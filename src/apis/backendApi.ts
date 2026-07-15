import {
  getSettings,
  getRecentContainers,
  initializeSettings,
  saveSettings,
} from 'src/settings/main';
import { toApiResponse, type ApiResponse } from 'src/models/error/api';
import { Failure, Success } from 'src/models/error/result';
import * as containerService from 'src/services/container/main';
import * as relationalService from 'src/services/document/relational';
import * as pdfRepo from 'src/repositories/document/pdf';
import * as textRepo from 'src/repositories/document/text';
import * as documentService from 'src/services/document/config';
import type {
  Container,
  ContainerElement,
  ContainerElementFile,
  ContainerElementFolder,
  ContainerID,
  ContainerSkel,
  ContainerType,
  RecentContainerEntry,
  RenamedEntry,
} from 'src/models/container';
import type { AppSettings } from 'src/models/settings';
import type { DocumentSource } from 'src/models/document/common';
import type { AnnotationID, AnnotationStyle } from 'src/models/document/pdf';
import type { Relational, RelationalWithAddress } from 'src/models/relational/common';
import { type RelationalResponce } from 'src/models/relational/common';
import type { DocumentConfigFile } from 'src/models/relational/fileSchema';
import type { AnnotationInfo } from 'src/models/relational/fileSchema';
import * as annotationService from 'src/services/document/annotation';
import * as unsavedStateService from 'src/services/document/unsavedState';
import type { Observable } from 'dexie';
import { initOCR } from 'src/utils/ocr/main';

/**
 * バックエンド統合 API層
 * フロントエンドから関数呼び出しで各サービスを利用
 * 将来的なAPI通信化にも対応できるように設計
 */
class BackendApi {
  /**
   * 初期化
   */
  async initialize(): Promise<ApiResponse<void>> {
    const settings = await getSettings();
    if (!settings.ok) return toApiResponse(settings, 'INIT_PROCESS_ERROR');
    const annotDb = await annotationService.initAnnotDB();
    if (!annotDb.ok) return toApiResponse(annotDb, 'INIT_PROCESS_ERROR');
    const relDb = await relationalService.initRelationalDB();
    if (!relDb.ok) return toApiResponse(relDb, 'INIT_PROCESS_ERROR');

    void initOCR().catch((err) => console.error('OCR初期化に失敗しました:', err));

    if (!settings.value.initialized) {
      const initRes = await initializeSettings();
      if (!initRes.ok) return toApiResponse(initRes, 'INIT_PROCESS_ERROR');
    }

    return toApiResponse(Success());
  }

  // ============ コンテナ操作 ============

  /**
   * コンテナ一覧を取得する
   */
  async getAllContainers(): Promise<ApiResponse<ContainerSkel[]>> {
    // 保存済みのコンテナ情報を取得
    const allContainers = await containerService.getAllContainers();
    return toApiResponse(allContainers, 'CONTAINERS_GET_FAILED');
  }

  /**
   * コンテナを作成する
   */
  async createContainer(
    type: ContainerType,
    name: string,
    path: string,
  ): Promise<ApiResponse<ContainerSkel>> {
    const createdContainer = await containerService.createContainer(type, name, path);
    return toApiResponse(createdContainer, 'CONTAINER_CREATE_FAILED');
  }

  /**
   * コンテナの中身（ファイル群）を読み取る
   *
   * @param forceReload trueの場合、既に読み込み済みでも実データを読み直す（手動リロード用）
   */
  async loadContainer(
    id: ContainerID,
    forceReload: boolean = false,
  ): Promise<ApiResponse<Container>> {
    const loadedContainers = await containerService.loadContainer(id, forceReload);
    if (loadedContainers.ok) {
      const initRelation = await relationalService.loadRelationals(id);
      if (!initRelation.ok) return toApiResponse(initRelation, 'CONTAINER_LOAD_FAILED');
    }
    return toApiResponse(loadedContainers, 'CONTAINER_LOAD_FAILED');
  }

  /**
   * コンテナの読み込みを中止する（`deleteContainer: true`の場合は実データの`.rd`管理情報も削除する）
   */
  async unloadContainer(
    cId: ContainerID,
    deleteContainer: boolean = false,
  ): Promise<ApiResponse<void>> {
    const res = await containerService.unloadContainer(cId, deleteContainer);
    return toApiResponse(res, 'CONTAINER_UNLOAD_FAILED');
  }

  /**
   * 「最近読み込んだコンテナ一覧」を取得する（最新順）
   */
  async getRecentContainers(): Promise<ApiResponse<RecentContainerEntry[]>> {
    const res = await getRecentContainers();
    return toApiResponse(res, 'CONTAINERS_GET_FAILED');
  }

