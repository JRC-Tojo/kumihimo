/**
 * アノテーションの作成・変更・削除をUndo/Redo履歴（historyStore）に記録しつつ実行するコンポーザブル
 *
 * 固定の依存を持たないステートレスな設計とし、file・アノテーションを呼び出しごとの引数として
 * 受け取る。そのため、DocumentTabViewの子孫コンポーネントかどうかに関わらず、
 * アノテーションのCRUDを行うあらゆる箇所（描画・スタイルパネル編集・右クリックメニュー等）から
 * propsの受け渡しなしにそのまま呼び出せる
 */

import dayjs from 'dayjs';
import { useBackendApi } from 'src/apis/backendApi';
import { useHistoryStore } from 'src/stores/historyStore';
import { useRelationalStore } from 'src/stores/relationalStore';
import { useGroupStore } from 'src/stores/groupStore';
import { fileKey } from 'src/utils/document/fileKey';
import type { ApiResponse } from 'src/models/error/api';
import type { ContainerElementFile } from 'src/models/container';
import type { AnnotationID, AnnotationStyle } from 'src/models/document/pdf';
import type { AnnotationInfo, RelationalEndpointID } from 'src/models/relational/fileSchema';
import type { Relational } from 'src/models/relational/common';
import type { AnnotationGroup, AnnotationGroupID } from 'src/models/document/group';

/** 2つのファイルがcontainerID込みで同一かどうか */
function isSameFile(a: ContainerElementFile, b: ContainerElementFile): boolean {
  return a.containerID === b.containerID && a.path === b.path;
}

/** 関係性の一意キー（src/targetの組で同一のエッジを識別する） */
function relationalKey(r: Relational): string {
  return `${r.srcID}|${r.targetID}`;
}

/** 複数アノテーションから捕捉した関係性一覧を、同一エッジの重複を除いてまとめる */
function dedupRelationals(relationalsById: Map<AnnotationID, Relational[]>): Relational[] {
  const merged = new Map<string, Relational>(
    [...relationalsById.values()].flat().map((r) => [relationalKey(r), r]),
  );
  return [...merged.values()];
}

