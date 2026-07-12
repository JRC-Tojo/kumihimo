import { defineStore, acceptHMRUpdate } from 'pinia';
import { useBackendApi } from 'src/apis/backendApi';
import type { AppSettings } from 'src/models/settings';
import { DEFAULT_RELATIONAL_VERIFICATION_STYLE } from 'src/models/relational/style';
import type { RelationalVerificationStyle } from 'src/models/relational/style';

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
        this.appSettings = res.data;
      } else {
        console.error(res.error);
      }
    },
  },
});

if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(useSettingsStore, import.meta.hot));
}
