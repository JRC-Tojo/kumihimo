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
import * as containerConfigService from 'src/services/container/config';
import * as relationalService from 'src/services/document/relational';
import * as pdfRepo from 'src/repositories/document/pdf';
import * as localFontAccessRepo from 'src/repositories/document/localFontAccess';
import * as textRepo from 'src/repositories/document/text';
import * as documentService from 'src/services/document/config';
import { runConcurrently } from 'src/utils/promise/concurrent';
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
import type { ContainerTextSearchResult, TextSearchMatch } from 'src/models/document/search';
import type {
  AnnotationID,
  AnnotationStyle,
  ColorCode,
  TextAnnotationStyle,
} from 'src/models/document/pdf';
import type {
  AnnotationGroup,
  AnnotationGroupID,
  GroupValueAggregation,
} from 'src/models/document/group';
import type { AnnotationTool } from 'src/models/docPage';
import type { Relational, RelationalWithAddress } from 'src/models/relational/common';
import { type RelationalResponce } from 'src/models/relational/common';
import type { DocumentConfigFile } from 'src/models/relational/fileSchema';
import type {
  AnnotationInfo,
  BookmarkID,
  BookmarkInfo,
  RelationalEndpointID,
} from 'src/models/relational/fileSchema';
import type { RelaxationOptions } from 'src/models/relational/relaxation';
import * as annotationService from 'src/services/document/annotation';
import * as annotationGroupService from 'src/services/document/annotationGroup';
import * as bookmarkService from 'src/services/document/bookmark';
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
 * コンテナ横断のテキスト検索（`searchContainerText`）で同時に検索するPDF文書数の上限
 *
 * 各文書の検索はpdf.js文書ごとに専用のWorkerスレッドを使うため、無制限に並列化すると
 * 大きなファイルが多いコンテナでメモリ・CPUを圧迫しかねない（`PdfPage.vue`の
 * `MAX_CONCURRENT_TILE_RENDERS`と同じ考え方）
 */
const CONTAINER_SEARCH_CONCURRENCY = 3;

/**
 * バックエンド統合 API層
 * フロントエンドから関数呼び出しで各サービスを利用
 * 将来的なAPI通信化にも対応できるように設計
 */
class BackendApi {
  /** `prefetchLocalFonts`が一度でも実行済みかどうか（同一セッション中の再実行を防ぐフラグ） */
  private localFontsPrefetched = false;

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
   * 文書内テキスト検索（Ctrl+F）: 指定ファイルの全ページからクエリにマッチする箇所を位置情報付きで返す
   *
   * ビューア表示中の文書自体に対する検索は、既に取得済みのPDFDocumentProxyを再利用できる
   * `src/components/Viewer/pdfManager.ts`の`searchDocumentText`を直接使う方が効率的なため、
   * こちらは「開いていない文書」も対象にできるコンテナ横断検索（`searchContainerText`）から使う想定
   */
  async searchDocumentText(
    file: ContainerElementFile,
    query: string,
  ): Promise<ApiResponse<TextSearchMatch[]>> {
    const docSrc = await containerService.loadFileAsDocumentSource(file.containerID, file.path);
    if (!docSrc.ok) return toApiResponse(docSrc, 'INVALID_DOCUMENT');
    const res = await pdfRepo.searchTextByFile(file, docSrc.value, query);
    return toApiResponse(res, 'DOC_SEARCH_FAILED');
  }

