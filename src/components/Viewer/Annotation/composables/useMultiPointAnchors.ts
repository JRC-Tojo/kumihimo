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
  /**
   * アンカードラッグ終了時、親グループの`draggable`を戻す値を取得する（呼び出し元コンポーネントの
   * `:config`で計算しているのと同じ式を渡すこと）。ドラッグ開始時に`getGroupNode().draggable(false)`
   * で直接書き換えた値は、Vueの再描画では上書きされない（vue-konvaは前回の算出結果との差分でしか
   * 属性を再設定しないため、Vue側から見て`draggable`の計算結果自体はドラッグ前後で変わっていない
   * ＝差分なしと判定される）。ここで明示的に復元しないと、一度でも頂点をドラッグしたアノテーションは
   * 以後ずっと本体を移動できなくなってしまう
   */
  getGroupDraggable: () => boolean;
  /**
   * ドラッグ中、確定前の暫定pointsが変化するたびに呼ばれる（矢じり等、shapeNode自体は
   * 直接書き換えているため何もしなくても追従するが、矢じりのように別ノードとして描画される
   * 付随要素をVueの再描画（displayAnnotationの更新＝ドラッグ確定後）を待たずライブ追従させるため）
   */
  onPointsChange?: (points: number[]) => void;
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
    // Konvaのドラッグイベントは既定で親へbubbleする。ここで止めないと、
    // 親グループの dragmove/dragend ハンドラ（ボディドラッグ用）が誤って呼ばれてしまう
    e.cancelBubble = true;

    const shapeNode = options.getShapeNode();
    if (!shapeNode) return;

    const anchor = e.target as Konva.Rect;
    const points = shapeNode.points().slice();
    points[index * 2] = anchor.x();
    points[index * 2 + 1] = anchor.y();
    shapeNode.points(points);
    options.onPointsChange?.(points);
  }

  /**
   * 頂点ドラッグ終了処理
   *
   * `e.cancelBubble = true`は絶対に削除しないこと。Konvaの`dragend`イベントは既定で
   * 親ノードへbubbleするため、これを止めないと親グループ（ボディドラッグ用）の
   * onDragendハンドラが直後に誤発火する。親側は`props.annotation`（DB書き込み未反映の
   * 古い値）からpatchを組み立てるため、誤発火すると「頂点は新しい位置に動いたのに、
   * 本体の線だけ元の座標へ戻る」という不具合が再発する
   */
  function onAnchorDragEnd(e: KonvaEvent) {
    e.cancelBubble = true;
    options.getGroupNode()?.draggable(options.getGroupDraggable());

    const shapeNode = options.getShapeNode();
    if (!shapeNode) return;
    options.onCommit(shapeNode.points());
  }

  return { onAnchorDragStart, onAnchorDrag, onAnchorDragEnd };
}
