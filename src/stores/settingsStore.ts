import { defineStore, acceptHMRUpdate } from 'pinia';
import { useBackendApi } from 'src/apis/backendApi';
import type { AppSettings } from 'src/models/settings';
import type { AnnotationTool } from 'src/models/docPage';
import { ColorCode } from 'src/models/document/pdf';
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
     * アノテーションプリセット一覧を保存する（追加・編集・削除・並び替え・インポートの共通経路）
     *
     * 保存成功時はローカルのappSettingsも即座に更新し、プリセットバー等の再描画を待たせない。
     * `tools`キーの読み込み→変更→保存自体はBackendApi側（設定サービス層）で直列化されるため、
     * ここでは他フィールド（直近使用色等）を引き継ぐ必要はない
     * @returns 保存に成功したかどうか
     */
    async updateAnnotationPresets(newList: AnnotationTool[]): Promise<boolean> {
      const api = useBackendApi();
      const res = await api.saveAnnotationPresets(newList);
      if (!res.ok) {
        console.error(res.error);
        return false;
      }

      if (this.appSettings) this.appSettings.tools = res.data;
      return true;
    },

    /**
     * 色スウォッチで色を選択した際に、直近使用色の先頭へ記録する（既存の同色は前詰めで移動する）
     */
    async recordRecentColor(color: string): Promise<void> {
      const parsed = ColorCode.safeParse(color);
      if (!parsed.success) return;

      const api = useBackendApi();
      const res = await api.recordRecentColor(parsed.data);
      if (!res.ok) {
        console.error(res.error);
        return;
      }

      if (this.appSettings) this.appSettings.tools = res.data;
    },

    /**
     * 直近使用色として保持する件数を変更する（設定画面から呼ばれる）。上限を減らした場合は
     * 既存の直近使用色一覧もその場で切り詰める
     *
     * `AppSettings`スキーマの`recentColorsLimit`は正の整数のみを許容するため、不正な値
     * （数値入力欄が空欄になった場合の0等）をそのままDBへ保存すると、次回起動時のZod
     * バリデーションでアプリの初期化自体が失敗する。保存前にガードする
     * @returns 保存に成功したかどうか
     */
    async updateRecentColorsLimit(limit: number): Promise<boolean> {
      if (!Number.isInteger(limit) || limit < 1) return false;

      const api = useBackendApi();
      const res = await api.updateRecentColorsLimit(limit);
      if (!res.ok) {
        console.error(res.error);
        return false;
      }

      if (this.appSettings) this.appSettings.tools = res.data;
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