  /**
   * コンテナ横断のテキスト検索: コンテナ内の全PDF文書を対象にクエリを検索する
   *
   * 文書ごとの読み込み・検索は`CONTAINER_SEARCH_CONCURRENCY`件まで並列化する（issue #91と
   * 同根の「重いファイルが多いコンテナで遅い」問題への対応）。`onResult`を渡すと、各文書の
   * 検索が完了するたび（＝全件揃うのを待たず）に随時呼ばれるため、呼び出し側はUIを
   * ブロックせず結果が出た文書から順次表示できる。個別文書の読み込み・検索に失敗した場合は
   * その文書だけスキップし、コンテナ全体の検索は継続する
   */
  async searchContainerText(
    cId: ContainerID,
    query: string,
    onResult?: (result: ContainerTextSearchResult) => void,
  ): Promise<ApiResponse<ContainerTextSearchResult[]>> {
    const containerRes = await containerService.loadContainer(cId, false);
    if (!containerRes.ok) return toApiResponse(containerRes, 'CONTAINER_SEARCH_FAILED');

    const pdfFiles = Object.values(containerRes.value.elements).filter(
      (el): el is ContainerElementFile =>
        el.type === 'File' && el.path.toLowerCase().endsWith('.pdf'),
    );

    const searchTasks = pdfFiles.map(
      (file) => async (): Promise<ContainerTextSearchResult | undefined> => {
        const docSrc = await containerService.loadFileAsDocumentSource(file.containerID, file.path);
        if (!docSrc.ok) return undefined;
        const matchesRes = await pdfRepo.searchTextByFile(file, docSrc.value, query);
        if (!matchesRes.ok || matchesRes.value.length === 0) return undefined;

        const result: ContainerTextSearchResult = { file, matches: matchesRes.value };
        onResult?.(result);
        return result;
      },
    );

    const settled = await runConcurrently(searchTasks, CONTAINER_SEARCH_CONCURRENCY);
    const results = settled.filter((r): r is ContainerTextSearchResult => r !== undefined);
    return toApiResponse(Success(results), 'CONTAINER_SEARCH_FAILED');
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
   * 実ファイルの`.kcfg`を都度確認し、アノテーションDBを最新の内容と整合させる。
   * 実ファイルが`.kcfg`記録時から更新されている場合は`DOC_CONFIG_CONFLICT`として返すため、
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
   * `.kcfg`とアノテーションDBを実ファイルの内容と整合させる
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
   * 実データのパス変更に加え、`.kcfg`サイドカー・関係性キャッシュ・読み込み中DBの
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

  /**
   * 指定文書に登録されているブックマーク一覧を取得する（ページ番号の昇順）
   *
   * PDFに元々埋め込まれているしおり（アウトライン）は`loadDocumentConfig`初回呼び出し時に
   * 自動でここに取り込まれるため、呼び出し側はブックマークの起源を区別する必要はない
   */
  async listBookmarks(file: ContainerElementFile): Promise<ApiResponse<BookmarkInfo[]>> {
    const res = await bookmarkService.listBookmarks(file);
    return toApiResponse(res, 'BOOKMARK_LOAD_FAILED');
  }

  /**
   * ブックマークを新規登録する
   *
   * `options.parentId`を指定すると、既存のブックマークの子要素として登録される。
   * `options.annotationId`を指定すると、ページ番号だけでなくアノテーション位置も記録し、
   * ジャンプ時にその位置へ遷移できるようにする
   */
  async addBookmark(
    file: ContainerElementFile,
    title: string,
    pageNumber: number,
    options?: bookmarkService.AddBookmarkOptions,
  ): Promise<ApiResponse<BookmarkInfo>> {
    const res = await bookmarkService.addBookmark(file, title, pageNumber, options);
    return toApiResponse(res, 'BOOKMARK_SAVE_FAILED');
  }

  /**
   * ブックマークを削除する（子要素が存在する場合はまとめて削除される）
   */
  async removeBookmark(
    file: ContainerElementFile,
    bookmarkId: BookmarkID,
  ): Promise<ApiResponse<void>> {
    const res = await bookmarkService.removeBookmark(file, bookmarkId);
    return toApiResponse(res, 'BOOKMARK_SAVE_FAILED');
  }

  /**
   * ブックマークの名称を変更する
   */
  async renameBookmark(
    file: ContainerElementFile,
    bookmarkId: BookmarkID,
    newTitle: string,
  ): Promise<ApiResponse<void>> {
    const res = await bookmarkService.renameBookmark(file, bookmarkId, newTitle);
    return toApiResponse(res, 'BOOKMARK_SAVE_FAILED');
  }

  /**
   * 登録済みブックマークを、PDFのネイティブしおり（Outline）として文書データへ書き込む
   *
   * 「名前を付けて保存」（`saveDocumentAs`）でPDFを別名保存する際に使う。ブックマークが
   * 存在しない場合は`docSrc`をそのまま返す（Outline未設定のPDFへ余計な変更を加えない）
   */
  async packBookmarksInSource(
    docSrc: DocumentSource,
    file: ContainerElementFile,
  ): Promise<ApiResponse<DocumentSource>> {
    const bookmarksRes = await bookmarkService.listBookmarks(file);
    if (!bookmarksRes.ok) return toApiResponse(bookmarksRes, 'BOOKMARK_LOAD_FAILED');
    if (bookmarksRes.value.length === 0) return toApiResponse(Success(docSrc));

    const annotInfosRes = await annotationService.getAnnotationsByFile(file);
    if (!annotInfosRes.ok) return toApiResponse(annotInfosRes, 'DOC_ANNOT_LOAD_FAILED');

    const packedRes = await pdfRepo.embedBookmarksIntoPdf(
      docSrc,
      bookmarksRes.value,
      annotInfosRes.value,
    );
    return toApiResponse(packedRes, 'BOOKMARK_EMBED_FAILED');
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
   * 文書別アノテーションを、ネイティブのPDF注釈（コメント）として保存
   *
   * `packAnnotationsInSource`（図形として焼き込み、非可逆）とは異なり、Acrobat等の
   * 「コメント」パネルから個別に参照・削除できる形でPDFへ埋め込む
   */
  async packAnnotationsAsCommentsInSource(
    docSrc: DocumentSource,
    annotations: AnnotationStyle[],
  ): Promise<ApiResponse<DocumentSource>> {
    const packedSrc = await pdfRepo.embedAnnotationsAsCommentsIntoPdf(docSrc, annotations);
    return toApiResponse(packedSrc, 'DOC_ANNOT_EMBED_FAILED');
  }

  /**
   * 文書別アノテーションを、画面表示どおりの見た目でベクタ形状のままページに焼き込んで保存（非可逆）
   *
   * `packAnnotationsInSource`（pdf-libの図形描画プリミティブで一部種別のみ再現する旧実装）とは
   * 異なり、全アノテーション種別・線種・矢印サイズ・テキストの折り返し・ブレンドモードを再現する。
   * ページの背景はラスタ化しないため、元がベクタのPDFはベクタのまま維持される
   */
  async packAnnotationsAsVectorInSource(
    docSrc: DocumentSource,
    annotations: AnnotationStyle[],
  ): Promise<ApiResponse<DocumentSource>> {
    const packedSrc = await pdfRepo.embedAnnotationsAsVectorIntoPdf(docSrc, annotations);
    return toApiResponse(packedSrc, 'DOC_ANNOT_EMBED_FAILED');
  }

  /**
   * このブラウザがLocal Font Access API（OSの実フォントを列挙・取得するAPI）に対応しているか
   *
   * Chromium系ブラウザ（Chrome/Edge/Opera）専用。非対応の場合はUIから該当機能を隠すこと
   */
  isLocalFontAccessSupported(): boolean {
    return localFontAccessRepo.isLocalFontAccessSupported();
  }

  /**
   * OSにインストールされているフォントのファミリー名一覧（重複除去・ソート済み）を取得する
   *
   * 初回呼び出し時にブラウザの許可プロンプトが表示されるため、必ずユーザー操作
   * （クリック等）のイベントハンドラ内から呼ぶこと
   */
  async queryLocalFontFamilies(): Promise<ApiResponse<string[]>> {
    const res = await localFontAccessRepo.queryLocalFonts();
    if (!res.ok) return toApiResponse(res, 'LOCAL_FONT_QUERY_FAILED');
    const families = [...new Set(res.value.map((f) => f.family))].sort((a, b) =>
      a.localeCompare(b),
    );
    return toApiResponse(Success(families));
  }

  /**
   * Local Font Access権限を先読みで要求する（ユーザー操作のイベントハンドラ内から呼ぶこと）
   *
   * テキストツール選択・テキストボックス編集開始など複数の呼び出し元を持つが、一度でも
   * 要求済みであれば以降は何もしない（許可プロンプトは初回のみで、対応ブラウザでも一度
   * 拒否されると再度要求できないため、繰り返し呼んでもOSフォント一覧の再取得が無駄になるだけ）。
   * 先読みはfire-and-forgetで使われることが多いが、取得失敗を呼び出し側でも判定できるよう
   * `ApiResponse`をそのまま返す（不要であれば呼び出し側で明示的に`void`破棄すること）
   */
  async prefetchLocalFonts(): Promise<ApiResponse<void>> {
    if (this.localFontsPrefetched) return toApiResponse(Success());
    if (!this.isLocalFontAccessSupported()) return toApiResponse(Success());
    this.localFontsPrefetched = true;

    const res = await this.queryLocalFontFamilies();
    if (!res.ok) return res;
    return toApiResponse(Success());
  }

  /**
   * 現在のブラウザ・アノテーション内容で、埋め込み保存時にフォント（特に日本語等の
   * WinAnsiEncodingで表現できない文字）が表示されなくなるリスクがあるかどうかを判定する
   *
   * Local Font Access APIが使えない（非対応ブラウザ、または対応ブラウザでも権限が
   * 未許可・拒否済みでOSフォントを一件も取得できない）場合、標準14フォントでは表現できない
   * 文字を含むテキストボックスがあると、保存後のPDFでその文字が表示されなくなる。
   * 呼び出し側は、この判定がtrueの場合に警告ダイアログ等でユーザーに確認を促すこと
   */
  async hasFontEmbedRisk(annotations: AnnotationStyle[]): Promise<ApiResponse<boolean>> {
    // WinAnsiEncodingで表現できない文字（日本語等）を含むテキストボックスのみを判定対象にする
    // （それ以外は標準14フォントのままで表示できるため、実フォントの解決有無を問わず安全）
    const targets = annotations.filter(
      (a): a is TextAnnotationStyle =>
        a.type === 'text' && a.text.trim() !== '' && !pdfRepo.isWinAnsiEncodable(a.text),
    );
    if (targets.length === 0) return toApiResponse(Success(false));
    if (!this.isLocalFontAccessSupported()) return toApiResponse(Success(true));

    // OSフォントが1件でも取得できることと、対象テキストの文字を実際に埋め込めることは別問題
    // （無関係な言語のフォントしか無い場合等）であるため、保存処理と同じ候補選定・グリフ収録
    // 判定（`resolveTextFont`）を`anyTextWillFallbackToStandardFont`経由でそのまま再利用する
    const hasFallback = await pdfRepo.anyTextWillFallbackToStandardFont(
      targets.map((a) => ({ fontFamily: a.fontFamily, fontWeight: a.fontWeight, text: a.text })),
    );
    return toApiResponse(Success(hasFallback));
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
    offset: { dx: number; dy: number },
  ): Promise<ApiResponse<AnnotationInfo[]>> {
    const res = await annotationService.pasteAnnotations(file, sources, pageNumber, offset);
    return toApiResponse(res, 'DOC_ANNOT_PASTE_FAILED');
  }

  /**
   * 関係性の端点（アノテーションまたはグループ）の周辺プレビュー画像（PNG dataURL）を取得する
   *
   * アノテーション単体でも、未オープンの文書からアドレスを解決できる（`resolveEndpointAddress`
   * 参照）ため、公開APIとしてはアノテーション専用のプレビューAPIを別に持たず、これに統一する
   */
  async getRelationalEndpointPreviewImage(
    id: RelationalEndpointID,
    scale?: number,
  ): Promise<ApiResponse<string>> {
    const res = await relationalService.getRelationalEndpointPreviewImage(id, scale);
    return toApiResponse(res, 'DOC_ANNOT_PREVIEW_FAILED');
  }

  // ============ グループ操作 ============

  /**
   * 指定ファイルに登録されているグループ一覧を取得する
   */
  async listAnnotationGroups(file: ContainerElementFile): Promise<ApiResponse<AnnotationGroup[]>> {
    const res = await annotationGroupService.listAnnotationGroups(file);
    return toApiResponse(res, 'DOC_ANNOT_GROUP_LOAD_FAILED');
  }

  /**
   * 指定ファイル内の特定グループを取得する
   */
  async getAnnotationGroup(
    file: ContainerElementFile,
    groupId: AnnotationGroupID,
  ): Promise<ApiResponse<AnnotationGroup>> {
    const res = await annotationGroupService.getAnnotationGroup(file, groupId);
    return toApiResponse(res, 'DOC_ANNOT_GROUP_LOAD_FAILED');
  }

  /**
   * 複数のアノテーションをグループ化する
   *
   * 選択範囲に既存グループのメンバーが含まれていた場合はそのグループを解散して統合する。
   * 解散したグループが関係性の端点になっていた場合は、孤立させないよう関係性もあわせて削除する。
   *
   * グループ生成自体は成功したが関係性のクリーンアップが途中で失敗した場合、そのまま失敗を返すと
   * 「APIは失敗と報告するが、実データ上はグループが生成・解散済み」という、呼び出し元（Undo履歴）
   * からは取り消せない不整合状態が残ってしまう。そのため、クリーンアップ失敗時は新規グループの
   * 取り消し・解散前グループの復元・（既にクリーンアップ済みだった分の）関係性の再登録まで
   * ベストエフォートで補償し、操作全体を行う前の状態へ戻したうえで失敗を返す
   */
  async groupAnnotations(
    file: ContainerElementFile,
    annotationIds: AnnotationID[],
  ): Promise<ApiResponse<{ group: AnnotationGroup; dissolvedGroups: AnnotationGroup[] }>> {
    const res = await annotationGroupService.groupAnnotations(file, annotationIds);
    if (!res.ok) return toApiResponse(res, 'DOC_ANNOT_GROUP_FAILED');
    const { group: newGroup, dissolvedGroups } = res.value;
    if (dissolvedGroups.length === 0) return toApiResponse(Success(res.value));

    // クリーンアップで削除される可能性のある関係性を、削除前にすべて捕捉しておく
    // （ロールバック時にこの中から「実際に削除済みだった分」だけを選んで再登録する）
    const dissolvedIds = new Set<string>(dissolvedGroups.map((g) => g.id));
    const involvingRes = await relationalService.getRelationalsInvolvingFile(file);
    const capturedRelationals = involvingRes.ok
      ? involvingRes.value
          .map((r) => r.relational)
          .filter((r) => dissolvedIds.has(r.srcID) || dissolvedIds.has(r.targetID))
      : [];

    const cleanedGroupIds: AnnotationGroupID[] = [];
    for (const dissolved of dissolvedGroups) {
      const cleanupRes = await relationalService.removeRelationalsForAnnotation(dissolved.id);
      if (!cleanupRes.ok) {
        await rollbackGroupAnnotations(file, newGroup, dissolvedGroups, {
          cleanedGroupIds,
          capturedRelationals,
        });
        return toApiResponse(cleanupRes, 'RELATIONAL_REMOVE_FAILED');
      }
      cleanedGroupIds.push(dissolved.id);
    }

    return toApiResponse(Success(res.value));
  }

  /**
   * キャプチャ済みのグループ記録をそのままの内容で復元する（Undo/Redoのリプレイ専用）
   */
  async restoreGroup(
    file: ContainerElementFile,
    group: AnnotationGroup,
  ): Promise<ApiResponse<AnnotationGroup>> {
    const res = await annotationGroupService.restoreGroup(file, group);
    return toApiResponse(res, 'DOC_ANNOT_GROUP_FAILED');
  }

  /**
   * 既存グループから特定のメンバーを取り除く（グループ自体は解散しない部分更新）
   */
  async removeGroupMembers(
    file: ContainerElementFile,
    groupId: AnnotationGroupID,
    memberIdsToRemove: AnnotationID[],
  ): Promise<ApiResponse<AnnotationGroup>> {
    const res = await annotationGroupService.removeGroupMembers(file, groupId, memberIdsToRemove);
    return toApiResponse(res, 'DOC_ANNOT_GROUP_FAILED');
  }

  /**
   * グループを解除する
   *
   * グループが関係性の端点になっていた場合は、孤立させないよう関係性もあわせて削除する。
   * グループの解除自体は成功したが関係性のクリーンアップが失敗した場合、そのまま失敗を返すと
   * 「APIは失敗と報告するが、実データ上はグループが解除済み」という不整合状態が残ってしまうため、
   * `groupAnnotations`と同様に解除前グループ・関係性をベストエフォートで復元してから失敗を返す
   */
  async ungroupAnnotations(
    file: ContainerElementFile,
    groupId: AnnotationGroupID,
  ): Promise<ApiResponse<void>> {
    const groupRes = await annotationGroupService.getAnnotationGroup(file, groupId);
    if (!groupRes.ok) return toApiResponse(groupRes, 'DOC_ANNOT_UNGROUP_FAILED');
    const removedGroup = groupRes.value;

    const res = await annotationGroupService.ungroupAnnotations(file, groupId);
    if (!res.ok) return toApiResponse(res, 'DOC_ANNOT_UNGROUP_FAILED');

    const involvingRes = await relationalService.getRelationalsInvolvingFile(file);
    const capturedRelationals = involvingRes.ok
      ? involvingRes.value
          .map((r) => r.relational)
          .filter((r) => r.srcID === groupId || r.targetID === groupId)
      : [];

    const cleanupRes = await relationalService.removeRelationalsForAnnotation(groupId);
    if (!cleanupRes.ok) {
      await annotationGroupService.restoreGroup(file, removedGroup);
      await Promise.all(capturedRelationals.map((r) => relationalService.registRelational(r)));
      return toApiResponse(cleanupRes, 'RELATIONAL_REMOVE_FAILED');
    }

    return toApiResponse(res, 'DOC_ANNOT_UNGROUP_FAILED');
  }

  /**
   * グループ全体を代表する値の算出方法を設定・変更する
   */
  async updateGroupValueAggregation(
    file: ContainerElementFile,
    groupId: AnnotationGroupID,
    aggregation: GroupValueAggregation | undefined,
  ): Promise<ApiResponse<AnnotationGroup>> {
    const res = await annotationGroupService.updateGroupValueAggregation(
      file,
      groupId,
      aggregation,
    );
    return toApiResponse(res, 'DOC_ANNOT_GROUP_VALUE_SAVE_FAILED');
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
   * 指定した端点（アノテーションまたはグループ）に紐づく関係性（src側）をすべて削除する
   */
  async removeRelationals(sourceID: RelationalEndpointID): Promise<ApiResponse<void>> {
    const res = await relationalService.removeRelationals(sourceID);
    return toApiResponse(res, 'RELATIONAL_REMOVE_FAILED');
  }

  /**
   * srcID・targetIDが一致する1本の関係性のみを削除する（リンクの変更・個別削除用）
   */
  async removeRelationalEdge(
    srcID: RelationalEndpointID,
    targetID: RelationalEndpointID,
  ): Promise<ApiResponse<void>> {
    const res = await relationalService.removeRelationalEdge(srcID, targetID);
    return toApiResponse(res, 'RELATIONAL_REMOVE_FAILED');
  }

  /**
   * 端点（アノテーションまたはグループ）のIDから、それが属するファイル情報を解決する
   */
  async resolveAnnotationFile(
    id: RelationalEndpointID,
  ): Promise<ApiResponse<ContainerElementFile>> {
    const res = await relationalService.resolveAnnotationFile(id);
    return toApiResponse(res, 'RELATIONAL_RESOLVE_FAILED');
  }

  /**
   * 端点（アノテーションまたはグループ）のIDから、それが存在するページ番号を解決する
   */
  async getAnnotationPageNumber(id: RelationalEndpointID): Promise<ApiResponse<number>> {
    const res = await relationalService.getAnnotationPageNumber(id);
    return toApiResponse(res, 'RELATIONAL_RESOLVE_FAILED');
  }

  /**
   * コンテナ単位の関係性緩和ルール（`.kumihimo/settings.json`）を取得する
   *
   * 同一コンテナを開いた誰にとっても検証結果が同じになるよう、ブラウザ単位のアプリ設定
   * ではなくコンテナルートに保存されている設定を参照する
   */
  async getContainerRelaxationSettings(cID: ContainerID): Promise<ApiResponse<RelaxationOptions>> {
    const res = await containerConfigService.getContainerSettingsFile(cID);
    if (!res.ok) return toApiResponse(res, 'RELATIONAL_RELAXATION_GET_FAILED');
    return toApiResponse(Success(res.value.relationalRelaxation));
  }

  /**
   * コンテナ単位の関係性緩和ルールを更新する
   *
   * 更新後は、検証時に参照される緩和ルールのキャッシュ（`relationalService`側）を破棄し、
   * 古い設定が使われ続けないようにする
   */
  async saveContainerRelaxationSettings(
    cID: ContainerID,
    relaxation: RelaxationOptions,
  ): Promise<ApiResponse<void>> {
    const res = await containerConfigService.saveContainerSettingsFile(cID, {
      relationalRelaxation: relaxation,
    });
    if (res.ok) relationalService.invalidateContainerRelaxationCache(cID);
    return toApiResponse(res, 'RELATIONAL_RELAXATION_SAVE_FAILED');
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

/**
 * `groupAnnotations`の関係性クリーンアップが途中で失敗した際、新規グループの取り消し・
 * 解散前グループの復元・関係性の再登録をベストエフォートで行い、操作前の状態へ戻す
 *
 * 個々の復元処理自体が失敗しても（コンテナオブジェクトのロールバック等、他箇所の既存の補償処理と
 * 同様に）これ以上できることはないため、戻り値は無視して他の復元処理を続行する
 */
async function rollbackGroupAnnotations(
  file: ContainerElementFile,
  createdGroup: AnnotationGroup,
  dissolvedGroups: AnnotationGroup[],
  cleaned: { cleanedGroupIds: AnnotationGroupID[]; capturedRelationals: Relational[] },
): Promise<void> {
  await annotationGroupService.ungroupAnnotations(file, createdGroup.id);
  await Promise.all(dissolvedGroups.map((g) => annotationGroupService.restoreGroup(file, g)));

  const cleanedSet = new Set<string>(cleaned.cleanedGroupIds);
  const toRestore = cleaned.capturedRelationals.filter(
    (r) => cleanedSet.has(r.srcID) || cleanedSet.has(r.targetID),
  );
  await Promise.all(toRestore.map((r) => relationalService.registRelational(r)));
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