  /**
   * 一度閉じたコンテナ（「最近読み込んだコンテナ一覧」等）を、再び読み込み対象に加える
   */
  async reopenContainer(entry: ContainerSkel): Promise<ApiResponse<Container>> {
    const res = await containerService.reopenContainer(entry);
    if (res.ok) {
      const initRelation = await relationalService.loadRelationals(entry.id);
      if (!initRelation.ok) return toApiResponse(initRelation, 'CONTAINER_LOAD_FAILED');
    }
    return toApiResponse(res, 'CONTAINER_LOAD_FAILED');
  }

  /**
   * ローカルフォルダを選択する（`createContainer('local', ...)`の直前にUIから呼ぶこと。
   * ブラウザの「ユーザー操作直後のみ許可」という制約を満たすための入り口になる）
   */
  async pickLocalDirectory(): Promise<ApiResponse<{ name: string }>> {
    const res = await containerService.pickLocalDirectory();
    return toApiResponse(res, 'CONTAINER_CREATE_FAILED');
  }

  /**
   * 既に取得済みのディレクトリハンドルを登録する（`.code-workspace`読み込み等、
   * ディレクトリピッカー以外の経路でハンドルを取得した場合に使用する）
   */
  async registerLocalDirectoryHandle(
    handle: FileSystemDirectoryHandle,
  ): Promise<ApiResponse<void>> {
    const res = await containerService.registerLocalDirectoryHandle(handle);
    return toApiResponse(res, 'CONTAINER_CREATE_FAILED');
  }

  /**
   * コンテナへのアクセス許可状態を確認する（local型のみ意味を持つ。それ以外は常にgranted扱い）
   */
  async checkContainerPermission(
    cId: ContainerID,
  ): Promise<ApiResponse<'granted' | 'prompt' | 'denied'>> {
    const res = await containerService.checkContainerPermission(cId);
    return toApiResponse(res, 'CONTAINER_PERMISSION_FAILED');
  }

  /**
   * コンテナへのアクセス許可を再度要求する（再接続ボタン等のユーザー操作から呼ぶこと）
   */
  async requestContainerPermission(cId: ContainerID): Promise<ApiResponse<void>> {
    const res = await containerService.requestContainerPermission(cId);
    return toApiResponse(res, 'CONTAINER_PERMISSION_FAILED');
  }

  /**
   * コンテナ内にフォルダを新規作成する
   */
  async createFolder(
    cId: ContainerID,
    folderPath: string,
  ): Promise<ApiResponse<ContainerElementFolder>> {
    const res = await containerService.createFolder(cId, folderPath);
    return toApiResponse(res, 'FOLDER_CREATE_FAILED');
  }

  /**
   * コンテナ内のフォルダを削除する（配下の全要素も合わせて削除する）
   */
  async deleteFolder(cId: ContainerID, folder: ContainerElementFolder): Promise<ApiResponse<void>> {
    const res = await containerService.deleteFolder(cId, folder);
    return toApiResponse(res, 'FOLDER_DELETE_FAILED');
  }

  // ============ 文書操作 ============

  /**
   * 文書を取得
   */
  async getDocumentSource(file: ContainerElement): Promise<ApiResponse<DocumentSource>> {
    if (file.type !== 'File')
      return toApiResponse(
        Failure(new Error('Container element is not a file')),
        'INVALID_DOCUMENT',
      );
    const docSrc = await containerService.loadFileAsDocumentSource(file.containerID, file.path);
    return toApiResponse(docSrc, 'INVALID_DOCUMENT');
  }

  /**
   * テキスト系文書（.txt/.md等）の内容を文字列として取得する
   */
  async getDocumentText(file: ContainerElementFile): Promise<ApiResponse<string>> {
    const docSrc = await containerService.loadFileAsDocumentSource(file.containerID, file.path);
    if (!docSrc.ok) return toApiResponse(docSrc, 'INVALID_DOCUMENT');
    const textRes = textRepo.loadTextContents(docSrc.value);
    return toApiResponse(textRes, 'INVALID_DOCUMENT');
  }

  /**
   * 文書を新規登録
   */
  async saveFile(
    cId: ContainerID,
    filePath: string,
    srcData: DocumentSource,
  ): Promise<ApiResponse<ContainerElementFile>> {
    const file = await containerService.createFile(cId, filePath, srcData);
    return toApiResponse(file, 'DOC_SAVE_FAILED');
  }

