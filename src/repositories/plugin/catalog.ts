/**
 * 「導入可能プラグイン一覧」のモックカタログ
 *
 * 実際のプラグインストア・リポジトリはまだ存在しないため（CLAUDE.mdの規約により、存在しない
 * 外部データはモックとして明示する）、このファイルは`samplePlugins/`配下のサンプルのメタ情報を
 * 固定配列として返すだけの実装とする。将来、別リポジトリの実カタログAPIに差し替える際も
 * `getCatalogEntries`/`getCatalogBinary`のシグネチャ自体は変えずに済むようにしてある
 */
import type { CatalogEntry } from 'src/models/plugin/installation';
import { PluginID } from 'src/models/plugin/manifest';
import type { Result } from 'src/models/error/result';
import { Failure, Success } from 'src/models/error/result';
import { base64ToUint8Array } from 'src/utils/binary/base64';
import { PAGE_NUMBER_STAMPER_WASM_BASE64 } from 'src/repositories/plugin/generated/pageNumberStamperWasm.generated';

const CATALOG_ENTRIES: CatalogEntry[] = [
  {
    manifest: {
      id: PluginID.parse('wasm-page-number-stamper'),
      name: 'ページ番号スタンパー',
      version: '1.0.0',
      description:
        '各ページにページ番号のテキストボックスを配置します（再実行時は前回分を置き換えます）',
      runtime: 'wasm',
      mainFile: 'page_number_stamper.wasm',
      requiredHostApis: [
        'ui.reportProgress',
        'plan.addAnnotation',
        'plan.removeAnnotation',
        'plan.setConfirmationMode',
        'doc.getAnnotationIdsByTag',
      ],
    },
    // モックカタログのため固定の日時を用いる
    publishedAt: new Date('2026-01-01T00:00:00.000Z'),
  },
  {
    manifest: {
      id: PluginID.parse('py-entry-point-stub'),
      name: 'Pyodideプラグイン（スタブ）',
      version: '0.1.0',
      description:
        'Pyodide実行エンジンは未実装のため、このプラグインは実行できません（将来対応予定のサンプル）',
      runtime: 'pyodide',
      mainFile: 'plugin.py',
      requiredHostApis: [],
    },
    publishedAt: new Date('2026-01-01T00:00:00.000Z'),
  },
];

export function getCatalogEntries(): Promise<Result<CatalogEntry[]>> {
  return Promise.resolve(Success(CATALOG_ENTRIES));
}

/**
 * カタログ上のプラグイン本体バイト列を取得する
 *
 * 実際の別リポジトリ運用時はここがHTTP取得等に置き換わる想定。現状はビルド時に
 * `bun run build:sample-plugins`が生成する`generated/pageNumberStamperWasm.generated.ts`の
 * base64定数から復元する
 */
export function getCatalogBinary(id: PluginID): Promise<Result<Uint8Array>> {
  if (id === ('wasm-page-number-stamper' as PluginID)) {
    return Promise.resolve(base64ToUint8Array(PAGE_NUMBER_STAMPER_WASM_BASE64));
  }
  return Promise.resolve(Failure(new Error(`No binary available for plugin (id: ${id})`)));
}
