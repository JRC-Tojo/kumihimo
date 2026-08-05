/**
 * 選択中のアノテーションに対する操作（削除・微調整・コピー・貼り付け・複製・重ね順変更）をまとめたコンポーザブル
 *
 * 選択状態・ファイル・現在ページを知っている`DocumentTabView.vue`にインスタンス化させ、
 * キーボードショートカットからはこれらの関数を呼ぶだけにする。今回はキーボードのみだが、
 * 将来アノテーションの右クリックコンテキストメニューを追加する際も、メニュー項目のonClickから
 * 同じ関数を呼ぶだけで実装できるようにするための共有ロジック層である
 */

import { type Ref } from 'vue';
import dayjs from 'dayjs';
import { useBackendApi } from 'src/apis/backendApi';
import { useEditorStore } from 'src/stores/editorStore';
import { useAnnotationHistory } from './useAnnotationHistory';
import type { ContainerElementFile } from 'src/models/container';
import type { AnnotationID, AnnotationStyle } from 'src/models/document/pdf';
import type { LayerOrderAction } from 'src/utils/document/annotationOrder';

/** 連続ペースト・複製時に位置をずらす基準量（px、文書座標） */
const PASTE_OFFSET_STEP = 20;

export interface UseAnnotationActionsDeps {
  file: ContainerElementFile;
  annotations: Ref<AnnotationStyle[]>;
  selectedAnnotationIds: Ref<AnnotationID[]>;
  currentPage: Ref<number>;
}