  /**
   * 文書を削除
   */
  async deleteFile(cId: ContainerID, file: ContainerElementFile): Promise<ApiResponse<void>> {
    const deleteRes = await containerService.deleteFile(cId, file);
    if (!deleteRes.ok) return toApiResponse(deleteRes, 'DOC_DELETE_FAILED');

    await documentService.deleteConfigForFile(file);

    return toApiResponse(deleteRes, 'DOC_DELETE_FAILED');
  }

  /**
   * 文書のメタ情報（ハッシュ値、アノテーション等）を取得
   *
   * 実ファイルの`.rdcfg`を都度確認し、アノテーションDBを最新の内容と整合させる。
   * 実ファイルが`.rdcfg`記録時から更新されている場合は`DOC_CONFIG_CONFLICT`として返すため、
   * 呼び出し側でコンフリクト解決フローに分岐できる
   */
  async loadDocumentConfig(file: ContainerElementFile): Promise<ApiResponse<DocumentConfigFile>> {
    const fileConfig = await documentService.loadConfig(file);
    if (!fileConfig.ok && fileConfig.error instanceof documentService.DocumentConfigConflictError) {
      return toApiResponse(fileConfig, 'DOC_CONFIG_CONFLICT');
    }
    return toApiResponse(fileConfig, 'DOC_ANNOT_LOAD_FAILED');
  }

  /**
   * 文書のメタ情報（ハッシュ値、アノテーション等）を保存
   */
  async saveDocumentConfig(
    file: ContainerElementFile,
    oldSrc: DocumentSource,
    newSrc: DocumentSource,
  ): Promise<ApiResponse<void>> {
    const savedRes = await documentService.saveConfig(file, oldSrc, newSrc);
    return toApiResponse(savedRes, 'DOC_SAVE_FAILED');
  }

  /**
   * 「保存せず閉じる」選択時、このファイルの未保存（仮登録）のアノテーション・関係性を破棄し、
   * 最後に保存された状態へ戻す
   */
  async discardUnsavedChanges(file: ContainerElementFile): Promise<ApiResponse<void>> {
    const res = await documentService.discardUnsavedChanges(file);
    return toApiResponse(res, 'DOC_SAVE_FAILED');
  }

  /**
   * ファイルと同一階層に存在する、依存先のファイルが見つからない（＝浮いている）設定ファイルパス一覧
   */
  getFloatingConfigPaths(file: ContainerElementFile): ApiResponse<string[]> {
    const floatingPaths = documentService.getFloatingConfigPaths(file);
    return toApiResponse(floatingPaths, 'DOC_LIST_FAILED');
  }

  /**
   * 文書設定ファイルに含まれるアノテーションを新文書に基づいて位置や内容を更新する
   *
   * @param confFilePath 読み込む文書設定ファイルを指定できる（指定しない場合はFileに紐づくconfigFileを読み込む）
   */
  async updateDocumentConfig(
    file: ContainerElementFile,
    confFilePath?: string,
  ): Promise<ApiResponse<DocumentConfigFile>> {
    const updatedConfig = await documentService.updateConfigForNewDoc(file, confFilePath);
    return toApiResponse(updatedConfig, 'DOCINFO_UPDATE_FAILED');
  }

  /**
   * コンフリクト解決時、外部で更新された実ファイルの内容を正として設定情報を確定する
   *
   * `loadDocumentConfig`がハッシュ不一致で失敗した際、`updateDocumentConfig`で得た
   * （再追跡済み、または追跡できず現状のまま採用する）設定内容をここで書き込むことで、
   * `.rdcfg`とアノテーションDBを実ファイルの内容と整合させる
   */
  async acceptExternalDocumentConfig(
    file: ContainerElementFile,
    config: DocumentConfigFile,
  ): Promise<ApiResponse<void>> {
    const res = await documentService.acceptExternalConfig(file, config);
    return toApiResponse(res, 'DOC_SAVE_FAILED');
  }

  /**
   * ファイル・フォルダのパスをリネームする
   *
   * 実データのパス変更に加え、`.rdcfg`サイドカー・関係性キャッシュ・読み込み中DBの
   * ファイルパス参照もあわせて更新する（詳細は`documentService.renamePath`を参照）
   */
  async renamePath(elem: ContainerElement, newPath: string): Promise<ApiResponse<RenamedEntry[]>> {
    const renameRes = await documentService.renamePath(elem, newPath);
    return toApiResponse(renameRes, 'PATH_RENAME_FAILED');
  }

