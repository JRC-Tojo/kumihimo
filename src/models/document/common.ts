import z from 'zod';

/**
 * 各文書と並列に保存する設定ファイルの拡張子
 */
export const CONFIG_FILE_EXTS = '.kcfg';

/**
 * 本システムが内容を表示できる文書の拡張子
 *
 * これ以外の拡張子はエクスプローラー上には表示するが、タブを開くと非対応メッセージを表示する
 */
export const SUPPORTED_DOCUMENT_EXTS = ['.pdf', '.txt', '.md'] as const;

/**
 * 文書の本体データ
 */
export const DocumentSource = z.base64().brand('DocumnetSource');
export type DocumentSource = z.infer<typeof DocumentSource>;