export function useAnnotationHistory() {
  const api = useBackendApi();
  const historyStore = useHistoryStore();
  const relationalStore = useRelationalStore();
  const groupStore = useGroupStore();

  /**
   * 削除前に、対象アノテーションがsrc・target問わず関わる関係性一覧をキャプチャする（undo時の復元用）
   *
   * relationalStoreのキャッシュは対象アノテーションの属するファイルがrefreshFile済みであれば
   * （タブを開いている間は常に最新化されている）漏れなく取得できる
   */
  function captureRelationals(annotID: RelationalEndpointID): Relational[] {
    return relationalStore.edgesForAnnotation(annotID).map((edge) => edge.relational);
  }

  /**
   * 関係性の復元・再削除いずれの後も、影響を受けるファイル（自分・関係性の相手）双方の
   * 検証キャッシュを再検証する
   */
  async function refreshRelationalCachesAfter(
    file: ContainerElementFile,
    selfId: RelationalEndpointID,
    relationals: Relational[],
  ): Promise<void> {
    await relationalStore.refreshFile(file);

    await Promise.all(
      relationals.map(async (relational) => {
        const otherId = relational.srcID === selfId ? relational.targetID : relational.srcID;
        const otherFileRes = await api.resolveAnnotationFile(otherId);
        if (otherFileRes.ok && !isSameFile(otherFileRes.data, file)) {
          await relationalStore.refreshFile(otherFileRes.data);
        }
      }),
    );
  }

  /** 単一アノテーションの登録（作成/更新）を履歴付きで行う */
  async function registerWithHistory(
    file: ContainerElementFile,
    previous: AnnotationStyle | undefined,
    next: AnnotationStyle,
  ): Promise<ApiResponse<AnnotationInfo>> {
    const res = await api.registerAnnotationStyle(file, next);
    if (res.ok) {
      historyStore.push(file, {
        undo: async () => {
          if (previous) await api.registerAnnotationStyle(file, previous);
          else await api.removeAnnotation(next.id);
        },
        redo: async () => {
          await api.registerAnnotationStyle(file, next);
        },
      });
    }
    return res;
  }

  /** 複数アノテーションの登録（作成/更新）をまとめて1つのUndoステップとして扱う */
  async function registerManyWithHistory(
    file: ContainerElementFile,
    items: { previous: AnnotationStyle; next: AnnotationStyle }[],
  ): Promise<void> {
    if (items.length === 0) return;

    const results = await Promise.all(
      items.map((item) => api.registerAnnotationStyle(file, item.next)),
    );
    // 1件でも失敗していれば、undo/redoの対象が不完全になるため履歴には積まない
    if (!results.every((res) => res.ok)) return;

    historyStore.push(file, {
      undo: async () => {
        await Promise.all(items.map((item) => api.registerAnnotationStyle(file, item.previous)));
      },
      redo: async () => {
        await Promise.all(items.map((item) => api.registerAnnotationStyle(file, item.next)));
      },
    });
  }

  /**
   * 選択中アノテーション群に種別依存のpatchを適用し、registerManyWithHistoryへ渡す
   * previous/nextペアの配列を組み立てる（対象外の種別はbuildingがnullを返すことで除外される）
   *
   * useAnnotationStylePanel（パネル編集）が使う共通ロジックをここに集約する
   */
  function buildRegisterManyItems(
    annots: AnnotationStyle[],
    building: (annot: AnnotationStyle) => Partial<AnnotationStyle> | null,
  ): { previous: AnnotationStyle; next: AnnotationStyle }[] {
    const now = dayjs().toISOString();
    return annots
      .map((annot) => {
        const patch = building(annot);
        return patch
          ? { previous: annot, next: { ...annot, ...patch, updatedAt: now } as AnnotationStyle }
          : null;
      })
      .filter((i): i is { previous: AnnotationStyle; next: AnnotationStyle } => i !== null);
  }

  /**
   * 削除対象アノテーションが所属していたグループへの影響（部分メンバー除去、または
   * 残りメンバー数がMIN_GROUP_MEMBERSを下回る場合の解散）を捕捉・適用する。
   * 戻り値の削除前スナップショットは、undo時に`api.restoreGroup`でそっくり復元するために使う。
   *
   * グループを解散する場合、`api.ungroupAnnotations`はそのグループが関係性の端点として
   * 持っていた関係性も削除してしまう。解散前に捕捉しておかないとundoでグループを復元しても
   * その関係性は失われたままになるため、`relationalsByGroupId`として合わせて返す
   */
  async function applyGroupImpactForRemoval(
    file: ContainerElementFile,
    removedIds: AnnotationID[],
  ): Promise<{
    groups: AnnotationGroup[];
    relationalsByGroupId: Map<AnnotationGroupID, Relational[]>;
  }> {
    const removedSet = new Set(removedIds);
    const groups = groupStore.groupsByFileKey[fileKey(file)] ?? [];
    const affected = groups.filter((g) => g.memberIds.some((id) => removedSet.has(id)));
    if (affected.length === 0) return { groups: [], relationalsByGroupId: new Map() };

    const snapshots = affected.map((g) => ({ ...g, memberIds: [...g.memberIds] }));
    const relationalsByGroupId = new Map<AnnotationGroupID, Relational[]>();

    for (const g of affected) {
      const idsToRemove = g.memberIds.filter((id) => removedSet.has(id));
      const res = await api.removeGroupMembers(file, g.id, idsToRemove);
      if (!res.ok) {
        relationalsByGroupId.set(g.id, captureRelationals(g.id));
        await api.ungroupAnnotations(file, g.id);
      }
    }
    await groupStore.refreshFile(file);
    return { groups: snapshots, relationalsByGroupId };
  }

  /**
   * 単一アノテーションの削除を履歴付きで行う
   *
   * 削除前に紐づく関係性を捕捉しておき、undo時にはアノテーション本体→関係性の順に再登録する
   * （関係性の登録はsrc/target双方のアドレス解決にアノテーション本体の存在を要求するため、
   * 本体を先に復元する必要がある）。redo（再削除）はapi.removeAnnotationの既存カスケード
   * 削除ロジックに任せる。
   *
   * 注意：リンクしていた相手側のアノテーションが別の操作で削除されたまま復元されていない場合、
   * そのリンクの再登録は失敗する（本体側のUndo自体は常に成功する。既知の制限）
   */
  async function removeWithHistory(
    file: ContainerElementFile,
    removed: AnnotationStyle,
  ): Promise<ApiResponse<void>> {
    const relationals = captureRelationals(removed.id);
    const res = await api.removeAnnotation(removed.id);
    if (res.ok) {
      const { groups: affectedGroups, relationalsByGroupId: dissolvedRelationalsByGroupId } =
        await applyGroupImpactForRemoval(file, [removed.id]);
      historyStore.push(file, {
        undo: async () => {
          await api.registerAnnotationStyle(file, removed);
          await Promise.all(affectedGroups.map((g) => api.restoreGroup(file, g)));
          if (affectedGroups.length > 0) await groupStore.refreshFile(file);
          const dissolvedGroupRelationals = affectedGroups.flatMap(
            (g) => dissolvedRelationalsByGroupId.get(g.id) ?? [],
          );
          await Promise.all(
            [...relationals, ...dissolvedGroupRelationals].map((r) => api.registRelationals(r)),
          );
          await refreshRelationalCachesAfter(file, removed.id, relationals);
          await Promise.all(
            affectedGroups.map((g) =>
              refreshRelationalCachesAfter(file, g.id, dissolvedRelationalsByGroupId.get(g.id) ?? []),
            ),
          );
        },
        redo: async () => {
          await api.removeAnnotation(removed.id);
          const { groups: redoneGroups, relationalsByGroupId: redoneRelationalsByGroupId } =
            await applyGroupImpactForRemoval(file, [removed.id]);
          await refreshRelationalCachesAfter(file, removed.id, relationals);
          await Promise.all(
            redoneGroups.map((g) =>
              refreshRelationalCachesAfter(file, g.id, redoneRelationalsByGroupId.get(g.id) ?? []),
            ),
          );
        },
      });
    }
    return res;
  }

  /** 複数アノテーションの削除をまとめて1つのUndoステップとして扱う（関係性の捕捉・復元も同様） */
  async function removeManyWithHistory(
    file: ContainerElementFile,
    removedList: AnnotationStyle[],
  ): Promise<void> {
    if (removedList.length === 0) return;

    const relationalsById = new Map(
      removedList.map((a) => [a.id, captureRelationals(a.id)] as const),
    );
    const results = await Promise.all(removedList.map((a) => api.removeAnnotation(a.id)));
    // 1件でも失敗していれば、undo/redoの対象が不完全になるため履歴には積まない
    if (!results.every((res) => res.ok)) return;

    // 複数削除で2つ以上のグループを同時に縮小・解散させる場合も、影響適用はまとめて1回で行う
    const { groups: affectedGroups, relationalsByGroupId: dissolvedRelationalsByGroupId } =
      await applyGroupImpactForRemoval(
        file,
        removedList.map((a) => a.id),
      );

    historyStore.push(file, {
      undo: async () => {
        await Promise.all(removedList.map((a) => api.registerAnnotationStyle(file, a)));
        await Promise.all(affectedGroups.map((g) => api.restoreGroup(file, g)));
        if (affectedGroups.length > 0) await groupStore.refreshFile(file);
        // 削除対象同士が互いにリンクしていた場合、両端のrelationalsByIdエントリに
        // 同じエッジが重複して含まれるため、登録前に一意化する
        const dedupedRelationals = dedupRelationals(relationalsById);
        const dissolvedGroupRelationals = affectedGroups.flatMap(
          (g) => dissolvedRelationalsByGroupId.get(g.id) ?? [],
        );
        await Promise.all(
          [...dedupedRelationals, ...dissolvedGroupRelationals].map((r) =>
            api.registRelationals(r),
          ),
        );
        await Promise.all(
          removedList.map((a) =>
            refreshRelationalCachesAfter(file, a.id, relationalsById.get(a.id) ?? []),
          ),
        );
        await Promise.all(
          affectedGroups.map((g) =>
            refreshRelationalCachesAfter(file, g.id, dissolvedRelationalsByGroupId.get(g.id) ?? []),
          ),
        );
      },
      redo: async () => {
        await Promise.all(removedList.map((a) => api.removeAnnotation(a.id)));
        const { groups: redoneGroups, relationalsByGroupId: redoneRelationalsByGroupId } =
          await applyGroupImpactForRemoval(
            file,
            removedList.map((a) => a.id),
          );
        await Promise.all(
          removedList.map((a) =>
            refreshRelationalCachesAfter(file, a.id, relationalsById.get(a.id) ?? []),
          ),
        );
        await Promise.all(
          redoneGroups.map((g) =>
            refreshRelationalCachesAfter(file, g.id, redoneRelationalsByGroupId.get(g.id) ?? []),
          ),
        );
      },
    });
  }

  /**
   * 貼り付け・複製で新規作成された複数アノテーションを、1つのUndoステップとして記録する
   *
   * API呼び出し（api.pasteAnnotations）は呼び出し元で既に完了済みであるため、ここでは
   * 履歴の記録のみを行う
   */
  function recordCreatedBatch(file: ContainerElementFile, created: AnnotationStyle[]): void {
    if (created.length === 0) return;

    historyStore.push(file, {
      undo: async () => {
        await Promise.all(created.map((a) => api.removeAnnotation(a.id)));
      },
      redo: async () => {
        await Promise.all(created.map((a) => api.registerAnnotationStyle(file, a)));
      },
    });
  }

  /**
   * 重ね順変更など、before/afterのペアが既に確定している複数アノテーションの変更を
   * 1つのUndoステップとして記録する（API呼び出しは呼び出し元で既に完了済み）
   */
  function recordChangedBatch(
    file: ContainerElementFile,
    pairs: { before: AnnotationStyle; after: AnnotationStyle }[],
  ): void {
    if (pairs.length === 0) return;

    historyStore.push(file, {
      undo: async () => {
        await Promise.all(pairs.map((p) => api.registerAnnotationStyle(file, p.before)));
      },
      redo: async () => {
        await Promise.all(pairs.map((p) => api.registerAnnotationStyle(file, p.after)));
      },
    });
  }

  /**
   * 貼り付け・複製で作成したアノテーション群と、それに対応する新規グループ（あれば）を
   * 1つのUndoステップとして記録する（API呼び出しは呼び出し元で既に完了済み）
   *
   * `createdGroup`は値算出方法の設定まで終えた最終状態を渡すこと（redoでのapi.restoreGroupが
   * 一度でその状態まで復元できるようにするため）
   */
  function recordCreatedBatchWithGroup(
    file: ContainerElementFile,
    created: AnnotationStyle[],
    createdGroup: AnnotationGroup | undefined,
  ): void {
    if (created.length === 0) return;

    historyStore.push(file, {
      undo: async () => {
        if (createdGroup) await api.ungroupAnnotations(file, createdGroup.id);
        await Promise.all(created.map((a) => api.removeAnnotation(a.id)));
        if (createdGroup) await groupStore.refreshFile(file);
      },
      redo: async () => {
        await Promise.all(created.map((a) => api.registerAnnotationStyle(file, a)));
        if (createdGroup) {
          await api.restoreGroup(file, createdGroup);
          await groupStore.refreshFile(file);
        }
      },
    });
  }

  /**
   * グループ化を1つのUndoステップとして記録する（api.groupAnnotationsは呼び出し元で実行済み）
   *
   * undo：新規グループを解除し、解散していた既存グループがあればそっくり復元したうえで
   * それらに紐づいていた関係性も再登録する。redo：新規グループの復元のため既存グループを
   * 再度解散し、新規グループを復元する
   */
  function recordGroupCreated(
    file: ContainerElementFile,
    newGroup: AnnotationGroup,
    dissolvedGroups: AnnotationGroup[],
    dissolvedRelationalsByGroupId: Map<AnnotationGroupID, Relational[]>,
  ): void {
    historyStore.push(file, {
      undo: async () => {
        await api.ungroupAnnotations(file, newGroup.id);
        await Promise.all(dissolvedGroups.map((g) => api.restoreGroup(file, g)));
        const relationals = [
          ...new Map(
            dissolvedGroups
              .flatMap((g) => dissolvedRelationalsByGroupId.get(g.id) ?? [])
              .map((r) => [relationalKey(r), r] as const),
          ).values(),
        ];
        await Promise.all(relationals.map((r) => api.registRelationals(r)));
        await groupStore.refreshFile(file);
        await Promise.all(
          dissolvedGroups.map((g) =>
            refreshRelationalCachesAfter(file, g.id, dissolvedRelationalsByGroupId.get(g.id) ?? []),
          ),
        );
      },
      redo: async () => {
        await Promise.all(dissolvedGroups.map((g) => api.ungroupAnnotations(file, g.id)));
        await api.restoreGroup(file, newGroup);
        await groupStore.refreshFile(file);
        // undo同様、解散し直したグループの関係性キャッシュも更新しないと、相手側ファイルの
        // タブが古い関係性・検証状態を表示し続けてしまう
        await Promise.all(
          dissolvedGroups.map((g) =>
            refreshRelationalCachesAfter(file, g.id, dissolvedRelationalsByGroupId.get(g.id) ?? []),
          ),
        );
      },
    });
  }

  /**
   * グループ解除を1つのUndoステップとして記録する（api.ungroupAnnotationsは呼び出し元で実行済み）
   */
  function recordGroupRemoved(
    file: ContainerElementFile,
    removedGroup: AnnotationGroup,
    relationals: Relational[],
  ): void {
    historyStore.push(file, {
      undo: async () => {
        await api.restoreGroup(file, removedGroup);
        await Promise.all(relationals.map((r) => api.registRelationals(r)));
        await groupStore.refreshFile(file);
        await refreshRelationalCachesAfter(file, removedGroup.id, relationals);
      },
      redo: async () => {
        await api.ungroupAnnotations(file, removedGroup.id);
        await groupStore.refreshFile(file);
      },
    });
  }

  /**
   * グループ値算出方法の変更を1つのUndoステップとして記録する（api呼び出しは呼び出し元で実行済み）
   */
  function recordGroupAggregationChanged(
    file: ContainerElementFile,
    groupId: AnnotationGroupID,
    previous: AnnotationGroup['valueAggregation'],
    next: AnnotationGroup['valueAggregation'],
  ): void {
    historyStore.push(file, {
      undo: async () => {
        await api.updateGroupValueAggregation(file, groupId, previous);
        await groupStore.refreshFile(file);
      },
      redo: async () => {
        await api.updateGroupValueAggregation(file, groupId, next);
        await groupStore.refreshFile(file);
      },
    });
  }

  return {
    registerWithHistory,
    registerManyWithHistory,
    removeWithHistory,
    removeManyWithHistory,
    recordCreatedBatch,
    recordCreatedBatchWithGroup,
    recordChangedBatch,
    recordGroupCreated,
    recordGroupRemoved,
    recordGroupAggregationChanged,
    captureRelationals,
    buildRegisterManyItems,
  };
}
