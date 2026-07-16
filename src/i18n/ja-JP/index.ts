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
    searchPlaceholder: '設定を検索',
    noResults: '設定が見つかりませんでした',
    darkMode: 'ダークモード',
    darkModeDesc: 'アプリ全体の配色をダークモードに切り替えます。',
    viewMode: '表示モード',
    viewModeDesc: 'コンテナ一覧の表示形式を切り替えます。',
    sortBy: 'ソート',
    sortByDesc: 'コンテナ一覧の並び順を指定します。',
    language: '言語',
    languageDesc: 'アプリの表示言語を切り替えます。',
    save: '設定を保存',
    sections: {
      general: '一般',
      display: '表示',
      data: 'データ',
    },
    relationalVerification: {
      title: '関係性検証スタイル',
      ok: 'OK（検証成功）',
      okDesc: '関係性の検証がOKだった場合に、アノテーションへ適用する線・塗りのスタイルです。',
      ng: 'NG（検証失敗）',
      ngDesc: '関係性の検証がNGだった場合に、アノテーションへ適用する線・塗りのスタイルです。',
      strokeColor: '線の色',
      fillColor: '塗りの色',
      strokeWidth: '線の太さ',
      fillOpacity: '塗りの不透明度',
    },
    sampleData: {
      title: 'サンプルデータ',
      create: 'サンプル文書を作成',
      createDesc: '動作確認用のサンプル文書をまとめて作成します。',
      clear: 'すべてのデータを削除',
      clearDesc: '保存されているすべてのデータを削除します（元に戻せません）。',
    },
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
      arrow: '矢印',
      polyline: '折れ線',
      polygon: 'ポリゴン',
      text: 'テキスト',
      relationalToggle: '関係性登録モード',
      annotationToggle: 'アノテーションの表示切替',
      handMode: 'ハンドモード',
      selectMode: '選択モード',
      save: {
        title: '保存',
        overwrite: '上書き保存',
        saveAs: '名前を付けて保存',
        auto: '自動保存',
        success: '保存しました',
        failed: '保存に失敗しました',
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
      conflictTitle: 'ファイルがアプリ外で更新されています',
      conflictMessage:
        'このファイルは、アノテーション情報を記録した時点から内容が変更されています。最新の内容を反映しますか？（アノテーションの位置がずれる場合があります）',
      conflictTrackFailed:
        'アノテーション位置の再追跡に失敗しました。既存のアノテーション情報のまま開きます（現在の内容と一致していない可能性があります）。',
    },
    peek: {
      title: '関係性の一覧',
      linkedAnnotations: '関連アノテーション',
      previewUnavailable: 'プレビューを取得できませんでした',
      openDocument: '文書を開く',
      rowHint: 'クリックでプレビュー、ダブルクリックで新規タブを開きます',
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
        noRelations: 'リンクはありません',
        selfValue: '自身の値',
        otherValue: '相手の値',
        verifying: '検証中...',
        emptyValue: '(空)',
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
    addContainer: 'コンテナを追加',
    newFile: '新規ファイル',
    newFolder: '新規フォルダ',
    rename: '名前を変更',
    cut: '切り取り',
    paste: '貼り付け',
    delete: '削除',
    deleteConfirmFile: '「{name}」を削除しますか？',
    deleteConfirmFolder: '「{name}」を配下のファイルも含めて削除しますか？',
    closeContainer: 'コンテナを閉じる',
    closeContainerConfirm: '「{name}」を閉じますか？（実データは削除されません）',
    permissionNeeded: 'このフォルダへのアクセス許可が必要です',
    reconnect: '再接続',
    changesDetected: '変更が検出されました。クリックして更新',
    changesConflict:
      '外部で更新されたファイル（{names}）に未保存の変更があります。保存してから更新ボタンを押してください',
    unsavedChanges: '未保存の変更があります',
    emptyContainer: 'ファイルがありません',
    unsupportedFile: 'このファイルは表示できません',
    localFolder: 'ローカルフォルダ',
    localFolderDesc: 'PC上の実フォルダを選択してコンテナとして追加します。',
    selectFolder: 'フォルダを選択',
    workspaceFile: 'ワークスペースファイル',
    workspaceFileDesc:
      'VSCodeの.code-workspaceファイルを読み込み、含まれる複数のフォルダを一括でコンテナとして追加します。',
    selectWorkspaceFile: 'ワークスペースファイルを選択',
    workspaceAbsolutePathSkipped: '絶対パスのため読み込みをスキップしました',
    workspaceFolderNotFound: 'フォルダが見つからないため読み込みをスキップしました',
    recentContainers: '最近読み込んだコンテナ',
    notSupportedContainerType: '非対応のコンテナ種別です',
    selectLocationFirst: '先にファイルまたはフォルダを選択してください',
    copyRelativePath: '相対パスのコピー',
    copyAbsolutePath: '絶対パスのコピー',
    pathCopied: 'パスをクリップボードにコピーしました',
    unsavedTabConfirm: '「{name}」に未保存の変更があります。保存しますか？',
    unsavedContainerTabsConfirm:
      '「{name}」内の開いているファイルに未保存の変更があります。保存しますか？',
    saveAndClose: '保存して閉じる',
    discardAndClose: '保存せず閉じる',
    invalidFileName: '無効なファイル名です',
    invalidFileNameEmpty: 'ファイル名を入力してください',
    duplicateName: '同じ名前のファイルまたはフォルダが既に存在します',
    uploadFailed: '一部のファイル・フォルダのアップロードに失敗しました（{names}）',
  },
};
