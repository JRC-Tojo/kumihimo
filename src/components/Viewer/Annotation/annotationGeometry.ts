/**
 * アノテーション種別ごとの純粋な幾何計算・デフォルト値をまとめたレジストリ
 *
 * ドラッグ開始・終了座標からアノテーション実体を生成する処理、描画中プレビュー形状の計算、
 * 外接矩形（バウンディングボックス）計算に加え、初期プリセット（`defaultPresets`）も
 * 種別ごとに1箇所へ集約する。サービス層に置くことで、Viewerコンポーネント（Konva描画）・
 * リポジトリ層（src/repositories/document/pdf.ts のOCR/プレビュー画像切り出し）・
 * 設定層（src/settings/main.ts のデフォルトプリセット生成）のいずれからもレイヤー規約を
 * 破らずに参照できる。
 *
 * 新しいアノテーション種別を追加する際は、`AnnotationStyle`（models/document/pdf.ts）に
 * 型を追加したうえで、この`ANNOTATION_GEOMETRY`にエントリを追加する。追加を忘れると
 * `Record<AnnotationStyle['type'], AnnotationGeometryModule>`の型チェックでコンパイルエラーになる。
 * `defaultPresets`は`AnnotationGeometryModule`の必須フィールドのため、エントリ追加時に
 * デフォルトスタイルの設定を忘れることもできない（設定し忘れると、その種別はプリセットが
 * 1件も無いままとなり、ユーザーがプリセットを自作しない限り実質的に使用不能になってしまう）。
 */

import { v4 as uuidv4 } from 'uuid';
import dayjs from 'dayjs';
import { AnnotationID, ColorCode, type AnnotationStyle } from 'src/models/document/pdf';
import type { DrawingAnnotationStyle } from 'src/models/docPage';
import type { BoundingBox } from 'src/models/common';
import { hexToRgba } from 'src/utils/color/hexToRgba';
import { strokeTypeToDash } from 'src/utils/document/strokeDash';

export interface Point {
  x: number;
  y: number;
}

