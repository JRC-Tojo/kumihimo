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

export const useRelationalStore = defineStore('relational', {
  state: () => ({
    // ファイル単位で読み込んだ関係性エッジ（src・target問わずそのファイルが関わるもの）
    edgesByFileKey: {} as Record<string, RelationalEdge[]>,
  }),

  getters: {
    /**
     * 指定アノテーションがsrc・target問わず関わるエッジ一覧（重複除去済み）
     */
    edgesForAnnotation(state): (annotId: AnnotationID) => RelationalEdge[] {
      return (annotId: AnnotationID) => {
        const allEdges = Object.values(state.edgesByFileKey).flat();
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
      return (annotId: AnnotationID) => {
        const edges = this.edgesForAnnotation(annotId);
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
