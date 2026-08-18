import { describe, expect, it } from 'bun:test';
import type { AnnotationID } from 'src/models/document/pdf';
import type { AnnotationInfo } from 'src/models/relational/fileSchema';
import { excludeTemporaryAnnotationInfos } from '../annotation';

/**
 * テスト用に、指定IDのみを変えた最小構成のAnnotationInfo（box型・位置サイズ固定）を生成する
 */
function buildAnnotInfo(id: AnnotationID): AnnotationInfo {
  // 指定IDをstyle.idに設定したbox型の注釈情報を、contextは未読み込み（空）のまま返す
  return {
    style: {
      id,
      type: 'box',
      pageNumber: 1,
      x: 0,
      y: 0,
      color: '#000000' as never,
      strokeWidth: 2,
      strokeType: 'solid',
      width: 10,
      height: 10,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      comment: {},
    },
    context: {},
  };
}

describe('excludeTemporaryAnnotationInfos', () => {
  const temporaryId = '00000000-0000-4000-8000-000000000001' as AnnotationID;
  const savedId = '00000000-0000-4000-8000-000000000002' as AnnotationID;

  it('仮登録IDに一致するAnnotationInfoを除外する', () => {
    const infos = [buildAnnotInfo(temporaryId), buildAnnotInfo(savedId)];

    const result = excludeTemporaryAnnotationInfos(infos, new Set([temporaryId]));

    expect(result.map((info) => info.style.id)).toEqual([savedId]);
  });

  it('仮登録IDが空の場合は全件をそのまま返す', () => {
    // このSetは`registerConfigAnnotationInfos`のDexieトランザクション内で取得される最新の
    // 仮登録状態を表す。判定と登録が同一トランザクションであるため、他の書き込みが割り込んで
    // 判定後にこのSetが古くなることはない（config.tsが個別に呼び出していた旧実装で起きていた
    // 競合はこの一体化により構造的に発生しなくなる）
    const infos = [buildAnnotInfo(savedId)];

    const result = excludeTemporaryAnnotationInfos(infos, new Set());

    expect(result).toEqual(infos);
  });
});
