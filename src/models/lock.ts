/**
 * アプリ起動前ロック画面用の共有パスフレーズハッシュ
 *
 * オープンソースであるため、このハッシュ値を含めソースコード自体は誰でも閲覧できる。
 * 本気で解析・改変を試みる相手には無力であり、あくまでURLを知った部外者が偶発的に
 * アプリを使ってしまうことを防ぐ簡易的な抑止（ソフトロック）として位置づける
 *
 * 生成方法（ブラウザのコンソール等で実行）:
 *   const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('決めたパスフレーズ'));
 *   [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
 */
export const LOCK_PASSWORD_HASH =
  'a2db139e00a59a7b86fb22f65c59a897fee15bc1c43b33e6b3feb734647e5146';
