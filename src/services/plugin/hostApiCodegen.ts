/**
 * `hostApiRegistry.ts`の`HOST_API_REGISTRY`から、Rust SDK（`PLUGIN_SDK/rust/host_sdk.rs`）の
 * `extern "C"`ブロックのテキストを生成する
 *
 * この関数は2箇所から同じ形で呼ばれる:
 * - `scripts/generatePluginSdk.ts`（`bun run generate:plugin-sdk`）が`host_sdk.rs`の
 *   マーカー区間（`GENERATED-EXTERN:BEGIN`〜`GENERATED-EXTERN:END`）を書き換える
 * - `src/services/plugin/__test__/hostApiCodegen.test.ts`が、checked-inの`host_sdk.rs`の
 *   マーカー区間とこの関数の出力が一致することを検証する（ズレ検知）
 *
 * 純粋関数（ファイルI/Oを行わない）にすることで、生成側・検証側の両方から同一ロジックを
 * 参照できるようにしている
 */
import type {
  HostApiFunctionSpec,
  HostApiParamRustType,
} from 'src/services/plugin/hostApiRegistry';

/** 1行に収めた場合の長さがこの値を超える場合、引数を1行ずつに折り返す */
const MAX_LINE_LENGTH = 100;

function rustParamType(rustType: HostApiParamRustType): string {
  return rustType === 'string' ? '*const u8' : rustType;
}

function formatFunctionDeclaration(spec: HostApiFunctionSpec): string {
  const paramStrs = spec.params.map((param) => `${param.name}: ${rustParamType(param.rustType)}`);
  const returnsSuffix = spec.returns === 'string' ? ' -> *const u8' : '';

  const oneLine = `    fn ${spec.hostFnName}(${paramStrs.join(', ')})${returnsSuffix};`;
  if (oneLine.length <= MAX_LINE_LENGTH) return oneLine;

  const paramLines = paramStrs.map((s) => `        ${s},`).join('\n');
  return `    fn ${spec.hostFnName}(\n${paramLines}\n    )${returnsSuffix};`;
}

/**
 * `extern "C" { ... }`ブロックの中身（マーカー区間に収まる部分。マーカー行自体は含まない）を生成する
 */
export function generateRustExternBlock(registry: HostApiFunctionSpec[]): string {
  const discovery = registry.filter((spec) => spec.group === 'discovery');
  const execution = registry.filter((spec) => spec.group === 'execution');

  const lines: string[] = [];
  lines.push('    // ---- 発見専用（describePlugin内でのみ呼ぶこと） ----');
  for (const spec of discovery) lines.push(formatFunctionDeclaration(spec));
  lines.push('');
  lines.push(
    '    // ---- 実行時API（manifest.requiredHostApisで要求したもののみ実データを返す） ----',
  );
  for (const spec of execution) lines.push(formatFunctionDeclaration(spec));

  return lines.join('\n');
}

export const GENERATED_EXTERN_BEGIN_MARKER = '// GENERATED-EXTERN:BEGIN';
export const GENERATED_EXTERN_END_MARKER = '// GENERATED-EXTERN:END';

/**
 * ファイル全文からマーカー区間（マーカー行自体は含まない中身）を抽出する。
 * マーカーが見つからない場合は`undefined`を返す
 */
export function extractMarkedBlock(fileText: string): string | undefined {
  const beginIndex = fileText.indexOf(GENERATED_EXTERN_BEGIN_MARKER);
  const endIndex = fileText.indexOf(GENERATED_EXTERN_END_MARKER);
  if (beginIndex === -1 || endIndex === -1 || endIndex < beginIndex) return undefined;

  const afterBegin = fileText.indexOf('\n', beginIndex);
  if (afterBegin === -1) return undefined;
  return fileText.slice(afterBegin + 1, endIndex).replace(/\s+$/, '');
}

/**
 * ファイル全文のマーカー区間を、生成済みテキストで置き換える（マーカー行自体は保持する）
 */
export function replaceMarkedBlock(fileText: string, generated: string): string {
  const beginIndex = fileText.indexOf(GENERATED_EXTERN_BEGIN_MARKER);
  const endIndex = fileText.indexOf(GENERATED_EXTERN_END_MARKER);
  if (beginIndex === -1 || endIndex === -1 || endIndex < beginIndex) {
    throw new Error('GENERATED-EXTERN マーカーが見つかりませんでした');
  }

  const afterBeginLineEnd = fileText.indexOf('\n', beginIndex);
  if (afterBeginLineEnd === -1)
    throw new Error('GENERATED-EXTERN:BEGIN行の末尾が見つかりませんでした');

  const before = fileText.slice(0, afterBeginLineEnd + 1);
  const after = fileText.slice(endIndex);
  return `${before}${generated}\n    ${after}`;
}