  /**
   * ファイル・フォルダを別のフォルダ配下へ移動する
   */
  async moveElement(
    elem: ContainerElement,
    newParentPath: string,
  ): Promise<ApiResponse<RenamedEntry[]>> {
    const moveRes = await documentService.moveElement(elem, newParentPath);
    return toApiResponse(moveRes, 'PATH_MOVE_FAILED');
  }

  /**
   * コンテナ要素の最新状態を、共有キャッシュを更新せずに読み取る（変更検知用）
   */
  async peekContainerElements(id: ContainerID): Promise<ApiResponse<Container>> {
    const res = await containerService.peekContainerElements(id);
    return toApiResponse(res, 'CONTAINER_LOAD_FAILED');
  }

  // ============ アノテーション操作 ============

  /**
   * 文書別アノテーションを取得
   *
   * TODO: 廃止（getFileConfigに統合）
   */
  async getAnnotationsBySource(docSrc: DocumentSource): Promise<ApiResponse<AnnotationStyle[]>> {
    const annots = await pdfRepo.extractAnnotationsFromPdf(docSrc);
    return toApiResponse(annots, 'DOC_ANNOT_LOAD_FAILED');
  }

  /**
   * 文書別アノテーションを保存
   *
   * TODO: 現状の保存処理はsaveFileConfigに移行（packは本システムを返さないでも閲覧できるファイルを出力したいとき用に残しておく）
   */
  async packAnnotationsInSource(
    docSrc: DocumentSource,
    annotations: AnnotationStyle[],
  ): Promise<ApiResponse<DocumentSource>> {
    const packedSrc = await pdfRepo.embedAnnotationsIntoPdf(docSrc, annotations);
    return toApiResponse(packedSrc, 'DOC_ANNOT_EMBED_FAILED');
  }

  /**
   * 指定ファイルのアノテーション情報をDBから取得する
   */
  async getAnnotationsByFile(file: ContainerElementFile): Promise<ApiResponse<AnnotationInfo[]>> {
    const res = await annotationService.getAnnotationsByFile(file);
    return toApiResponse(res, 'DOC_ANNOT_LOAD_FAILED');
  }

  /**
   * 指定ファイルのアノテーションをDBの変更に応じて購読する
   */
  observedAnnotationStylesByFile(
    file: ContainerElementFile,
  ): ApiResponse<Observable<AnnotationStyle[]>> {
    const observed = annotationService.observedAnnotationStylesByFile(file);
    return toApiResponse(Success(observed));
  }

  /**
   * 指定ファイルに未保存の変更（アノテーション・関係性）があるかどうかを取得する
   */
  async hasUnsavedChangesByFile(file: ContainerElementFile): Promise<ApiResponse<boolean>> {
    const res = await unsavedStateService.hasUnsavedChangesByFile(file);
    return toApiResponse(res, 'DOC_ANNOT_LOAD_FAILED');
  }

  /**
   * 指定ファイルの未保存状態をDBの変更に応じて購読する
   */
  observedHasUnsavedChangesByFile(file: ContainerElementFile): ApiResponse<Observable<boolean>> {
    const observed = unsavedStateService.observedHasUnsavedChangesByFile(file);
    return toApiResponse(Success(observed));
  }

  /**
   * 指定したアノテーションを登録する
   */
  async registerAnnotationStyle(
    file: ContainerElementFile,
    aStyle: AnnotationStyle,
  ): Promise<ApiResponse<AnnotationInfo>> {
    const res = await annotationService.registerAnnotationStyle(file, aStyle);
    return toApiResponse(res, 'DOC_ANNOT_REGIST_FAILED');
  }

  /**
   * 指定したアノテーションを削除する
   *
   * 紐づく関係性（src・target問わず）もあわせて削除し、孤立した関係性が残らないようにする
   */
  async removeAnnotation(annotID: AnnotationID): Promise<ApiResponse<void>> {
    const res = await annotationService.removeAnnotationInfo(annotID);
    if (!res.ok) return toApiResponse(res, 'DOC_ANNOT_REMOVE_FAILED');

    const relRes = await relationalService.removeRelationalsForAnnotation(annotID);
    if (!relRes.ok) return toApiResponse(relRes, 'RELATIONAL_REMOVE_FAILED');

    return toApiResponse(res, 'DOC_ANNOT_REMOVE_FAILED');
  }

  /**
   * アノテーションの領域のプレビュー画像（PNG dataURL）を取得する
   */
  async getAnnotationPreviewImage(
    annotID: AnnotationID,
    scale?: number,
  ): Promise<ApiResponse<string>> {
    const res = await annotationService.getAnnotationPreviewImage(annotID, scale);
    return toApiResponse(res, 'DOC_ANNOT_PREVIEW_FAILED');
  }

