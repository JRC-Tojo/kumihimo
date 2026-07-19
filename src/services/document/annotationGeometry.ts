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

export interface Point {
  x: number;
  y: number;
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
  /** 初期設定（初回起動時・既存設定への補完時）に投入するこの種別のデフォルトプリセット。1件以上必須 */
  defaultPresets: AnnotationDefaultPreset[];
}

/** ドラッグ（始点→終点の2点）から生成する種別（box/circle/line/arrow/text） */
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

/** クリックで頂点を置いていく方式で生成する種別（polyline/polygon） */
export interface ClickPointsDrawModule<
  T extends AnnotationStyle,
> extends AnnotationGeometryModuleCommon<T> {
  drawMode: 'clickPoints';
  /** 確定時、これまでにクリックした頂点座標列からアノテーション実体を生成する */
  createFromPoints(pageNumber: number, points: Point[], style: DrawingAnnotationStyle): T | null;
  /** 描画中のプレビュー形状のKonva設定を計算する（cursorは最後に置いた頂点から現在のマウス位置へのラバーバンド用） */
  previewFromPoints(
    points: Point[],
    cursor: Point | null,
    style: DrawingAnnotationStyle,
  ): Record<string, unknown>;
  /** trueの場合、始点付近を再クリックすると新しい頂点を追加せず形状を閉じて確定できる */
  closable: boolean;
}

export type AnnotationGeometryModule<T extends AnnotationStyle = AnnotationStyle> =
  DragDrawModule<T> | ClickPointsDrawModule<T>;

const BOUNDING_BOX_PADDING = 2;

/** ドラッグ開始・終了座標から共通のベースフィールドを生成する。strokeColorが不正な場合はnullを返す */
function buildBaseAnnotation(
  pageNumber: number,
  x: number,
  y: number,
  style: DrawingAnnotationStyle,
) {
  const strokeColor = ColorCode.safeParse(style.strokeColor);
  if (!strokeColor.success) return null;

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
    color: strokeColor.data,
  };
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
  drawMode: 'drag',
  createFromDrag(pageNumber, start, end, style) {
    if (style.type !== 'box') return null;
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
      opacity: style.fillOpacity,
      fillColor: ColorCode.safeParse(style.fillColor).success
        ? ColorCode.parse(style.fillColor)
        : undefined,
    };
  },
  previewFromDrag(start, end, style) {
    if (style.type !== 'box') return {};
    return {
      x: Math.min(start.x, end.x),
      y: Math.min(start.y, end.y),
      width: Math.abs(end.x - start.x),
      height: Math.abs(end.y - start.y),
      fill: style.fillColor ?? 'transparent',
      opacity: style.fillOpacity,
      stroke: style.strokeColor,
      strokeWidth: style.strokeWidth,
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
function computePointsSpan(points: number[]): { minX: number; maxX: number; minY: number; maxY: number } {
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
  drawMode: 'drag',
  createFromDrag(pageNumber, start, end, style) {
    if (style.type !== 'line') return null;
    const built = buildBaseAnnotation(pageNumber, start.x, start.y, style);
    if (!built) return null;

    return {
      ...built.base,
      type: 'line',
      color: built.color,
      strokeWidth: style.strokeWidth,
      strokeType: style.strokeType,
      opacity: style.strokeOpacity,
      points: [0, 0, end.x - start.x, end.y - start.y],
    };
  },
  previewFromDrag(start, end, style) {
    if (style.type !== 'line') return {};
    return {
      x: start.x,
      y: start.y,
      points: [0, 0, end.x - start.x, end.y - start.y],
      stroke: style.strokeColor,
      strokeWidth: style.strokeWidth,
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
  drawMode: 'drag',
  createFromDrag(pageNumber, start, end, style) {
    if (style.type !== 'circle') return null;
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
      opacity: style.fillOpacity,
      fillColor: ColorCode.safeParse(style.fillColor).success
        ? ColorCode.parse(style.fillColor)
        : undefined,
      radius: Math.sqrt(deltaX * deltaX + deltaY * deltaY) / 2,
    };
  },
  previewFromDrag(start, end, style) {
    if (style.type !== 'circle') return {};
    const deltaX = end.x - start.x;
    const deltaY = end.y - start.y;
    return {
      x: start.x + deltaX / 2,
      y: start.y + deltaY / 2,
      radius: Math.sqrt(deltaX * deltaX + deltaY * deltaY) / 2,
      fill: style.fillColor ?? 'transparent',
      opacity: style.fillOpacity,
      stroke: style.strokeColor,
      strokeWidth: style.strokeWidth,
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
  drawMode: 'drag',
  createFromDrag(pageNumber, start, end, style) {
    if (style.type !== 'arrow') return null;
    const built = buildBaseAnnotation(pageNumber, start.x, start.y, style);
    if (!built) return null;

    return {
      ...built.base,
      type: 'arrow',
      color: built.color,
      strokeWidth: style.strokeWidth,
      strokeType: style.strokeType,
      opacity: style.strokeOpacity,
      points: [0, 0, end.x - start.x, end.y - start.y],
      startHead: style.startHead,
      endHead: style.endHead,
      headSize: style.headSize,
    };
  },
  previewFromDrag(start, end, style) {
    if (style.type !== 'arrow') return {};
    return {
      x: start.x,
      y: start.y,
      points: [0, 0, end.x - start.x, end.y - start.y],
      stroke: style.strokeColor,
      strokeWidth: style.strokeWidth,
      fill: style.strokeColor,
      fillEnabled: style.endHead !== 'open' && style.startHead !== 'open',
      pointerAtBeginning: style.startHead !== 'none',
      pointerAtEnding: style.endHead !== 'none',
      pointerLength: style.headSize,
      pointerWidth: style.headSize,
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
      opacity: style.strokeOpacity,
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
      stroke: style.strokeColor,
      strokeWidth: style.strokeWidth,
      fill: style.strokeColor,
      fillEnabled: style.endHead !== 'open' && style.startHead !== 'open',
      pointerAtBeginning: style.startHead !== 'none',
      pointerAtEnding: style.endHead !== 'none',
      pointerLength: style.headSize,
      pointerWidth: style.headSize,
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
      opacity: style.fillOpacity,
      fillColor: ColorCode.safeParse(style.fillColor).success
        ? ColorCode.parse(style.fillColor)
        : undefined,
      points: points.flatMap((p) => [p.x - origin.x, p.y - origin.y]),
    };
  },
  previewFromPoints(points, cursor, style) {
    if (style.type !== 'polygon') return {};
    const origin = points[0];
    if (!origin) return {};

    const flat = points.flatMap((p) => [p.x - origin.x, p.y - origin.y]);
    if (cursor) flat.push(cursor.x - origin.x, cursor.y - origin.y);

    return {
      x: origin.x,
      y: origin.y,
      points: flat,
      closed: points.length >= 3,
      fill: style.fillColor ?? 'transparent',
      opacity: style.fillOpacity,
      stroke: style.strokeColor,
      strokeWidth: style.strokeWidth,
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
  drawMode: 'drag',
  createFromDrag(pageNumber, start, end, style) {
    if (style.type !== 'text') return null;
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
      opacity: style.fillOpacity,
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
  previewFromDrag(start, end, style) {
    if (style.type !== 'text') return {};
    return {
      x: Math.min(start.x, end.x),
      y: Math.min(start.y, end.y),
      width: Math.abs(end.x - start.x),
      height: Math.abs(end.y - start.y),
      fill: style.fillColor ?? 'transparent',
      opacity: style.fillOpacity,
      stroke: style.strokeColor,
      strokeWidth: style.strokeWidth,
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
