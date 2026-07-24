/**
 * WASMプラグインとホストの間でやり取りする全ホスト関数（`host_system`モジュール名前空間）の
 * シグネチャを定義する唯一の情報源
 *
 * ここで定義したシグネチャから、以下の2つが導出される:
 * - `engines/wasmEngine.ts`のDISCOVERY_SIGNATURES/EXECUTION_SIGNATURES（ホストが実際に
 *   注入するインポートオブジェクトの形）
 * - `PLUGIN_SDK/rust/host_sdk.rs`の`extern "C"`ブロック（`hostApiCodegen.ts`が生成し、
 *   `src/services/plugin/__test__/hostApiCodegen.test.ts`がこのレジストリとの一致を保証する）
 *
 * このレジストリを変更した場合は、`bun run generate:plugin-sdk`でRust SDK側を再生成すること。
 * 忘れると`hostApiCodegen.test.ts`が落ちて気づける
 */

/** ホスト関数側から見たJSの値の型（`wasmEngine.ts`のマーシャリングが必要とする粒度） */
export type HostApiParamJsType = 'string' | 'number' | 'boolean';

/** Rust側の`extern "C"`宣言に使う型（`string`は`*const u8`ポインタを意味する） */
export type HostApiParamRustType = 'string' | 'i32' | 'f32' | 'f64' | 'bool';

export interface HostApiParam {
  /** Rust側の引数名（コード生成・ドキュメント用。ホスト実装側の実引数名とは無関係） */
  name: string;
  jsType: HostApiParamJsType;
  rustType: HostApiParamRustType;
}

export interface HostApiFunctionSpec {
  /** `host_system`インポート名 かつ Rustの`extern "C"`関数名（snake_case） */
  hostFnName: string;
  /** discovery: 常時付与（`describePlugin`専用）／execution: requiredHostApisで最小権限制御 */
  group: 'discovery' | 'execution';
  params: HostApiParam[];
  returns: 'void' | 'string';
}

/** `HostApiFunctionSpec.params`を並べる際の記述量を減らすための、`HostApiParam`組み立てヘルパー */
function p(name: string, jsType: HostApiParamJsType, rustType: HostApiParamRustType): HostApiParam {
  return { name, jsType, rustType };
}

export const HOST_API_REGISTRY: HostApiFunctionSpec[] = [
  // ============ 発見専用（常時付与） ============
  {
    hostFnName: 'ui_register_entry_point',
    group: 'discovery',
    params: [
      p('entry_id', 'string', 'string'),
      p('label', 'string', 'string'),
      p('description', 'string', 'string'),
    ],
    returns: 'void',
  },
  {
    hostFnName: 'ui_add_text_field',
    group: 'discovery',
    params: [
      p('field_id', 'string', 'string'),
      p('label', 'string', 'string'),
      p('default_value', 'string', 'string'),
      p('optional', 'boolean', 'bool'),
    ],
    returns: 'void',
  },
  {
    hostFnName: 'ui_add_number_field',
    group: 'discovery',
    params: [
      p('field_id', 'string', 'string'),
      p('label', 'string', 'string'),
      p('default_value', 'number', 'f64'),
      p('optional', 'boolean', 'bool'),
    ],
    returns: 'void',
  },
  {
    hostFnName: 'ui_add_toggle_field',
    group: 'discovery',
    params: [
      p('field_id', 'string', 'string'),
      p('label', 'string', 'string'),
      p('default_value', 'boolean', 'bool'),
    ],
    returns: 'void',
  },
  {
    hostFnName: 'ui_add_select_field',
    group: 'discovery',
    params: [
      p('field_id', 'string', 'string'),
      p('label', 'string', 'string'),
      p('options_csv', 'string', 'string'),
      p('default_value', 'string', 'string'),
    ],
    returns: 'void',
  },
  {
    hostFnName: 'ui_add_file_field',
    group: 'discovery',
    params: [
      p('field_id', 'string', 'string'),
      p('label', 'string', 'string'),
      p('optional', 'boolean', 'bool'),
    ],
    returns: 'void',
  },

  // ============ 実行時API（requiredHostApisで最小権限制御） ============
  {
    hostFnName: 'ui_report_progress',
    group: 'execution',
    params: [p('percent', 'number', 'i32')],
    returns: 'void',
  },
  {
    hostFnName: 'ui_log',
    group: 'execution',
    params: [p('message', 'string', 'string')],
    returns: 'void',
  },
  {
    hostFnName: 'ui_report_error',
    group: 'execution',
    params: [p('message', 'string', 'string')],
    returns: 'void',
  },
  {
    hostFnName: 'plan_set_confirmation_mode',
    group: 'execution',
    params: [p('mode', 'string', 'string')],
    returns: 'void',
  },
  {
    hostFnName: 'plan_add_annotation',
    group: 'execution',
    params: [
      p('file_index', 'number', 'i32'),
      p('page', 'number', 'i32'),
      p('x', 'number', 'f32'),
      p('y', 'number', 'f32'),
      p('width', 'number', 'f32'),
      p('height', 'number', 'f32'),
      p('text', 'string', 'string'),
      p('color', 'string', 'string'),
      p('font_size', 'number', 'f32'),
      p('tags_csv', 'string', 'string'),
    ],
    returns: 'string',
  },
  {
    hostFnName: 'plan_update_annotation',
    group: 'execution',
    params: [
      p('annot_id', 'string', 'string'),
      p('x', 'number', 'f32'),
      p('y', 'number', 'f32'),
      p('width', 'number', 'f32'),
      p('height', 'number', 'f32'),
      p('text', 'string', 'string'),
      p('color', 'string', 'string'),
      p('font_size', 'number', 'f32'),
      p('tags_csv', 'string', 'string'),
    ],
    returns: 'string',
  },
  {
    hostFnName: 'plan_remove_annotation',
    group: 'execution',
    params: [p('annot_id', 'string', 'string')],
    returns: 'string',
  },
  {
    hostFnName: 'plan_add_relational',
    group: 'execution',
    params: [
      p('src_annot_id', 'string', 'string'),
      p('target_annot_id', 'string', 'string'),
      p('rule_type', 'string', 'string'),
    ],
    returns: 'string',
  },
  {
    hostFnName: 'plan_remove_relational',
    group: 'execution',
    params: [p('src_annot_id', 'string', 'string'), p('target_annot_id', 'string', 'string')],
    returns: 'string',
  },
  {
    hostFnName: 'doc_get_project_metadata',
    group: 'execution',
    params: [p('file_index', 'number', 'i32')],
    returns: 'string',
  },
  {
    hostFnName: 'doc_get_page_size',
    group: 'execution',
    params: [p('file_index', 'number', 'i32'), p('page', 'number', 'i32')],
    returns: 'string',
  },
  {
    hostFnName: 'doc_get_page_text_blocks',
    group: 'execution',
    params: [p('file_index', 'number', 'i32'), p('page', 'number', 'i32')],
    returns: 'string',
  },
  {
    hostFnName: 'doc_get_page_image',
    group: 'execution',
    params: [p('file_index', 'number', 'i32'), p('page', 'number', 'i32')],
    returns: 'string',
  },
  {
    hostFnName: 'doc_get_annotations_by_file',
    group: 'execution',
    params: [p('file_index', 'number', 'i32')],
    returns: 'string',
  },
  {
    hostFnName: 'doc_get_annotation_ids_by_tag',
    group: 'execution',
    params: [p('file_index', 'number', 'i32'), p('tag', 'string', 'string')],
    returns: 'string',
  },
];
