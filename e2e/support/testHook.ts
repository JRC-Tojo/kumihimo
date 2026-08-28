import type { Page } from '@playwright/test';

/**
 * `src/boot/testHook.ts`（開発ビルド専用）が`window`へ生やすフックの型。
 * `BackendApi`本体の型は`src/apis/backendApi.ts`にあるが、e2e配下は独自のtsconfig/実行系
 * （PlaywrightのNodeランナー）で動くため、Viteの`src/*`パスエイリアスに依存せず、
 * ここではE2Eのシード・検証で使う範囲だけを最小限に型付けする
 */
export interface ApiResult<T> {
  ok: boolean;
  data?: T;
  error?: unknown;
}

export interface TestContainerSkel {
  id: string;
  name: string;
  type: 'box' | 'cache' | 'local';
  containerPath: string;
}

export interface TestContainerFile {
  containerID: string;
  path: string;
  type: 'File';
  [key: string]: unknown;
}

export interface TestAnnotationStyle {
  id: string;
  type: string;
  pageNumber: number;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  [key: string]: unknown;
}

export interface TestAnnotationInfo {
  style: TestAnnotationStyle;
  context: { text?: string | undefined };
}

export interface TestRelational {
  srcID: string;
  targetID: string;
  rule: { type: 'equal' | 'link' };
}

export interface TestAnnotationGroup {
  id: string;
  memberIds: string[];
  valueAggregation?: { type: 'sum' } | { type: 'formula'; expression: string } | undefined;
  [key: string]: unknown;
}

export interface KumihimoTestApi {
  createContainer(
    type: 'box' | 'cache' | 'local',
    name: string,
    path: string,
  ): Promise<ApiResult<TestContainerSkel>>;
  loadContainer(id: string): Promise<ApiResult<unknown>>;
  saveFile(
    containerId: string,
    filePath: string,
    src64: string,
  ): Promise<ApiResult<TestContainerFile>>;
  registerAnnotationStyle(
    file: TestContainerFile,
    style: TestAnnotationStyle,
  ): Promise<ApiResult<unknown>>;
  removeAnnotation(annotID: string): Promise<ApiResult<void>>;
  getAnnotationsByFile(file: TestContainerFile): Promise<ApiResult<TestAnnotationInfo[]>>;
  registRelationals(rel: TestRelational): Promise<ApiResult<unknown>>;
  getRelationalsInFile(file: TestContainerFile): Promise<ApiResult<TestRelational[]>>;
  listAnnotationGroups(file: TestContainerFile): Promise<ApiResult<TestAnnotationGroup[]>>;
  getAnnotationGroup(
    file: TestContainerFile,
    groupId: string,
  ): Promise<ApiResult<TestAnnotationGroup>>;
  groupAnnotations(
    file: TestContainerFile,
    annotationIds: string[],
  ): Promise<ApiResult<{ group: TestAnnotationGroup; dissolvedGroups: TestAnnotationGroup[] }>>;
  ungroupAnnotations(file: TestContainerFile, groupId: string): Promise<ApiResult<void>>;
}

export interface KumihimoTestRelationalStore {
  statusForAnnotation(annotId: string): 'ok' | 'ng' | 'pending' | undefined;
}

export interface KumihimoTestGroupStore {
  /** 指定ID群がフロントエンドのgroupStoreキャッシュ上で既存グループとちょうど一致する場合、そのグループIDを返す */
  matchingGroupId(file: TestContainerFile, ids: string[]): string | undefined;
}

export interface KumihimoTestHook {
  api: KumihimoTestApi;
  stores: {
    relational: KumihimoTestRelationalStore;
    group: KumihimoTestGroupStore;
  };
}

declare global {
  interface Window {
    __kumihimoTest?: KumihimoTestHook;
  }
}

/** テスト用フック（アプリの初期化boot完了）が`window`に登録されるまで待つ */
export async function waitForTestHook(page: Page): Promise<void> {
  await page.waitForFunction(() => window.__kumihimoTest !== undefined);
}
