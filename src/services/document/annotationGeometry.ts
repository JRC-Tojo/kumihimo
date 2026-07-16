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
  /** 初期設定（初回起動時・既存設定への補完時）に投入するこの種別のデフォルトプリセット。1件以上必須 */
  defaultPresets: AnnotationDefaultPreset[];
}

/** ドラッグ（始点→終点の2点）から生成する種別（box/circle/line/arrow/text） */
export interface DragDrawModule<T extends AnnotationStyle> extends AnnotationGeometryModuleCommon<T> {
  drawMode: 'drag';
  /** ドラッグ開始・終了座標からアノテーション実体を生成する */
  createFromDrag(pageNumber: number, start: Point, end: Point, style: DrawingAnnotationStyle): T | null;
  /** 描画中（ドラッグ中）のプレビュー形状のKonva設定を計算する */
  previewFromDrag(start: Point, end: Point, style: DrawingAnnotationStyle): Record<string, unknown>;
}

/** クリックで頂点を置いていく方式で生成する種別（polyline/polygon） */
export interface ClickPointsDrawModule<T extends AnnotationStyle> extends AnnotationGeometryModuleCommon<T> {
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
  | DragDrawModule<T>
  | ClickPointsDrawModule<T>;

const BOUNDING_BOX_PADDING = 2;

/** ドラッグ開始・終了座標から共通のベースフィールドを生成する。strokeColorが不正な場合はnullを返す */
function buildBaseAnnotation(pageNumber: number, x: number, y: number, style: DrawingAnnotationStyle) {
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

const boxGeometry: AnnotationGeometryModule = {
  drawMode: 'drag',
  createFromDrag(pageNumber, start, end, style) {
    if (style.type !== 'box') return null;
    const built = buildBaseAnnotation(pageNumber, Math.min(start.x, end.x), Math.min(start.y, end.y), style);
    if (!built) return null;

    return {
      ...built.base,
      type: 'box',
      color: built.color,
      strokeWidth: style.strokeWidth,
      width: Math.abs(end.x - start.x),
      height: Math.abs(end.y - start.y),
      opacity: style.fillOpacity,
    };
  },
  previewFromDrag(start, end, style) {
    if (style.type !== 'box') return {};
    return {
      x: Math.min(start.x, end.x),
      y: Math.min(start.y, end.y),
      width: Math.abs(end.x - start.x),
      height: Math.abs(end.y - start.y),
      fill: 'transparent',
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
function lineLikeBoundingBox(x: number, y: number, points: number[], strokeWidth: number): BoundingBox {
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

/** 折れ線・ポリゴン共通: 全頂点のmin/maxから外接矩形（線幅を考慮）を計算する（lineLikeBoundingBoxのN点版） */
function multiPointBoundingBox(x: number, y: number, points: number[], strokeWidth: number): BoundingBox {
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
      stroke: style.strokeColor,
      strokeWidth: style.strokeWidth,
    };
  },
  boundingBox(style) {
    if (style.type !== 'circle') return { x: 0, y: 0, width: 0, height: 0 };
    const { x, y, radius } = style;
    const extent = radius + BOUNDING_BOX_PADDING;
    return {
      x: Math.max(0, x - extent),
      y: Math.max(0, y - extent),
      width: extent * 2,
      height: extent * 2,
    };
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
      opacity: style.fillOpacity,
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
      fill: 'transparent',
      stroke: style.strokeColor,
      strokeWidth: style.strokeWidth,
    };
  },
  boundingBox(style) {
    if (style.type !== 'polygon') return { x: 0, y: 0, width: 0, height: 0 };
    return multiPointBoundingBox(style.x, style.y, style.points, style.strokeWidth ?? 2);
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
    const built = buildBaseAnnotation(pageNumber, Math.min(start.x, end.x), Math.min(start.y, end.y), style);
    if (!built) return null;

    const textColor = ColorCode.safeParse(style.textColor);
    if (!textColor.success) return null;

    return {
      ...built.base,
      type: 'text',
      color: built.color,
      strokeWidth: style.strokeWidth,
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
  defaultPresets: [
    {
      name: 'テキスト（黒文字）',
      style: {
        type: 'text',
        strokeColor: '#000000',
        strokeWidth: 0,
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
