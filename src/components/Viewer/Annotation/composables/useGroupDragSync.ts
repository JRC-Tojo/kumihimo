/**
 * 範囲選択で複数のアノテーションを選択している際、そのうち1つをドラッグしたら選択中の
 * 他のアノテーションも一緒に移動するようにするための同期処理
 *
 * KonvaのTransformerは、アタッチされたノード同士でのみ`_proxyDrag`（ドラッグ開始時の絶対座標を
 * 記録し、次のdragmoveで delta を計算して他のアタッチ済みノードへ`setAbsolutePosition`+
 * `startDrag()`で伝播する仕組み）による同期移動を行う。元々`AnnotationLayer.vue`は
 * `supportsTransformer: true`の種別（box/circle/text）しかTransformerにアタッチしなかったため、
 * line/arrow/polyline/polygonのようなGroup系はこの同期の輪の外にいた（issue #49。本モジュールが
 * 追加された理由）。その後アノテーショングループ化機能により、複数選択時は全種別が
 * `canJoinGroupTransformer: true`として共有Transformerにアタッチされるようになったため、
 * 現状は選択数が2件以上の間、下記の重複回避チェックによりこのモジュール自体は常にスキップされる
 * （Konva本来の同期に一本化されている）。単一選択への揮発は起きないため、削除はせずそのまま残す
 *
 * 本モジュールはKonva Transformerと全く同じ手法を、選択中の全ノードに対して自前で適用する。
 * ただし「リーダー・フォロワーが共に共有Transformerに参加する種別」の組み合わせはKonva本来の
 * 同期に既に処理されているため、二重に移動させないよう明示的にスキップする
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
    const leaderJoinsGroupTransformer = leaderType
      ? ANNOTATION_REGISTRY[leaderType].canJoinGroupTransformer
      : false;

    selectedIds.forEach((otherId) => {
      if (otherId === id) return;
      const otherType = ctx.getAnnotationType(otherId);
      if (!otherType) return;

      // リーダー・フォロワーが共に複数選択時の共有Transformerに参加する種別の場合、
      // KonvaのTransformerが既に同期移動させているため、ここで重ねて動かすと二重にdeltaが
      // 適用されてしまう（グループ化機能の追加により全種別がcanJoinGroupTransformer:trueと
      // なったため、実質的にこの関数は選択数>1の間は常にスキップする経路が中心になる）
      if (leaderJoinsGroupTransformer && ANNOTATION_REGISTRY[otherType].canJoinGroupTransformer) {
        return;
      }

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
