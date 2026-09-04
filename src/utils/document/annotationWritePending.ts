/**
 * アノテーションIDごとに「ローカルで最後に発行した書き込みが書き込もうとしている`updatedAt`」を
 * 保持する、共有のリアクティブ状態
 *
 * アノテーションDBへの書き込みはファイル単位で発行順に直列実行される
 * （`services/document/annotation.ts`の`annotationFileMutex`）ため、DB自体は常に発行順に
 * 確定する。しかしDB購読（liveQuery）側への反映は書き込みが確定するたびに個別に、かつ
 * 「書き込みを依頼したPromiseが解決したタイミング」から幾らか遅れて非同期に発火する
 * （Dexieの変更通知は書き込みトランザクションの完了とは別のマイクロタスクで実行されるため）。
 * そのため「自分の書き込みが完了した」ことと「その内容がDB購読経由でUIから見えるように
 * なった」ことは同じタイミングではない。この間に届く更新（過去の書き込みの遅れたエコー、
 * まだ自分の最新の書き込みに追いついていない状態）をそのまま表示してしまうと、確定して
 * 見えていた変更が一瞬古い状態へ巻き戻ってから追いつく（ちらつく）挙動になる。
 *
 * これを避けるため、ローカルで「この内容で書き込む」と発行するたびに、対象アノテーションIDに
 * 対する『最後に自分が意図した内容』の目印として`updatedAt`を記録しておく。`updatedAt`は
 * ローカルの編集のたびに新しく発行されるISO文字列で、書き込み経路の途中（author補完等）で
 * 書き換えられることが無いため、個々の編集を一意に識別する目印として使える。DB購読由来の
 * 更新は、この目印と`updatedAt`が完全一致するもの（＝自分が最後に意図した書き込みの確定
 * エコー）が届くまで無視し、一致した時点で初めて反映してよい（`resolveAnnotationEcho`）。
 * 目印が無いID（このセッションでローカル書き込みを行っていない、または既に確定済み）への
 * 更新は、他ユーザー・プラグイン・OCR再読込等の外部由来の変更として即座に反映してよい。
 *
 * 新しい/古いといった時系列の前後は一切見ない点が重要で、Undo/Redoのように意図的に
 * 本来より古い`updatedAt`を持つ内容へ書き戻す操作であっても、その書き込みの発行時に目印を
 * 更新するため（`useAnnotationHistory.ts`のregisterStyleTracked等参照）、「自分が最後に
 * 意図した内容とちょうど一致するかどうか」だけで正しく判定できる
 */
import { reactive } from 'vue';
import type { AnnotationID, AnnotationStyle } from 'src/models/document/pdf';

const pendingUpdatedAt = reactive(new Map<AnnotationID, string>());

/** 指定IDへローカルで書き込みを発行する直前に呼び、意図した内容の目印を記録する */
export function markAnnotationWriteIntent(id: AnnotationID, updatedAt: string): void {
  pendingUpdatedAt.set(id, updatedAt);
}

/**
 * 指定IDへの書き込みが失敗した場合に呼ぶ
 *
 * その書き込みが依然として「最後に意図した内容」のままであれば（＝この後により新しい書き込みが
 * 発行されていなければ）目印を取り消し、DB購読側の更新を再び素通しできるようにする。既により
 * 新しい書き込みが発行済みであれば、それはそちらの書き込みの目印であり自分が取り消す対象では
 * ないため、何もしない
 */
export function cancelAnnotationWriteIntent(id: AnnotationID, updatedAt: string): void {
  if (pendingUpdatedAt.get(id) === updatedAt) pendingUpdatedAt.delete(id);
}

/**
 * DB購読由来の更新`next`をUIへ反映してよいかどうかを判定する
 *
 * 反映してよい場合はtrueを返し、目印を消費する（以後このIDへの目印は無くなり、次に届く
 * 更新からは素通しに戻る）。まだ自分の意図した内容に追いついていない場合はfalseを返し、
 * 呼び出し側はこの更新を無視すること。リアクティブなMapへの`get`呼び出しのため、
 * Vueのwatch/computed内で呼べばリアクティブに追跡される
 */
export function resolveAnnotationEcho(next: AnnotationStyle): boolean {
  const intended = pendingUpdatedAt.get(next.id);
  if (intended === undefined) return true;
  if (intended !== next.updatedAt) return false;
  pendingUpdatedAt.delete(next.id);
  return true;
}
