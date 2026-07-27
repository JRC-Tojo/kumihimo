/**
 * PDFページのCanvasをLightGlue-ONNXモデル入力用のテンソルに変換する
 *
 * モデルは固定サイズ（正方形）の入力を要求するため、アスペクト比を保ったまま
 * targetSizeに収まるようリサイズ（レターボックス、余白は黒で埋める）し、
 * RGBA→RGB float32[0,1]のNCHW配列に変換する。リサイズ時に生じるスケール・
 * オフセットを合わせて返すことで、モデル出力の特徴点座標を元のCanvas座標系へ
 * 逆変換できるようにする（`unletterbox`）
 */

import * as ort from 'onnxruntime-web';

export interface LetterboxInfo {
  /** 元のCanvas上の1pxが、リサイズ後の画像上で何pxに相当するか */
  scale: number;
  /** レターボックスの余白オフセット（リサイズ後座標系、px） */
  offsetX: number;
  offsetY: number;
}

/** Canvasをレターボックス方式でtargetSize四方にリサイズしたCanvasを返す */
function letterboxResize(
  canvas: HTMLCanvasElement,
  targetSize: number,
): { canvas: HTMLCanvasElement; info: LetterboxInfo } {
  const scale = Math.min(targetSize / canvas.width, targetSize / canvas.height);
  const drawWidth = Math.round(canvas.width * scale);
  const drawHeight = Math.round(canvas.height * scale);
  const offsetX = Math.floor((targetSize - drawWidth) / 2);
  const offsetY = Math.floor((targetSize - drawHeight) / 2);

  const out = document.createElement('canvas');
  out.width = targetSize;
  out.height = targetSize;
  const ctx = out.getContext('2d');
  if (ctx) {
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, targetSize, targetSize);
    ctx.drawImage(
      canvas,
      0,
      0,
      canvas.width,
      canvas.height,
      offsetX,
      offsetY,
      drawWidth,
      drawHeight,
    );
  }

  return { canvas: out, info: { scale, offsetX, offsetY } };
}

/** リサイズ後画像上の座標を、元のCanvas座標系（＝ページレンダリング時のピクセル座標）に逆変換する */
export function unletterbox(point: { x: number; y: number }, info: LetterboxInfo): {
  x: number;
  y: number;
} {
  return {
    x: (point.x - info.offsetX) / info.scale,
    y: (point.y - info.offsetY) / info.scale,
  };
}

/** Canvasを指定サイズのRGB float32プレーナー配列（3*size*size、[0,1]正規化）に変換する */
function canvasToPlanarFloat32(
  canvas: HTMLCanvasElement,
  targetSize: number,
): { data: Float32Array; info: LetterboxInfo } {
  const { canvas: resized, info } = letterboxResize(canvas, targetSize);
  const ctx = resized.getContext('2d', { willReadFrequently: true });
  const pixels = ctx?.getImageData(0, 0, targetSize, targetSize).data;

  const size = targetSize * targetSize;
  const data = new Float32Array(3 * size);
  if (pixels) {
    for (let i = 0; i < size; i++) {
      data[i] = (pixels[i * 4] ?? 0) / 255;
      data[size + i] = (pixels[i * 4 + 1] ?? 0) / 255;
      data[2 * size + i] = (pixels[i * 4 + 2] ?? 0) / 255;
    }
  }

  return { data, info };
}

/**
 * 2枚のCanvasからLightGlue-ONNXモデル入力用の`[2, 3, size, size]`バッチテンソルを作る
 *
 * （LightGlue-ONNXの`images`入力は2枚の画像をバッチ化した形状を取る。参照:
 * https://github.com/fabio-sim/LightGlue-ONNX）
 */
export function buildPairTensor(
  canvasA: HTMLCanvasElement,
  canvasB: HTMLCanvasElement,
  targetSize: number,
): { tensor: ort.Tensor; infoA: LetterboxInfo; infoB: LetterboxInfo } {
  const a = canvasToPlanarFloat32(canvasA, targetSize);
  const b = canvasToPlanarFloat32(canvasB, targetSize);

  const combined = new Float32Array(a.data.length + b.data.length);
  combined.set(a.data, 0);
  combined.set(b.data, a.data.length);

  const tensor = new ort.Tensor('float32', combined, [2, 3, targetSize, targetSize]);
  return { tensor, infoA: a.info, infoB: b.info };
}
