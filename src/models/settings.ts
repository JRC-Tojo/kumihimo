import z from 'zod';

// TODO: 本当は設定に起因する要素のため、importはしたくない & docPage.tsはフロントエンドのみの情報が多いため削除したい
import { AnnotationTool } from './docPage';
import { ContainerSkel } from './container';
import {
  RelationalVerificationStyle,
  DEFAULT_RELATIONAL_VERIFICATION_STYLE,
} from './relational/style';

/**
 * アプリケーション設定スキーマ
 */
export const AppSettings = z.object({
  darkMode: z.boolean().default(false),
  viewMode: z.enum(['rich', 'list1', 'list2']).default('rich'),
  sortBy: z.enum(['name', 'updatedAt', 'genre']).default('updatedAt'),
  initialized: z.boolean().default(false),
  containerSkels: ContainerSkel.array().optional().default([]),
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
