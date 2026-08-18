import { defineBoot } from '#q-app/wrappers';
import { useBackendApi } from 'src/apis/backendApi';
import { useRelationalStore } from 'src/stores/relationalStore';

/**
 * E2E（Playwright）テストから`window.__kumihimoTest`経由でBackendApi・関係性ストアへ
 * アクセスできるようにする、開発ビルド専用のフック。
 *
 * `import.meta.env.DEV`の分岐により、本番ビルド（`quasar build`）ではこのモジュール自体が
 * tree-shakingで除去される。実データ投入・状態確認をUIクリックのみに頼らず行うための入り口。
 */
export default defineBoot(({ store }) => {
  if (!import.meta.env.DEV) return;

  window.__kumihimoTest = {
    api: useBackendApi(),
    stores: {
      relational: useRelationalStore(store),
    },
  };
});
