export default {
  // ページタイトル
  title: {
    app: '関係性文書アプリ',
    documents: 'ドキュメント一覧',
    viewer: 'ドキュメント表示',
    settings: '設定',
  },

  // 共通ボタン
  button: {
    add: '追加',
    save: '保存',
    delete: '削除',
    cancel: 'キャンセル',
    edit: '編集',
    close: '閉じる',
    upload: 'アップロード',
    refresh: '更新',
    back: '戻る',
    next: '次へ',
    previous: '前へ',
  },

  // ドキュメント関連
  document: {
    title: 'ドキュメント',
    name: 'ドキュメント名',
    uploadedAt: 'アップロード日時',
    updatedAt: '最終更新日時',
    pages: 'ページ',
    fileSize: 'ファイルサイズ',
    genre: 'ジャンル',
    description: '説明',
    tags: 'タグ',
    noDocuments: 'ドキュメントがありません',
    createNew: '新規ドキュメント',
    deleteConfirm: 'このドキュメントを削除しますか？',
  },

  // ビューモード
  viewMode: {
    rich: 'リッチ表示',
    list1: 'リスト表示（広）',
    list2: 'リスト表示（狭）',
  },

  // ソート
  sort: {
    byName: 'ドキュメント名でソート',
    byUpdatedAt: '更新日時でソート',
    byGenre: 'ジャンルでソート',
  },

  // メッセージ
  message: {
    success: '成功しました',
    error: 'エラーが発生しました',
    loading: '読み込み中...',
    saving: '保存中...',
    creatingDocument: 'ドキュメントを作成中...',
    deletingDocument: 'ドキュメントを削除中...',
    updatingDocument: 'ドキュメントを更新中...',
  },

  // PDF ビューア
  pdf: {
    zoomIn: 'ズームイン',
    zoomOut: 'ズームアウト',
    pageNumber: 'ページ',
    of: '/',
    fitPage: 'ページに合わせる',
    fitWidth: '幅に合わせる',
    singlePage: '1ページ表示',
    twoPage: '2ページ表示',
  },

  // 検索
  search: {
    placeholder: '検索...',
    noResults: '結果がありません',
  },

  // 設定
  settings: {
    title: '設定',
    darkMode: 'ダークモード',
    viewMode: '表示モード',
    sortBy: 'ソート',
    language: '言語',
    save: '設定を保存',
  },

  // エラーメッセージ
  error: {
    documentNotFound: 'ドキュメントが見つかりません',
    failedToLoadDocument: 'ドキュメントの読み込みに失敗しました',
    failedToCreateDocument: 'ドキュメント作成に失敗しました',
    failedToDeleteDocument: 'ドキュメント削除に失敗しました',
    failedToUpdateDocument: 'ドキュメント更新に失敗しました',
  },

  // PDF エディタ関連
  pdfEditor: {
    tools: {
      line: '直線',
      box: '四角形',
      circle: '円',
      relationalToggle: '関係性登録モード',
      annotationToggle: 'アノテーションの表示切替',
      handMode: 'ハンドモード',
      selectMode: '選択モード',
      save: {
        title: '保存',
        overwrite: '上書き保存',
        saveAs: '名前を付けて保存',
        auto: '自動保存',
      },
      print: '印刷',
      download: 'ダウンロード',
      viewStyle: {
        title: 'タイルモード',
        noGrid: '分割なし',
        split: '左右2分割',
        grid: '上下左右4分割',
      },
      relational: {
        equal: '等しい',
        link: 'リンク',
        off: 'オフ',
        cancel: 'キャンセル',
        waitingMessage:
          '対になるアノテーションを待機しています（{mode}モード）。描画または選択するとリンクされます。',
        registerSuccess: '関係性を登録しました。',
        registerFailed: '関係性の登録に失敗しました。',
      },
    },
    document: {
      noDocumentSelected: '表示する文書を選択してください',
      loading: '読み込み中 ...',
    },
    leftDrawer: {
      title: 'サムネイル / ブックマーク',
      thumbnail: {
        title: 'サムネイル',
      },
      bookmark: {
        title: 'ブックマーク',
        noBookmarks: 'ブックマークなし',
        page: 'ページ',
      },
    },
    rightDrawer: {
      title: 'プロパティ',
      annotation: {
        title: 'プロパティ',
        type: '種別',
        color: '色',
        stroke: '線の幅',
        opacity: '透明度',
        relations: 'リンク',
        addRelation: 'リンクを追加',
        delete: '削除',
        notSelected: 'アノテーションを選択してください',
      },
    },
    footer: {
      viewMode: {
        title: '表示モード',
        single: '単一ページ',
        c_single: '連続表示',
        spread: '見開き',
        c_spread: '見開き連続表示',
      },
    },
  },

  explorer: {
    demo: 'デモデータを作成',
  },
};
