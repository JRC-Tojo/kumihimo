import z from 'zod';
import { PluginManifest } from './manifest';

/**
 * インストール済みプラグイン
 */
export const InstalledPlugin = z.object({
  manifest: PluginManifest,
  installedAt: z.coerce.date(),
  enabled: z.boolean().default(true),
});
export type InstalledPlugin = z.infer<typeof InstalledPlugin>;

/**
 * カタログ（導入可能プラグイン一覧）のエントリ
 *
 * `src/repositories/plugin/catalog.ts`のモックカタログが返す形
 */
export const CatalogEntry = z.object({
  manifest: PluginManifest,
  publishedAt: z.coerce.date(),
});
export type CatalogEntry = z.infer<typeof CatalogEntry>;
