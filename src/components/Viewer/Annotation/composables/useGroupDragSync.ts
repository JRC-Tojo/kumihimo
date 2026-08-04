/**
 * 範囲選択で複数のアノテーションを選択している際、そのうち1つをドラッグしたら選択中の
 * 他のアノテーションも一緒に移動するようにするための同期処理
 *
 * KonvaのTransformerは、アタッチされたノード同士でのみ`_proxyDrag`（ドラッグ開始時の絶対座標を
 * 記録し、次のdragmoveで delta を計算して他のアタッチ済みノードへ`setAbsolutePosition`+
 * `startDrag()`で伝播する仕組み）による同期移動を行う。しかし`AnnotationLayer.vue`は
 * `supportsTransformer: true`の種別（box/circle/text）しかTransformerにアタッチしないため、
 * line/arrow/polyline/polygonのようなGroup系はこの同期の輪の外にいる（issue #49）。
 *
 * 本モジュールはKonva Transformerと全く同じ手法を、選択中の全ノードに対して自前で適用する。
 * ただし「リーダー・フォロワーが共にTransformer対応型」の組み合わせはKonva本来の同期に
 * 既に処理されているため、二重に移動させないよう明示的にスキップする
 */
import type Konva from 'konva';
import type { AnnotationID, AnnotationStyle } from 'src/models/document/pdf';
import { ANNOTATION_REGISTRY } from '../registry';

const DRAG_SYNC_NAMESPACE = 'groupDragSync';

export interface GroupDragSyncContext {
  /** 現在の選択中アノテーションID一覧を取得する */
  getSelectedIds: () => AnnotationID[];
  /** 指定IDのアノテーション種別を取得する（見つからない場合はundefined） */
  getAnnotationType: (id: AnnotationID) => AnnotationStyle['type'] | undefined;
  /** 指定IDのKonvaノードを取得する（見つからない場合はnull） */
  getNode: (id: AnnotationID) => Konva.Node | null;
}

/**
 * 指定ノード（1件のアノテーション）に、選択中の他ノードへドラッグを伝播させるリスナーを登録する。
 * 返り値の関数を呼ぶと登録を解除する（アノテーションのアンマウント時に呼ぶこと）
 */
export function bindGroupDragSync(
  id: AnnotationID,
  node: Konva.Node,
  ctx: GroupDragSyncContext,
): () => void {
  // Konva Transformerの_proxyDragと同じパターン：dragstartで絶対座標を記録し、
  // 次のdragmoveでdeltaを計算したらnullに戻す（以降のdragmoveは各ノード自身のネイティブ
  // ドラッグ追従に任せ、二重にdeltaを適用しない）
  let lastPos: { x: number; y: number } | null = null;

  const onDragStart = () => {
    lastPos = node.getAbsolutePosition();
  };

  const onDragMove = () => {
    if (!lastPos) return;
    const abs = node.getAbsolutePosition();
    const dx = abs.x - lastPos.x;
    const dy = abs.y - lastPos.y;
    lastPos = null;

    const selectedIds = ctx.getSelectedIds();
    if (selectedIds.length <= 1 || !selectedIds.includes(id)) return;

    const leaderType = ctx.getAnnotationType(id);
    const leaderSupportsTransformer = leaderType
      ? ANNOTATION_REGISTRY[leaderType].supportsTransformer
      : false;

    selectedIds.forEach((otherId) => {
      if (otherId === id) return;
      const otherType = ctx.getAnnotationType(otherId);
      if (!otherType) return;

      // リーダー・フォロワーが共にTransformer対応型の場合、KonvaのTransformerが
      // 既に同期移動させているため、ここで重ねて動かすと二重にdeltaが適用されてしまう
      if (leaderSupportsTransformer && ANNOTATION_REGISTRY[otherType].supportsTransformer) return;

      const otherNode = ctx.getNode(otherId);
      if (!otherNode || otherNode.isDragging()) return;

      const otherAbs = otherNode.getAbsolutePosition();
      otherNode.setAbsolutePosition({ x: otherAbs.x + dx, y: otherAbs.y + dy });
      // ネイティブドラッグを引き継がせることで、以降のポインタ移動に他のノードと同様に追従し、
      // 既存のonDragstart/onDragend（beginBodyDrag/commitBodyDrag）がそのまま発火する
      otherNode.startDrag();
    });
  };

  node.on(`dragstart.${DRAG_SYNC_NAMESPACE}`, onDragStart);
  node.on(`dragmove.${DRAG_SYNC_NAMESPACE}`, onDragMove);

  return () => {
    node.off(`.${DRAG_SYNC_NAMESPACE}`);
  };
}
