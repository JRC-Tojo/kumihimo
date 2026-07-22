import { defineStore, acceptHMRUpdate } from 'pinia';
import type { InstalledPlugin, CatalogEntry } from 'src/models/plugin/installation';
import type { PluginID } from 'src/models/plugin/manifest';
import type { PluginSubmission } from 'src/models/plugin/submission';
import { useBackendApi } from 'src/apis/backendApi';

export const usePluginStore = defineStore('plugin', {
  state: () => ({
    installed: [] as InstalledPlugin[],
    catalog: [] as CatalogEntry[],
    submissions: [] as PluginSubmission[],
    selectedPluginId: null as PluginID | null,
  }),

  actions: {
    /**
     * インストール済みプラグイン一覧を読み込む
     */
    async loadInstalled(): Promise<void> {
      const api = useBackendApi();
      const res = await api.getInstalledPlugins();
      if (res.ok) this.installed = res.data;
    },

    /**
     * 導入可能プラグイン一覧（カタログ）を読み込む
     */
    async loadCatalog(): Promise<void> {
      const api = useBackendApi();
      const res = await api.getCatalogEntries();
      if (res.ok) this.catalog = res.data;
    },

    /**
     * 自分が行ったプラグイン申請一覧を読み込む
     */
    async loadSubmissions(): Promise<void> {
      const api = useBackendApi();
      const res = await api.getPluginSubmissions();
      if (res.ok) this.submissions = res.data;
    },

    /**
     * カタログからプラグインをインストールし、一覧を最新化する
     */
    async install(id: PluginID): Promise<boolean> {
      const api = useBackendApi();
      const res = await api.installPluginFromCatalog(id);
      if (res.ok) await this.loadInstalled();
      return res.ok;
    },

    /**
     * プラグインをアンインストールし、一覧を最新化する
     */
    async uninstall(id: PluginID): Promise<boolean> {
      const api = useBackendApi();
      const res = await api.uninstallPlugin(id);
      if (res.ok) await this.loadInstalled();
      return res.ok;
    },

    /**
     * 一覧上で選択中のプラグインを設定する
     */
    select(id: PluginID | null): void {
      this.selectedPluginId = id;
    },
  },
});

if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(usePluginStore, import.meta.hot));
}
