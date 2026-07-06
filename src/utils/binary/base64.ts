import type { Result } from 'src/models/error/result';
import { Failure, Success, toError } from 'src/models/error/result';

/** ヘルパー: base64 -> Uint8Array */
export function base64ToUint8Array(base64: string): Result<Uint8Array> {
  try {
    const cleaned = base64.replace(/^data:.*;base64,/, '');
    const binaryString = atob(cleaned);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) bytes[i] = binaryString.charCodeAt(i);
    return Success(bytes);
  } catch (e) {
    return Failure(toError(e));
  }
}

/** ヘルパー: Uint8Array -> base64 (純粋な base64 を返す) */
export function uint8ArrayToBase64(bytes: Uint8Array): Result<string> {
  let binary = '';
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) binary += String.fromCharCode(bytes[i]!);
  try {
    const converted = btoa(binary);
    return Success(converted);
  } catch (e) {
    return Failure(toError(e));
  }
}

/** ヘルパー：ArrayBuffer -> base64 */
export function arrayBufferToBase64(buffer: ArrayBuffer): Promise<Result<string>> {
  return new Promise((resolve) => {
    const blob = new Blob([buffer]);
    const reader = new FileReader();
    reader.onloadend = () => {
      // data:application/octet-stream;base64,XXXXX... のプレフィックスを削除
      if (typeof reader.result === 'string') {
        const base64String = reader.result.split(',')[1];
        if (!base64String) {
          resolve(Failure(new Error('Failed to extract base64 string')));
          return;
        }
        resolve(Success(base64String));
      } else {
        resolve(Failure(new Error('This is not a valid buffer')));
      }
    };
    reader.readAsDataURL(blob);
  });
}

/** ファイルサイズ(bytes単位)を取得する */
export function getBase64FileSize(base64String: string): Result<number> {
  // データURIスキーム（data:image/png;base64, など）が含まれている場合は除去する
  const base64 = base64String.split(',')[1] || base64String;

  // パディングの数をカウント（末尾の '=' をチェック）
  let padding = 0;
  if (base64.endsWith('==')) {
    padding = 2;
  } else if (base64.endsWith('=')) {
    padding = 1;
  }

  // 計算式: (文字列の長さ * 0.75) - パディング数
  return Success(base64.length * 0.75 - padding);
}

/** base64化された情報のハッシュ値を計算する */
export async function calcBase64Hash(
  base64String: string,
  algorithm: 'SHA-256' | 'SHA-1' = 'SHA-256',
): Promise<Result<string>> {
  try {
    // 1. Base64文字列をバイナリ（Uint8Array）にデコード
    const binaryString = atob(base64String);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }

    // 2. Web Crypto APIでハッシュ値を計算 (戻り値は ArrayBuffer)
    const hashBuffer = await crypto.subtle.digest(algorithm, bytes.buffer);

    // 3. ArrayBufferを16進数（Hex）文字列に変換
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');

    return Success(hashHex);
  } catch (e) {
    return Failure(toError(e));
  }
}
