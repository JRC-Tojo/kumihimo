import type { ContainerID } from 'src/models/container';
import { Path } from 'src/utils/binary/path';

/**
 * ファイルを一意に識別するための最小限の形。`ContainerElementFile`はこれを満たすため、
 * そのまま渡せる（`AnnotationBaseAddress`のような`{cID, filePath}`形の値は呼び出し側で詰め替える）
 */
export interface FileIdentity {
  containerID: ContainerID;
  path: string;
}

/**
 * ファイルのキャッシュキーを生成する（containerIDまで含めて同一性判定する）
 *
 * pathはPathオブジェクトで正規化してから連結する（区切り文字表記の揺れによる
 * 同一ファイルの不一致判定を防ぐ）
 */
export function fileKey(file: FileIdentity): string {
  return `${file.containerID}|${new Path(file.path).path}`;
}
