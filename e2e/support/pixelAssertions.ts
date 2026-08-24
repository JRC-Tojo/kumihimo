import { createCanvas, loadImage } from 'canvas';

/**
 * PNGスクリーンショットのバッファに、単色（真っ白・透明等）ではない実際の描画内容が
 * 含まれているかを判定する。
 *
 * クロスラン（CI環境・別マシン間）でのピクセル差分ベースライン画像は用意していないため
 * （初回生成には人がレビューして採用する運用が必要で、今回のスコープ外のフォローアップ課題）、
 * 「実際に何かが描画されたか」だけを、ベースラインを必要としない形で確認する用途に使う
 */
export async function hasVisibleContent(pngBuffer: Buffer): Promise<boolean> {
  // PNGバッファをデコードし、node-canvas上のcanvasへ一旦描き直すことで、生のピクセルデータ
  // （RGBA配列）を取得できるようにする
  const image = await loadImage(pngBuffer);
  const canvas = createCanvas(image.width, image.height);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(image, 0, 0);
  const { data } = ctx.getImageData(0, 0, image.width, image.height);

  // 先頭ピクセル（背景色の代表値）を基準に、以降のピクセルが1つでも異なる色を持てば
  // 「単色ではない＝何らかの内容が実際に描画されている」と判定する
  const [r0, g0, b0] = [data[0], data[1], data[2]];
  for (let i = 4; i < data.length; i += 4) {
    if (data[i] !== r0 || data[i + 1] !== g0 || data[i + 2] !== b0) return true;
  }
  return false;
}
