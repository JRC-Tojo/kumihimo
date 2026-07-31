/**
 * アノテーションをCanvas 2Dコンテキストへ直接描画する（Konva/Vueの実描画コンポーネントには
 * 依存しない、フレームワーク非依存の再実装）
 *
 * 「完全に埋め込む」モード（`embedAnnotationsAsRasterIntoPdf`）で使う。KonvaのAnnotationLayerは
 * 画面表示中の1ページ分しかマウントされておらず、PDFは複数ページある可能性があるため、実際に
 * マウント済みのKonva Stageをそのまま画像化することができない。そのため、画面描画（Konva）が
 * 使っているのと同じ純粋な幾何計算・スタイル解決ロジック（arrowHeadGeometry.ts・strokeDash.ts・
 * blendMode.ts・hexToRgba）を再利用しつつ、Canvas 2D APIで直接描画することで、
 * 表示中かどうかに関係なく任意のページをラスタ化できるようにする
 */
import type { AnnotationStyle, ArrowHeadType } from 'src/models/document/pdf';
import { getAnnotationSortKey } from 'src/utils/document/annotationOrder';
import { strokeTypeToDash } from 'src/utils/document/strokeDash';
import { blendModeToComposite } from 'src/utils/document/blendMode';
import { hexToRgba } from 'src/utils/color/hexToRgba';
import {
  computeHeadTransform,
  getHeadLocalPoints,
  getHeadRadius,
  isClosedHead,
  isFilledHead,
} from 'src/components/Viewer/Annotation/arrowHeadGeometry';

/**
 * 明示的な不透明度（strokeOpacity/fillOpacity）が未設定の場合、後方互換のため
 * 旧`opacity`フィールドへフォールバックする（useAnnotationShape.tsのresolveOpacityと同じ規約）
 */
function resolveOpacity(annotation: AnnotationStyle, explicit: number | undefined): number {
  return explicit ?? annotation.opacity ?? 1;
}

/** 枠線色。色が未設定（「線色なし」）の場合は透明を返す（resolveStrokeと同じ規約） */
function resolveStrokeCss(annotation: AnnotationStyle): string {
  if (!annotation.color) return 'rgba(0, 0, 0, 0)';
  return hexToRgba(annotation.color, resolveOpacity(annotation, annotation.strokeOpacity));
}

/** 塗り色。fillColorを持つ種別専用（resolveFillと同じ規約） */
function resolveFillCss(annotation: {
  fillColor?: string | undefined;
  fillOpacity?: number | undefined;
  opacity?: number | undefined;
}): string {
  if (!annotation.fillColor) return 'rgba(0, 0, 0, 0)';
  return hexToRgba(annotation.fillColor, annotation.fillOpacity ?? annotation.opacity ?? 1);
}

function applyStrokeStyle(ctx: CanvasRenderingContext2D, annotation: AnnotationStyle): void {
  const strokeWidth = annotation.strokeWidth || 2;
  ctx.strokeStyle = resolveStrokeCss(annotation);
  ctx.lineWidth = strokeWidth;
  ctx.setLineDash(strokeTypeToDash(annotation.strokeType, strokeWidth) ?? []);
}

function drawBox(ctx: CanvasRenderingContext2D, a: Extract<AnnotationStyle, { type: 'box' }>): void {
  ctx.beginPath();
  ctx.rect(a.x, a.y, a.width, a.height);
  ctx.fillStyle = resolveFillCss(a);
  ctx.fill();
  applyStrokeStyle(ctx, a);
  ctx.stroke();
}

function drawCircle(ctx: CanvasRenderingContext2D, a: Extract<AnnotationStyle, { type: 'circle' }>): void {
  const rx = a.radiusX ?? a.radius;
  const ry = a.radiusY ?? a.radius;
  ctx.beginPath();
  ctx.ellipse(a.x, a.y, rx, ry, 0, 0, Math.PI * 2);
  ctx.fillStyle = resolveFillCss(a);
  ctx.fill();
  applyStrokeStyle(ctx, a);
  ctx.stroke();
}

function drawLine(ctx: CanvasRenderingContext2D, a: Extract<AnnotationStyle, { type: 'line' }>): void {
  applyStrokeStyle(ctx, a);
  ctx.beginPath();
  ctx.moveTo(a.x + a.points[0]!, a.y + a.points[1]!);
  ctx.lineTo(a.x + a.points[2]!, a.y + a.points[3]!);
  ctx.stroke();
}

function drawPolygon(ctx: CanvasRenderingContext2D, a: Extract<AnnotationStyle, { type: 'polygon' }>): void {
  ctx.beginPath();
  ctx.moveTo(a.x + a.points[0]!, a.y + a.points[1]!);
  for (let i = 2; i + 1 < a.points.length; i += 2) {
    ctx.lineTo(a.x + a.points[i]!, a.y + a.points[i + 1]!);
  }
  ctx.closePath();
  ctx.fillStyle = resolveFillCss(a);
  ctx.fill();
  applyStrokeStyle(ctx, a);
  ctx.stroke();
}

/**
 * 矢じり1つ分を描画する（ArrowAnnotation.vue/PolylineAnnotation.vueのbuildHeadInfoと同じロジック）。
 * 矢じり自体はKonvaのhead configにdashが無いことと同様、常に実線で描く
 */
