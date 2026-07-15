import type { InjectionKey, Ref } from 'vue';
import type { ContainerElement, ContainerID } from 'src/models/container';

/**
 * `ExpContainer`が提供し、配下の`ExpFolder`/`ExpFile`がinjectで参照するコンテキスト
 *
 * 再帰的なツリー構造の各階層でprops経由のバケツリレーを避けるために使う
 */
export interface ExplorerContext {
  containerId: ContainerID;
  /** コンテナ内の全要素（フラットなパス→要素のマップ）。ツリー描画時に直下の子だけ抽出して使う */
  elements: Ref<Record<string, ContainerElement>>;
  /** ファイル操作後にコンテナを再読込するためのコールバック */
  reload: () => void | Promise<void>;
  /** コンテナルートのパス（絶対パスのコピー機能で`containerPath/相対パス`を組み立てるために使う） */
  containerPath: string;
}

export const ExplorerContextKey: InjectionKey<ExplorerContext> = Symbol('explorerContext');