  // ============ 関係性操作 ============

  /**
   * 当該ファイルをsrc側とする関係性一覧を取得する
   */
  async getRelationalsInFile(file: ContainerElementFile): Promise<ApiResponse<Relational[]>> {
    const fileConfig = await relationalService.getRelationals(file);
    return toApiResponse(fileConfig, 'RELATIONAL_GET_FAILED');
  }

  /**
   * 当該ファイルがsrc・target問わずどちらかの側で関わる関係性一覧を取得する
   */
  async getRelationalsForFile(
    file: ContainerElementFile,
  ): Promise<ApiResponse<RelationalWithAddress[]>> {
    const res = await relationalService.getRelationalsInvolvingFile(file);
    return toApiResponse(res, 'RELATIONAL_GET_FAILED');
  }

  /**
   * コンテナ内の関係性キャッシュが参照しているファイルパス一覧を取得する
   *
   * 開いているかどうかに関わらず、関係性でリンクされている全ファイルのパスを返す
   * （変更検知バナーの表示要否を判定する際の「関連ファイル」の範囲として利用する）
   */
  async getRelationalReferencedPaths(cID: ContainerID): Promise<ApiResponse<string[]>> {
    const res = await relationalService.getReferencedFilePaths(cID);
    return toApiResponse(res, 'RELATIONAL_GET_FAILED');
  }

  /**
   * 指定した関係性を検証する
   */
  async checkRelationals(relational: Relational): Promise<ApiResponse<RelationalResponce>> {
    const res = await relationalService.checkRelational(relational);
    return toApiResponse(res, 'RELATIONAL_CHECK_FAILED');
  }

  /**
   * 指定した関係性を検証する（アノテーション内容が未読み込みでも失敗しない版）
   *
   * checkedRule: undefinedは「検証保留中」を意味する
   */
  async checkRelationalsSafe(relational: Relational): Promise<ApiResponse<RelationalResponce>> {
    const res = await relationalService.checkRelationalSafe(relational);
    return toApiResponse(Success(res));
  }

  /**
   * 関係性を登録する
   *
   * cf) 更新の場合は事前にremoveしたうえで新しい関係性を登録する
   */
  async registRelationals(newRelational: Relational): Promise<ApiResponse<RelationalResponce>> {
    const res = await relationalService.registRelational(newRelational);
    return toApiResponse(res, 'RELATIONAL_REGIST_FAILED');
  }

  /**
   * 指定したアノテーションに紐づく関係性（src側）をすべて削除する
   */
  async removeRelationals(sourceAnnotID: AnnotationID): Promise<ApiResponse<void>> {
    const res = await relationalService.removeRelationals(sourceAnnotID);
    return toApiResponse(res, 'RELATIONAL_REMOVE_FAILED');
  }

  /**
   * srcID・targetIDが一致する1本の関係性のみを削除する（リンクの変更・個別削除用）
   */
  async removeRelationalEdge(
    srcID: AnnotationID,
    targetID: AnnotationID,
  ): Promise<ApiResponse<void>> {
    const res = await relationalService.removeRelationalEdge(srcID, targetID);
    return toApiResponse(res, 'RELATIONAL_REMOVE_FAILED');
  }

  /**
   * アノテーションIDから、そのアノテーションが属するファイル情報を解決する
   */
  async resolveAnnotationFile(annotID: AnnotationID): Promise<ApiResponse<ContainerElementFile>> {
    const res = await relationalService.resolveAnnotationFile(annotID);
    return toApiResponse(res, 'RELATIONAL_RESOLVE_FAILED');
  }

  // ============ 設定操作 ============

  /**
   * 設定を取得
   */
  async getSettings(): Promise<ApiResponse<AppSettings>> {
    const settings = await getSettings();
    return toApiResponse(settings, 'FAILED_LOAD_SETTINGS');
  }

  /**
   * 設定を保存
   */
  async saveSettings<K extends keyof AppSettings>(
    key: K,
    value: AppSettings[K],
  ): Promise<ApiResponse<void>> {
    const saveRes = await saveSettings(key, value);
    return toApiResponse(saveRes, 'FAILED_SAVE_SETTINGS');
  }
}

// グローバルAPIインスタンス
const backendApi = new BackendApi();

/**
 * フロントエンドから利用するためのAPI参照
 * Vue コンポーネント内で: const api = useBackendApi()
 */
export function useBackendApi() {
  return backendApi;
}

// グローバル登録用（オプション）
export default backendApi;
