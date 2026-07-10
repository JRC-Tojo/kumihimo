/* eslint-disable @typescript-eslint/no-unnecessary-type-assertion */
import { defineStore, acceptHMRUpdate } from 'pinia';
import { useBackendApi } from 'src/apis/backendApi';
import type { ContainerElementFile } from 'src/models/container';
import type { AnnotationID } from 'src/models/document/pdf';
import type { Relational } from 'src/models/relational/common';
import type { RelationalCheckedRule } from 'src/models/relational/fileSchema';

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

/**
 * ファイルのキャッシュキー（containerIDまで含めて同一性判定する）
 */
function fileKey(f: ContainerElementFile): string {
  return `${f.containerID}|${f.path}`;
}

function edgeKey(r: Relational): string {
  return `${r.srcID}|${r.targetID}|${JSON.stringify(r.rule)}`;
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
      return (annotId: AnnotationID) => {
        const edges = getEdgesForAnnotation(annotId);
        if (edges.length === 0) return undefined;
        if (edges.some((edge) => edge.checkedRule?.isOK === false)) return 'ng';
        if (edges.some((edge) => edge.checkedRule === undefined)) return 'pending';
        return 'ok';
      };
    },
  },

  actions: {
    /**
     * 指定ファイルが関わる関係性を読み込み、それぞれ検証してキャッシュを更新する
     */
    async refreshFile(file: ContainerElementFile): Promise<void> {
      const api = useBackendApi();

      const relRes = await api.getRelationalsForFile(file);
      if (!relRes.ok) return;

      const edges = await Promise.all(
        relRes.data.map(async ({ relational }): Promise<RelationalEdge> => {
          const checkedRes = await api.checkRelationalsSafe(relational);
          return {
            relational,
            checkedRule: checkedRes.ok ? checkedRes.data.checkedRule : undefined,
            srcVal: checkedRes.ok ? checkedRes.data.srcVal : '',
            targetVal: checkedRes.ok ? checkedRes.data.targetVal : '',
          };
        }),
      );

      this.edgesByFileKey[fileKey(file)] = edges;
    },
  },
});

if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(useRelationalStore, import.meta.hot));
}
