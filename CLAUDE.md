# CLAUDE.md

## プロジェクト概要

RelationalDocuments（`rd`）：膨大なPDF文書にマークをつけ、文書をまたいだ注釈同士の「関連性」を追跡するための Quasar/Vue 製 PWA。ユーザーはPDFのテキスト上にアノテーション（ペン・直線ペン・範囲形式、リッチなスタイル指定）を描画し、システムはアノテーション同士を紐づけることで、文書間の整合性（値の一致、条件の充足、OCR結果の照合など）を自動でチェックできるようにする。

## コマンド

- 開発サーバー（フロントエンド＋統合バックエンド、PWAモード）: `bun run dev`
- ビルド（PWAモード）: `bun run build`
- Lint: `bun run lint`（`./src*/**/*.{ts,js,cjs,mjs,vue}` に対して ESLint を実行）
- フォーマット: `bun run format`（Prettier、直接書き込み）
- テスト（全体）: `bun test --isolate`（`bun run test`と同じ）。`mock.module`はプロセス全体で共有され、テストファイルをまたいで残り続けるため、`--isolate`無しで実行すると読み込み順序次第で他ファイルのモックが漏れて失敗する。単に `bun test` を実行しないこと
- テスト（単一ファイル）: `bun test src/repositories/container/__test__/local.test.ts`
- 依存関係の追加: `bun add <pkg>` / 開発用依存関係: `bun add -D <pkg>`

テストは対象コードと同じ場所の `__test__/` サブフォルダに配置する（例: `src/utils/binary/__test__/base64.test.ts`）。

## アーキテクチャ

本プロジェクトは **クライアント/サーバー分離を内部でシミュレートするフロントエンドのみの Quasar/Vue アプリ** である。独立したバックエンドプロセスは存在しない。すべてブラウザ／PWA内で完結するが、将来の分離を見据えてクライアント＋サーバーであるかのようにレイヤー分割されている。

### レイヤー構成（`src/` 内で完結するバックエンド的構造）

```
Vueコンポーネント／ページ
        │  useBackendApi()
        ▼
src/apis/backendApi.ts  ← 単一のファサードクラス（BackendApi）。レイヤーをまたぐ呼び出しは必ずここを経由する
        │
        ▼
src/services/**         ← ビジネスロジック
        │
        ▼
src/repositories/**     ← ストレージアダプタ
        │
        ▼
外部ストレージ（ローカルフォルダ、Boxクラウド、IndexedDB/Dexieキャッシュ）
```

- **Vueコンポーネントからサービスやリポジトリを直接呼び出さないこと。** 必ず `const api = useBackendApi()`（`src/apis/backendApi.ts`）を経由する。ここが将来的に実際のHTTPバックエンドへ差し替える際の境界となる。
- **コンテナ（Container）**：ストレージの最上位単位（`local` フォルダ、`box` クラウドフォルダ、インメモリの `cache`）。`src/services/container/main.ts` がコンテナ種別ごとの処理を `src/repositories/container/` 内の対応するリポジトリへ振り分ける。新しいストレージ種別を追加する場合は、`ContainerType`（`src/models/container.ts`）にケースを追加し、`src/repositories/container/<type>.ts` に対応関数を実装したうえで、コンテナサービス内のすべての `switchContainerProcess` 呼び出し箇所に組み込む必要がある。
- **文書（Document）**：コンテナ内の `ContainerElementFile`。文書本体へのアクセスは `src/repositories/document/pdf.ts` / `text.ts` を経由する。文書ごとのメタ情報（アノテーション、関係性設定、ハッシュ値）はサイドカーの「文書設定ファイル」として `src/services/document/config.ts` が扱う。
- **アノテーション（Annotation）**：文書上に描画されるアノテーション図形（`src/services/document/annotation.ts`。キャッシュを除く実データではファイルと同じ名前の`.rdcfg`ファイルに記録される。
- **関係性（Relational）**：2つのアノテーション間（文書・コンテナをまたぐ場合もある）のリンクで、整合性チェックに使う。キャッシュを除く実データではコンテナルートに保存される`.rd`フォルダ内の`relational.json`に記録される。
- **設定（Settings）**：`src/settings/main.ts` と `src/models/settings.ts`。IndexedDBに永続化され、読み込み済みコンテナ一覧、DB接続情報、初期化フラグなどを管理する。

### エラーハンドリングの規約

レイヤー境界をまたいで例外を投げないこと。次の2つのラッパー型を組み合わせて使う。

- `Result<T, E>`（`src/models/error/result.ts`）：リポジトリ・サービス層内部で使用する。`Success(...)` / `Failure(...)` で生成し、`Failure(toError(e))` で unknown な try / catch 内容を正規化する。
- `ApiResponse<T>`（`src/models/error/api.ts`）：`BackendApi` の境界で `Result` を `toApiResponse(result, 'SOME_ERROR_CODE')` により変換したもの。フロントエンドは生の `Error` ではなく型付きのエラーコードを受け取る。

`BackendApi` に新しいメソッドを追加する際は、既存パターンに従い「サービスを呼び出す→`return toApiResponse(res, 'ERROR_CODE')`」という形にすること。

### スキーマと型

共有するデータ形状はすべて **Zod** で `src/models/` 配下に定義し、関心事ごとにファイルを分ける。ブランド付きUUID型（例: `ContainerID = z.uuidv4().brand('ContainerID')`）を用い、単なる文字列で異なるドメインのIDが混在しないようにしている。新しいID型を追加する際もこのパターンに従うこと。型はスキーマから推論する（`z.infer<typeof X>`）ものとし、個別に手書きしない。共有しない関数ローカルの interface はZod管理の対象外でよい。

### フロントエンドの規約

- `.vue` ファイルに表示用テキストを直書きしないこと。表示テキストはすべて `vue-i18n`（`src/i18n/{en-US,ja-JP}/index.ts`）を通す。
- 大きなページファイルよりも、再利用可能な小さなコンポーネント（`src/components/**`）への分割を優先する。`src/pages/**` は基本的にレイアウトの組み立てとコンポーネントの呼び出しに専念する。
- 状態管理は Pinia（`src/stores/*.ts`）を使用
- PDFの描画・アノテーション描画には `pdfjs-dist` と `konva`/`vue-konva` を使用（`src/components/Viewer/`）。
- パスを扱う処理は`utils/binary/path`のPathオブジェクトを活用して処理すること。

## 境界（Boundaries）

- `.env*` ファイルを変更・コミットしないこと。
- タスクにまだ存在しない外部データが必要な場合は、モックを作成すること。外部データが存在しないにもかかわらず勝手に存在するかのように扱わないこと。
- コードのコメントは日本語で記述する。各関数の冒頭には目的を説明するdocstring形式のコメントを入れ、コード中には処理の流れが追える程度のコメントを入れる。
- ファイル名は `sampleProgramFile.ts` 形式（キャメルケース）とする。
