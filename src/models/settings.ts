import z from 'zod';

// TODO: 本当は設定に起因する要素のため、importはしたくない & docPage.tsはフロントエンドのみの情報が多いため削除したい
import { AnnotationTool } from './docPage';
import { ContainerSkel, RecentContainerEntry } from './container';
import {
  RelationalVerificationStyle,
  DEFAULT_RELATIONAL_VERIFICATION_STYLE,
} from './relational/style';
import { localeKeys } from 'src/i18n';
import { ColorCode } from './document/pdf';

/**
 * アプリケーション設定スキーマ
 */
export const AppSettings = z.object({
  locale: z.enum(localeKeys).default('ja-JP'),
  darkMode: z.boolean().default(false),
  // アノテーションのauthorに使うユーザー名（未登録の場合はundefined）
  userName: z.string().optional(),
  // プラグイン申請（ストアリポジトリへのPR作成）に使うGitHub個人アクセストークン。
  // ローカル（IndexedDB）にのみ保存し、GitHub API以外への送信は行わない。
  // バックエンドを持たない構成上の制約でIndexedDBに平文保存する以上のことはできないが、
  // XSS等での漏洩時の被害を抑えるため、設定画面ではリポジトリ・権限を絞ったfine-grained PAT
  // （対象はストアリポジトリのみ、contents/pull-requests程度の権限）の利用を案内している
  githubToken: z.string().optional(),
  // githubTokenから解決したGitHubユーザー名（申請時のowner記録・キャッシュ用）
  githubLogin: z.string().optional(),
  viewMode: z.enum(['rich', 'list1', 'list2']).default('rich'),
  sortBy: z.enum(['name', 'updatedAt', 'genre']).default('updatedAt'),
  initialized: z.boolean().default(false),
  containerSkels: ContainerSkel.array().optional().default([]),
  // 最近読み込んだコンテナ一覧（アンロードしても保持し、再読込の選択肢として使う）
  recentContainers: RecentContainerEntry.array().optional().default([]),
  tools: z
    .object({
      annotations: AnnotationTool.array(),
      // スタイルパネルの色スウォッチで直近に使用した色（新しい順）。上限はrecentColorsLimit
      recentColors: ColorCode.array().optional().default([]),
      // 直近使用色として保持する件数（スタイルパネル・設定画面から変更可能）
      recentColorsLimit: z.number().int().positive().optional().default(5),
    })
    .default({ annotations: [], recentColors: [], recentColorsLimit: 5 }),
  // 関係性検証結果（OK/NG）をアノテーションに反映する際のスタイル
  relationalVerificationStyle: RelationalVerificationStyle.default(
    DEFAULT_RELATIONAL_VERIFICATION_STYLE,
  ),
  // アノテーションの自動保存トグルのオン・オフ
  autoSaveAnnotations: z.boolean().default(false),
  // 起動時ロック画面の解除済みフラグ（端末＝ブラウザプロファイル単位で保持する）
  unlocked: z.boolean().default(false),
});

export type AppSettings = z.infer<typeof AppSettings>;
