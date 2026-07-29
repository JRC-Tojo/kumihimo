/**
 * 他画面（関係性SubTools等）からの「設定タブを開いて特定セクションへスクロールしてほしい」
 * という意図（`editorStore.settingsScrollTarget`）を消費し、対象セクションへ自動スクロールする
 *
 * `settings`（API取得結果）はマウント後に非同期で読み込まれるため、対象セクション自体が
 * まだDOMに存在しないタイミングで意図が届くことがある。両方が揃うまで待ってから実行する
 */
import { nextTick, watch, type Ref } from 'vue';
import { useEditorStore } from 'src/stores/editorStore';

export function useSettingsScrollTarget<T>(
  contentRef: Ref<HTMLElement | undefined>,
  settings: Ref<T | undefined>,
  searchQuery: Ref<string>,
) {
  const editorStore = useEditorStore();

  /** 指定IDのセクション要素までスムーズスクロールする */
  function scrollToSection(id: string): void {
    contentRef.value
      ?.querySelector(`#${id}`)
      ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  watch(
    [() => editorStore.settingsScrollTarget, settings],
    async ([target, loadedSettings]) => {
      if (target === undefined || loadedSettings === undefined) return;
      // 対象セクションが検索フィルタで隠れないようクリアしてからスクロールする
      searchQuery.value = '';
      await nextTick();
      scrollToSection(target);
      editorStore.clearSettingsScrollTarget();
    },
    { immediate: true },
  );

  return { scrollToSection };
}
