import { getSettings, initializeSettings, saveSettings } from 'src/settings/main';
import { toApiResponse, type ApiResponse } from 'src/models/error/api';
import { Failure, Success } from 'src/models/error/result';
import * as containerService from 'src/services/container/main';
import * as relationalService from 'src/services/document/relational';
import * as pdfRepo from 'src/repositories/document/pdf';
import * as documentService from 'src/services/document/config';
import type {
  Container,
  ContainerElement,
  ContainerElementFile,
  ContainerID,
  ContainerSkel,
  ContainerType,
} from 'src/models/container';
import type { AppSettings } from 'src/models/settings';
import type { DocumentSource } from 'src/models/document/common';
import type { AnnotationID, AnnotationStyle } from 'src/models/document/pdf';
import type { Relational } from 'src/models/relational/common';
import { type RelationalResponce } from 'src/models/relational/common';
import type { DocumentConfigFile } from 'src/models/relational/fileSchema';
import type { AnnotationInfo } from 'src/models/relational/fileSchema';
import * as annotationService from 'src/services/document/annotation';
import type { Observable } from 'dexie';

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
   */
  async loadContainer(id: ContainerID): Promise<ApiResponse<Container>> {
    const loadedContainers = await containerService.loadContainer(id);
    if (loadedContainers.ok) {
      const initRelation = await relationalService.loadRelationals(id);
      if (!initRelation.ok) return toApiResponse(initRelation, 'CONTAINER_LOAD_FAILED');
    }
    return toApiResponse(loadedContainers, 'CONTAINER_LOAD_FAILED');
  }

  // ============ 文書操作 ============

  /**
   * 全コンテナ要素を取得
   */
  async getAllElements(): Promise<ApiResponse<ContainerElement[]>> {
    // 保存済みのコンテナ情報を取得
    const allContainers = await containerService.getAllContainers();
    if (!allContainers.ok) return toApiResponse(allContainers, 'CONTAINER_LOAD_FAILED');

    // TODO: 将来的には「コンテナ取得」と「コンテナ読み込み」は分離するが、現状はフロントエンドに媚びた実装
    // コンテナの要素をすべて読み込む
    const allContainersWithElements = await Promise.all(
      allContainers.value.map((c) => containerService.loadContainer(c.id)),
    );
    const errContainer = allContainersWithElements.find((res) => !res.ok);
    if (errContainer !== void 0) return toApiResponse(errContainer, 'DOC_LIST_FAILED');

    // Resultをunwrapしてファイル要素を抽出
    const containers = allContainersWithElements.filter((res) => res.ok).map((res) => res.value);
    const elements = containers
      .flatMap((c) => Object.values(c.elements ?? {}))
      .filter((e) => e !== void 0);

    return toApiResponse(Success(elements));
  }

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
    return toApiResponse(deleteRes, 'DOC_DELETE_FAILED');
  }

  /**
   * 文書のメタ情報（ハッシュ値、アノテーション等）を取得
   */
  async loadDocumentConfig(file: ContainerElementFile): Promise<ApiResponse<DocumentConfigFile>> {
    const fileConfig = await documentService.loadConfig(file);
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
   * パスのリネーム
   */
  // async renamePath(
  //   elem: ContainerElement,
  //   newPath: string,
  // ): Promise<ApiResponse<ContainerElement>> {
  //   // 新規パスに更新したElementを返す
  //   // TODO: 実データのファイルパスの更新と関係性データに記載のパス情報を両方更新する
  //   const renameRes = await containerService.renamePath(elem, newPath);
  //   if (!renameRes.ok) return toApiResponse(renameRes, 'PATH_RENAME_FAILED');
  //   const relRes = await relationalService.renamePath(elem, newPath);
  //   if (!relRes.ok) return toApiResponse(relRes, 'PATH_RENAME_FAILED');
  //   return toApiResponse(renameRes, 'PATH_RENAME_FAILED');
  // }

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
   */
  async removeAnnotation(annotID: AnnotationID): Promise<ApiResponse<void>> {
    const res = await annotationService.removeAnnotationInfo(annotID);
    return toApiResponse(res, 'DOC_ANNOT_REMOVE_FAILED');
  }

  // ============ 関係性操作 ============

  /**
   * 当該ファイルに紐づく関係性一覧を取得する
   */
  async getRelationalsInFile(file: ContainerElementFile): Promise<ApiResponse<Relational[]>> {
    const fileConfig = await relationalService.getRelationals(file);
    return toApiResponse(fileConfig, 'RELATIONAL_GET_FAILED');
  }

  /**
   * 指定した関係性を検証する
   */
  async checkRelationals(relational: Relational): Promise<ApiResponse<RelationalResponce>> {
    const res = await relationalService.checkRelational(relational);
    return toApiResponse(res, 'RELATIONAL_CHECK_FAILED');
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
   * 関係性を削除する
   */
  async removeRelationals(sourceAnnotID: AnnotationID): Promise<ApiResponse<void>> {
    const res = await relationalService.removeRelationals(sourceAnnotID);
    return toApiResponse(res, 'RELATIONAL_REMOVE_FAILED');
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
