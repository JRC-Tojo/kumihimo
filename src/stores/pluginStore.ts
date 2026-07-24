import { defineStore, acceptHMRUpdate } from 'pinia';
import type {
  InstalledPlugin,
  CatalogEntry,
  PluginInstallSource,
} from 'src/models/plugin/installation';
import type { PluginID } from 'src/models/plugin/manifest';
import { useBackendApi } from 'src/apis/backendApi';

export const usePluginStore = defineStore('plugin', {
  state: () => ({
    installed: [] as InstalledPlugin[],
    catalog: [] as CatalogEntry[],
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
     * カタログからプラグインをインストールし、一覧を最新化する
     */
    async install(id: PluginID): Promise<boolean> {
      const api = useBackendApi();
      const res = await api.installPluginFromCatalog(id);
      if (res.ok) await this.loadInstalled();
      return res.ok;
    },

    /**
     * ローカルのマニフェスト・バイナリから直接プラグインをインストールし、一覧を最新化する
     * （ストア/カタログを経由しないサイドロード。開発中のWASMを実ホストで動作確認する用途）
     */
    async installFromFile(
      manifestJson: unknown,
      binary: Uint8Array,
      icon: Uint8Array | undefined,
    ): Promise<boolean> {
      const api = useBackendApi();
      const res = await api.installPluginFromFile(manifestJson, binary, icon);
      if (res.ok) await this.loadInstalled();
      return res.ok;
    },

    /**
     * プラグインをアンインストールし、一覧を最新化する
     */
    async uninstall(id: PluginID, source: PluginInstallSource): Promise<boolean> {
      const api = useBackendApi();
      const res = await api.uninstallPlugin(id, source);
      if (res.ok) await this.loadInstalled();
      return res.ok;
    },
  },
});

if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(usePluginStore, import.meta.hot));
}
