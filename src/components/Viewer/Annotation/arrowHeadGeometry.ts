/**
 * 矢印/ポリラインの矢じり形状に関する、フレームワーク非依存の純粋なジオメトリ計算をまとめたモジュール
 *
 * 矢じりの見た目（頂点配置・塗り可否・閉多角形かどうか）の単一の真実源とすることで、
 * 実際のKonva描画（ArrowAnnotation.vue/PolylineAnnotation.vue/ArrowLikePreviewShape.vue）と
 * UIプレビュー（ArrowHeadPreview.vue/AnnotationPresetPreview.vue）の見た目がズレないようにする。
 *
 * ローカル座標系の規約: 先端（矢じりが実際に指す注釈の端点）を原点(0,0)とし、+x方向を
 * 「線の外側へ向かう方向」（線分の延長方向）とする。呼び出し側は`computeHeadTransform`で
 * 得た角度だけ回転させたうえで、端点座標へ平行移動して配置する
 */
import type { ArrowHeadType } from 'src/models/document/pdf';

/** 先端(0,0)を基準に、+x=外向きとしたローカル座標での頂点配列（[x1,y1,x2,y2,...]）。circle/noneはnull */
export function getHeadLocalPoints(type: ArrowHeadType, size: number): number[] | null {
  const half = size / 2;
  switch (type) {
    case 'triangle':
      return [0, 0, -size, -half, -size, half];
    case 'open':
      // 閉じたVの字（背面の辺を持たない輪郭のみの矢じり）。頂点順は「片方の後端→先端→もう片方の後端」
      return [-size, -half, 0, 0, -size, half];
    case 'reverseTriangle':
      // 通常のtriangleを先端側/後端側で反転し、端点より外側へ突き出す形状にする
      return [size, 0, 0, -half, 0, half];
    case 'reverseOpen':
      return [0, -half, size, 0, 0, half];
    case 'square':
      return [-half, -half, half, -half, half, half, -half, half];
    case 'diamond':
      return [0, -half, half, 0, 0, half, -half, 0];
    case 'butt':
      return [0, -half, 0, half];
    case 'slash':
      return [-size * 0.25, -half, size * 0.25, half];
    case 'circle':
    case 'none':
      return null;
  }
}

/** 'circle'のみ半径を返す。それ以外はnull */
export function getHeadRadius(type: ArrowHeadType, size: number): number | null {
  return type === 'circle' ? size / 2 : null;
}

/** 塗りつぶしを行う矢じり形状かどうか */
export function isFilledHead(type: ArrowHeadType): boolean {
  switch (type) {
    case 'triangle':
    case 'reverseTriangle':
    case 'square':
    case 'diamond':
    case 'circle':
      return true;
    default:
      return false;
  }
}

/** 閉じた多角形として描画すべき形状かどうか（falseの場合は開いた折れ線として描画する） */
export function isClosedHead(type: ArrowHeadType): boolean {
  switch (type) {
    case 'triangle':
    case 'reverseTriangle':
    case 'square':
    case 'diamond':
      return true;
    default:
      return false;
  }
}

export interface HeadTransform {
  tipX: number;
  tipY: number;
  angleDeg: number;
}

/**
 * 注釈の`points`（[x1,y1,x2,y2,...]、x/yからの相対座標）から、指定した端（start/end）の
 * 端点座標と、ローカル座標系の+x（外向き）を実際の線分方向へ合わせるための回転角度（度）を求める。
 * 2点構成のarrow・複数頂点構成のpolylineのどちらでも使えるよう、始点側は先頭2点、
 * 終点側は末尾2点の線分だけを見る。端点となる2点が一致する（線分の長さが0）場合はnullを返す
 */
export function computeHeadTransform(
  points: readonly number[],
  end: 'start' | 'end',
): HeadTransform | null {
  if (points.length < 4) return null;

  const [fromX, fromY, tipX, tipY] =
    end === 'end'
      ? [points[points.length - 4], points[points.length - 3], points[points.length - 2], points[points.length - 1]]
      : [points[2], points[3], points[0], points[1]];

  if (fromX === undefined || fromY === undefined || tipX === undefined || tipY === undefined) {
    return null;
  }

  const dx = tipX - fromX;
  const dy = tipY - fromY;
  if (Math.abs(dx) < 1e-9 && Math.abs(dy) < 1e-9) return null;

  const angleDeg = (Math.atan2(dy, dx) * 180) / Math.PI;
  return { tipX, tipY, angleDeg };
}

/** ローカル座標の頂点配列から、SVGの`d`属性文字列を組み立てる（閉多角形かどうかはisClosedHeadに従う） */
export function buildHeadLocalSvgPath(type: ArrowHeadType, size: number): string | null {
  const points = getHeadLocalPoints(type, size);
  if (!points) return null;

  const commands: string[] = [];
  for (let i = 0; i + 1 < points.length; i += 2) {
    commands.push(`${i === 0 ? 'M' : 'L'}${points[i]},${points[i + 1]}`);
  }
  if (isClosedHead(type)) commands.push('Z');
  return commands.join(' ');
}