interface RectLike {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** 点の外積を用いた向き判定（線分交差判定の補助）。0=一直線上、1/2=左右どちらか */
function orientation(p: Point, q: Point, r: Point): 0 | 1 | 2 {
  const val = (q.y - p.y) * (r.x - q.x) - (q.x - p.x) * (r.y - q.y);
  if (Math.abs(val) < 1e-9) return 0;
  return val > 0 ? 1 : 2;
}

/** p-q-r が一直線上にある前提で、qがp-r線分上（境界含む）にあるかどうか */
function onSegment(p: Point, q: Point, r: Point): boolean {
  return (
    q.x <= Math.max(p.x, r.x) + 1e-9 &&
    q.x >= Math.min(p.x, r.x) - 1e-9 &&
    q.y <= Math.max(p.y, r.y) + 1e-9 &&
    q.y >= Math.min(p.y, r.y) - 1e-9
  );
}

/** 2つの線分（p1-q1, p2-q2）が交差する（端点が触れるだけの場合も含む）かどうか */
function segmentsIntersect(p1: Point, q1: Point, p2: Point, q2: Point): boolean {
  const o1 = orientation(p1, q1, p2);
  const o2 = orientation(p1, q1, q2);
  const o3 = orientation(p2, q2, p1);
  const o4 = orientation(p2, q2, q1);

  if (o1 !== o2 && o3 !== o4) return true;
  if (o1 === 0 && onSegment(p1, p2, q1)) return true;
  if (o2 === 0 && onSegment(p1, q2, q1)) return true;
  if (o3 === 0 && onSegment(p2, p1, q2)) return true;
  if (o4 === 0 && onSegment(p2, q1, q2)) return true;
  return false;
}

/** 線分（p1-p2）が矩形（境界含む）と交差するかどうか。線分の端点が矩形内にある場合も交差とみなす */
function segmentIntersectsRect(p1: Point, p2: Point, rect: RectLike): boolean {
  const inRect = (p: Point) =>
    p.x >= rect.x && p.x <= rect.x + rect.width && p.y >= rect.y && p.y <= rect.y + rect.height;
  if (inRect(p1) || inRect(p2)) return true;

  const corners: Point[] = [
    { x: rect.x, y: rect.y },
    { x: rect.x + rect.width, y: rect.y },
    { x: rect.x + rect.width, y: rect.y + rect.height },
    { x: rect.x, y: rect.y + rect.height },
  ];
  for (let i = 0; i < 4; i++) {
    const a = corners[i]!;
    const b = corners[(i + 1) % 4]!;
    if (segmentsIntersect(p1, p2, a, b)) return true;
  }
  return false;
}

/** 折れ線・多角形共通: 相対座標の頂点列（原点オフセット）を絶対座標の線分列と比較し、どれか1本でも矩形と交差すればtrue */
function polylineIntersectsRect(
  originX: number,
  originY: number,
  points: number[],
  rect: RectLike,
  closed: boolean,
): boolean {
  const abs: Point[] = [];
  for (let i = 0; i + 1 < points.length; i += 2) {
    abs.push({ x: originX + points[i]!, y: originY + points[i + 1]! });
  }
  if (abs.length < 2) return false;

  for (let i = 0; i + 1 < abs.length; i++) {
    if (segmentIntersectsRect(abs[i]!, abs[i + 1]!, rect)) return true;
  }
  if (closed && abs.length >= 3) {
    if (segmentIntersectsRect(abs[abs.length - 1]!, abs[0]!, rect)) return true;
  }

  // 矩形が完全に図形の内側にある（辺には触れない）ケースを拾うため、中心点の内外判定を補助的に行う
  if (closed) {
    const center = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
    let inside = false;
    for (let i = 0, j = abs.length - 1; i < abs.length; j = i++) {
      const pi = abs[i]!;
      const pj = abs[j]!;
      const intersects =
        pi.y > center.y !== pj.y > center.y &&
        center.x < ((pj.x - pi.x) * (center.y - pi.y)) / (pj.y - pi.y) + pi.x;
      if (intersects) inside = !inside;
    }
    if (inside) return true;
  }

  return false;
}

/** 楕円（中心cx,cy・半径rx,ry）と矩形が交差するかどうかの近似判定（矩形内の最近点と中心の距離で判定） */
function ellipseIntersectsRect(
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  rect: RectLike,
): boolean {
  const closestX = Math.max(rect.x, Math.min(cx, rect.x + rect.width));
  const closestY = Math.max(rect.y, Math.min(cy, rect.y + rect.height));
  const nx = rx > 0 ? (closestX - cx) / rx : 0;
  const ny = ry > 0 ? (closestY - cy) / ry : 0;
  return nx * nx + ny * ny <= 1;
}

/** 初期設定として投入されるプリセット1件分の元データ（id/表示順はsettings層で採番する） */
export interface AnnotationDefaultPreset {
  name: string;
  style: DrawingAnnotationStyle;
}

interface AnnotationGeometryModuleCommon<T extends AnnotationStyle> {
  /** アノテーションの外接矩形（OCR/プレビュー画像切り出し用、少し余白を含む）を計算する */
  boundingBox(style: T): BoundingBox;
  /**
   * 位置・サイズ操作盤（SubTools）向け: 現在の全体サイズ（幅・高さ）を返す
   *
   * boundingBoxと異なり余白を含まない、図形そのものの実サイズ（多頂点図形は外接矩形の辺長）
   */
  getSize(style: T): { width: number; height: number };
  /**
   * 位置・サイズ操作盤向け: 指定した全体サイズになるよう、型ごとのフィールドを更新するpatchを返す
   *
   * 多頂点図形（polyline/polygon）は原点を基準に各頂点を比例縮尺する
   */
  resizeTo(style: T, width: number, height: number): Partial<T>;
  /**
   * 交差選択（矩形の一部でも重なっていれば選択）向け: 図形の実形状が矩形と交差するかどうかを判定する。
   * `rect`はstyleと同じドキュメント座標系（scale未適用）で渡すこと。
   * バウンディングボックスのAABB同士の重なりだけでは、折れ線・円などの空白部分まで
   * 選択されてしまうため、型ごとの実形状に基づいた判定をここに集約する
   */
  intersectsRect(style: T, rect: RectLike): boolean;
  /** 初期設定（初回起動時・既存設定への補完時）に投入するこの種別のデフォルトプリセット。1件以上必須 */
  defaultPresets: AnnotationDefaultPreset[];
}

/** ドラッグ（始点→終点の2点）から生成する種別向け。現在は全種別がclickPoints方式のため未使用だが、将来の拡張のため型として残す */
export interface DragDrawModule<
  T extends AnnotationStyle,
> extends AnnotationGeometryModuleCommon<T> {
  drawMode: 'drag';
  /** ドラッグ開始・終了座標からアノテーション実体を生成する */
  createFromDrag(
    pageNumber: number,
    start: Point,
    end: Point,
    style: DrawingAnnotationStyle,
  ): T | null;
  /** 描画中（ドラッグ中）のプレビュー形状のKonva設定を計算する */
  previewFromDrag(start: Point, end: Point, style: DrawingAnnotationStyle): Record<string, unknown>;
}

/** クリックで頂点を置いていく方式で生成する種別（box/line/circle/arrow/polyline/polygon/text の全種別） */
export interface ClickPointsDrawModule<
  T extends AnnotationStyle,
> extends AnnotationGeometryModuleCommon<T> {
  drawMode: 'clickPoints';
  /** 確定時、これまでにクリックした頂点座標列からアノテーション実体を生成する */
  createFromPoints(pageNumber: number, points: Point[], style: DrawingAnnotationStyle): T | null;
  /**
   * 描画中のプレビュー形状のKonva設定を計算する（cursorは最後に置いた頂点から現在のマウス位置へのラバーバンド用）
   *
   * `options.closing`は、始点付近にカーソルがあり今クリックすれば閉合確定できる状態かどうかを示す
   * （closable=trueの種別のみ使用。polygonはこの間だけ閉じた図形として塗りを適用し、
   * ユーザーに「ここで閉じられる」ことを視覚的に伝える）
   */
  previewFromPoints(
    points: Point[],
    cursor: Point | null,
    style: DrawingAnnotationStyle,
    options?: { closing?: boolean },
  ): Record<string, unknown>;
  /** trueの場合、始点付近を再クリックすると新しい頂点を追加せず形状を閉じて確定できる */
  closable: boolean;
  /**
   * 指定した場合、頂点数がこの値に達した時点で（始点への再クリックを待たず）自動的に確定する。
   * line/textのように「2点だけで成立する」種別を、クリックのみ（ドラッグ不要）で
   * 描けるようにするために使う（polyline/polygonは未指定のまま）
   */
  maxPoints?: number;
}

export type AnnotationGeometryModule<T extends AnnotationStyle = AnnotationStyle> =
  DragDrawModule<T> | ClickPointsDrawModule<T>;

const BOUNDING_BOX_PADDING = 2;

/**
 * ドラッグ開始・終了座標から共通のベースフィールドを生成する。
 * strokeColorが未設定（「線色なし」）の場合はcolor: undefinedとして有効に扱い、
 * 値はあるが不正な文字列の場合のみnullを返す
 */
function buildBaseAnnotation(
  pageNumber: number,
  x: number,
  y: number,
  style: DrawingAnnotationStyle,
) {
  const strokeColor =
    style.strokeColor === undefined ? undefined : ColorCode.safeParse(style.strokeColor);
  if (strokeColor && !strokeColor.success) return null;

  const now = dayjs().toISOString();
  return {
    base: {
      id: AnnotationID.parse(uuidv4()),
      pageNumber,
      x,
      y,
      createdAt: now,
      updatedAt: now,
      comment: {},
    },
    color: strokeColor?.data,
  };
}

/** プレビュー描画用の線色。strokeColorが未設定（「線色なし」）の場合は'transparent'を返す */
function previewStroke(style: DrawingAnnotationStyle): string {
  return style.strokeColor ? hexToRgba(style.strokeColor, style.strokeOpacity) : 'transparent';
}

/**
 * ポリゴンのプレビュー描画用の塗り色を算出する。未確定（始点を再クリックして閉合するまで）の
 * 間は基本的に塗らないが、閉合確定できる状態（closing）またはfillColorが設定済みの場合は
 * 塗り色（未設定ならstrokeColorで代用）を使う
 */
function previewPolygonFill(style: DrawingAnnotationStyle, closing: boolean): string {
  if (style.type !== 'polygon') return 'transparent';
  const fillSource = style.fillColor ?? style.strokeColor;
  return (closing || style.fillColor) && fillSource
    ? hexToRgba(fillSource, style.fillOpacity)
    : 'transparent';
}

/**
 * 既存の注釈をもとに、新しいIDを持つ複製オブジェクトを生成する
 *
 * ペースト（Ctrl+V）・Ctrl+ドラッグによる複製・（将来の）右クリックメニュー「複製」の
 * いずれの経路からも共有利用する中心関数。位置・ページ番号以外のフィールド（色・スタイル・
 * points等）はsourceからそのまま引き継ぐ
 */
export function duplicateAnnotation(
  source: AnnotationStyle,
  pageNumber: number,
  x: number,
  y: number,
): AnnotationStyle {
  const now = dayjs().toISOString();
  return {
    ...source,
    id: AnnotationID.parse(uuidv4()),
    pageNumber,
    x,
    y,
    createdAt: now,
    updatedAt: now,
  };
}

const boxGeometry: AnnotationGeometryModule = {
  drawMode: 'clickPoints',
  closable: false,
  maxPoints: 2,
  createFromPoints(pageNumber, points, style) {
    if (style.type !== 'box') return null;
    if (points.length < 2) return null;
    const start = points[0]!;
    const end = points[1]!;
    const built = buildBaseAnnotation(
      pageNumber,
      Math.min(start.x, end.x),
      Math.min(start.y, end.y),
      style,
    );
    if (!built) return null;

    return {
      ...built.base,
      type: 'box',
      color: built.color,
      strokeWidth: style.strokeWidth,
      strokeType: style.strokeType,
      width: Math.abs(end.x - start.x),
      height: Math.abs(end.y - start.y),
      strokeOpacity: style.strokeOpacity,
      fillOpacity: style.fillOpacity,
      fillColor: ColorCode.safeParse(style.fillColor).success
        ? ColorCode.parse(style.fillColor)
        : undefined,
    };
  },
  previewFromPoints(points, cursor, style) {
    if (style.type !== 'box') return {};
    const start = points[0];
    if (!start) return {};
    const end = points[1] ?? cursor ?? start;
    return {
      x: Math.min(start.x, end.x),
      y: Math.min(start.y, end.y),
      width: Math.abs(end.x - start.x),
      height: Math.abs(end.y - start.y),
      fill: style.fillColor ? hexToRgba(style.fillColor, style.fillOpacity) : 'transparent',
      stroke: previewStroke(style),
      strokeWidth: style.strokeWidth,
      dash: strokeTypeToDash(style.strokeType, style.strokeWidth),
    };
  },
  boundingBox(style) {
    if (style.type !== 'box') return { x: 0, y: 0, width: 0, height: 0 };
    const { x, y, width, height } = style;
    return {
      x: Math.max(0, x - BOUNDING_BOX_PADDING),
      y: Math.max(0, y - BOUNDING_BOX_PADDING),
      width: width + BOUNDING_BOX_PADDING * 2,
      height: height + BOUNDING_BOX_PADDING * 2,
    };
  },
  getSize(style) {
    if (style.type !== 'box') return { width: 0, height: 0 };
    return { width: style.width, height: style.height };
  },
  resizeTo(style, width, height) {
    if (style.type !== 'box') return {};
    return { width, height };
  },
  intersectsRect(style, rect) {
    if (style.type !== 'box') return false;
    return (
      style.x + style.width >= rect.x &&
      style.x <= rect.x + rect.width &&
      style.y + style.height >= rect.y &&
      style.y <= rect.y + rect.height
    );
  },
  defaultPresets: [
    {
      name: 'ボックス（青枠）',
      style: {
        type: 'box',
        strokeColor: '#0000FF',
        strokeWidth: 5,
        strokeType: 'solid',
        strokeOpacity: 1,
        fillColor: '#0000FF',
        fillPattern: 'solid',
        fillOpacity: 0.5,
      },
    },
  ],
};

/** 直線・矢印共通: 起点・終点の外接矩形（線幅を考慮）を計算する */
function lineLikeBoundingBox(
  x: number,
  y: number,
  points: number[],
  strokeWidth: number,
): BoundingBox {
  const [, , dx, dy] = points;
  const x2 = x + (dx ?? 2);
  const y2 = y + (dy ?? 2);

  const halfStroke = strokeWidth / 2 + BOUNDING_BOX_PADDING;
  const minX = Math.min(x, x2) - halfStroke;
  const maxX = Math.max(x, x2) + halfStroke;
  const minY = Math.min(y, y2) - halfStroke;
  const maxY = Math.max(y, y2) + halfStroke;

  return {
    x: Math.max(0, minX),
    y: Math.max(0, minY),
    width: maxX - minX,
    height: maxY - minY,
  };
}

/** 折れ線・ポリゴン共通: 相対座標の頂点配列（原点からのオフセット）からmin/max範囲を計算する（余白なし） */
function computePointsSpan(points: number[]): {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
} {
  let minX = 0;
  let maxX = 0;
  let minY = 0;
  let maxY = 0;

  for (let i = 0; i + 1 < points.length; i += 2) {
    const px = points[i]!;
    const py = points[i + 1]!;
    minX = Math.min(minX, px);
    maxX = Math.max(maxX, px);
    minY = Math.min(minY, py);
    maxY = Math.max(maxY, py);
  }

  return { minX, maxX, minY, maxY };
}

/**
 * 折れ線・ポリゴン共通: 指定した全体サイズになるよう、原点（min座標）を基準に全頂点を比例縮尺する
 *
 * 縮尺元の辺長が0（縦横どちらかに潰れた図形）の場合はその軸の縮尺を1倍のまま据え置く
 */
function resizePointsTo(points: number[], width: number, height: number): number[] {
  const { minX, maxX, minY, maxY } = computePointsSpan(points);
  const oldWidth = maxX - minX;
  const oldHeight = maxY - minY;
  const scaleX = oldWidth > 0 ? width / oldWidth : 1;
  const scaleY = oldHeight > 0 ? height / oldHeight : 1;

  return points.map((v, i) =>
    i % 2 === 0 ? minX + (v - minX) * scaleX : minY + (v - minY) * scaleY,
  );
}

/** 折れ線・ポリゴン共通: 全頂点のmin/maxから外接矩形（線幅を考慮）を計算する（lineLikeBoundingBoxのN点版） */
function multiPointBoundingBox(
  x: number,
  y: number,
  points: number[],
  strokeWidth: number,
): BoundingBox {
  const halfStroke = strokeWidth / 2 + BOUNDING_BOX_PADDING;
  let minX = x;
  let maxX = x;
  let minY = y;
  let maxY = y;

  for (let i = 0; i + 1 < points.length; i += 2) {
    const px = x + points[i]!;
    const py = y + points[i + 1]!;
    minX = Math.min(minX, px);
    maxX = Math.max(maxX, px);
    minY = Math.min(minY, py);
    maxY = Math.max(maxY, py);
  }

  return {
    x: Math.max(0, minX - halfStroke),
    y: Math.max(0, minY - halfStroke),
    width: maxX - minX + halfStroke * 2,
    height: maxY - minY + halfStroke * 2,
  };
}

const lineGeometry: AnnotationGeometryModule = {
  drawMode: 'clickPoints',
  closable: false,
  maxPoints: 2,
  createFromPoints(pageNumber, points, style) {
    if (style.type !== 'line') return null;
    if (points.length < 2) return null;
    const start = points[0]!;
    const end = points[1]!;
    const built = buildBaseAnnotation(pageNumber, start.x, start.y, style);
    if (!built) return null;

    return {
      ...built.base,
      type: 'line',
      color: built.color,
      strokeWidth: style.strokeWidth,
      strokeType: style.strokeType,
      strokeOpacity: style.strokeOpacity,
      points: [0, 0, end.x - start.x, end.y - start.y],
    };
  },
  previewFromPoints(points, cursor, style) {
    if (style.type !== 'line') return {};
    const start = points[0];
    if (!start) return {};
    const end = points[1] ?? cursor ?? start;
    return {
      x: start.x,
      y: start.y,
      points: [0, 0, end.x - start.x, end.y - start.y],
      stroke: previewStroke(style),
      strokeWidth: style.strokeWidth,
      dash: strokeTypeToDash(style.strokeType, style.strokeWidth),
    };
  },
  boundingBox(style) {
    if (style.type !== 'line') return { x: 0, y: 0, width: 0, height: 0 };
    return lineLikeBoundingBox(style.x, style.y, style.points, style.strokeWidth ?? 2);
  },
  getSize(style) {
    if (style.type !== 'line') return { width: 0, height: 0 };
    return { width: Math.abs(style.points[2] ?? 0), height: Math.abs(style.points[3] ?? 0) };
  },
  resizeTo(style, width, height) {
    if (style.type !== 'line') return {};
    const signX = (style.points[2] ?? 0) < 0 ? -1 : 1;
    const signY = (style.points[3] ?? 0) < 0 ? -1 : 1;
    return { points: [style.points[0] ?? 0, style.points[1] ?? 0, width * signX, height * signY] };
  },
  intersectsRect(style, rect) {
    if (style.type !== 'line') return false;
    const [x1, y1, x2, y2] = style.points;
    if (x1 === undefined || y1 === undefined || x2 === undefined || y2 === undefined) return false;
    return segmentIntersectsRect(
      { x: style.x + x1, y: style.y + y1 },
      { x: style.x + x2, y: style.y + y2 },
      rect,
    );
  },
  defaultPresets: [
    {
      name: '実線（黒）',
      style: {
        type: 'line',
        strokeColor: '#000000',
        strokeType: 'solid',
        strokeWidth: 5,
        strokeOpacity: 1,
      },
    },
    {
      name: '点線（赤）',
      style: {
        type: 'line',
        strokeColor: '#FF0000',
        strokeType: 'dash-dot',
        strokeWidth: 10,
        strokeOpacity: 1,
      },
    },
  ],
};

const circleGeometry: AnnotationGeometryModule = {
  drawMode: 'clickPoints',
  closable: false,
  maxPoints: 2,
  createFromPoints(pageNumber, points, style) {
    if (style.type !== 'circle') return null;
    if (points.length < 2) return null;
    const start = points[0]!;
    const end = points[1]!;
    const deltaX = end.x - start.x;
    const deltaY = end.y - start.y;
    const built = buildBaseAnnotation(
      pageNumber,
      start.x + deltaX / 2,
      start.y + deltaY / 2,
      style,
    );
    if (!built) return null;

    return {
      ...built.base,
      type: 'circle',
      color: built.color,
      strokeWidth: style.strokeWidth,
      strokeType: style.strokeType,
      strokeOpacity: style.strokeOpacity,
      fillOpacity: style.fillOpacity,
      fillColor: ColorCode.safeParse(style.fillColor).success
        ? ColorCode.parse(style.fillColor)
        : undefined,
      radius: Math.sqrt(deltaX * deltaX + deltaY * deltaY) / 2,
    };
  },
  previewFromPoints(points, cursor, style) {
    if (style.type !== 'circle') return {};
    const start = points[0];
    if (!start) return {};
    const end = points[1] ?? cursor ?? start;
    const deltaX = end.x - start.x;
    const deltaY = end.y - start.y;
    return {
      x: start.x + deltaX / 2,
      y: start.y + deltaY / 2,
      radius: Math.sqrt(deltaX * deltaX + deltaY * deltaY) / 2,
      fill: style.fillColor ? hexToRgba(style.fillColor, style.fillOpacity) : 'transparent',
      stroke: previewStroke(style),
      strokeWidth: style.strokeWidth,
      dash: strokeTypeToDash(style.strokeType, style.strokeWidth),
    };
  },
  boundingBox(style) {
    if (style.type !== 'circle') return { x: 0, y: 0, width: 0, height: 0 };
    const { x, y } = style;
    // 楕円化されている場合はradiusX/radiusYを使い、未設定（正円）の場合はradiusにフォールバックする
    const radiusX = style.radiusX ?? style.radius;
    const radiusY = style.radiusY ?? style.radius;
    const extentX = radiusX + BOUNDING_BOX_PADDING;
    const extentY = radiusY + BOUNDING_BOX_PADDING;
    return {
      x: Math.max(0, x - extentX),
      y: Math.max(0, y - extentY),
      width: extentX * 2,
      height: extentY * 2,
    };
  },
  getSize(style) {
    if (style.type !== 'circle') return { width: 0, height: 0 };
    return {
      width: (style.radiusX ?? style.radius) * 2,
      height: (style.radiusY ?? style.radius) * 2,
    };
  },
  resizeTo(style, width, height) {
    if (style.type !== 'circle') return {};
    // radiusX/radiusYを明示することで楕円化する（正円のradiusは互換性のため残す）
    return { radiusX: width / 2, radiusY: height / 2 };
  },
  intersectsRect(style, rect) {
    if (style.type !== 'circle') return false;
    const radiusX = style.radiusX ?? style.radius;
    const radiusY = style.radiusY ?? style.radius;
    return ellipseIntersectsRect(style.x, style.y, radiusX, radiusY, rect);
  },
  defaultPresets: [
    {
      name: '円（緑枠）',
      style: {
        type: 'circle',
        strokeColor: '#009900',
        strokeWidth: 3,
        strokeType: 'solid',
        strokeOpacity: 1,
        fillColor: '#009900',
        fillPattern: 'solid',
        fillOpacity: 0.3,
      },
    },
  ],
};

const arrowGeometry: AnnotationGeometryModule = {
  drawMode: 'clickPoints',
  closable: false,
  maxPoints: 2,
  createFromPoints(pageNumber, points, style) {
    if (style.type !== 'arrow') return null;
    if (points.length < 2) return null;
    const start = points[0]!;
    const end = points[1]!;
    const built = buildBaseAnnotation(pageNumber, start.x, start.y, style);
    if (!built) return null;

    return {
      ...built.base,
      type: 'arrow',
      color: built.color,
      strokeWidth: style.strokeWidth,
      strokeType: style.strokeType,
      strokeOpacity: style.strokeOpacity,
      points: [0, 0, end.x - start.x, end.y - start.y],
      startHead: style.startHead,
      endHead: style.endHead,
      headSize: style.headSize,
    };
  },
  previewFromPoints(points, cursor, style) {
    if (style.type !== 'arrow') return {};
    const start = points[0];
    if (!start) return {};
    const end = points[1] ?? cursor ?? start;
    return {
      x: start.x,
      y: start.y,
      points: [0, 0, end.x - start.x, end.y - start.y],
      stroke: previewStroke(style),
      strokeWidth: style.strokeWidth,
      dash: strokeTypeToDash(style.strokeType, style.strokeWidth),
      startHead: style.startHead,
      endHead: style.endHead,
      headSize: style.headSize,
    };
  },
  boundingBox(style) {
    if (style.type !== 'arrow') return { x: 0, y: 0, width: 0, height: 0 };
    return lineLikeBoundingBox(style.x, style.y, style.points, style.strokeWidth ?? 2);
  },
  getSize(style) {
    if (style.type !== 'arrow') return { width: 0, height: 0 };
    return { width: Math.abs(style.points[2] ?? 0), height: Math.abs(style.points[3] ?? 0) };
  },
  resizeTo(style, width, height) {
    if (style.type !== 'arrow') return {};
    const signX = (style.points[2] ?? 0) < 0 ? -1 : 1;
    const signY = (style.points[3] ?? 0) < 0 ? -1 : 1;
    return { points: [style.points[0] ?? 0, style.points[1] ?? 0, width * signX, height * signY] };
  },
  intersectsRect(style, rect) {
    if (style.type !== 'arrow') return false;
    const [x1, y1, x2, y2] = style.points;
    if (x1 === undefined || y1 === undefined || x2 === undefined || y2 === undefined) return false;
    return segmentIntersectsRect(
      { x: style.x + x1, y: style.y + y1 },
      { x: style.x + x2, y: style.y + y2 },
      rect,
    );
  },
  defaultPresets: [
    {
      name: '矢印（黒）',
      style: {
        type: 'arrow',
        strokeColor: '#000000',
        strokeWidth: 3,
        strokeType: 'solid',
        strokeOpacity: 1,
        startHead: 'none',
        endHead: 'triangle',
        headSize: 12,
      },
    },
  ],
};

const polylineGeometry: AnnotationGeometryModule = {
  drawMode: 'clickPoints',
  closable: false,
  createFromPoints(pageNumber, points, style) {
    if (style.type !== 'polyline') return null;
    if (points.length < 2) return null;
    const origin = points[0];
    if (!origin) return null;
    const built = buildBaseAnnotation(pageNumber, origin.x, origin.y, style);
    if (!built) return null;

    return {
      ...built.base,
      type: 'polyline',
      color: built.color,
      strokeWidth: style.strokeWidth,
      strokeType: style.strokeType,
      strokeOpacity: style.strokeOpacity,
      points: points.flatMap((p) => [p.x - origin.x, p.y - origin.y]),
      startHead: style.startHead,
      endHead: style.endHead,
      headSize: style.headSize,
    };
  },
  previewFromPoints(points, cursor, style) {
    if (style.type !== 'polyline') return {};
    const origin = points[0];
    if (!origin) return {};

    const flat = points.flatMap((p) => [p.x - origin.x, p.y - origin.y]);
    if (cursor) flat.push(cursor.x - origin.x, cursor.y - origin.y);

    return {
      x: origin.x,
      y: origin.y,
      points: flat,
      stroke: previewStroke(style),
      strokeWidth: style.strokeWidth,
      dash: strokeTypeToDash(style.strokeType, style.strokeWidth),
      startHead: style.startHead,
      endHead: style.endHead,
      headSize: style.headSize,
    };
  },
  boundingBox(style) {
    if (style.type !== 'polyline') return { x: 0, y: 0, width: 0, height: 0 };
    return multiPointBoundingBox(style.x, style.y, style.points, style.strokeWidth ?? 2);
  },
  getSize(style) {
    if (style.type !== 'polyline') return { width: 0, height: 0 };
    const { minX, maxX, minY, maxY } = computePointsSpan(style.points);
    return { width: maxX - minX, height: maxY - minY };
  },
  resizeTo(style, width, height) {
    if (style.type !== 'polyline') return {};
    return { points: resizePointsTo(style.points, width, height) };
  },
  intersectsRect(style, rect) {
    if (style.type !== 'polyline') return false;
    return polylineIntersectsRect(style.x, style.y, style.points, rect, false);
  },
  defaultPresets: [
    {
      name: '折れ線（黒）',
      style: {
        type: 'polyline',
        strokeColor: '#000000',
        strokeWidth: 3,
        strokeType: 'solid',
        strokeOpacity: 1,
        startHead: 'none',
        endHead: 'none',
        headSize: 12,
      },
    },
    {
      name: '折れ矢印（黒）',
      style: {
        type: 'polyline',
        strokeColor: '#000000',
        strokeWidth: 3,
        strokeType: 'solid',
        strokeOpacity: 1,
        startHead: 'none',
        endHead: 'triangle',
        headSize: 12,
      },
    },
  ],
};

const polygonGeometry: AnnotationGeometryModule = {
  drawMode: 'clickPoints',
  closable: true,
  createFromPoints(pageNumber, points, style) {
    if (style.type !== 'polygon') return null;
    if (points.length < 3) return null;
    const origin = points[0];
    if (!origin) return null;
    const built = buildBaseAnnotation(pageNumber, origin.x, origin.y, style);
    if (!built) return null;

    return {
      ...built.base,
      type: 'polygon',
      color: built.color,
      strokeWidth: style.strokeWidth,
      strokeType: style.strokeType,
      strokeOpacity: style.strokeOpacity,
      fillOpacity: style.fillOpacity,
      fillColor: ColorCode.safeParse(style.fillColor).success
        ? ColorCode.parse(style.fillColor)
        : undefined,
      points: points.flatMap((p) => [p.x - origin.x, p.y - origin.y]),
    };
  },
  previewFromPoints(points, cursor, style, options) {
    if (style.type !== 'polygon') return {};
    const origin = points[0];
    if (!origin) return {};

    const closing = options?.closing ?? false;
    const flat = points.flatMap((p) => [p.x - origin.x, p.y - origin.y]);
    // 始点をクリックすれば閉合確定できる状態のときは、カーソル位置（ほぼ始点と一致）を
    // 余分な頂点として追加しない（既に置いた頂点だけで、確定後と同じ形に見せる）
    if (cursor && !closing) flat.push(cursor.x - origin.x, cursor.y - origin.y);

    return {
      x: origin.x,
      y: origin.y,
      points: flat,
      // 未確定（始点を再クリックして閉合するまで）の間は、途中の点数に関わらず基本的に
      // 閉じた図形として見せない。ただし始点付近にカーソルがあり今クリックすれば閉合確定
      // できる状態（closing）のときだけは、閉じた図形として塗りを適用し、ユーザーに
      // 「ここで閉じられる」ことを視覚的に伝える
      closed: closing,
      fill: previewPolygonFill(style, closing),
      stroke: previewStroke(style),
      strokeWidth: style.strokeWidth,
      dash: strokeTypeToDash(style.strokeType, style.strokeWidth),
    };
  },
  boundingBox(style) {
    if (style.type !== 'polygon') return { x: 0, y: 0, width: 0, height: 0 };
    return multiPointBoundingBox(style.x, style.y, style.points, style.strokeWidth ?? 2);
  },
  getSize(style) {
    if (style.type !== 'polygon') return { width: 0, height: 0 };
    const { minX, maxX, minY, maxY } = computePointsSpan(style.points);
    return { width: maxX - minX, height: maxY - minY };
  },
  resizeTo(style, width, height) {
    if (style.type !== 'polygon') return {};
    return { points: resizePointsTo(style.points, width, height) };
  },
  intersectsRect(style, rect) {
    if (style.type !== 'polygon') return false;
    return polylineIntersectsRect(style.x, style.y, style.points, rect, true);
  },
  defaultPresets: [
    {
      name: 'ポリゴン（紫）',
      style: {
        type: 'polygon',
        strokeColor: '#9900CC',
        strokeWidth: 3,
        strokeType: 'solid',
        strokeOpacity: 1,
        fillColor: '#9900CC',
        fillPattern: 'solid',
        fillOpacity: 0.3,
      },
    },
  ],
};

const textGeometry: AnnotationGeometryModule = {
  drawMode: 'clickPoints',
  closable: false,
  maxPoints: 2,
  createFromPoints(pageNumber, points, style) {
    if (style.type !== 'text') return null;
    if (points.length < 2) return null;
    const start = points[0]!;
    const end = points[1]!;
    const built = buildBaseAnnotation(
      pageNumber,
      Math.min(start.x, end.x),
      Math.min(start.y, end.y),
      style,
    );
    if (!built) return null;

    const textColor = ColorCode.safeParse(style.textColor);
    if (!textColor.success) return null;

    return {
      ...built.base,
      type: 'text',
      color: built.color,
      strokeWidth: style.strokeWidth,
      strokeType: style.strokeType,
      strokeOpacity: style.strokeOpacity,
      fillOpacity: style.fillOpacity,
      width: Math.abs(end.x - start.x),
      height: Math.abs(end.y - start.y),
      text: '',
      fontFamily: style.fontFamily,
      fontSize: style.fontSize,
      fontWeight: style.fontWeight,
      textColor: textColor.data,
      textAlign: style.textAlign,
      fillColor: ColorCode.safeParse(style.fillColor).success
        ? ColorCode.parse(style.fillColor)
        : undefined,
    };
  },
  previewFromPoints(points, cursor, style) {
    if (style.type !== 'text') return {};
    const start = points[0];
    if (!start) return {};
    const end = points[1] ?? cursor ?? start;
    return {
      x: Math.min(start.x, end.x),
      y: Math.min(start.y, end.y),
      width: Math.abs(end.x - start.x),
      height: Math.abs(end.y - start.y),
      fill: style.fillColor ? hexToRgba(style.fillColor, style.fillOpacity) : 'transparent',
      stroke: previewStroke(style),
      strokeWidth: style.strokeWidth,
      dash: strokeTypeToDash(style.strokeType, style.strokeWidth),
    };
  },
  boundingBox(style) {
    if (style.type !== 'text') return { x: 0, y: 0, width: 0, height: 0 };
    const { x, y, width, height } = style;
    return {
      x: Math.max(0, x - BOUNDING_BOX_PADDING),
      y: Math.max(0, y - BOUNDING_BOX_PADDING),
      width: width + BOUNDING_BOX_PADDING * 2,
      height: height + BOUNDING_BOX_PADDING * 2,
    };
  },
  getSize(style) {
    if (style.type !== 'text') return { width: 0, height: 0 };
    return { width: style.width, height: style.height };
  },
  resizeTo(style, width, height) {
    if (style.type !== 'text') return {};
    return { width, height };
  },
  intersectsRect(style, rect) {
    if (style.type !== 'text') return false;
    return (
      style.x + style.width >= rect.x &&
      style.x <= rect.x + rect.width &&
      style.y + style.height >= rect.y &&
      style.y <= rect.y + rect.height
    );
  },
  defaultPresets: [
    {
      name: 'テキスト（黒文字）',
      style: {
        type: 'text',
        strokeColor: '#000000',
        // デフォルト状態でも視認・選択できるよう、細い枠線を初期値とする
        strokeWidth: 1,
        strokeType: 'solid',
        strokeOpacity: 1,
        fillPattern: 'none',
        fillOpacity: 1,
        textColor: '#000000',
        fontWeight: 400,
        fontFamily: 'sans-serif',
        fontSize: 16,
        textAlign: 'left',
      },
    },
  ],
};

export const ANNOTATION_GEOMETRY: Record<AnnotationStyle['type'], AnnotationGeometryModule> = {
  box: boxGeometry,
  line: lineGeometry,
  circle: circleGeometry,
  arrow: arrowGeometry,
  polyline: polylineGeometry,
  polygon: polygonGeometry,
  text: textGeometry,
};
