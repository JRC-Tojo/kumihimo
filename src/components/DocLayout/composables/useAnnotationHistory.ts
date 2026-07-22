/**
 * アノテーションの作成・変更・削除をUndo/Redo履歴（historyStore）に記録しつつ実行するコンポーザブル
 *
 * 固定の依存を持たないステートレスな設計とし、file・アノテーションを呼び出しごとの引数として
 * 受け取る。そのため、DocumentTabViewの子孫コンポーネントかどうかに関わらず、
 * アノテーションのCRUDを行うあらゆる箇所（描画・スタイルパネル編集・右ドロワー編集等）から
 * propsの受け渡しなしにそのまま呼び出せる
 */

import dayjs from 'dayjs';
import { useBackendApi } from 'src/apis/backendApi';
import { useHistoryStore } from 'src/stores/historyStore';
import { useRelationalStore } from 'src/stores/relationalStore';
import type { ApiResponse } from 'src/models/error/api';
import type { ContainerElementFile } from 'src/models/container';
import type { AnnotationID, AnnotationStyle } from 'src/models/document/pdf';
import type { AnnotationInfo } from 'src/models/relational/fileSchema';
import type { Relational } from 'src/models/relational/common';

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

  /**
   * 削除前に、対象アノテーションがsrc・target問わず関わる関係性一覧をキャプチャする（undo時の復元用）
   *
   * relationalStoreのキャッシュは対象アノテーションの属するファイルがrefreshFile済みであれば
   * （タブを開いている間は常に最新化されている）漏れなく取得できる
   */
  function captureRelationals(annotID: AnnotationID): Relational[] {
    return relationalStore.edgesForAnnotation(annotID).map((edge) => edge.relational);
  }

  /**
   * 関係性の復元・再削除いずれの後も、影響を受けるファイル（自分・関係性の相手）双方の
   * 検証キャッシュを再検証する
   */
  async function refreshRelationalCachesAfter(
    file: ContainerElementFile,
    selfId: AnnotationID,
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
   * useAnnotationStylePanel（パネル編集）・DocumentRightDrawer（右ドロワー編集）双方の
   * 同一ロジックをここに集約する
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
      historyStore.push(file, {
        undo: async () => {
          await api.registerAnnotationStyle(file, removed);
          await Promise.all(relationals.map((r) => api.registRelationals(r)));
          await refreshRelationalCachesAfter(file, removed.id, relationals);
        },
        redo: async () => {
          await api.removeAnnotation(removed.id);
          await refreshRelationalCachesAfter(file, removed.id, relationals);
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

    historyStore.push(file, {
      undo: async () => {
        await Promise.all(removedList.map((a) => api.registerAnnotationStyle(file, a)));
        // 削除対象同士が互いにリンクしていた場合、両端のrelationalsByIdエントリに
        // 同じエッジが重複して含まれるため、登録前に一意化する
        const dedupedRelationals = dedupRelationals(relationalsById);
        await Promise.all(dedupedRelationals.map((r) => api.registRelationals(r)));
        await Promise.all(
          removedList.map((a) =>
            refreshRelationalCachesAfter(file, a.id, relationalsById.get(a.id) ?? []),
          ),
        );
      },
      redo: async () => {
        await Promise.all(removedList.map((a) => api.removeAnnotation(a.id)));
        await Promise.all(
          removedList.map((a) =>
            refreshRelationalCachesAfter(file, a.id, relationalsById.get(a.id) ?? []),
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

  return {
    registerWithHistory,
    registerManyWithHistory,
    removeWithHistory,
    removeManyWithHistory,
    recordCreatedBatch,
    recordChangedBatch,
    buildRegisterManyItems,
  };
}
