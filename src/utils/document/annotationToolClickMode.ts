import type { DrawingAnnotationType } from 'src/models/docPage';
import type { AnnotationStyle } from 'src/models/document/pdf';

/**
 * MainToolsのアノテーション種別ボタンをクリックした際、描画モードへ切り替えず選択編集モードを
 * 維持すべきかどうかを判定する（純粋関数）。選択中アノテーションがちょうど1件あり、かつ
 * クリックされた種別がその選択中アノテーションの種別と一致する場合のみtrueを返す。
 *
 * この分岐がプリセット登録バグ（issue #45）の根本的な修正になる：この条件を満たす場合に
 * `activeAnnotationType`/`currentAnnotationStyle`を変更しないことで、MainToolsポップアップ内の
 * プリセット追加ボタンが選択中アノテーションのスタイルを正しく参照できるようになる
 */
export function shouldKeepSelectionMode(
  selection: AnnotationStyle[] | undefined,
  clickedType: DrawingAnnotationType,
): boolean {
  return selection?.length === 1 && selection[0]?.type === clickedType;
}
