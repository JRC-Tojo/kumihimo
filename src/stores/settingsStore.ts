import { defineStore, acceptHMRUpdate } from 'pinia';
import { useBackendApi } from 'src/apis/backendApi';
import type { AppSettings } from 'src/models/settings';
import type { AnnotationTool } from 'src/models/docPage';
import { DEFAULT_RELATIONAL_VERIFICATION_STYLE } from 'src/models/relational/style';
import type { RelationalVerificationStyle } from 'src/models/relational/style';
import { Dark } from 'quasar';
import type { LocaleKey } from 'src/i18n';
import { globalI18n } from 'src/boot/i18n';
import { useEditorStore } from 'src/stores/editorStore';

/**
 * アプリ設定をリアクティブに参照するためのストア
 *
 * AnnotationLayer配下のような深い子コンポーネントからも、propsのバケツリレーなしに
 * 現在の設定値（関係性検証スタイル等）を参照できるようにする
 */
export const useSettingsStore = defineStore('settings', {
  state: () => ({
    appSettings: undefined as AppSettings | undefined,
  }),

  getters: {
    relationalVerificationStyle(state): RelationalVerificationStyle {
      return (
        state.appSettings?.relationalVerificationStyle ?? DEFAULT_RELATIONAL_VERIFICATION_STYLE
      );
    },
  },

  actions: {
    /**
     * バックエンドから最新の設定を読み込む
     */
    async loadSettings(): Promise<void> {
      const api = useBackendApi();
      const res = await api.getSettings();
      if (res.ok) {
        setDarkMode(res.data.darkMode);
        setLocale(res.data.locale);
        setAutoSave(res.data.autoSaveAnnotations);
        this.appSettings = res.data;
      } else {
        console.error(res.error);
      }
    },

    /**
     * アノテーションプリセット一覧を保存する（追加・編集・削除・並び替えの共通経路）
     *
     * 保存成功時はローカルのappSettingsも即座に更新し、プリセットバー等の再描画を待たせない
     * @returns 保存に成功したかどうか
     */
    async updateAnnotationPresets(newList: AnnotationTool[]): Promise<boolean> {
      const api = useBackendApi();
      const res = await api.saveSettings('tools', { annotations: newList });
      if (!res.ok) {
        console.error(res.error);
        return false;
      }

      if (this.appSettings) this.appSettings.tools.annotations = newList;
      return true;
    },
  },
});

/**
 * ウェブページをダークデザインに変更する
 */
function setDarkMode(isDark: boolean) {
  Dark.set(isDark);
}

/**
 * 表示言語を設定
 */
function setLocale(localeKey: LocaleKey) {
  globalI18n.locale.value = localeKey;
}

/**
 * 自動保存トグルの状態をエディタストアへ反映する
 */
function setAutoSave(autoSave: boolean) {
  useEditorStore().autoSaveAnnotations = autoSave;
}

if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(useSettingsStore, import.meta.hot));
}
