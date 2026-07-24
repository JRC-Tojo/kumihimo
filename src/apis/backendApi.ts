import {
  getSettings,
  getRecentContainers,
  initializeSettings,
  saveSettings,
  saveAnnotationPresets,
  recordRecentColorSetting,
  updateRecentColorsLimitSetting,
  ensureDefaultAnnotationPresets,
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
import type { AnnotationID, AnnotationStyle, ColorCode } from 'src/models/document/pdf';
import type { AnnotationTool } from 'src/models/docPage';
import type { Relational, RelationalWithAddress } from 'src/models/relational/common';
import { type RelationalResponce } from 'src/models/relational/common';
import type { DocumentConfigFile } from 'src/models/relational/fileSchema';
import type { AnnotationInfo } from 'src/models/relational/fileSchema';
import * as annotationService from 'src/services/document/annotation';
import * as unsavedStateService from 'src/services/document/unsavedState';
import type { LayerOrderAction } from 'src/utils/document/annotationOrder';
import type { Observable } from 'dexie';
import { initOCR } from 'src/utils/ocr/main';
import type {
  InstalledPlugin,
  CatalogEntry,
  PluginInstallSource,
} from 'src/models/plugin/installation';
import type { PluginID } from 'src/models/plugin/manifest';
import type { PluginEntryPointDescriptor } from 'src/models/plugin/discovery';
import type { PluginRunState } from 'src/models/plugin/panel';
import type { PluginSubmission } from 'src/models/plugin/submission';
import * as pluginInstallService from 'src/services/plugin/install';
import * as pluginRunService from 'src/services/plugin/run';
import * as pluginSubmissionService from 'src/services/plugin/submissionGithub';
import * as githubAuthService from 'src/services/plugin/githubAuth';
import { parseSubmissionDraft } from 'src/services/plugin/manifest';

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
    } else {
      // 既存インストールには、初回起動後に追加されたアノテーション種別のデフォルトプリセットを補う
      const migrateRes = await ensureDefaultAnnotationPresets();
      if (!migrateRes.ok) return toApiResponse(migrateRes, 'INIT_PROCESS_ERROR');
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
   * 指定したアノテーションの重ね順（最前面/前面/背面/最背面）を変更する
   *
   * `annotations`には対象と同じファイルの注釈一覧を渡す
   */
  async reorderAnnotation(
    file: ContainerElementFile,
    annotations: AnnotationStyle[],
    annotID: AnnotationID,
    action: LayerOrderAction,
  ): Promise<ApiResponse<AnnotationInfo>> {
    const res = await annotationService.reorderAnnotationStyle(file, annotations, annotID, action);
    return toApiResponse(res, 'DOC_ANNOT_REORDER_FAILED');
  }

  /**
   * 複数のアノテーションを複製し、指定したページへ貼り付ける（ペースト）
   */
  async pasteAnnotations(
    file: ContainerElementFile,
    sources: AnnotationStyle[],
    pageNumber: number,
    offsetStep: number,
  ): Promise<ApiResponse<AnnotationInfo[]>> {
    const res = await annotationService.pasteAnnotations(file, sources, pageNumber, offsetStep);
    return toApiResponse(res, 'DOC_ANNOT_PASTE_FAILED');
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
  async checkRelationals(
    relational: RelationalWithAddress,
  ): Promise<ApiResponse<RelationalResponce>> {
    const res = await relationalService.checkRelational(relational);
    return toApiResponse(res, 'RELATIONAL_CHECK_FAILED');
  }

  /**
   * 指定した関係性を検証する（アノテーション内容が未読み込みでも失敗しない版）
   *
   * checkedRule: undefinedは「検証保留中」を意味する
   */
  async checkRelationalsSafe(
    relational: RelationalWithAddress,
  ): Promise<ApiResponse<RelationalResponce>> {
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

  /**
   * アノテーションプリセット一覧を保存する（追加・編集・削除・並び替え・インポートの共通経路）
   *
   * `tools`キーの読み込み→変更→保存を直列化するため、`saveSettings('tools', ...)`を
   * 直接呼ぶのではなくこちらを経由すること（直近使用色の記録・件数変更と競合しないようにする）
   */
  async saveAnnotationPresets(
    presets: AnnotationTool[],
  ): Promise<ApiResponse<AppSettings['tools']>> {
    const res = await saveAnnotationPresets(presets);
    return toApiResponse(res, 'FAILED_SAVE_SETTINGS');
  }

  /**
   * 直近使用色の先頭へ色を記録する
   */
  async recordRecentColor(color: ColorCode): Promise<ApiResponse<AppSettings['tools']>> {
    const res = await recordRecentColorSetting(color);
    return toApiResponse(res, 'FAILED_SAVE_SETTINGS');
  }

  /**
   * 直近使用色として保持する件数を変更する
   */
  async updateRecentColorsLimit(limit: number): Promise<ApiResponse<AppSettings['tools']>> {
    const res = await updateRecentColorsLimitSetting(limit);
    return toApiResponse(res, 'FAILED_SAVE_SETTINGS');
  }

  // ============ プラグイン操作 ============

  /**
   * 設定済みのGitHub個人アクセストークンを取得する（内部専用）
   */
  private async getGithubToken(): Promise<string | undefined> {
    const settings = await getSettings();
    return settings.ok ? settings.value.githubToken : undefined;
  }

  /**
   * GitHub個人アクセストークンの有効性を確認し、紐づくユーザー名を返す
   * （設定画面の「接続を確認」ボタンから呼ばれる。設定への保存はフロントエンド側で行う）
   */
  async verifyGithubToken(token: string): Promise<ApiResponse<string>> {
    const res = await githubAuthService.verifyGithubToken(token);
    return toApiResponse(res, 'PLUGIN_GITHUB_AUTH_FAILED');
  }

  /**
   * インストール済みプラグイン一覧を取得する
   */
  async getInstalledPlugins(): Promise<ApiResponse<InstalledPlugin[]>> {
    const res = await pluginInstallService.getInstalledPlugins();
    return toApiResponse(res, 'PLUGIN_LIST_FAILED');
  }

  /**
   * 導入可能なプラグイン一覧（カタログ。ストアリポジトリから取得）を取得する
   */
  async getCatalogEntries(): Promise<ApiResponse<CatalogEntry[]>> {
    const token = await this.getGithubToken();
    const res = await pluginInstallService.getCatalogEntries(token);
    return toApiResponse(res, 'PLUGIN_LIST_FAILED');
  }

  /**
   * カタログからプラグインをそのままインストールする
   */
  async installPluginFromCatalog(id: PluginID): Promise<ApiResponse<void>> {
    const token = await this.getGithubToken();
    const res = await pluginInstallService.installFromCatalog(id, token);
    return toApiResponse(res, 'PLUGIN_INSTALL_FAILED');
  }

  /**
   * ローカルの入力内容（フォーム由来）・バイナリ・（任意で）アイコンから直接プラグインを
   * インストールする（ストア/カタログを経由しない。開発中のWASMを実ホストで動作確認する用途）
   */
  async installPluginFromFile(
    draftJson: unknown,
    binary: Uint8Array,
    icon: Uint8Array | undefined,
  ): Promise<ApiResponse<void>> {
    const parsed = parseSubmissionDraft(draftJson);
    if (!parsed.ok) return toApiResponse(parsed, 'PLUGIN_MANIFEST_INVALID');
    const res = await pluginInstallService.installFromDraft(parsed.value, binary, icon);
    return toApiResponse(res, 'PLUGIN_INSTALL_FAILED');
  }

  /**
   * プラグインをアンインストールする
   */
  async uninstallPlugin(id: PluginID, source: PluginInstallSource): Promise<ApiResponse<void>> {
    const res = await pluginInstallService.uninstallPlugin(id, source);
    return toApiResponse(res, 'PLUGIN_UNINSTALL_FAILED');
  }

  /**
   * プラグインの有効/無効を切り替える
   */
  async setPluginEnabled(
    id: PluginID,
    source: PluginInstallSource,
    enabled: boolean,
  ): Promise<ApiResponse<void>> {
    const res = await pluginInstallService.setPluginEnabled(id, source, enabled);
    return toApiResponse(res, 'PLUGIN_TOGGLE_ENABLED_FAILED');
  }

  /**
   * プラグインが自己申告するエントリポイント・入力項目を取得する（`describePlugin`の発見専用実行）
   */
  async discoverPluginEntryPoints(
    id: PluginID,
    source: PluginInstallSource,
  ): Promise<ApiResponse<PluginEntryPointDescriptor[]>> {
    const res = await pluginRunService.discoverEntryPoints(id, source);
    return toApiResponse(res, 'PLUGIN_DISCOVER_FAILED');
  }

  /**
   * プラグインのエントリポイントを実行する
   *
   * `fieldValues`は`discoverPluginEntryPoints`が返したfieldIdをキーとする入力値
   * （`file`型フィールドの値は含まない）。`targetFiles`は`file`型フィールドの宣言順に
   * ユーザーが選択した対象文書（ファイル選択ダイアログでの解決結果）
   */
  async runPluginEntryPoint(
    id: PluginID,
    source: PluginInstallSource,
    entryId: string,
    fieldValues: Record<string, string | number | boolean>,
    targetFiles: ContainerElementFile[],
  ): Promise<ApiResponse<PluginRunState>> {
    const res = await pluginRunService.runEntryPoint(id, source, entryId, fieldValues, targetFiles);
    return toApiResponse(res, 'PLUGIN_RUN_FAILED');
  }

  /**
   * プラグインの実行状態をDBの変更に応じて購読する
   */
  observePluginRunState(runId: string): ApiResponse<Observable<PluginRunState | undefined>> {
    const observed = pluginRunService.observeRunState(runId);
    return toApiResponse(Success(observed));
  }

  /**
   * プラグインが積んだ書き込み予定項目を承認し、実データへコミットする
   */
  async approvePluginPlanItems(runId: string, itemIds: string[]): Promise<ApiResponse<void>> {
    const res = await pluginRunService.approvePlanItems(runId, itemIds);
    return toApiResponse(res, 'PLUGIN_PLAN_COMMIT_FAILED');
  }

  /**
   * プラグインが積んだ書き込み予定項目を却下する（実データへは反映しない）
   */
  async rejectPluginPlanItems(runId: string, itemIds: string[]): Promise<ApiResponse<void>> {
    const res = await pluginRunService.rejectPlanItems(runId, itemIds);
    return toApiResponse(res, 'PLUGIN_PLAN_COMMIT_FAILED');
  }

  /**
   * プラグインを申請する（ストアリポジトリへ実際にPull Requestを作成する。新規申請・
   * バージョン更新のいずれもこの1つの経路で扱う）
   *
   * @param updateId バージョン更新の場合のみ、更新対象の公開済みプラグインidを指定する。
   *   未指定（新規申請）の場合はサービス層が新規にUUIDを採番する
   */
  async submitPlugin(
    draftJson: unknown,
    binary: Uint8Array,
    icon: Uint8Array | undefined,
    updateId: PluginID | undefined,
  ): Promise<ApiResponse<PluginSubmission>> {
    const parsed = parseSubmissionDraft(draftJson);
    if (!parsed.ok) return toApiResponse(parsed, 'PLUGIN_MANIFEST_INVALID');
    const token = await this.getGithubToken();
    if (!token)
      return toApiResponse(
        Failure(new Error('GitHub連携が未設定です')),
        'PLUGIN_GITHUB_TOKEN_MISSING',
      );
    const res = await pluginSubmissionService.submitPlugin(
      parsed.value,
      binary,
      icon,
      token,
      updateId,
    );
    return toApiResponse(res, 'PLUGIN_SUBMIT_FAILED');
  }

  /**
   * 自分が行ったプラグイン申請（PR）一覧を取得する
   */
  async getPluginSubmissions(): Promise<ApiResponse<PluginSubmission[]>> {
    const token = await this.getGithubToken();
    if (!token)
      return toApiResponse(
        Failure(new Error('GitHub連携が未設定です')),
        'PLUGIN_GITHUB_TOKEN_MISSING',
      );
    const res = await pluginSubmissionService.getSubmissions(token);
    return toApiResponse(res, 'PLUGIN_SUBMISSION_GET_FAILED');
  }

  /**
   * 未マージの申請（PR）を取り下げる（マージせずにクローズする）
   *
   * CI検証（manifest/wasm/icon/ownership）に合格したPRはストアリポジトリ側のActionsが
   * 自動的にマージするため、アプリ側に手動マージの操作はない
   */
  async withdrawPluginSubmission(prNumber: number): Promise<ApiResponse<void>> {
    const token = await this.getGithubToken();
    if (!token)
      return toApiResponse(
        Failure(new Error('GitHub連携が未設定です')),
        'PLUGIN_GITHUB_TOKEN_MISSING',
      );
    const res = await pluginSubmissionService.withdrawSubmission(prNumber, token);
    return toApiResponse(res, 'PLUGIN_PUBLISH_FAILED');
  }

  /**
   * 公開済みプラグインの取り下げ（unpublish）を申請する
   */
  async unpublishPlugin(id: PluginID): Promise<ApiResponse<PluginSubmission>> {
    const token = await this.getGithubToken();
    if (!token)
      return toApiResponse(
        Failure(new Error('GitHub連携が未設定です')),
        'PLUGIN_GITHUB_TOKEN_MISSING',
      );
    const res = await pluginSubmissionService.unpublishPlugin(id, token);
    return toApiResponse(res, 'PLUGIN_PUBLISH_FAILED');
  }

  /**
   * 「マイ申請」一覧からPRを非表示にする（GitHub側のPRは変更しないローカル表示のみのフィルタ）
   */
  async dismissPluginSubmission(prNumber: number): Promise<ApiResponse<void>> {
    const res = await pluginSubmissionService.dismissSubmission(prNumber);
    return toApiResponse(res, 'PLUGIN_DISMISS_SUBMISSION_FAILED');
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
