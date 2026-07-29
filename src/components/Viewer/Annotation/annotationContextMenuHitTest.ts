/**
 * アノテーション右クリック（コンテキストメニュー）のヒットテストをまとめた純粋関数
 *
 * Konvaの`contextmenu`イベントは`target.attrs`にヒットしたシェイプの情報を持つ。
 * `handleMouseDown`（AnnotationLayer.vue）の判定規則と同じく、アンカー（`annotation-anchor`）を
 * 対象にした場合はそのアンカーが属する注釈本体のIDを返す
 */
export interface ContextMenuHitAttrs {
  name?: string;
  id?: string;
  annotationId?: string;
}

export function resolveContextMenuAnnotationId(
  attrs: ContextMenuHitAttrs | undefined,
): string | undefined {
  if (!attrs) return undefined;
  return attrs.name === 'annotation-anchor' ? attrs.annotationId : attrs.id;
}
