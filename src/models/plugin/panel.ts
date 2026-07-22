import z from 'zod';
import { ContainerElementFile } from 'src/models/container';
import { PluginID } from './manifest';
import { PluginPlanItem } from './plan';

/**
 * プラグインタブ（`PluginPanelView`）に表示するブロック
 *
 * プラグインはこれらのブロックのJSONを送るだけで、実際の描画はすべてシステム側の
 * Vueコンポーネントが担う（プラグインにDOM/Vueへの参照は一切渡さない）
 */
export const PluginPanelBlock = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('progress'), label: z.string(), percent: z.number().nullable() }),
  z.object({ kind: z.literal('log'), lines: z.string().array() }),
  z.object({ kind: z.literal('text'), text: z.string() }),
]);
export type PluginPanelBlock = z.infer<typeof PluginPanelBlock>;

/**
 * プラグイン1回の実行状態
 */
export const PluginRunState = z.object({
  runId: z.string(),
  pluginId: PluginID,
  entryId: z.string(),
  // このランで選択された対象文書（`ui.addFileField`宣言順）。plan項目のcommit時
  // （annotationService呼び出し）の安全確認、および実行時ホストAPIの対象特定に使う
  targetFiles: ContainerElementFile.array(),
  blocks: PluginPanelBlock.array().default([]),
  plan: PluginPlanItem.array().default([]),
  status: z.enum(['running', 'done', 'error']),
});
export type PluginRunState = z.infer<typeof PluginRunState>;
