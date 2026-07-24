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

export function parseSemver(version: string): ParsedVersion | undefined {
  const match = SEMVER_PATTERN.exec(version);
  if (!match) return undefined;
  const [, major, minor, patch] = match as unknown as [string, string, string, string];
  return { major: Number(major), minor: Number(minor), patch: Number(patch) };
}

export function bumpVersion(version: string, kind: VersionBumpKind): string | undefined {
  const parsed = parseSemver(version);
  if (!parsed) return undefined;
  switch (kind) {
    case 'major':
      return `${parsed.major + 1}.0.0`;
    case 'minor':
      return `${parsed.major}.${parsed.minor + 1}.0`;
    case 'patch':
      return `${parsed.major}.${parsed.minor}.${parsed.patch + 1}`;
  }
}
