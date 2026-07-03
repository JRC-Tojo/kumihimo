// Node.jsの 'path' インポートを削除し、ブラウザ用のセパレータを定義
const SEP = '/';

function replaceSep(pathstr: string) {
  // すべてのバックスラッシュをスラッシュに統一し、重複するスラッシュを1つにまとめ、末尾のスラッシュを削除
  const normalized = pathstr.replace(/[\\/]+/g, SEP);
  if (normalized === SEP) return SEP;
  return normalized.replace(/\/$/, '');
}

// Node.js の path.normalize / path.join / path.resolve の簡易ブラウザ版実装
const browserPath = {
  normalize(pathstr: string): string {
    if (!pathstr) return '.';
    const parts = pathstr.split(SEP);
    const stack: string[] = [];
    const isAbsolute = pathstr.startsWith(SEP);

    for (const part of parts) {
      if (part === '' || part === '.') continue;
      if (part === '..') {
        if (stack.length > 0 && stack[stack.length - 1] !== '..') {
          stack.pop();
        } else if (!isAbsolute) {
          stack.push('..');
        }
      } else {
        stack.push(part);
      }
    }

    const result = stack.join(SEP);
    return isAbsolute ? SEP + result : result || '.';
  },

  join(...args: string[]): string {
    return browserPath.normalize(args.filter((p) => typeof p === 'string' && p).join(SEP));
  },

  resolve(...args: string[]): string {
    // ブラウザには「カレントディレクトリ」の概念がないため、リポジトリルートや仮想ルート（/）を基準とします
    let resolvedPath = '';
    let resolvedAbsolute = false;

    for (let i = args.length - 1; i >= -1 && !resolvedAbsolute; i--) {
      const path = i >= 0 ? args[i] : '/'; // 最終的にルートベースにする
      if (!path) continue;
      resolvedPath = path + SEP + resolvedPath;
      resolvedAbsolute = path.startsWith(SEP);
    }

    return browserPath.normalize(resolvedPath);
  },

  relative(from: string, to: string): string {
    const fromParts = browserPath.resolve(from).split(SEP).filter(Boolean);
    const toParts = browserPath.resolve(to).split(SEP).filter(Boolean);

    const length = Math.min(fromParts.length, toParts.length);
    let samePartsLength = length;
    for (let i = 0; i < length; i++) {
      if (fromParts[i] !== toParts[i]) {
        samePartsLength = i;
        break;
      }
    }

    let outputParts: string[] = [];
    for (let i = samePartsLength; i < fromParts.length; i++) {
      outputParts.push('..');
    }
    outputParts = outputParts.concat(toParts.slice(samePartsLength));

    return outputParts.join(SEP) || '.';
  },

  basename(pathstr: string, ext?: string): string {
    const parts = pathstr.split(SEP);
    let base = parts[parts.length - 1] || '';
    if (ext && base.endsWith(ext)) {
      base = base.slice(0, -ext.length);
    }
    return base;
  },

  extname(pathstr: string): string {
    const base = browserPath.basename(pathstr);
    const index = base.lastIndexOf('.');
    if (index === -1 || index === 0) return '';
    return base.slice(index);
  },
};

export class Path {
  private _path: string;
  constructor(value?: string | Path) {
    if (value === undefined) {
      this._path = '';
    } else if (typeof value === 'string') {
      this._path = browserPath.normalize(replaceSep(value));
    } else {
      this._path = value._path;
    }
  }

  child(...paths: string[]) {
    if (this._path !== '') {
      return new Path(browserPath.join(this._path, ...paths));
    }
    return new Path(browserPath.join(...paths));
  }

  parent(times = 1) {
    if (this._path) {
      return new Path(browserPath.join(this._path, ...new Array(times).fill('..')));
    }
    return new Path(browserPath.join(...Array(times).fill('..')));
  }

  absolute() {
    return new Path(browserPath.resolve(this._path));
  }

  /** このpathを起点にしたtargetの相対パスを返す */
  relativeto(target: Path) {
    return new Path(browserPath.relative(this._path, target._path));
  }

  /** パスを文字列化する */
  get path() {
    return this._path;
  }

  /** "で囲まれたパス文字列を返す */
  get quotedPath() {
    // ブラウザ（URL/スラッシュベース）を想定し、バックスラッシュのエスケープ処理を調整
    return `"${this._path.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  }

  /** ディレクトリ階層を除いたファイル名を返す ".../../file.txt" -> "file.txt" */
  basename() {
    return browserPath.basename(this._path);
  }

  /** ディレクトリ階層を除いたファイル名(拡張子なし)を返す ".../../file.txt" -> "file" */
  stemname() {
    return browserPath.basename(this._path, this.extname());
  }

  /** 拡張子を返す ".../../file.txt" -> ".txt" */
  extname() {
    return browserPath.extname(this._path);
  }
}

/**
 * パス一覧から特定の拡張子のみを抽出し、ファイル名（拡張子抜き）に重複があるものはすべて除外する
 * @param paths ファイルパスの配列
 * @param targetExtension 抽出したい拡張子（例: 'jpg', 'json'）
 */
export function filterAndExcludeDuplicateNames(paths: string[], targetExtension: string): string[] {
  // 拡張子のドットを標準化
  const targetExt = targetExtension.startsWith('.')
    ? targetExtension.slice(1).toLowerCase()
    : targetExtension.toLowerCase();

  // ファイル名（拡張子抜き）の登場回数を記録するマップ
  // キー: 拡張子抜きの名前, 値: { count: 登場回数, originalPath: 最初にみつかったパス }
  const nameMap = new Map<string, { count: number; originalPath: string }>();

  for (const pathStr of paths) {
    // パスからファイル名部分（例: "dir/sub/file.jpg" -> "file.jpg"）を取得
    const filename = pathStr.split('/').pop() || '';
    const lastDotIndex = filename.lastIndexOf('.');

    // 拡張子がない、またはドットが先頭にある場合はスキップ
    if (lastDotIndex <= 0) continue;

    const nameWithoutExt = filename.substring(0, lastDotIndex);
    const ext = filename.substring(lastDotIndex + 1).toLowerCase();

    // 目的の拡張子のみを対象にする
    if (ext === targetExt) {
      const existing = nameMap.get(nameWithoutExt);
      if (existing) {
        // すでに存在している場合はカウントを増やす（重複確定）
        existing.count++;
      } else {
        // 初めて登場した名前を登録
        nameMap.set(nameWithoutExt, { count: 1, originalPath: pathStr });
      }
    }
  }

  const result: string[] = [];

  // 登場回数が「ちょうど1回」のものだけを結果に加える
  for (const [, info] of nameMap) {
    if (info.count === 1) {
      result.push(info.originalPath);
    }
  }

  return result;
}
