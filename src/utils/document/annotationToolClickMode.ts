import type { DrawingAnnotationType } from 'src/models/docPage';
import type { AnnotationStyle } from 'src/models/document/pdf';

/**
 * MainToolsのアノテーション種別ボタンをクリックした際、選択中アノテーションのスタイルを
 * 次に描くスタイルへ引き継ぐべきかどうかを判定する（純粋関数）。選択中アノテーションが
 * ちょうど1件あり、かつクリックされた種別がその選択中アノテーションの種別と一致する場合のみ
 * trueを返す。
 *
 * MainToolsは選択の有無に関わらず常に描画モードへ切り替える（issue #58：以前はこの条件を
 * 満たす場合に早期returnして描画モードへの切り替え自体をブロックしていたが、関係性登録で
 * ペアとなるアノテーションを作成できなくなる副作用があったため撤廃した）。その代わりこの条件を
 * 満たす場合は、選択中アノテーションのスタイルを`currentAnnotationStyle`に引き継ぐことで、
 * MainToolsポップアップ内のプリセット追加ボタンが正しいスタイルを登録対象にできるようにする
 * （issue #45の根本原因への対処はこちらに引き継がれる）
 */
export function shouldInheritSelectionStyle(
  selection: AnnotationStyle[] | undefined,
  clickedType: DrawingAnnotationType,
): boolean {
  return selection?.length === 1 && selection[0]?.type === clickedType;
}
