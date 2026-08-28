import { defineBoot } from '#q-app/wrappers';
import { useBackendApi } from 'src/apis/backendApi';
import { useRelationalStore } from 'src/stores/relationalStore';
import { useGroupStore } from 'src/stores/groupStore';
import { fileKey } from 'src/utils/document/fileKey';
import type { ContainerElementFile } from 'src/models/container';
import type { AnnotationID } from 'src/models/document/pdf';

/**
 * E2E（Playwright）テストから`window.__kumihimoTest`経由でBackendApi・関係性ストア・
 * グループストアへアクセスできるようにする、開発ビルド専用のフック。
 *
 * `import.meta.env.DEV`の分岐により、本番ビルド（`quasar build`）ではこのモジュール自体が
 * tree-shakingで除去される。実データ投入・状態確認をUIクリックのみに頼らず行うための入り口。
 */
export default defineBoot(({ store }) => {
  if (!import.meta.env.DEV) return;

  const groupStore = useGroupStore(store);

  window.__kumihimoTest = {
    api: useBackendApi(),
    stores: {
      relational: useRelationalStore(store),
      group: {
        // resolvePeekTarget()等のUI側ロジックが参照するのと同じキャッシュ（groupStore）を
        // 直接見ることで、バックエンドの確定とフロントエンドのキャッシュ反映のタイミングずれを
        // e2eテスト側で待ち合わせられるようにする
        matchingGroupId: (file: ContainerElementFile, ids: AnnotationID[]) =>
          groupStore.matchingGroup(fileKey(file), ids)?.id,
      },
    },
  };
});
