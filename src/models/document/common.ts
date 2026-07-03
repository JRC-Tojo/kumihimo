import z from 'zod';

/**
 * 各文書と並列に保存する設定ファイルの拡張子
 */
export const CONFIG_FILE_EXTS = '.rdcfg';

/**
 * 文書の本体データ
 */
export const DocumentSource = z.base64().brand('DocumnetSource');
export type DocumentSource = z.infer<typeof DocumentSource>;
