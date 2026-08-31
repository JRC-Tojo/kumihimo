/**
 * アノテーション・グループ・関係性の作成/変更/削除をUndo/Redo履歴（historyStore）に
 * 記録しつつ実行するコンポーザブル
 *
 * 固定の依存を持たないステートレスな設計とし、file・アノテーションを呼び出しごとの引数として
 * 受け取る。そのため、DocumentTabViewの子孫コンポーネントかどうかに関わらず、
 * アノテーションのCRUDを行うあらゆる箇所（描画・スタイルパネル編集・右クリックメニュー等）から
 * propsの受け渡しなしにそのまま呼び出せる。
 *
 * ## 関数の2つの形（既存パターンを増やす際はどちらかに合わせること）
 * - 「実行して記録する」形（`registerWithHistory`・`removeWithHistory`）：この関数自身がAPI呼び出し
 *   まで行う。呼び出し元は結果（`ApiResponse`）だけを見ればよい
 * - 「記録のみ」形（`recordCreatedBatch`・`recordGroupCreated`等）：呼び出し元が既にAPI呼び出しを
 *   終えている前提で、undo/redoの手順だけを登録する。複数のAPI呼び出し・分岐を伴う操作
 *   （ペースト＋グループ再構築等）はこちらの形が合う
 *
 * ## 関係性（Relational）を巻き込む操作の設計方針
 * アノテーション・グループはいずれも関係性の端点（`RelationalEndpointID`）になりうる。
 * 端点を削除・解散する操作は、その端点が持つ関係性も巻き添えで消してしまうため、undo可能に
 * するには「壊す直前に関係性を捕捉し、undo/redoの都度そのスナップショットで復元・後始末する」
 * 必要がある（`captureRelationalSnapshot`・`restoreRelationalSnapshot`参照）。
 *
 * 一方、関係性の新規登録・削除・ルール変更そのものも`recordRelationalCreated`等でUndo履歴に
 * 乗る。これにより「新規作成したアノテーション（グループ）に関係性を結び、その後で作成自体を
 * Undoする」という操作順でも、関係性側の取り消しが履歴スタック上で必ず先（後着順）に処理される
 * ため、`registerWithHistory`・`recordCreatedBatch`系が個別に関係性を捕捉する必要はない
 * （スタックの構造上、より新しい操作から順にundoされることが保証されているため）。
 * 巻き添え解散のように「エンティティ自体を対象としたUndoステップが存在しないまま関係性ごと
 * 消える」パターンにだけ、上記のスナップショット捕捉が必要になる
 */

import dayjs from 'dayjs';
import { useBackendApi } from 'src/apis/backendApi';
import { useHistoryStore } from 'src/stores/historyStore';
import { useRelationalStore } from 'src/stores/relationalStore';
import { useGroupStore } from 'src/stores/groupStore';
import { fileKey } from 'src/utils/document/fileKey';
import {
  markAnnotationWriteIntent,
  cancelAnnotationWriteIntent,
} from 'src/utils/document/annotationWritePending';
import type { ApiResponse } from 'src/models/error/api';
import type { ContainerElementFile } from 'src/models/container';
import type { AnnotationID, AnnotationStyle } from 'src/models/document/pdf';
import type { AnnotationInfo, RelationalEndpointID } from 'src/models/relational/fileSchema';
import type { Relational } from 'src/models/relational/common';
import type { AnnotationGroup, AnnotationGroupID } from 'src/models/document/group';

/** 関係性の一意キー（src/targetの組で同一のエッジを識別する） */
function relationalKey(r: Relational): string {
  return `${r.srcID}|${r.targetID}`;
}

/**
 * 関係性の端点（アノテーション・グループ問わず）ごとに、ある時点で捕捉した関係性一覧を
 * まとめたスナップショット
 *
 * 「端点を削除・解散する直前に捕捉し、undoで復元・redoで後始末する」という繰り返し出てくる
 * パターンを共通の形で扱うための型。`captureRelationalSnapshot`で作り、
 * `restoreRelationalSnapshot`・`refreshRelationalSnapshotCaches`にそのまま渡す
 */
