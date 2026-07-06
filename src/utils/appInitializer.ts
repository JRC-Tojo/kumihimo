import { v4 as uuidv4 } from 'uuid';
import { useBackendApi } from '../apis/backendApi';
import { DocumentSource } from 'src/models/document/common';
import { AnnotationID, ColorCode, type AnnotationStyle } from 'src/models/document/pdf';
import { arrayBufferToBase64 } from './binary/base64';

/**
 * アプリケーション初期化用ユーティリティ
 */
export async function initializeApp() {
  const api = useBackendApi();

  // アプリの初期化
  const initRes = await api.initialize();
  if (!initRes.ok) {
    // TODO: 本当は適切なエラーハンドリングをユーザーに返すべき（今後の実装）
    console.error('Failed to initialize app');
    console.log(initRes);
    return;
  }
}

/**
 * デモ用のサンプルデータを作成
 */
export async function createDemoData() {
  const api = useBackendApi();

  const sampleDocs = [
    { title: 'システム要件定義書' },
    { title: 'API仕様書 v2.1' },
    { title: 'セキュリティ対応ガイドライン' },
    { title: 'データベース設計書' },
    { title: '本番環境運用マニュアル' },
    { title: 'テスト計画書' },
  ];

  // デモデータ用のコンテナを作成
  const targetContainer = await api.createContainer('cache', 'DEMO CONTAINER', '.');
  if (!targetContainer.ok) {
    console.error('Failed to create demo container');
    console.log(targetContainer);
    return;
  }

  // コンテナ内部を読み込み
  const loadedContainer = await api.loadContainer(targetContainer.data.id);
  if (!loadedContainer.ok) return;

  // タイトルは違うが内容は同じドキュメントを生成するため、読み込みデータは１つだけ
  const targetURL = new URL('../assets/sampleDocs/sampleArticle.pdf', import.meta.url).href;
  const bufferedSrc = await fetch(targetURL).then((res) => res.arrayBuffer());
  const base64Src = await arrayBufferToBase64(bufferedSrc);
  if (!base64Src.ok) {
    console.error(base64Src.error);
    return;
  }
  const docSrc = DocumentSource.parse(base64Src.value);

  for (const doc of sampleDocs) {
    const genedAnnots = generateRandomAnnots();
    const packedSrc = await api.packAnnotationsInSource(docSrc, genedAnnots);
    if (!packedSrc.ok) {
      console.error('Failed to pack annotations');
      console.log(packedSrc);
      return;
    }

    const response = await api.saveFile(
      loadedContainer.data.id,
      `./${doc.title}.pdf`,
      packedSrc.data,
    );
    if (!response.ok) {
      console.error(`Failed to save new document (${doc.title})`);
      console.log(response);
      return;
    }
  }
}

/**
 * ランダムにアノテーションを生成する
 */
function generateRandomAnnots(): AnnotationStyle[] {
  const annotationCount = 3;
  const colors: ColorCode[] = [
    ColorCode.parse('#FFD700'),
    ColorCode.parse('#FF6B6B'),
    ColorCode.parse('#4ECDC4'),
    ColorCode.parse('#45B7D1'),
    ColorCode.parse('#FFA07A'),
    ColorCode.parse('#98D8C8'),
  ];

  const annots: AnnotationStyle[] = [];
  for (let i = 0; i < annotationCount; i++) {
    const colorIdx = Math.floor(Math.random() * colors.length);
    const color: ColorCode = colors[colorIdx] || ColorCode.parse('#FFD700');

    const now = new Date().toISOString();
    annots.push({
      id: AnnotationID.parse(uuidv4()),
      pageNumber: 1,
      x: Math.random() * 500,
      y: Math.random() * 600,
      width: 150,
      height: 80,
      color: color,
      strokeWidth: 3,
      createdAt: now,
      updatedAt: now,
      comment: {},
      type: 'box',
    });
  }

  return annots;
}
