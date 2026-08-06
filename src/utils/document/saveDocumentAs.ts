/**
 * 文書を別名（別のファイルパス）で保存する
 *
 * `saveDocument`（上書き保存。実データは常に文書本体そのまま＋`.kcfg`側のみ更新）とは異なり、
 * こちらは新規ファイルとして書き出すため、アノテーションをどう扱うかを`SaveAsMode`で選べる。
 * アノテーションを含める場合もPDF本体へ焼き込むだけで、`.kcfg`側の複製は行わない
 * （別名保存後のファイルは、本システム外でも内容を確認できる単体のPDFとして扱う想定のため）
 */
import { Notify } from 'quasar';
import { useBackendApi } from 'src/apis/backendApi';
import type { ContainerElementFile, ContainerID } from 'src/models/container';
import type { SaveDocumentNotifyMessages } from 'src/utils/document/saveDocument';
import { useRelationalStore } from 'src/stores/relationalStore';
import { useSettingsStore } from 'src/stores/settingsStore';
import { applyRelationalOverrideToStyle } from 'src/components/Viewer/Annotation/relationalStyleOverride';
import { getSupportedDocumentKind } from 'src/utils/document/supportedTypes';

/**
 * 別名保存時にアノテーションをどう扱うか
 *
 * - documentOnly: 文書本体のみ（アノテーションを含めない）
 * - embedAnnotations: アノテーションをPDFページ内容として焼き込む（非可逆）
 * - annotationsAsComments: アノテーションをPDFのネイティブ注釈（コメント）として埋め込む
 */
export type SaveAsMode = 'documentOnly' | 'embedAnnotations' | 'annotationsAsComments';

export interface SaveAsDestination {
  containerID: ContainerID;
  filePath: string;
}

/**
 * 指定した文書を、指定したモード・保存先で別名保存する
 *
 * @returns 保存に成功したかどうか
 */
export async function saveDocumentAs(
  file: ContainerElementFile,
  destination: SaveAsDestination,
  mode: SaveAsMode,
  notifyMessages?: SaveDocumentNotifyMessages,
): Promise<boolean> {
  const api = useBackendApi();

  const srcRes = await api.getDocumentSource(file);
  if (!srcRes.ok) {
    if (notifyMessages) Notify.create({ type: 'negative', message: notifyMessages.failed });
    return false;
  }

  let outSrc = srcRes.data;

  if (mode !== 'documentOnly') {
    const annotsRes = await api.getAnnotationsByFile(file);
    if (!annotsRes.ok) {
      if (notifyMessages) Notify.create({ type: 'negative', message: notifyMessages.failed });
      return false;
    }

    // 関係性の検証結果（OK/NG）によるスタイル上書きは、画面表示（Konva）だけでなく
    // 書き出すPDFにも反映する。元のスタイルのまま埋め込むと、画面と異なる見た目になってしまうため
    const relationalStore = useRelationalStore();
    const settingsStore = useSettingsStore();
    const styles = annotsRes.data.map((info) =>
      applyRelationalOverrideToStyle(
        info.style,
        relationalStore.statusForAnnotation(info.style.id),
        settingsStore.relationalVerificationStyle,
      ),
    );

    const packRes =
      mode === 'embedAnnotations'
        ? await api.packAnnotationsAsVectorInSource(outSrc, styles)
        : await api.packAnnotationsAsCommentsInSource(outSrc, styles);
    if (!packRes.ok) {
      if (notifyMessages) Notify.create({ type: 'negative', message: notifyMessages.failed });
      return false;
    }
    outSrc = packRes.data;
  }

  // 登録済みブックマークは、アノテーションの埋め込みモードに関わらずPDFのネイティブしおり
  // （Outline）として書き出す（別名保存後のファイルを外部ビューアで開いても参照できるようにする）
  if (getSupportedDocumentKind(file.path) === 'pdf') {
    const bookmarkPackRes = await api.packBookmarksInSource(outSrc, file);
    if (!bookmarkPackRes.ok) {
      if (notifyMessages) Notify.create({ type: 'negative', message: notifyMessages.failed });
      return false;
    }
    outSrc = bookmarkPackRes.data;
  }

  const saveRes = await api.saveFile(destination.containerID, destination.filePath, outSrc);
  if (!saveRes.ok) {
    if (notifyMessages) Notify.create({ type: 'negative', message: notifyMessages.failed });
    return false;
  }

  if (notifyMessages) Notify.create({ type: 'positive', message: notifyMessages.success });
  return true;
}
