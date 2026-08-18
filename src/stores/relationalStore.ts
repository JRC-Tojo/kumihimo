/* eslint-disable @typescript-eslint/no-unnecessary-type-assertion */
import { defineStore, acceptHMRUpdate } from 'pinia';
import { useBackendApi } from 'src/apis/backendApi';
import type { ContainerElementFile, ContainerID } from 'src/models/container';
import type { Relational } from 'src/models/relational/common';
import type {
  RelationalCheckedRule,
  RelationalEndpointID,
  RelationalRule,
} from 'src/models/relational/fileSchema';
import { buildRelationalRule, type RelationalRuleType } from 'src/models/relational/ruleUtils';
import { runConcurrently } from 'src/utils/promise/concurrent';
import { fileKey } from 'src/utils/document/fileKey';
import { Path } from 'src/utils/binary/path';

/**
 * 関係性の検証状態
 *
 * 'pending' はOCR未完了等により検証がまだ完了していないことを表す
 */
export type RelationalStatus = 'ok' | 'ng' | 'pending' | undefined;

export interface RelationalEdge {
  relational: Relational;
  checkedRule: RelationalCheckedRule | undefined;
  // 検証に用いた実際の値（OCR結果等）。判定基準を画面上で確認できるようにするため保持する
  srcVal: string;
  targetVal: string;
}

export { fileKey };

/**
 * 関係性の同一性を判定するキー
 *
 * srcID・targetIDの組だけを使う（ruleの内容は含めない）。同じアノテーション同士の関係性は
 * 常に1本しか存在し得ない（`removeRelationalEdge`もsrcID・targetIDのみで1本を特定する）ため、
 * ここでruleの内容までキーに含めてしまうと、srcファイル側とtargetファイル側それぞれの
 * `edgesByFileKey`キャッシュが更新タイミングのずれで一時的に異なるrule（例：計算式の
 * 登録有無）を保持した場合に、同じ関係性が別物として重複表示されてしまう
 */
function edgeKey(r: Relational): string {
  return `${r.srcID}|${r.targetID}`;
}

/**
 * 2つのファイルがcontainerID込みで同一かどうか
 *
 * pathは区切り文字表記の揺れによる不一致を防ぐため、Pathオブジェクトで正規化してから比較する
 */
function isSameFile(a: ContainerElementFile, b: ContainerElementFile): boolean {
  return a.containerID === b.containerID && new Path(a.path).path === new Path(b.path).path;
}

/**
 * エッジ一覧から検証状態を集計する（優先度: ng > pending > ok、空配列はundefined）
 */
function aggregateStatus(edges: RelationalEdge[]): RelationalStatus {
  if (edges.length === 0) return undefined;
  if (edges.some((edge) => edge.checkedRule?.isOK === false)) return 'ng';
  if (edges.some((edge) => edge.checkedRule === undefined)) return 'pending';
  return 'ok';
}

/**
 * 指定アノテーション側から見た比較値を返す（src側ならsrcVal、target側ならtargetVal）
 */
export function edgeValueFor(edge: RelationalEdge, annotId: RelationalEndpointID): string {
  return edge.relational.srcID === annotId ? edge.srcVal : edge.targetVal;
}

/**
 * 指定アノテーションの「相手側」の比較値を返す
 */
export function otherEdgeValueFor(edge: RelationalEdge, annotId: RelationalEndpointID): string {
  return edge.relational.srcID === annotId ? edge.targetVal : edge.srcVal;
}

