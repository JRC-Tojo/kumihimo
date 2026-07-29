/* eslint-disable @typescript-eslint/no-unnecessary-type-assertion */
import { defineStore, acceptHMRUpdate } from 'pinia';
import { useBackendApi } from 'src/apis/backendApi';
import type { ContainerElementFile, ContainerID } from 'src/models/container';
import type { AnnotationID } from 'src/models/document/pdf';
import type { Relational } from 'src/models/relational/common';
import type { RelationalCheckedRule } from 'src/models/relational/fileSchema';
import { runConcurrently } from 'src/utils/promise/concurrent';
import { fileKey } from 'src/utils/document/fileKey';

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

function edgeKey(r: Relational): string {
  return `${r.srcID}|${r.targetID}|${JSON.stringify(r.rule)}`;
}

/**
 * 2つのファイルがcontainerID込みで同一かどうか
 */
function isSameFile(a: ContainerElementFile, b: ContainerElementFile): boolean {
  return a.containerID === b.containerID && a.path === b.path;
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
export function edgeValueFor(edge: RelationalEdge, annotId: AnnotationID): string {
  return edge.relational.srcID === annotId ? edge.srcVal : edge.targetVal;
}

/**
 * 指定アノテーションの「相手側」の比較値を返す
 */
export function otherEdgeValueFor(edge: RelationalEdge, annotId: AnnotationID): string {
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
    edgesForAnnotation(state): (annotId: AnnotationID) => RelationalEdge[] {
      const allEdges = Object.values(state.edgesByFileKey).flat();
      return (annotId: AnnotationID) => {
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
    statusForAnnotation(): (annotId: AnnotationID) => RelationalStatus {
      // this.edgesForAnnotationへのアクセスをここで行い、getter間の依存を明示的に確立する
      const getEdgesForAnnotation = this.edgesForAnnotation;
      return (annotId: AnnotationID) => aggregateStatus(getEdgesForAnnotation(annotId));
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
      selfId: AnnotationID,
    ): Promise<void> {
      const api = useBackendApi();
      await this.refreshFile(file);

      const otherId = edge.relational.srcID === selfId ? edge.relational.targetID : edge.relational.srcID;
      const otherFileRes = await api.resolveAnnotationFile(otherId);
      if (otherFileRes.ok && !isSameFile(otherFileRes.data, file)) {
        await this.refreshFile(otherFileRes.data);
      }
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