function drawHead(
  ctx: CanvasRenderingContext2D,
  headType: ArrowHeadType,
  headSize: number,
  points: readonly number[],
  end: 'start' | 'end',
  originX: number,
  originY: number,
  strokeCss: string,
): void {
  if (headType === 'none') return;
  const transform = computeHeadTransform(points, end);
  if (!transform) return;

  ctx.save();
  ctx.setLineDash([]);
  ctx.translate(originX + transform.tipX, originY + transform.tipY);
  ctx.rotate((transform.angleDeg * Math.PI) / 180);
  ctx.fillStyle = strokeCss;
  ctx.strokeStyle = strokeCss;

  if (headType === 'circle') {
    const radius = getHeadRadius(headType, headSize);
    if (radius) {
      ctx.beginPath();
      ctx.arc(0, 0, radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    ctx.restore();
    return;
  }

  const localPoints = getHeadLocalPoints(headType, headSize);
  if (localPoints) {
    ctx.beginPath();
    ctx.moveTo(localPoints[0]!, localPoints[1]!);
    for (let i = 2; i + 1 < localPoints.length; i += 2) {
      ctx.lineTo(localPoints[i]!, localPoints[i + 1]!);
    }
    if (isClosedHead(headType)) ctx.closePath();
    if (isFilledHead(headType)) ctx.fill();
    ctx.stroke();
  }
  ctx.restore();
}

function drawShaftAndHeads(
  ctx: CanvasRenderingContext2D,
  a: Extract<AnnotationStyle, { type: 'arrow' | 'polyline' }>,
): void {
  applyStrokeStyle(ctx, a);
  const strokeCss = resolveStrokeCss(a);
  ctx.fillStyle = strokeCss;

  ctx.beginPath();
  ctx.moveTo(a.x + a.points[0]!, a.y + a.points[1]!);
  for (let i = 2; i + 1 < a.points.length; i += 2) {
    ctx.lineTo(a.x + a.points[i]!, a.y + a.points[i + 1]!);
  }
  ctx.stroke();

  drawHead(ctx, a.startHead, a.headSize, a.points, 'start', a.x, a.y, strokeCss);
  drawHead(ctx, a.endHead, a.headSize, a.points, 'end', a.x, a.y, strokeCss);
}

/**
 * 単語単位で折り返す（Konva.Textの`wrap:'word'`と同じ考え方の簡易実装）。
 * `ctx.font`は呼び出し側で設定済みであること
 */
function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split('\n')) {
    const words = paragraph.split(' ');
    let current = '';
    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word;
      if (current && ctx.measureText(candidate).width > maxWidth) {
        lines.push(current);
        current = word;
      } else {
        current = candidate;
      }
    }
    lines.push(current);
  }
  return lines;
}

/** TextBoxAnnotation.vueのrectConfig/textConfigと同じレイアウト（padding: 4, wrap: 'word', verticalAlign: 'top'） */
function drawText(ctx: CanvasRenderingContext2D, a: Extract<AnnotationStyle, { type: 'text' }>): void {
  ctx.beginPath();
  ctx.rect(a.x, a.y, a.width, a.height);
  ctx.fillStyle = resolveFillCss(a);
  ctx.fill();
  const strokeWidth = a.strokeWidth || 1;
  ctx.strokeStyle = resolveStrokeCss(a);
  ctx.lineWidth = strokeWidth;
  ctx.setLineDash(strokeTypeToDash(a.strokeType, strokeWidth) ?? []);
  ctx.stroke();

  const padding = 4;
  ctx.font = `${a.fontWeight >= 700 ? 'bold' : 'normal'} ${a.fontSize}px ${a.fontFamily}`;
  ctx.textBaseline = 'top';
  ctx.textAlign = a.textAlign;
  ctx.fillStyle = hexToRgba(a.textColor, resolveOpacity(a, a.fillOpacity));

  const maxWidth = Math.max(0, a.width - padding * 2);
  const lines = wrapText(ctx, a.text, maxWidth);
  const lineHeight = a.fontSize;
  const textX =
    a.textAlign === 'center'
      ? a.x + a.width / 2
      : a.textAlign === 'right'
        ? a.x + a.width - padding
        : a.x + padding;
  lines.forEach((line, i) => {
    ctx.fillText(line, textX, a.y + padding + i * lineHeight);
  });
}

/**
 * アノテーション群を、重ね順（annotationOrder.ts）どおりにCanvas 2Dコンテキストへ描画する。
 * 各アノテーションの合成モード（blendMode）は、同一canvasへの逐次描画として
 * `globalCompositeOperation`で近似する（KonvaのAnnotationBlendLayerはCSSの`mix-blend-mode`で
 * 実現しているが、同一canvasへの逐次描画でも「背景＋既存の描画済み内容に対して合成する」という
 * 見た目は再現できる）
 */
export function renderAnnotationsOntoCanvas(
  ctx: CanvasRenderingContext2D,
  annotations: AnnotationStyle[],
): void {
  const sorted = [...annotations].sort((a, b) => getAnnotationSortKey(a) - getAnnotationSortKey(b));
  for (const a of sorted) {
    ctx.save();
    ctx.globalCompositeOperation = blendModeToComposite(a.blendMode);
    switch (a.type) {
      case 'box':
        drawBox(ctx, a);
        break;
      case 'circle':
        drawCircle(ctx, a);
        break;
      case 'line':
        drawLine(ctx, a);
        break;
      case 'arrow':
      case 'polyline':
        drawShaftAndHeads(ctx, a);
        break;
      case 'polygon':
        drawPolygon(ctx, a);
        break;
      case 'text':
        drawText(ctx, a);
        break;
    }
    ctx.restore();
  }
}