export function useAnnotationActions(deps: UseAnnotationActionsDeps) {
  const api = useBackendApi();
  const editorStore = useEditorStore();
  const history = useAnnotationHistory();

  /** 選択中の注釈IDを実体（AnnotationStyle）に解決する */
  function resolveSelected(): AnnotationStyle[] {
    return deps.selectedAnnotationIds.value
      .map((id) => deps.annotations.value.find((a) => a.id === id))
      .filter((a): a is AnnotationStyle => a !== undefined);
  }

  /**
   * 選択中の注釈をすべて削除する（Delete/Backspace、右ドロワーの削除ボタン、
   * 将来の右クリック「削除」から共用）
   *
   * 削除・関係性キャッシュの再検証・Undo履歴への記録は`useAnnotationHistory`にまとめて委譲する
   * （削除前に紐づいていた関係性の相手ファイルの再検証、undo時の関係性復元も含む）
   */
  async function deleteSelected(): Promise<void> {
    const targets = resolveSelected();
    if (targets.length === 0) return;

    await history.removeManyWithHistory(deps.file, targets);
    deps.selectedAnnotationIds.value = [];
  }

  /**
   * 選択中の注釈を微調整する（矢印キー）
   *
   * line/arrow/polyline/polygonのpointsはx/yからの相対オフセットのため、x/yのみ変更すれば
   * 図形全体が移動する。1回のキー押下で選択中の全注釈をまとめて1つのUndoステップとして記録する
   */
  async function nudgeSelected(dx: number, dy: number): Promise<void> {
    const targets = resolveSelected();
    if (targets.length === 0) return;
    const now = dayjs().toISOString();
    await history.registerManyWithHistory(
      deps.file,
      targets.map((annot) => ({
        previous: annot,
        next: { ...annot, x: annot.x + dx, y: annot.y + dy, updatedAt: now },
      })),
    );
  }

  /** 選択中の注釈をアプリ内クリップボードにコピーする（Ctrl+C。OSクリップボードは使わない） */
  function copySelected(): void {
    const targets = resolveSelected();
    if (targets.length === 0) return;
    editorStore.setAnnotationClipboard(targets);
  }

  /**
   * アプリ内クリップボードの内容を現在のページへ貼り付ける（Ctrl+V）
   *
   * 貼り付け先の基準位置は次の優先順で決める。いずれの場合も、クリップボード内の
   * 各要素には同じ移動量を適用し、複数要素をコピーしていた場合の相対的な位置関係を保つ
   * （貼り付け後は貼り付けた注釈群のみを選択状態にする）:
   * 1. 選択中の注釈がある場合：それから少しずらした位置
   * 2. 選択中の注釈が無い場合：カーソルが最後にホバーしていた位置
   * 3. カーソル位置も未取得の場合（キーボードのみの操作等）：コピー元から少しずらした位置
   */
  async function pasteClipboard(): Promise<void> {
    const clipboard = editorStore.annotationClipboard;
    if (!clipboard || clipboard.length === 0) return;
    const anchorSource = clipboard[0];
    if (!anchorSource) return;

    const selected = resolveSelected();
    let target: { x: number; y: number };
    if (selected.length > 0) {
      const base = selected[0]!;
      target = { x: base.x + PASTE_OFFSET_STEP, y: base.y + PASTE_OFFSET_STEP };
    } else if (editorStore.lastPointerDocPos) {
      target = editorStore.lastPointerDocPos;
    } else {
      target = { x: anchorSource.x + PASTE_OFFSET_STEP, y: anchorSource.y + PASTE_OFFSET_STEP };
    }
    const offset = { dx: target.x - anchorSource.x, dy: target.y - anchorSource.y };

    const res = await api.pasteAnnotations(deps.file, clipboard, deps.currentPage.value, offset);
    if (!res.ok) return;

    history.recordCreatedBatch(
      deps.file,
      res.data.map((info) => info.style),
    );
    deps.selectedAnnotationIds.value = res.data.map((info) => info.style.id);
  }

  /**
   * 選択中の注釈をその場複製する（将来の右クリックメニュー「複製」用）
   *
   * Ctrl+drag複製とは呼び出し経路が異なるが、同じ`pasteAnnotations`（=`duplicateAnnotation`）を利用する
   */
  async function duplicateSelected(): Promise<void> {
    const targets = resolveSelected();
    if (targets.length === 0) return;

    const res = await api.pasteAnnotations(deps.file, targets, deps.currentPage.value, {
      dx: PASTE_OFFSET_STEP,
      dy: PASTE_OFFSET_STEP,
    });
    if (!res.ok) return;

    history.recordCreatedBatch(
      deps.file,
      res.data.map((info) => info.style),
    );
    deps.selectedAnnotationIds.value = res.data.map((info) => info.style.id);
  }

  /**
   * 選択中の注釈の重ね順を変更する（最前面/前面/背面/最背面）
   *
   * ツールバー（editorStore.layerOrderActionのwatch）・将来の右クリックメニューの両方から呼ぶ
   *
   * 同じ注釈一覧を毎回渡すと、選択内の各注釈が同じzIndex（front/backならmaxKey+1/minKey-1）を
   * 取得してしまい選択内の相対順が不定になる。処理済みの注釈のzIndexをローカルで反映しながら
   * 順に処理することで、次のcomputeReorderedZIndexが最新の状態を参照できるようにする
   */
  async function reorderSelected(action: LayerOrderAction): Promise<void> {
    const ids = deps.selectedAnnotationIds.value;
    if (ids.length === 0) return;

    let workingAnnotations = deps.annotations.value;
    const pairs: { before: AnnotationStyle; after: AnnotationStyle }[] = [];
    for (const id of ids) {
      const before = workingAnnotations.find((a) => a.id === id);
      const res = await api.reorderAnnotation(deps.file, workingAnnotations, id, action);
      if (!res.ok || !before) continue;
      pairs.push({ before, after: res.data.style });
      workingAnnotations = workingAnnotations.map((a) => (a.id === id ? res.data.style : a));
    }
    history.recordChangedBatch(deps.file, pairs);
  }

  return {
    deleteSelected,
    nudgeSelected,
    copySelected,
    pasteClipboard,
    duplicateSelected,
    reorderSelected,
  };
}
