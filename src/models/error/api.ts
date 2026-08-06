/**
 * API レスポンススキーマ（Result型対応版）
 * Result<T>をフロントエンドに返す際に使用
 */

import type { Result, Success } from './result';

/**
 * APIエラーキー定義（コンソールメッセージなどで使用可能）
 *
 * TODO: 今後エラーメッセージの表示機構を整えたら移動させる
 */
export type ApiErrorKey =
  // =========== 初期設定 ===========
  | 'INIT_PROCESS_ERROR'
  | 'FAILED_LOAD_SETTINGS'
  | 'FAILED_SAVE_SETTINGS'
  // =========== 認証関係 ===========
  // | 'AUTH_UNAUTHORIZED'
  // | 'AUTH_FORBIDDEN'
  // =========== コンテナ関係 ===========
  | 'CONTAINERS_GET_FAILED'
  | 'CONTAINER_LOAD_FAILED'
  | 'CONTAINER_CREATE_FAILED'
  | 'CONTAINER_UNLOAD_FAILED'
  | 'CONTAINER_PERMISSION_FAILED'
  | 'PATH_RENAME_FAILED'
  | 'PATH_MOVE_FAILED'
  | 'FOLDER_CREATE_FAILED'
  | 'FOLDER_DELETE_FAILED'
  | 'WORKSPACE_PARSE_FAILED'
  // =========== ドキュメント関係 ===========
  | 'DOC_LIST_FAILED'
  | 'INVALID_DOCUMENT'
  // | 'DOC_NOT_FOUND'
  | 'DOC_SAVE_FAILED'
  | 'DOC_DELETE_FAILED'
  // | 'DOC_PARSE_ERROR'
  | 'DOCINFO_UPDATE_FAILED'
  | 'DOC_CONFIG_CONFLICT'
  | 'DOC_ANNOT_LOAD_FAILED'
  | 'DOC_ANNOT_REGIST_FAILED'
  | 'DOC_ANNOT_EMBED_FAILED'
  | 'DOC_ANNOT_REMOVE_FAILED'
  | 'DOC_ANNOT_PREVIEW_FAILED'
  | 'DOC_ANNOT_REORDER_FAILED'
  | 'DOC_ANNOT_PASTE_FAILED'
  | 'RELATIONAL_REGIST_FAILED'
  | 'RELATIONAL_LOAD_FAILED'
  | 'RELATIONAL_GET_FAILED'
  | 'RELATIONAL_CHECK_FAILED'
  | 'RELATIONAL_REMOVE_FAILED'
  | 'RELATIONAL_RESOLVE_FAILED'
  | 'RELATIONAL_RELAXATION_GET_FAILED'
  | 'RELATIONAL_RELAXATION_SAVE_FAILED'
  | 'LOCAL_FONT_QUERY_FAILED'
  | 'DOC_OUTLINE_LOAD_FAILED'
  | 'BOOKMARK_LOAD_FAILED'
  | 'BOOKMARK_SAVE_FAILED'
  // =========== プラグイン関係 ===========
  | 'PLUGIN_LIST_FAILED'
  | 'PLUGIN_MANIFEST_INVALID'
  | 'PLUGIN_INSTALL_FAILED'
  | 'PLUGIN_UNINSTALL_FAILED'
  | 'PLUGIN_TOGGLE_ENABLED_FAILED'
  | 'PLUGIN_DISCOVER_FAILED'
  | 'PLUGIN_RUN_FAILED'
  | 'PLUGIN_PLAN_COMMIT_FAILED'
  | 'PLUGIN_SUBMIT_FAILED'
  | 'PLUGIN_SUBMISSION_GET_FAILED'
  | 'PLUGIN_DISMISS_SUBMISSION_FAILED'
  | 'PLUGIN_PUBLISH_FAILED'
  | 'PLUGIN_GITHUB_AUTH_FAILED'
  | 'PLUGIN_GITHUB_TOKEN_MISSING'
  // =========== ストレージ関係 ===========
  // | 'STORAGE_READ_ERROR'
  // | 'STORAGE_WRITE_ERROR'
  // =========== その他 ===========
  // | 'VALIDATION_ERROR'
  // | 'SERVER_ERROR'
  | 'UNKNOWN_ERROR';

/**
 * APIエラー情報
 * key: エラーの識別子
 * message: ユーザーに表示するメッセージテンプレート（${variable}形式で変数を埋め込み可能）
 * variables?: メッセージに埋め込む変数
 */
export interface ApiErrorInfo<E = Error> {
  key: ApiErrorKey;
  error: E;
  variables?: Record<string, string | number | boolean>;
  details?: unknown; // デバッグ用の詳細情報
}

/**
 * API レスポンススキーマ
 */
export interface ApiResponseSuccess<T> {
  ok: true;
  data: T;
  timestamp: Date;
}

export interface ApiResponseFailure {
  ok: false;
  error: ApiErrorInfo;
  timestamp: Date;
  requestId: string; // リクエスト追跡用
}

export type ApiResponse<T = void> = ApiResponseSuccess<T> | ApiResponseFailure;

type KVArgs = NonNullable<ApiErrorInfo['variables']>;

export function toApiResponse<T>(res: Success<T>): ApiResponse<T>;
export function toApiResponse<T>(
  res: Result<T>,
  errKey: ApiErrorKey,
  errArgs?: KVArgs,
): ApiResponse<T>;
export function toApiResponse<T>(
  res: Result<T>,
  errKey: ApiErrorKey = 'UNKNOWN_ERROR',
  errArgs: KVArgs = {},
): ApiResponse<T> {
  if (res.ok) {
    return { ok: true, data: res.value, timestamp: new Date() };
  }

  const eInfo: ApiErrorInfo = {
    key: errKey,
    error: res.error,
    variables: errArgs,
  };
  return { ok: false, error: eInfo, timestamp: new Date(), requestId: errKey };
}