export const useRelationalStore = defineStore('relational', {
  state: () => ({
    // ファイル単位で読み込んだ関係性エッジ（src・target問わずそのファイルが関わるもの）
    edgesByFileKey: {} as Record<string, RelationalEdge[]>,
  }),

  getters: {
    /**
     * 指定アノテーションがsrc・target問わず関わるエッジ一覧（重複除去済み）
     *
     * state.edgesByFileKeyへの依存はこのgetter自身の評価時点で読み取っておく
     * （返り値の関数の中で読むと、Piniaのgetterの依存追跡が曖昧になるため）
     */
    edgesForAnnotation(state): (annotId: RelationalEndpointID) => RelationalEdge[] {
      const allEdges = Object.values(state.edgesByFileKey).flat();
      return (annotId: RelationalEndpointID) => {
        const relevant = allEdges.filter(
          (edge) => edge.relational.srcID === annotId || edge.relational.targetID === annotId,
        );

        const dedupedByKey = new Map(relevant.map((edge) => [edgeKey(edge.relational), edge]));
        return Array.from(dedupedByKey.values());
      };
    },

    /**
     * 指定アノテーションの検証状態（優先度: ng > pending > ok、関連なしはundefined）
     */
    statusForAnnotation(): (annotId: RelationalEndpointID) => RelationalStatus {
      // this.edgesForAnnotationへのアクセスをここで行い、getter間の依存を明示的に確立する
      const getEdgesForAnnotation = this.edgesForAnnotation;
      return (annotId: RelationalEndpointID) => aggregateStatus(getEdgesForAnnotation(annotId));
    },

    /**
     * 指定ファイル（fileKey = `${containerID}|${path}`）が関わるエッジ全体の検証状態
     *
     * 読み込み済み（＝タブを開く等で`refreshFile`済み）のファイルのみ対象で、
     * 未読み込みのファイルに対して新規データ取得は行わない
     */
    statusForFile(state): (fileKey: string) => RelationalStatus {
      return (fileKey: string) => aggregateStatus(state.edgesByFileKey[fileKey] ?? []);
    },
  },

  actions: {
    /**
     * 指定ファイルが関わる関係性を読み込み、それぞれ検証してキャッシュを更新する
     */
    async refreshFile(file: ContainerElementFile): Promise<void> {
      const api = useBackendApi();

      // TODO: エラーハンドリング
      const relRes = await api.getRelationalsForFile(file);
      if (!relRes.ok) return;

      const edgeCheckers = relRes.data.map((edge) => async (): Promise<RelationalEdge> => {
        const checkedRes = await api.checkRelationalsSafe(edge);
        return {
          relational: edge.relational,
          checkedRule: checkedRes.ok ? checkedRes.data.checkedRule : undefined,
          srcVal: checkedRes.ok ? checkedRes.data.srcVal : '',
          targetVal: checkedRes.ok ? checkedRes.data.targetVal : '',
        };
      });

      this.edgesByFileKey[fileKey(file)] = await runConcurrently(edgeCheckers, 5);
    },

    /**
     * 編集対象のエッジについて、自身のファイルだけでなく相手側アノテーションのファイルの
     * 関係性キャッシュも合わせて更新する（別ファイル間の関係性が、開いていないタブ側の
     * キャッシュに古い情報が残ったままにならないようにする）
     */
    async refreshEdgeBothEndpoints(
      file: ContainerElementFile,
      edge: RelationalEdge,
      selfId: RelationalEndpointID,
    ): Promise<void> {
      const api = useBackendApi();
      await this.refreshFile(file);

      const otherId =
        edge.relational.srcID === selfId ? edge.relational.targetID : edge.relational.srcID;
      const otherFileRes = await api.resolveAnnotationFile(otherId);
      if (otherFileRes.ok && !isSameFile(otherFileRes.data, file)) {
        await this.refreshFile(otherFileRes.data);
      }
    },

    /**
     * 関係性のルールを変更する（既存の1本を削除してから新しいルールで登録し直す）
     *
     * 削除と登録は別々のAPI呼び出しのため、途中で失敗すると中途半端な状態
     * （リンクが消えたままになる等）が残りうる。新ルールでの再登録に失敗した場合は
     * 元のルールで登録し直すロールバックを試みることで、データを失わないようにする。
     * 戻り値は最終的にユーザーの意図した変更（新ルールでの登録）が成功したかどうか
     */
    async updateRelationalRule(
      file: ContainerElementFile,
      edge: RelationalEdge,
      selfId: RelationalEndpointID,
      newRule: RelationalRule,
    ): Promise<boolean> {
      const api = useBackendApi();

      const removeRes = await api.removeRelationalEdge(
        edge.relational.srcID,
        edge.relational.targetID,
      );
      if (!removeRes.ok) return false;

      const registRes = await api.registRelationals({
        srcID: edge.relational.srcID,
        targetID: edge.relational.targetID,
        rule: newRule,
      });

      if (!registRes.ok) {
        // 新ルールでの再登録に失敗した場合、リンク自体が失われないよう元のルールで登録し直す
        // TODO: このロールバック自体が失敗した場合のエラーハンドリング
        await api.registRelationals({
          srcID: edge.relational.srcID,
          targetID: edge.relational.targetID,
          rule: edge.relational.rule,
        });
        await this.refreshEdgeBothEndpoints(file, edge, selfId);
        return false;
      }

      await this.refreshEdgeBothEndpoints(file, edge, selfId);
      return true;
    },

    /**
     * 関係性のルール種別（equal/link）を変更する（`updateRelationalRule`の薄いラッパー）
     */
    changeRelationalRuleType(
      file: ContainerElementFile,
      edge: RelationalEdge,
      selfId: RelationalEndpointID,
      newType: RelationalRuleType,
    ): Promise<boolean> {
      return this.updateRelationalRule(file, edge, selfId, buildRelationalRule(newType));
    },

    /**
     * リネーム・移動されたファイルのキャッシュキーを付け替える
     *
     * `edgesByFileKey`は`containerID|path`をキーにしているため、リネーム後もキャッシュを
     * 再利用できるようにキーだけ新パスへ書き換える（内容の再検証は不要）
     */
    remapFileKeys(containerID: ContainerID, pathMap: Record<string, string>): void {
      const updated: Record<string, RelationalEdge[]> = {};
      for (const [key, edges] of Object.entries(this.edgesByFileKey)) {
        const [cID, path] = key.split('|');
        if (cID === containerID && path !== undefined && pathMap[path] !== undefined) {
          updated[`${cID}|${pathMap[path]}`] = edges;
        } else {
          updated[key] = edges;
        }
      }
      this.edgesByFileKey = updated;
    },
  },
});

if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(useRelationalStore, import.meta.hot));
}
