/**
 * プラグインのバージョン文字列（`x.y.z`形式）を解釈し、メジャー/マイナー/パッチを1つ上げる
 */

export type VersionBumpKind = 'major' | 'minor' | 'patch';

interface ParsedVersion {
  major: number;
  minor: number;
  patch: number;
}

const SEMVER_PATTERN = /^(\d+)\.(\d+)\.(\d+)$/;

/**
 * x.y.z形式のバージョン文字列を数値コンポーネントへ分解する。
 */
export function parseSemver(version: string): ParsedVersion | undefined {
  // 正規表現に一致しない入力はバージョンとして扱わない。
  const match = SEMVER_PATTERN.exec(version);
  if (!match) return undefined;
  const [, major, minor, patch] = match as unknown as [string, string, string, string];
  // 各コンポーネントを数値化して返す。
  return { major: Number(major), minor: Number(minor), patch: Number(patch) };
}

/**
 * 指定コンポーネントを1つ増加させたバージョン文字列を返す。
 */
export function bumpVersion(version: string, kind: VersionBumpKind): string | undefined {
  // 先に入力形式を検証し、不正な値は更新しない。
  const parsed = parseSemver(version);
  if (!parsed) return undefined;
  // 更新対象に応じて下位コンポーネントをリセットする。
  switch (kind) {
    case 'major':
      return `${parsed.major + 1}.0.0`;
    case 'minor':
      return `${parsed.major}.${parsed.minor + 1}.0`;
    case 'patch':
      return `${parsed.major}.${parsed.minor}.${parsed.patch + 1}`;
  }
}
