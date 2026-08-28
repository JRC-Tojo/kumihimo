/**
 * グループの値算出方法（数式モード）で、各メンバーに割り当てる変数名（A, B, C...）を
 * `AnnotationGroup.memberIds`の並び順から導出するユーティリティ
 *
 * 変数の割当を別配列として永続化せず、常に`memberIds`の順序から導出することで、
 * メンバー構成が変わった際に実データと静かに乖離する二重の真実源を作らないようにする
 * （メンバーが縮小した場合の数式自体の扱いは呼び出し側の責務。関連: annotationGroup.ts）
 */
import type { AnnotationID } from 'src/models/document/pdf';

/**
 * インデックスから変数名を導出する（0→A, 1→B, ..., 25→Z, 26→AA, 27→AB, ...）
 *
 * グループは通常ユーザーが手作業で選択できる範囲のアノテーション数しか持たないため
 * A-Zの範囲で収まることがほとんどだが、26件を超えた場合もExcelの列名と同じ規則で
 * 破綻なく割り当てられるようにしておく
 */
export function letterForMemberIndex(index: number): string {
  let n = index;
  let letters = '';
  do {
    letters = String.fromCharCode(65 + (n % 26)) + letters;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return letters;
}

/**
 * `memberIds`の順序に対応する「変数名 → メンバーID」のマップを構築する
 */
export function buildVariableMap(memberIds: AnnotationID[]): Map<string, AnnotationID> {
  return new Map(memberIds.map((id, index) => [letterForMemberIndex(index), id]));
}
