/**
 * コンテナルート（`<コンテナルート>/.kumihimo/settings.json`）に保存する、コンテナ単位の設定
 *
 * ブラウザ単位でしか保持されないアプリ設定（`src/models/settings.ts`のAppSettings）とは異なり、
 * 同一コンテナを開いた別のユーザー・別端末でも同じ内容が共有される。関係性の検証結果は
 * 検証に使う緩和ルールに依存するため、コンテナ内の誰が検証しても同じ結果になるよう
 * ここに保存する（IndexedDBのようなブラウザローカルな設定に置くと、開く人によって
 * 検証結果が変わってしまう）
 */

import z from 'zod';
import { RelaxationOptions, DEFAULT_RELAXATION_OPTIONS } from './relaxation';

export const ContainerSettingsFile = z.object({
  // 関係性の等値検証における緩和ルールの既定値（アノテーション別設定が無い場合に使われる）
  relationalRelaxation: RelaxationOptions.default(DEFAULT_RELAXATION_OPTIONS),
});
export type ContainerSettingsFile = z.infer<typeof ContainerSettingsFile>;

/**
 * コンテナ設定ファイルがまだ作成されていない場合（コンテナの初回読み込み時等）の初期値
 */
export const DEFAULT_CONTAINER_SETTINGS_FILE: ContainerSettingsFile = {
  relationalRelaxation: DEFAULT_RELAXATION_OPTIONS,
};
