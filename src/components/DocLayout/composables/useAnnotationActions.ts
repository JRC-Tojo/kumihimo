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
import { useRelationalStore, type RelationalEdge } from 'src/stores/relationalStore';
import type { ContainerElementFile } from 'src/models/container';
import type { AnnotationID, AnnotationStyle } from 'src/models/document/pdf';
import type { LayerOrderAction } from 'src/utils/document/annotationOrder';

/** 2つのファイルがcontainerID込みで同一かどうか */
function isSameFile(a: ContainerElementFile, b: ContainerElementFile): boolean {
  return a.containerID === b.containerID && a.path === b.path;
}

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
  const relationalStore = useRelationalStore();

  /** 選択中の注釈IDを実体（AnnotationStyle）に解決する */
  function resolveSelected(): AnnotationStyle[] {
    return deps.selectedAnnotationIds.value
      .map((id) => deps.annotations.value.find((a) => a.id === id))
      .filter((a): a is AnnotationStyle => a !== undefined);
  }

  /**
   * 削除対象アノテーションについて、このファイルだけでなく紐づく関係性の相手側アノテーションの
   * ファイルの関係性キャッシュも合わせて更新する（別ファイル間の関係性が、開いていないタブ側の
   * キャッシュに古い情報が残ったままにならないようにする）
   */
  async function refreshRelationalCachesAfterDelete(
    edgesBeforeDelete: { edge: RelationalEdge; selfId: AnnotationID }[],
  ): Promise<void> {
    await relationalStore.refreshFile(deps.file);

    await Promise.all(
      edgesBeforeDelete.map(async ({ edge, selfId }) => {
        const otherId =
          edge.relational.srcID === selfId ? edge.relational.targetID : edge.relational.srcID;
        const otherFileRes = await api.resolveAnnotationFile(otherId);
        if (otherFileRes.ok && !isSameFile(otherFileRes.data, deps.file)) {
          await relationalStore.refreshFile(otherFileRes.data);
        }
      }),
    );
  }

  /**
   * 選択中の注釈をすべて削除する（Delete/Backspace、右ドロワーの削除ボタン、
   * 将来の右クリック「削除」から共用）
   *
   * 削除前に紐づいていた関係性の相手ファイルも合わせて再検証し、
   * 開いていないタブ側に孤立した関係性が古いキャッシュとして残らないようにする
   */
  async function deleteSelected(): Promise<void> {
    const targets = resolveSelected();
    if (targets.length === 0) return;

    const edgesBeforeDelete = targets.flatMap((annot) =>
      relationalStore.edgesForAnnotation(annot.id).map((edge) => ({ edge, selfId: annot.id })),
    );

    await Promise.all(targets.map((annot) => api.removeAnnotation(annot.id)));
    deps.selectedAnnotationIds.value = [];

    await refreshRelationalCachesAfterDelete(edgesBeforeDelete);
  }

  /**
   * 選択中の注釈を微調整する（矢印キー）
   *
   * line/arrow/polyline/polygonのpointsはx/yからの相対オフセットのため、x/yのみ変更すれば
   * 図形全体が移動する
   */
  async function nudgeSelected(dx: number, dy: number): Promise<void> {
    const targets = resolveSelected();
    if (targets.length === 0) return;
    await Promise.all(
      targets.map((annot) =>
        api.registerAnnotationStyle(deps.file, {
          ...annot,
          x: annot.x + dx,
          y: annot.y + dy,
          updatedAt: dayjs().toISOString(),
        }),
      ),
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
   * ~~連続ペーストのたびに少しずつ位置をずらし、貼り付けた注釈群を選択状態にする~~
   * → ひとまずは位置ずらしを行わない
   */
  async function pasteClipboard(): Promise<void> {
    const clipboard = editorStore.annotationClipboard;
    if (!clipboard || clipboard.length === 0) return;

    // const offsetStep = PASTE_OFFSET_STEP * (editorStore.annotationClipboardPasteCount + 1);
    const offsetStep = 0;
    const res = await api.pasteAnnotations(
      deps.file,
      clipboard,
      deps.currentPage.value,
      offsetStep,
    );
    editorStore.incrementClipboardPasteCount();
    if (!res.ok) return;

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

    const res = await api.pasteAnnotations(
      deps.file,
      targets,
      deps.currentPage.value,
      PASTE_OFFSET_STEP,
    );
    if (!res.ok) return;

    deps.selectedAnnotationIds.value = res.data.map((info) => info.style.id);
  }

  /**
   * 選択中の注釈の重ね順を変更する（最前面/前面/背面/最背面）
   *
   * ツールバー（editorStore.layerOrderActionのwatch）・将来の右クリックメニューの両方から呼ぶ
   */
  async function reorderSelected(action: LayerOrderAction): Promise<void> {
    const ids = deps.selectedAnnotationIds.value;
    if (ids.length === 0) return;
    for (const id of ids) {
      await api.reorderAnnotation(deps.file, deps.annotations.value, id, action);
    }
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
