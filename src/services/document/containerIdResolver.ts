import type { ContainerID } from 'src/models/container';

/**
 * 関係性ファイルに記録されたアドレスのcIDを、必要であれば現在のコンテナIDへ読み替える
 *
 * ローカルコンテナのIDは、同一フォルダを別環境（新しいPC等）で開き直すたびに新規採番されるため、
 * `.rd/relational.json`に記録されたcIDが記録時点のまま残っていると、読み込み側の現在のコンテナIDと
 * 一致せずキャッシュDBに保存した関係性が参照できなくなる。
 * 記録されたcIDが現在どのコンテナとしても登録されていない場合は、このファイルを所有する
 * 現在のコンテナ自身への参照（＝古いID）とみなして読み替える。現在も別コンテナとして登録されている
 * 場合はコンテナをまたぐ関係性として維持する
 *
 * サービス層（containerService等）に依存しない純粋関数として切り出し、
 * 単体テストが重いモジュールグラフ（OCR/PDF/IndexedDB等）を読み込まずに済むようにしている
 */
export function resolveCachedContainerID(
  cID: ContainerID,
  currentContainerID: ContainerID,
  isRegisteredContainer: (id: ContainerID) => boolean,
): ContainerID {
  if (cID === currentContainerID) return cID;
  return isRegisteredContainer(cID) ? cID : currentContainerID;
}
