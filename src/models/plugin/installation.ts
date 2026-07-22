import z from 'zod';
import { PluginManifest } from './manifest';

/**
 * インストール済みプラグイン
 */
export const InstalledPlugin = z.object({
  manifest: PluginManifest,
  installedAt: z.coerce.date(),
  enabled: z.boolean().default(true),
  // アイコン画像（data URL）。オフラインでも一覧に表示できるよう、インストール時に取得して保持する。
  // manifest.iconFileが未指定、または取得に失敗した場合はundefined（デフォルトアイコンを表示する）
  iconDataUrl: z.string().optional(),
});
export type InstalledPlugin = z.infer<typeof InstalledPlugin>;

/**
 * カタログ（導入可能プラグイン一覧）のエントリ
 *
 * `src/repositories/plugin/catalog.ts`がストアリポジトリ（GitHub）から実際に取得する
 */
export const CatalogEntry = z.object({
  manifest: PluginManifest,
  publishedAt: z.coerce.date(),
  // アイコン画像の参照URL（raw.githubusercontent.com）。manifest.iconFile未指定時はundefined
  iconUrl: z.url().optional(),
});
export type CatalogEntry = z.infer<typeof CatalogEntry>;
