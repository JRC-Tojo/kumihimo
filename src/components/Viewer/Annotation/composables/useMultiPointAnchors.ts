/**
 * 頂点アンカー（ドラッグハンドル）のドラッグ処理をまとめたコンポーザブル
 *
 * 「N個の頂点で定義される形状（折れ線・ポリゴン）向けの単純な位置編集」（useMultiPointAnchors）と
 * 「2点（始点・終点）で定義される形状（直線・矢印）向けのShift45度スナップ・Ctrl中心対称移動付き編集」
 * （useTwoPointAnchors）は、頂点1件のドラッグに応じてpointsをどう書き換えるかだけが異なり、
 * それ以外（ドラッグ開始時の親グループ無効化、ドラッグ終了時の親グループdraggable復元・確定
 * コミット、Konvaのバブリング防止）は完全に同じ処理のため、共通コア（createAnchorDragHandlers）を
 * 1箇所にまとめて両者で使い回す
 */

import { ref } from 'vue';
import type Konva from 'konva';
import { reflectAroundPoint, type Point } from 'src/utils/document/annotationDrag';

type KonvaEvent = Konva.KonvaEventObject<MouseEvent>;

interface PointsNode {
  points(): number[];
  points(points: number[]): unknown;
}

interface AnchorDragCoreOptions {
  /** points()を持つKonvaノード（v-line/v-arrow）を取得する */
  getShapeNode: () => PointsNode | null;
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

/**
 * ドラッグ開始・終了に共通する処理（親グループのdraggable無効化・復元、bubble防止、確定コミット）
 * をまとめた内部ヘルパー。頂点1件のドラッグに応じたpoints書き換えロジックだけを
 * `updatePoint`として差し替えることで、useMultiPointAnchors/useTwoPointAnchors両方の実体になる
 */
function createAnchorDragHandlers(
  options: AnchorDragCoreOptions,
  updatePoint: (points: number[], index: number, anchor: Konva.Rect, e: KonvaEvent) => void,
  onDragStart?: (points: number[]) => void,
  onDragEnd?: () => void,
) {
  function onAnchorDragStart(e: KonvaEvent) {
    options.getGroupNode()?.draggable(false);
    e.cancelBubble = true;

    const shapeNode = options.getShapeNode();
    if (shapeNode) onDragStart?.(shapeNode.points());
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
    updatePoint(points, index, anchor, e);
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
    onDragEnd?.();

    const shapeNode = options.getShapeNode();
    if (!shapeNode) return;
    options.onCommit(shapeNode.points());
  }

  return { onAnchorDragStart, onAnchorDrag, onAnchorDragEnd };
}

export type UseMultiPointAnchorsOptions = AnchorDragCoreOptions;

/**
 * N個の頂点で定義される形状（折れ線・ポリゴン）向けの頂点アンカー編集ロジック。
 * スナップ無しの単純な位置編集のみを行う
 */
export function useMultiPointAnchors(options: UseMultiPointAnchorsOptions) {
  return createAnchorDragHandlers(options, (points, index, anchor) => {
    points[index * 2] = anchor.x();
    points[index * 2 + 1] = anchor.y();
  });
}

export interface UseTwoPointAnchorsOptions {
  /** points()を持つKonvaノード（v-line/v-arrow）を取得する */
  getShapeNode: () => PointsNode | null;
  /** ドラッグ中に無効化する親グループノードを取得する（アンカー操作と形状全体の移動が競合しないようにする） */
  getGroupNode: () => Konva.Group | null;
  /** アンカードラッグ終了時、親グループの`draggable`を戻す値を取得する（詳細はAnchorDragCoreOptions参照） */
  getGroupDraggable: () => boolean;
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

/**
 * 2点（始点・終点）で定義される形状（直線・矢印）向けの頂点アンカー編集ロジック。
 * Shiftキーによる45度スナップに加え、Ctrl押下時はドラッグ開始時点の中点を基準に
 * 反対側の端点も同時に対称移動させる（中心対称リサイズ）
 */
export function useTwoPointAnchors(options: UseTwoPointAnchorsOptions) {
  // Ctrl+dragによる中心対称移動の基準点（ドラッグ開始時点の中点）
  const dragStartMidpoint = ref<Point | null>(null);

  const { onAnchorDragStart, onAnchorDrag, onAnchorDragEnd } = createAnchorDragHandlers(
    {
      getShapeNode: options.getShapeNode,
      getGroupNode: options.getGroupNode,
      getGroupDraggable: options.getGroupDraggable,
      onPointsChange: (points) =>
        options.onPointsChange?.(points as [number, number, number, number]),
      onCommit: (points) => options.onCommit(points as [number, number, number, number]),
    },
    (points, index, anchor, e) => {
      const idx = index as 0 | 1;
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
        const fixedPoint = { x: points[fixedIndex[0]]!, y: points[fixedIndex[1]]! };
        const movedPoint = e.evt.shiftKey ? snapEndpoint(newPoint, fixedPoint) : newPoint;

        anchor.position(movedPoint);
        points[movingIndex[0]] = movedPoint.x;
        points[movingIndex[1]] = movedPoint.y;
      }
    },
    (points) => {
      dragStartMidpoint.value = {
        x: (points[0]! + points[2]!) / 2,
        y: (points[1]! + points[3]!) / 2,
      };
    },
    () => {
      dragStartMidpoint.value = null;
    },
  );

  return {
    onAnchorDragStart,
    onAnchorDrag0: (e: KonvaEvent) => onAnchorDrag(0, e),
    onAnchorDrag1: (e: KonvaEvent) => onAnchorDrag(1, e),
    onAnchorDragEnd,
  };
}
