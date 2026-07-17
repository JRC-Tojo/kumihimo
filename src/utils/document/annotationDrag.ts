/**
 * アノテーションのマウス操作（ドラッグ・リサイズ）に関する純粋な座標計算をまとめたユーティリティ
 *
 * Konvaのイベントやノードに依存しない座標計算のみを行い、各シェイプコンポーネントや
 * composableから呼び出す。修飾キー（Shift/Ctrl）の状態判定自体はここでは行わない。
 */

export interface Point {
  x: number;
  y: number;
}

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Shift+dragによる水平・垂直方向への移動制限
 *
 * 開始位置からの移動量が大きい軸のみ反映し、もう一方の軸は開始位置に固定する
 */
export function lockToDominantAxis(start: Point, pos: Point): Point {
  const dx = pos.x - start.x;
  const dy = pos.y - start.y;
  if (Math.abs(dx) >= Math.abs(dy)) {
    return { x: pos.x, y: start.y };
  }
  return { x: start.x, y: pos.y };
}

/**
 * Ctrl+dragによるLine/Arrow端点の中点対称移動
 *
 * centerを中心とした点対称の座標を返す（もう一方の端点をこの位置に置くことで、
 * 両端点が中点に対して対称に動くようにする）
 */
export function reflectAroundPoint(point: Point, center: Point): Point {
  return { x: center.x * 2 - point.x, y: center.y * 2 - point.y };
}

/**
 * コーナー/辺リサイズ時、Ctrlで中心固定にする際の位置補正
 *
 * リサイズ開始時のbox（startBox）の中心を基準に、リサイズ後の新しい幅・高さ（newBox.width/height）
 * を用いて中心が変わらないような新しいx/y（左上座標）を算出する
 */
export function applyCenteredResize(
  startBox: Box,
  newBox: { width: number; height: number },
): Point {
  const centerX = startBox.x + startBox.width / 2;
  const centerY = startBox.y + startBox.height / 2;
  return {
    x: centerX - newBox.width / 2,
    y: centerY - newBox.height / 2,
  };
}
