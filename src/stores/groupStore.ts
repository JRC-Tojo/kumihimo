/* eslint-disable @typescript-eslint/no-unnecessary-type-assertion */
import { defineStore, acceptHMRUpdate } from 'pinia';
import { useBackendApi } from 'src/apis/backendApi';
import type { ContainerElementFile, ContainerID } from 'src/models/container';
import type { AnnotationID } from 'src/models/document/pdf';
import type { AnnotationGroup, AnnotationGroupID } from 'src/models/document/group';
import { fileKey } from 'src/utils/document/fileKey';

export { fileKey };

export const useGroupStore = defineStore('annotationGroup', {
  state: () => ({
    // ファイル単位で読み込んだグループ一覧
    groupsByFileKey: {} as Record<string, AnnotationGroup[]>,
  }),

  getters: {
    /**
     * 指定IDが所属するグループを探す（グループ自身のID・メンバーのIDのどちらからでも解決できる）
     *
     * state.groupsByFileKeyへの依存はこのgetter自身の評価時点で読み取っておく
     * （返り値の関数の中で読むと、Piniaのgetterの依存追跡が曖昧になるため）
     */
    groupContaining(
      state,
    ): (fk: string, id: AnnotationID | AnnotationGroupID) => AnnotationGroup | undefined {
      return (fk, id) => {
        const groups = state.groupsByFileKey[fk] ?? [];
        return groups.find((g) => g.id === id || g.memberIds.includes(id as AnnotationID));
      };
    },

    /**
     * 指定IDが属するグループの全メンバーID集合を返す（属していない場合はundefined）
     *
     * クリック・矩形選択で選ばれたIDを、グループ全体の選択へ展開するために使う
     */
    memberSet(): (
      fk: string,
      id: AnnotationID | AnnotationGroupID,
    ) => Set<AnnotationID> | undefined {
      const getGroupContaining = this.groupContaining;
      return (fk, id) => {
        const group = getGroupContaining(fk, id);
        return group === undefined ? undefined : new Set(group.memberIds);
      };
    },

    /**
     * 指定したID集合が、既存グループの全メンバーとちょうど一致するグループを返す
     * （部分一致・過不足がある場合はundefined）
     *
     * 「選択範囲がまるごと1つのグループかどうか」の判定（グループ化解除メニューの表示可否、
     * 関係性ダイアログをグループ単位で開くかどうかの判定）に使う
     */
    matchingGroup(state): (fk: string, ids: AnnotationID[]) => AnnotationGroup | undefined {
      return (fk, ids) => {
        if (ids.length < 2) return undefined;
        const idSet = new Set(ids);
        const groups = state.groupsByFileKey[fk] ?? [];
        return groups.find(
          (g) => g.memberIds.length === idSet.size && g.memberIds.every((id) => idSet.has(id)),
        );
      };
    },
  },

  actions: {
    /**
     * 指定ファイルのグループ一覧を読み込み、キャッシュを更新する
     */
    async refreshFile(file: ContainerElementFile): Promise<void> {
      const api = useBackendApi();
      const res = await api.listAnnotationGroups(file);
      if (!res.ok) return;

      this.groupsByFileKey[fileKey(file)] = res.data;
    },

    /**
     * リネーム・移動されたファイルのキャッシュキーを付け替える
     */
    remapFileKeys(containerID: ContainerID, pathMap: Record<string, string>): void {
      const updated: Record<string, AnnotationGroup[]> = {};
      for (const [key, groups] of Object.entries(this.groupsByFileKey)) {
        const [cID, path] = key.split('|');
        if (cID === containerID && path !== undefined && pathMap[path] !== undefined) {
          updated[`${cID}|${pathMap[path]}`] = groups;
        } else {
          updated[key] = groups;
        }
      }
      this.groupsByFileKey = updated;
    },
  },
});

if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(useGroupStore, import.meta.hot));
}
