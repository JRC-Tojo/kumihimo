/**
 * ページ数が変化した文書（ページ挿入・削除）における、旧ページ番号から新ページ番号への対応付け
 *
 * ONNXによる画像特徴点マッチングは1ページ対あたりの処理コストが高いため、まずテキスト内容の
 * 単純な類似度（単語集合のJaccard類似度）で対応する新ページを絞り込み、実際の座標変換
 * （LightGlueによる特徴点マッチング）は決定した対応ページ対のみに対して行うことで、
 * O(旧ページ数 × 新ページ数)回のONNX推論を避ける
 */

import type { DocumentSource } from 'src/models/document/common';
import { extractTextByPage } from 'src/repositories/document/pdf';

/** ページ対応とみなす最低限のテキスト類似度。これ未満なら対応する新ページなしとする */
const MIN_SIMILARITY = 0.1;

function tokenize(text: string): Set<string> {
  return new Set(
    text
      .split(/[\s、。,.:：;；]+/)
      .map((w) => w.trim())
      .filter((w) => w.length > 0),
  );
}

function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const w of a) {
    if (b.has(w)) intersection++;
  }
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/**
 * 旧ページ番号 → 新ページ番号の対応表を作る
 *
 * ページ数が一致する場合は同一番号のまま対応させる（高速パス）。一致しない場合、
 * `targetOldPageNumbers`（実際にアノテーションが存在する旧ページのみ）について
 * 全新ページとのテキスト類似度を比較し、最もスコアが高いページを対応先とする
 * （閾値未満の場合は対応なし=undefinedとし、呼び出し側で追跡失敗として扱わせる）
 */
export async function buildPageCorrespondence(
  oldSrc: DocumentSource,
  newSrc: DocumentSource,
  targetOldPageNumbers: number[],
  oldNumPages: number,
  newNumPages: number,
): Promise<Map<number, number | undefined>> {
  const correspondence = new Map<number, number | undefined>();

  if (oldNumPages === newNumPages) {
    targetOldPageNumbers.forEach((p) => correspondence.set(p, p));
    return correspondence;
  }

  const newPageTokens = await Promise.all(
    Array.from({ length: newNumPages }, async (_, i) => {
      const res = await extractTextByPage(newSrc, i + 1);
      return res.ok ? tokenize(res.value) : new Set<string>();
    }),
  );

  for (const oldPageNum of targetOldPageNumbers) {
    const oldTextRes = await extractTextByPage(oldSrc, oldPageNum);
    const oldTokens = oldTextRes.ok ? tokenize(oldTextRes.value) : new Set<string>();

    let bestScore = 0;
    let bestPage: number | undefined;
    newPageTokens.forEach((tokens, idx) => {
      const score = jaccardSimilarity(oldTokens, tokens);
      if (score > bestScore) {
        bestScore = score;
        bestPage = idx + 1;
      }
    });

    correspondence.set(oldPageNum, bestScore >= MIN_SIMILARITY ? bestPage : undefined);
  }

  return correspondence;
}