export type RelationalSnapshot = Map<RelationalEndpointID, Relational[]>;

export function useAnnotationHistory() {
  const api = useBackendApi();
  const historyStore = useHistoryStore();
  const relationalStore = useRelationalStore();
  const groupStore = useGroupStore();

  /**
   * `api.registerAnnotationStyle`を、対象IDの「ローカルで意図した内容」の目印
   * （`annotationWritePending.ts`）を立てた状態で呼ぶ
   *
   * このファイル内の登録系関数はUndo/Redoのコールバックも含め、必ずこのラッパー経由で
   * `api.registerAnnotationStyle(s)`を呼ぶこと。素の`api`を直接呼ぶと、DB購読側の反映
   * （liveQuery）が書き込みの完了より遅れて届いた場合に、確定直後の画面が一時的に古い状態へ
   * 巻き戻って見える（`useAnnotationShape.ts`のdisplayAnnotation・resolveAnnotationEcho参照）
   */
  async function registerStyleTracked(
    file: ContainerElementFile,
    style: AnnotationStyle,
  ): Promise<ApiResponse<AnnotationInfo>> {
    markAnnotationWriteIntent(style.id, style.updatedAt);
    const res = await api.registerAnnotationStyle(file, style);
    if (!res.ok) cancelAnnotationWriteIntent(style.id, style.updatedAt);
    return res;
  }

  /** `registerStyleTracked`の複数件版（`api.registerAnnotationStyles`用） */
  async function registerStylesTracked(
    file: ContainerElementFile,
    styles: AnnotationStyle[],
  ): Promise<ApiResponse<AnnotationInfo[]>> {
    styles.forEach((s) => markAnnotationWriteIntent(s.id, s.updatedAt));
    const res = await api.registerAnnotationStyles(file, styles);
    if (!res.ok) styles.forEach((s) => cancelAnnotationWriteIntent(s.id, s.updatedAt));
    return res;
  }

  /**
   * 指定端点（アノテーションまたはグループ）がsrc・target問わず関わる関係性一覧を捕捉する
   *
   * relationalStoreのキャッシュは対象の属するファイルがrefreshFile済みであれば
   * （タブを開いている間は常に最新化されている）漏れなく取得できる
   */
  function captureRelationals(endpointId: RelationalEndpointID): Relational[] {
    return relationalStore.edgesForAnnotation(endpointId).map((edge) => edge.relational);
  }

  /**
   * 複数の端点について、呼び出した瞬間の関係性をまとめて捕捉したスナップショットを作る
   *
   * 直後にその端点を削除・解散する操作を安全に行えるようになる。undo/redoどちらから
   * 呼ぶ場合も、実行の都度その時点の最新状態を捕捉するために呼び直すこと
   * （1度だけ捕捉した結果を使い回さない。プラグイン等、履歴を経由しない関係性の変更が
   * 割り込む可能性があるため、常に「壊す直前」に捕捉するのが唯一安全な方法）
   */
  function captureRelationalSnapshot(endpointIds: RelationalEndpointID[]): RelationalSnapshot {
    return new Map(endpointIds.map((id) => [id, captureRelationals(id)]));
  }

  /** 複数のスナップショットを1つにまとめる（同じ端点が重複した場合は後に渡した方を優先する） */
  function mergeRelationalSnapshots(...snapshots: RelationalSnapshot[]): RelationalSnapshot {
    return new Map(snapshots.flatMap((s) => [...s]));
  }

  /**
   * 関係性の復元・再削除いずれの後も、影響を受けるファイル（自分・関係性の相手）双方の
   * 検証キャッシュを再検証する（実体はrelationalStore側の汎用版に委譲）
   */
  function refreshRelationalCachesAfter(
    file: ContainerElementFile,
    selfId: RelationalEndpointID,
    relationals: Relational[],
  ): Promise<void> {
    return relationalStore.refreshEndpointAndPeers(file, selfId, relationals);
  }

  /**
   * スナップショットに含まれる関係性をすべて（重複なく）再登録し、影響ファイルのキャッシュも
   * 再検証する。undo側：破棄前の状態を復元する
   */
  async function restoreRelationalSnapshot(
    file: ContainerElementFile,
    snapshot: RelationalSnapshot,
  ): Promise<void> {
    const deduped = new Map<string, Relational>(
      [...snapshot.values()].flat().map((r) => [relationalKey(r), r]),
    );
    await Promise.all([...deduped.values()].map((r) => api.registRelationals(r)));
    await refreshRelationalSnapshotCaches(file, snapshot);
  }

  /**
   * スナップショットが参照する関係性の相手先ファイルのキャッシュだけを再検証する
   * （関係性データ自体の再登録は行わない）。redo側：改めて破棄した直後の後始末に使う
   *
   * スナップショットに含まれる端点（アノテーション・グループ）は複数ありうるが、自ファイルの
   * 再検証は1回にまとめ、相手側ファイルも一意化してからそれぞれ1回だけ`refreshFile`する
   * （端点ごとに`refreshRelationalCachesAfter`を個別に呼ぶと、同じファイルへの再検証が
   * 選択件数に比例して重複実行され、undo/redoの応答が遅くなるため。
   * `relationalStore.refreshEndpointsAndPeers`参照）
   */
  async function refreshRelationalSnapshotCaches(
    file: ContainerElementFile,
    snapshot: RelationalSnapshot,
  ): Promise<void> {
    await relationalStore.refreshEndpointsAndPeers(file, [...snapshot]);
  }

  /** 単一アノテーションの登録（作成/更新）を履歴付きで行う */
  async function registerWithHistory(
    file: ContainerElementFile,
    previous: AnnotationStyle | undefined,
    next: AnnotationStyle,
  ): Promise<ApiResponse<AnnotationInfo>> {
    const res = await registerStyleTracked(file, next);
    if (res.ok) {
      historyStore.push(file, {
        undo: async () => {
          if (previous) await registerStyleTracked(file, previous);
          else await api.removeAnnotation(next.id);
        },
        redo: async () => {
          await registerStyleTracked(file, next);
        },
      });
    }
    return res;
  }

  /**
   * 複数アノテーションの登録（作成/更新）をまとめて1つのUndoステップとして扱う
   *
   * `registerAnnotationStyle`を件数分`Promise.all`で呼ぶと、DB書き込み（≒UI側のライブクエリ
   * 再発火）も件数分に分かれてしまい、グループドラッグ・複数選択の一括微調整・一括スタイル編集で
   * まとめて動かしたはずの複数要素が、画面上では1件ずつ遅れて動くように見えてしまう
   * （アノテーションDB書き込みをファイル単位で直列化するようになったことで、この遅れがより
   * はっきり現れるようになった）。1回のDB書き込みにまとめる`registerAnnotationStyles`を
   * 使うことで、対象全件が同時に確定・同時に画面へ反映されるようにする
   */
  async function registerManyWithHistory(
    file: ContainerElementFile,
    items: { previous: AnnotationStyle; next: AnnotationStyle }[],
  ): Promise<void> {
    if (items.length === 0) return;

    const res = await registerStylesTracked(
      file,
      items.map((item) => item.next),
    );
    if (!res.ok) return;

    historyStore.push(file, {
      undo: async () => {
        await registerStylesTracked(
          file,
          items.map((item) => item.previous),
        );
      },
      redo: async () => {
        await registerStylesTracked(
          file,
          items.map((item) => item.next),
        );
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
   * 持っていた関係性も削除してしまう。解散する各グループについて、解散の直前に
   * `captureRelationalSnapshot`で関係性を捕捉しておかないと、undoでグループを復元しても
   * その関係性は失われたままになる
   */
  async function applyGroupImpactForRemoval(
    file: ContainerElementFile,
    removedIds: AnnotationID[],
  ): Promise<{ groups: AnnotationGroup[]; snapshot: RelationalSnapshot }> {
    const removedSet = new Set(removedIds);
    const groups = groupStore.groupsByFileKey[fileKey(file)] ?? [];
    const affected = groups.filter((g) => g.memberIds.some((id) => removedSet.has(id)));
    if (affected.length === 0) return { groups: [], snapshot: new Map() };

    const snapshots = affected.map((g) => ({ ...g, memberIds: [...g.memberIds] }));
    const dissolvedSnapshots: RelationalSnapshot[] = [];

    for (const g of affected) {
      const idsToRemove = g.memberIds.filter((id) => removedSet.has(id));
      const res = await api.removeGroupMembers(file, g.id, idsToRemove);
      if (!res.ok) {
        dissolvedSnapshots.push(captureRelationalSnapshot([g.id]));
        await api.ungroupAnnotations(file, g.id);
      }
    }
    await groupStore.refreshFile(file);
    return { groups: snapshots, snapshot: mergeRelationalSnapshots(...dissolvedSnapshots) };
  }

  /**
   * 単一アノテーションの削除を履歴付きで行う
   *
   * 削除前に紐づく関係性（本体・巻き添えで解散するグループの両方）を捕捉しておき、undo時には
   * アノテーション本体→グループ→関係性の順に再登録する（関係性の登録はsrc/target双方の
   * アドレス解決に本体の存在を要求するため、本体を先に復元する必要がある）。
   *
   * redo（再削除）も初回の削除と全く同じ手順（捕捉→削除→グループ影響適用）を再現する。
   * 都度その時点の最新状態を捕捉し直すことで、undo/redoを繰り返しても関係性の状態にずれが
   * 生じない
   *
   * 注意：リンクしていた相手側のアノテーションが別の操作で削除されたまま復元されていない場合、
   * そのリンクの再登録は失敗する（本体側のUndo自体は常に成功する。既知の制限）
   */
  async function removeWithHistory(
    file: ContainerElementFile,
    removed: AnnotationStyle,
  ): Promise<ApiResponse<void>> {
    const ownSnapshot = captureRelationalSnapshot([removed.id]);
    const res = await api.removeAnnotation(removed.id);
    if (res.ok) {
      const { groups: affectedGroups, snapshot: groupSnapshot } = await applyGroupImpactForRemoval(
        file,
        [removed.id],
      );
      historyStore.push(file, {
        undo: async () => {
          await registerStyleTracked(file, removed);
          await Promise.all(affectedGroups.map((g) => api.restoreGroup(file, g)));
          if (affectedGroups.length > 0) await groupStore.refreshFile(file);
          await restoreRelationalSnapshot(
            file,
            mergeRelationalSnapshots(ownSnapshot, groupSnapshot),
          );
        },
        redo: async () => {
          const redoneOwnSnapshot = captureRelationalSnapshot([removed.id]);
          await api.removeAnnotation(removed.id);
          const { snapshot: redoneGroupSnapshot } = await applyGroupImpactForRemoval(file, [
            removed.id,
          ]);
          await refreshRelationalSnapshotCaches(
            file,
            mergeRelationalSnapshots(redoneOwnSnapshot, redoneGroupSnapshot),
          );
        },
      });
    }
    return res;
  }

  /**
   * 複数アノテーションの削除をまとめて1つのUndoステップとして扱う（関係性の捕捉・復元も同様）
   *
   * 削除・undoでの復元・redoでの再削除のいずれも、件数分の個別API呼び出しではなく
   * `removeAnnotations`/`registerAnnotationStyles`で1回にまとめる。個別に呼ぶとDB書き込み
   * （≒UI側のライブクエリ再発火）も件数分に分かれ、まとめて操作したはずの複数選択・グループが
   * 画面上で1件ずつ遅れて消える・現れるように見えてしまう
   */
  async function removeManyWithHistory(
    file: ContainerElementFile,
    removedList: AnnotationStyle[],
  ): Promise<void> {
    if (removedList.length === 0) return;

    const ids = removedList.map((a) => a.id);
    const ownSnapshot = captureRelationalSnapshot(ids);
    const res = await api.removeAnnotations(file, ids);
    if (!res.ok) return;

    // 複数削除で2つ以上のグループを同時に縮小・解散させる場合も、影響適用はまとめて1回で行う
    const { groups: affectedGroups, snapshot: groupSnapshot } = await applyGroupImpactForRemoval(
      file,
      ids,
    );

    historyStore.push(file, {
      undo: async () => {
        await registerStylesTracked(file, removedList);
        await Promise.all(affectedGroups.map((g) => api.restoreGroup(file, g)));
        if (affectedGroups.length > 0) await groupStore.refreshFile(file);
        await restoreRelationalSnapshot(file, mergeRelationalSnapshots(ownSnapshot, groupSnapshot));
      },
      redo: async () => {
        const redoneOwnSnapshot = captureRelationalSnapshot(ids);
        await api.removeAnnotations(file, ids);
        const { snapshot: redoneGroupSnapshot } = await applyGroupImpactForRemoval(file, ids);
        await refreshRelationalSnapshotCaches(
          file,
          mergeRelationalSnapshots(redoneOwnSnapshot, redoneGroupSnapshot),
        );
      },
    });
  }

  /**
   * 貼り付け・複製で新規作成された複数アノテーションを、1つのUndoステップとして記録する
   *
   * API呼び出し（api.pasteAnnotations）は呼び出し元で既に完了済みであるため、ここでは
   * 履歴の記録のみを行う。undoでの削除により、作成後に結ばれた関係性も巻き添えで消えるが、
   * 関係性の登録・削除自体も別途履歴に乗る（`recordRelationalCreated`）ため、履歴スタック上では
   * 必ずそちらのundoが先に処理される。したがってここで関係性を捕捉する必要はない
   */
  function recordCreatedBatch(file: ContainerElementFile, created: AnnotationStyle[]): void {
    if (created.length === 0) return;

    historyStore.push(file, {
      undo: async () => {
        await api.removeAnnotations(
          file,
          created.map((a) => a.id),
        );
      },
      redo: async () => {
        await registerStylesTracked(file, created);
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
        await registerStylesTracked(
          file,
          pairs.map((p) => p.before),
        );
      },
      redo: async () => {
        await registerStylesTracked(
          file,
          pairs.map((p) => p.after),
        );
      },
    });
  }

  /**
   * 貼り付け・複製で作成したアノテーション群と、それに対応する新規グループ（あれば）を
   * 1つのUndoステップとして記録する（API呼び出しは呼び出し元で既に完了済み）
   *
   * `createdGroup`は値算出方法の設定まで終えた最終状態を渡すこと（redoでのapi.restoreGroupが
   * 一度でその状態まで復元できるようにするため）。`recordCreatedBatch`と同じ理由により、
   * 作成後に結ばれた関係性の捕捉はここでは不要（`recordRelationalCreated`側で解決される）
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
        await api.removeAnnotations(
          file,
          created.map((a) => a.id),
        );
        if (createdGroup) await groupStore.refreshFile(file);
      },
      redo: async () => {
        await registerStylesTracked(file, created);
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
   * 再度解散し（その時点の最新の関係性を都度捕捉してから）、新規グループを復元する
   */
  function recordGroupCreated(
    file: ContainerElementFile,
    newGroup: AnnotationGroup,
    dissolvedGroups: AnnotationGroup[],
    dissolvedSnapshot: RelationalSnapshot,
  ): void {
    historyStore.push(file, {
      undo: async () => {
        await api.ungroupAnnotations(file, newGroup.id);
        await Promise.all(dissolvedGroups.map((g) => api.restoreGroup(file, g)));
        await groupStore.refreshFile(file);
        await restoreRelationalSnapshot(file, dissolvedSnapshot);
      },
      redo: async () => {
        const redoneSnapshot = captureRelationalSnapshot(dissolvedGroups.map((g) => g.id));
        await Promise.all(dissolvedGroups.map((g) => api.ungroupAnnotations(file, g.id)));
        await api.restoreGroup(file, newGroup);
        await groupStore.refreshFile(file);
        await refreshRelationalSnapshotCaches(file, redoneSnapshot);
      },
    });
  }

  /**
   * グループ解除を1つのUndoステップとして記録する（api.ungroupAnnotationsは呼び出し元で実行済み）
   */
  function recordGroupRemoved(
    file: ContainerElementFile,
    removedGroup: AnnotationGroup,
    snapshot: RelationalSnapshot,
  ): void {
    historyStore.push(file, {
      undo: async () => {
        await api.restoreGroup(file, removedGroup);
        await groupStore.refreshFile(file);
        await restoreRelationalSnapshot(file, snapshot);
      },
      redo: async () => {
        const redoneSnapshot = captureRelationalSnapshot([removedGroup.id]);
        await api.ungroupAnnotations(file, removedGroup.id);
        await groupStore.refreshFile(file);
        await refreshRelationalSnapshotCaches(file, redoneSnapshot);
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

  /**
   * 関係性1本の新規登録を1つのUndoステップとして記録する（api.registRelationalsは呼び出し元で実行済み）
   *
   * `selfId`は`file`に属する側の端点ID（src/targetのどちらでもよい。相手側ファイルの
   * キャッシュもあわせて再検証するために必要）。この操作自体が履歴に乗ることで、
   * 「新規作成したアノテーション（グループ）に関係性を結び、その後で作成自体をUndoする」
   * という操作順でも、この関数のundo（関係性の削除）が作成のundoより必ず先にスタックから
   * 取り出されるため、関係性が捕捉されないまま失われることがない
   */
  function recordRelationalCreated(
    file: ContainerElementFile,
    relational: Relational,
    selfId: RelationalEndpointID,
  ): void {
    historyStore.push(file, {
      undo: async () => {
        await api.removeRelationalEdge(relational.srcID, relational.targetID);
        await refreshRelationalCachesAfter(file, selfId, [relational]);
      },
      redo: async () => {
        await api.registRelationals(relational);
        await refreshRelationalCachesAfter(file, selfId, [relational]);
      },
    });
  }

  /**
   * 関係性1本の削除を1つのUndoステップとして記録する（api.removeRelationalEdgeは呼び出し元で実行済み）
   */
  function recordRelationalRemoved(
    file: ContainerElementFile,
    relational: Relational,
    selfId: RelationalEndpointID,
  ): void {
    historyStore.push(file, {
      undo: async () => {
        await api.registRelationals(relational);
        await refreshRelationalCachesAfter(file, selfId, [relational]);
      },
      redo: async () => {
        await api.removeRelationalEdge(relational.srcID, relational.targetID);
        await refreshRelationalCachesAfter(file, selfId, [relational]);
      },
    });
  }

  /**
   * 関係性のルール変更を1つのUndoステップとして記録する（削除→新ルールで再登録は
   * 呼び出し元で実行済み。`relationalStore.updateRelationalRule`参照）
   *
   * `previous`・`next`は同じsrcID/targetIDでruleのみ異なる想定
   */
  function recordRelationalRuleChanged(
    file: ContainerElementFile,
    previous: Relational,
    next: Relational,
    selfId: RelationalEndpointID,
  ): void {
    historyStore.push(file, {
      undo: async () => {
        await api.removeRelationalEdge(next.srcID, next.targetID);
        await api.registRelationals(previous);
        await refreshRelationalCachesAfter(file, selfId, [previous]);
      },
      redo: async () => {
        await api.removeRelationalEdge(previous.srcID, previous.targetID);
        await api.registRelationals(next);
        await refreshRelationalCachesAfter(file, selfId, [next]);
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
    recordRelationalCreated,
    recordRelationalRemoved,
    recordRelationalRuleChanged,
    captureRelationalSnapshot,
    buildRegisterManyItems,
  };
}
