/**
 * 文書のアノテーション・関係性を実データ（`.rdcfg`・関係性キャッシュ）へ保存する
 *
 * PDF本体（バイナリ）は書き換えない。アノテーションは常に`.rdcfg`側で外部管理されるため、
 * ここでの「保存」は「Dexie上の仮登録内容を実ファイルへ反映する」ことを意味する
 */
import { Notify } from 'quasar';
import { useBackendApi } from 'src/apis/backendApi';
import type { ContainerElementFile } from 'src/models/container';

export interface SaveDocumentNotifyMessages {
  success: string;
  failed: string;
}

/**
 * 指定した文書の現在の状態を実データへ保存する
 *
 * @param notifyMessages 指定した場合、成功/失敗をトースト通知する（自動保存等では省略して無通知にできる）
 * @returns 保存に成功したかどうか
 */
export async function saveDocument(
  file: ContainerElementFile,
  notifyMessages?: SaveDocumentNotifyMessages,
): Promise<boolean> {
  const api = useBackendApi();

  // PDF本体は変更しないため、oldSrc・newSrcには同一の現在データを渡す
  const srcRes = await api.getDocumentSource(file);
  if (!srcRes.ok) {
    if (notifyMessages) Notify.create({ type: 'negative', message: notifyMessages.failed });
    return false;
  }

  const saveRes = await api.saveDocumentConfig(file, srcRes.data, srcRes.data);
  if (!saveRes.ok) {
    if (notifyMessages) Notify.create({ type: 'negative', message: notifyMessages.failed });
    return false;
  }

  if (notifyMessages) Notify.create({ type: 'positive', message: notifyMessages.success });
  return true;
}
