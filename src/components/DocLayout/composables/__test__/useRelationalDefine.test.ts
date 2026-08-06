import { describe, expect, it } from 'bun:test';
import type { AnnotationID } from 'src/models/document/pdf';
import {
  decideRelationalOnAnnotationsAdded,
  decideRelationalOnSelectionChanged,
  decideRelationalContinuousRestart,
} from '../useRelationalDefine';

const idA = '00000000-0000-4000-8000-000000000001' as AnnotationID;
const idB = '00000000-0000-4000-8000-000000000002' as AnnotationID;
const idC = '00000000-0000-4000-8000-000000000003' as AnnotationID;

describe('decideRelationalOnAnnotationsAdded', () => {
  it('関係性モードが未設定の場合は何もしない（非連続・連続いずれでもモード自体が無ければ対象外）', () => {
    expect(
      decideRelationalOnAnnotationsAdded(undefined, undefined, [idA], undefined),
    ).toBeUndefined();
  });

  it('待機中でない状態で1件追加されたら、そのアノテーションを起点に待機を開始する（1組目・非連続時の1つ目の作成）', () => {
    const decision = decideRelationalOnAnnotationsAdded('link', undefined, [idA], undefined);
    expect(decision).toEqual({ action: 'start', annotId: idA });
  });

  it('待機中に1件追加されたら、そのアノテーションで確定する（1組目・非連続時の2つ目の作成）', () => {
    const decision = decideRelationalOnAnnotationsAdded('link', idA, [idB], undefined);
    expect(decision).toEqual({ action: 'finish', annotId: idB });
  });

  it('連続登録中でも待機解除後に次のアノテーションが作成されれば、それを新たな起点として待機を開始する（連続時の6.：次ペアの1つ目）', () => {
    // 直前のペア（idA-idB）確定後、pendingIdは解除済み・目印も選択変化側で解除済みの状態を想定する
    const decision = decideRelationalOnAnnotationsAdded('link', undefined, [idC], undefined);
    expect(decision).toEqual({ action: 'start', annotId: idC });
  });

  it('追加検知されたアノテーションが直前に確定したペアの対象そのものであれば何もしない（選択変化側の確定処理がアノテーション一覧への反映より先に完了し、後追いでこの追加検知が走った場合。これを新たな起点にしてしまうと、直後に描いた次のアノテーションと即座に関係性が結ばれてしまう）', () => {
    const decision = decideRelationalOnAnnotationsAdded('link', undefined, [idB], idB);
    expect(decision).toBeUndefined();
  });

  it('一度に複数件追加された場合は判定しない（同一アノテーションとしての一意な起点が決まらないため）', () => {
    expect(
      decideRelationalOnAnnotationsAdded('link', undefined, [idA, idB], undefined),
    ).toBeUndefined();
  });

  it('追加が無い場合（内容更新のみの変化）は何もしない', () => {
    expect(decideRelationalOnAnnotationsAdded('link', idA, [], undefined)).toBeUndefined();
  });
});

describe('decideRelationalOnSelectionChanged', () => {
  it('関係性モードが未設定なら何もしない', () => {
    expect(decideRelationalOnSelectionChanged(undefined, idA, [idA, idB])).toBeUndefined();
  });

  it('待機中でなければ何もしない', () => {
    expect(decideRelationalOnSelectionChanged('link', undefined, [idA, idB])).toBeUndefined();
  });

  it('待機中の基準アノテーション以外が選択されていれば、それを対象として返す（既存アノテーションを選んでペア確定する場合）', () => {
    const targetId = decideRelationalOnSelectionChanged('link', idA, [idA, idB]);
    expect(targetId).toBe(idB);
  });

  it('基準アノテーションしか選択されていなければ何もしない', () => {
    expect(decideRelationalOnSelectionChanged('link', idA, [idA])).toBeUndefined();
  });
});

describe('decideRelationalContinuousRestart', () => {
  it('連続定義モードでなければ再開しない', () => {
    const decision = decideRelationalContinuousRestart({
      continuous: false,
      pending: false,
      mode: 'link',
      targetId: idC,
      lastPairedId: undefined,
    });
    expect(decision).toEqual({ start: false, clearLastPaired: false });
  });

  it('既に待機中であれば再開しない（多重に待機開始しない）', () => {
    const decision = decideRelationalContinuousRestart({
      continuous: true,
      pending: true,
      mode: 'link',
      targetId: idC,
      lastPairedId: undefined,
    });
    expect(decision).toEqual({ start: false, clearLastPaired: false });
  });

  it('選択中のアノテーションが無ければ再開しない', () => {
    const decision = decideRelationalContinuousRestart({
      continuous: true,
      pending: false,
      mode: 'link',
      targetId: undefined,
      lastPairedId: undefined,
    });
    expect(decision).toEqual({ start: false, clearLastPaired: false });
  });

  it('直前に確定したペアの対象と選択IDが一致する間はスキップする（ペア確定直後、対象が選択され続けているだけの状態）', () => {
    const decision = decideRelationalContinuousRestart({
      continuous: true,
      pending: false,
      mode: 'link',
      targetId: idB,
      lastPairedId: idB,
    });
    expect(decision).toEqual({ start: false, clearLastPaired: false });
  });

  it('選択IDが直前のペア対象と異なれば、目印を解除したうえで新たな起点として待機を再開する（連続時の6.：次ペアの1つ目を正しく起点にする）', () => {
    const decision = decideRelationalContinuousRestart({
      continuous: true,
      pending: false,
      mode: 'link',
      targetId: idC,
      lastPairedId: idB,
    });
    expect(decision).toEqual({ start: true, clearLastPaired: true, annotId: idC, mode: 'link' });
  });

  it('目印が無い状態でも、選択が変化していれば新たな起点として待機を再開する', () => {
    const decision = decideRelationalContinuousRestart({
      continuous: true,
      pending: false,
      mode: 'equal',
      targetId: idA,
      lastPairedId: undefined,
    });
    expect(decision).toEqual({ start: true, clearLastPaired: false, annotId: idA, mode: 'equal' });
  });
});
