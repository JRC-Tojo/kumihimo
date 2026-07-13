import z from 'zod';

// TODO: 本当は設定に起因する要素のため、importはしたくない & docPage.tsはフロントエンドのみの情報が多いため削除したい
import { AnnotationTool } from './docPage';
import { ContainerSkel, RecentContainerEntry } from './container';
import {
  RelationalVerificationStyle,
  DEFAULT_RELATIONAL_VERIFICATION_STYLE,
} from './relational/style';
import { localeKeys } from 'src/i18n';

/**
 * アプリケーション設定スキーマ
 */
export const AppSettings = z.object({
  locale: z.enum(localeKeys).default('ja-JP'),
  darkMode: z.boolean().default(false),
  viewMode: z.enum(['rich', 'list1', 'list2']).default('rich'),
  sortBy: z.enum(['name', 'updatedAt', 'genre']).default('updatedAt'),
  initialized: z.boolean().default(false),
  containerSkels: ContainerSkel.array().optional().default([]),
  // 最近読み込んだコンテナ一覧（アンロードしても保持し、再読込の選択肢として使う）
  recentContainers: RecentContainerEntry.array().optional().default([]),
  tools: z
    .object({
      annotations: AnnotationTool.array(),
    })
    .default({ annotations: [] }),
  // 関係性検証結果（OK/NG）をアノテーションに反映する際のスタイル
  relationalVerificationStyle: RelationalVerificationStyle.default(
    DEFAULT_RELATIONAL_VERIFICATION_STYLE,
  ),
});

export type AppSettings = z.infer<typeof AppSettings>;
