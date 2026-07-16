/**
 * N個の頂点で定義される形状（折れ線・ポリゴン）の頂点アンカー編集ロジックを共通化するコンポーザブル
 *
 * 2点専用（Shift角度スナップ付き）の`useTwoPointAnchors`とは別に、頂点数が可変な形状向けに
 * スナップ無しの単純な位置編集ロジックとして用意する。
 */

import type Konva from 'konva';

type KonvaEvent = Konva.KonvaEventObject<MouseEvent>;

interface MultiPointNode {
  points(): number[];
  points(points: number[]): unknown;
}

export interface UseMultiPointAnchorsOptions {
  /** points()を持つKonvaノード（v-line/v-arrow）を取得する */
  getShapeNode: () => MultiPointNode | null;
  /** ドラッグ中に無効化する親グループノードを取得する（アンカー操作と形状全体の移動が競合しないようにする） */
  getGroupNode: () => Konva.Group | null;
  /** アンカードラッグ終了時に、確定したpointsで呼ばれる */
  onCommit: (points: number[]) => void;
}

export function useMultiPointAnchors(options: UseMultiPointAnchorsOptions) {
  function onAnchorDragStart(e: KonvaEvent) {
    options.getGroupNode()?.draggable(false);
    e.cancelBubble = true;
  }

  /** index: 何番目の頂点か（0始まり） */
  function onAnchorDrag(index: number, e: KonvaEvent) {
    const shapeNode = options.getShapeNode();
    if (!shapeNode) return;

    const anchor = e.target as Konva.Rect;
    const points = shapeNode.points().slice();
    points[index * 2] = anchor.x();
    points[index * 2 + 1] = anchor.y();
    shapeNode.points(points);
  }

  function onAnchorDragEnd() {
    const shapeNode = options.getShapeNode();
    if (!shapeNode) return;
    options.onCommit(shapeNode.points());
  }

  return { onAnchorDragStart, onAnchorDrag, onAnchorDragEnd };
}
