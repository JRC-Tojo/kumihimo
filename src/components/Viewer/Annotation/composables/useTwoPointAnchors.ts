/**
 * 2点（始点・終点）で定義される形状（直線・矢印）の端点アンカー編集ロジックを共通化するコンポーザブル
 *
 * LineAnnotation.vueで実装していたアンカードラッグ・Shiftキーによる45度スナップの処理を
 * 汎用化し、ArrowAnnotation.vueと共有する。Ctrl押下時は、ドラッグ開始時点の中点を基準に
 * 反対側の端点も同時に対称移動させる（中心対称リサイズ）。
 */

import { ref } from 'vue';
import type Konva from 'konva';
import { reflectAroundPoint, type Point } from 'src/utils/document/annotationDrag';

type KonvaEvent = Konva.KonvaEventObject<MouseEvent>;
// Konva.Line/Konva.Arrowの points() は GetSet<number[], this> 型（getter/setterオーバーロード）のため、
// 両方の呼び出し形に構造的に一致するインターフェースとして定義する
interface TwoPointNode {
  points(): number[];
  points(points: number[]): unknown;
}

export interface UseTwoPointAnchorsOptions {
  /** points()を持つKonvaノード（v-line/v-arrow）を取得する */
  getShapeNode: () => TwoPointNode | null;
  /** ドラッグ中に無効化する親グループノードを取得する（アンカー操作と形状全体の移動が競合しないようにする） */
  getGroupNode: () => Konva.Group | null;
  /** 反対側の端点アンカーノードを取得する（Ctrl押下時の中心対称移動で、見た目上の位置も追従させるため） */
  getAnchorNode: (idx: 0 | 1) => Konva.Rect | null;
  /**
   * ドラッグ中、確定前の暫定pointsが変化するたびに呼ばれる（矢じり等、shapeNode自体は
   * 直接書き換えているため何もしなくても追従するが、矢じりのように別ノードとして描画される
   * 付随要素をVueの再描画（displayAnnotationの更新＝ドラッグ確定後）を待たずライブ追従させるため）
   */
  onPointsChange?: (points: [number, number, number, number]) => void;
  /** アンカードラッグ終了時に、確定したpointsで呼ばれる */
  onCommit: (points: [number, number, number, number]) => void;
}

/** 固定点からの角度を45度刻みにスナップした座標を返す */
function snapEndpoint(point: Point, fixed: Point): Point {
  const dx = point.x - fixed.x;
  const dy = point.y - fixed.y;
  const angle = Math.atan2(dy, dx);
  const snapped = Math.round(angle / (Math.PI / 4)) * (Math.PI / 4);
  const length = Math.hypot(dx, dy);
  return {
    x: fixed.x + Math.cos(snapped) * length,
    y: fixed.y + Math.sin(snapped) * length,
  };
}

export function useTwoPointAnchors(options: UseTwoPointAnchorsOptions) {
  // Ctrl+dragによる中心対称移動の基準点（ドラッグ開始時点の中点）
  const dragStartMidpoint = ref<Point | null>(null);

  function onAnchorDragStart(e: KonvaEvent) {
    options.getGroupNode()?.draggable(false);
    e.cancelBubble = true;

    const shapeNode = options.getShapeNode();
    if (shapeNode) {
      const points = shapeNode.points();
      dragStartMidpoint.value = {
        x: (points[0]! + points[2]!) / 2,
        y: (points[1]! + points[3]!) / 2,
      };
    }
  }

  /** idx: 0 = 始点側アンカー, 1 = 終点側アンカー */
  function onAnchorDrag(idx: 0 | 1, e: KonvaEvent) {
    // Konvaのドラッグイベントは既定で親へbubbleする。ここで止めないと、
    // 親グループの dragmove/dragend ハンドラ（ボディドラッグ用）が誤って呼ばれてしまう
    e.cancelBubble = true;

    const shapeNode = options.getShapeNode();
    if (!shapeNode) return;

    const anchor = e.target as Konva.Rect;
    const points = shapeNode.points().slice() as [number, number, number, number];
    const fixedIndex = idx === 0 ? ([2, 3] as const) : ([0, 1] as const);
    const movingIndex = idx === 0 ? ([0, 1] as const) : ([2, 3] as const);
    const newPoint = { x: anchor.x(), y: anchor.y() };

    if (e.evt.ctrlKey && dragStartMidpoint.value) {
      // Ctrl押下時: ドラッグ開始時点の中点を基準に、反対側の端点も対称に動かす
      const midpoint = dragStartMidpoint.value;
      const movedPoint = e.evt.shiftKey ? snapEndpoint(newPoint, midpoint) : newPoint;
      const reflectedPoint = reflectAroundPoint(movedPoint, midpoint);

      anchor.position(movedPoint);
      points[movingIndex[0]] = movedPoint.x;
      points[movingIndex[1]] = movedPoint.y;
      points[fixedIndex[0]] = reflectedPoint.x;
      points[fixedIndex[1]] = reflectedPoint.y;

      options.getAnchorNode(idx === 0 ? 1 : 0)?.position(reflectedPoint);
    } else {
      const fixedPoint = { x: points[fixedIndex[0]], y: points[fixedIndex[1]] };
      const movedPoint = e.evt.shiftKey ? snapEndpoint(newPoint, fixedPoint) : newPoint;

      anchor.position(movedPoint);
      points[movingIndex[0]] = movedPoint.x;
      points[movingIndex[1]] = movedPoint.y;
    }

    shapeNode.points(points);
    options.onPointsChange?.(points);
  }

  /**
   * 端点ドラッグ終了処理
   *
   * `e.cancelBubble = true`は絶対に削除しないこと。Konvaの`dragend`イベントは既定で
   * 親ノードへbubbleするため、これを止めないと親グループ（ボディドラッグ用）の
   * onDragendハンドラが直後に誤発火する。親側は`props.annotation`（DB書き込み未反映の
   * 古い値）からpatchを組み立てるため、誤発火すると「端点は新しい位置に動いたのに、
   * 本体の線だけ元の座標へ戻る」という不具合が再発する
   */
  function onAnchorDragEnd(e: KonvaEvent) {
    e.cancelBubble = true;

    const shapeNode = options.getShapeNode();
    if (!shapeNode) return;
    dragStartMidpoint.value = null;
    options.onCommit(shapeNode.points() as [number, number, number, number]);
  }

  return {
    onAnchorDragStart,
    onAnchorDrag0: (e: KonvaEvent) => onAnchorDrag(0, e),
    onAnchorDrag1: (e: KonvaEvent) => onAnchorDrag(1, e),
    onAnchorDragEnd,
  };
}
