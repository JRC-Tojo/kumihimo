import { expect, test, type Locator, type Page } from '@playwright/test';
import {
  buildBoxAnnotationStyle,
  registerAnnotation,
  seedCacheContainerWithFixturePdf,
} from '../support/seed';
import { docPointToPagePosition, stageCanvas, waitForCanvasReady } from '../support/canvasCoords';
import type { TestContainerFile } from '../support/testHook';

const PAGE_SIZE = { width: 400, height: 300 };
const idA = '55555555-5555-4555-8555-555555555555';
const idB = '66666666-6666-4666-8666-666666666666';
const idC = '77777777-7777-4777-8777-777777777777';

/**
 * 3件のboxアノテーション（A, B, C）を、互いに重ならない位置へ事前投入する
 * （A・BをグループにしてもCと重ならないよう、Cは離れた位置に置く）
 */
async function seedThreeBoxes(page: Page, containerName: string) {
  const seeded = await seedCacheContainerWithFixturePdf(page, { containerName });
  await registerAnnotation(
    page,
    seeded.file,
    buildBoxAnnotationStyle({ id: idA, pageNumber: 1, x: 30, y: 30, width: 40, height: 30 }),
  );
  await registerAnnotation(
    page,
    seeded.file,
    buildBoxAnnotationStyle({ id: idB, pageNumber: 1, x: 30, y: 100, width: 40, height: 30 }),
  );
  await registerAnnotation(
    page,
    seeded.file,
    buildBoxAnnotationStyle({ id: idC, pageNumber: 1, x: 300, y: 200, width: 40, height: 30 }),
  );
  return seeded;
}

/** コンテナ・ファイルを開き、選択モードにしてキャンバスの準備を待つ */
async function openFileInSelectMode(page: Page, containerName: string) {
  await page.locator('.exp-container-row .container-name', { hasText: containerName }).click();
  await page.locator('.exp-file .file-name').first().click();
  await page.locator('[data-testid="select-mode"]').click();

  const canvas = stageCanvas(page);
  await waitForCanvasReady(canvas);
  return canvas;
}

/** アノテーションA・Bの中心座標（ページ座標系）をキャンバス上のスクリーン座標に変換して返す */
async function centers(canvas: Locator) {
  return {
    a: await docPointToPagePosition(canvas, { x: 50, y: 45 }, PAGE_SIZE),
    b: await docPointToPagePosition(canvas, { x: 50, y: 115 }, PAGE_SIZE),
    c: await docPointToPagePosition(canvas, { x: 320, y: 215 }, PAGE_SIZE),
  };
}

/** A・Bを選択した状態にする（Aをクリック→Shift+クリックでBを追加） */
async function selectAAndB(page: Page, canvas: Locator) {
  const { a, b } = await centers(canvas);
  await page.mouse.click(a.x, a.y);
  await page.keyboard.down('Shift');
  await page.mouse.click(b.x, b.y);
  await page.keyboard.up('Shift');
}

/**
 * 指定座標を右クリックし、コンテキストメニューが開くまで待つ（開かなければ数回リトライする）
 *
 * 複数選択・共有Transformerが既にアタッチされた直後のシェイプへ右クリックする場合、
 * ごくまれにKonva側のイベント処理タイミングと重なり、1回目の右クリックがコンテキストメニューの
 * オープンに繋がらないことがある（描画・ヒットテスト自体は正常で、単なる操作タイミングの
 * 揺らぎ）。決め打ちで長時間1回だけ待つのではなく、短い待機で開いたか確認し、開いていなければ
 * 右クリックを数回まで再試行することで、揺らぎを吸収しつつ不具合の見落としも防ぐ
 */
async function openContextMenuAt(
  page: Page,
  pos: { x: number; y: number },
  maxAttempts = 3,
): Promise<Locator> {
  const menu = page.getByRole('menu');
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    await page.mouse.click(pos.x, pos.y, { button: 'right' });
    const opened = await menu
      .waitFor({ state: 'visible', timeout: 5_000 })
      .then(() => true)
      .catch(() => false);
    if (opened) return menu;
    // 開かなかった場合、Escapeで念のため状態をリセットしてから再試行する
    await page.keyboard.press('Escape');
  }
  // 最終試行の結果をそのまま呼び出し元のアサーションへ委ねる（失敗時は通常のタイムアウトエラーになる）
  await menu.waitFor({ state: 'visible', timeout: 5_000 });
  return menu;
}

/** 右クリックメニューから「グループ化」を選ぶ（呼び出し前にA・Bが選択済みであること） */
async function groupViaContextMenu(page: Page, canvas: Locator) {
  const { a } = await centers(canvas);
  const menu = await openContextMenuAt(page, a);
  await menu.getByText('グループ化', { exact: true }).click();
}

test.describe('アノテーショングループ化', () => {
  // グループ化操作は複数アノテーションの選択・コンテキストメニュー・API呼び出しを伴い、
  // 他specより手順が多い。Vite開発サーバーのコールドコンパイル直後は既定の30秒を
  // 超えることがあるため、canvasCoords.tsのwaitForCanvasReadyと同じ理由で長めに確保する
  test.setTimeout(60_000);

  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('2件のアノテーションを選択してグループ化すると、グループが永続化される', async ({
    page,
  }) => {
    const seeded = await seedThreeBoxes(page, 'group-create');
    const canvas = await openFileInSelectMode(page, 'group-create');

    await selectAAndB(page, canvas);
    await groupViaContextMenu(page, canvas);

    await expect
      .poll(async () => {
        const res = await page.evaluate(async (file: TestContainerFile) => {
          const api = window.__kumihimoTest?.api;
          if (!api) throw new Error('__kumihimoTest hook is not available');
          return api.listAnnotationGroups(file);
        }, seeded.file);
        return res.ok ? (res.data?.length ?? -1) : -1;
      })
      .toBe(1);

    const groupsRes = await page.evaluate(async (file: TestContainerFile) => {
      const api = window.__kumihimoTest?.api;
      if (!api) throw new Error('__kumihimoTest hook is not available');
      return api.listAnnotationGroups(file);
    }, seeded.file);
    expect(groupsRes.ok).toBe(true);
    const group = groupsRes.data?.[0];
    expect(group?.memberIds.sort()).toEqual([idA, idB].sort());
  });

  test('グループのドラッグはちょうど1件のUndoステップとして記録され、1回のCtrl+Zで完全に元へ戻る', async ({
    page,
  }) => {
    const seeded = await seedThreeBoxes(page, 'group-undo-batch');
    const canvas = await openFileInSelectMode(page, 'group-undo-batch');

    await selectAAndB(page, canvas);
    await groupViaContextMenu(page, canvas);

    async function positionsOfAAndB() {
      const res = await page.evaluate(async (file: TestContainerFile) => {
        const api = window.__kumihimoTest?.api;
        if (!api) throw new Error('__kumihimoTest hook is not available');
        return api.getAnnotationsByFile(file);
      }, seeded.file);
      if (!res.ok) return undefined;
      const byId = new Map((res.data ?? []).map((info) => [info.style.id, info.style]));
      const styleA = byId.get(idA);
      const styleB = byId.get(idB);
      if (!styleA || !styleB) return undefined;
      return { a: { x: styleA.x, y: styleA.y }, b: { x: styleB.x, y: styleB.y } };
    }

    const beforeDrag = await positionsOfAAndB();
    expect(beforeDrag).toBeDefined();

    // グループ化直後は自動的にグループ全体が選択された状態になっている。
    // グループ化直後の共有Transformerのアタッチが完了しきる前にドラッグを開始すると
    // 取りこぼすことがあるため、一呼吸置いてから操作する
    const { a } = await centers(canvas);
    const dragTo = { x: a.x + 40, y: a.y + 20 };
    await page.waitForTimeout(300);
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(dragTo.x, dragTo.y, { steps: 8 });
    await page.mouse.up();

    // ドラッグによって実際にA・B双方の位置が変化するまで待つ（非同期の再描画・保存待ち）
    await expect
      .poll(
        async () => {
          const after = await positionsOfAAndB();
          if (!after || !beforeDrag) return false;
          return after.a.x !== beforeDrag.a.x && after.b.x !== beforeDrag.b.x;
        },
        { timeout: 10_000 },
      )
      .toBe(true);

    // 1回のCtrl+Zで、グループ全体（A・B双方）の移動がまとめて完全に元へ戻ることを検証する。
    // 個別に2件のUndoステップとして記録されてしまっている場合、1回のCtrl+Zでは一方の
    // シェイプしか戻らず、ここでの一致は成立しない
    await page.keyboard.press('Control+z');
    await expect
      .poll(async () => {
        const afterUndo = await positionsOfAAndB();
        return afterUndo;
      })
      .toEqual(beforeDrag);
  });

  test('グループ化を解除すると、グループレコードが削除される', async ({ page }) => {
    const seeded = await seedThreeBoxes(page, 'group-ungroup');
    const canvas = await openFileInSelectMode(page, 'group-ungroup');

    await selectAAndB(page, canvas);
    await groupViaContextMenu(page, canvas);

    await expect
      .poll(async () => {
        const res = await page.evaluate(async (file: TestContainerFile) => {
          const api = window.__kumihimoTest?.api;
          if (!api) throw new Error('__kumihimoTest hook is not available');
          return api.listAnnotationGroups(file);
        }, seeded.file);
        return res.ok ? (res.data?.length ?? -1) : -1;
      })
      .toBe(1);

    // 一旦空白領域をクリックして選択・Transformerを完全に解除してから選び直す
    // （直前の選択状態やTransformerのハンドル・アンカーの重なりがそのまま残っていることに
    // 依存しないよう、まっさらな状態から選択をやり直す）
    const blank = await docPointToPagePosition(canvas, { x: 300, y: 50 }, PAGE_SIZE);
    await page.mouse.click(blank.x, blank.y);

    const { a } = await centers(canvas);
    await page.mouse.click(a.x, a.y);
    const menu = await openContextMenuAt(page, a);
    await menu.getByText('グループ化を解除', { exact: true }).click();

    await expect
      .poll(async () => {
        const res = await page.evaluate(async (file: TestContainerFile) => {
          const api = window.__kumihimoTest?.api;
          if (!api) throw new Error('__kumihimoTest hook is not available');
          return api.listAnnotationGroups(file);
        }, seeded.file);
        return res.ok ? (res.data?.length ?? -1) : -1;
      })
      .toBe(0);
  });

  test('グループ全体をコピー＆ペーストすると、新しいグループが再作成される', async ({ page }) => {
    const seeded = await seedThreeBoxes(page, 'group-copy-paste');
    const canvas = await openFileInSelectMode(page, 'group-copy-paste');

    await selectAAndB(page, canvas);
    await groupViaContextMenu(page, canvas);

    await expect
      .poll(async () => {
        const res = await page.evaluate(async (file: TestContainerFile) => {
          const api = window.__kumihimoTest?.api;
          if (!api) throw new Error('__kumihimoTest hook is not available');
          return api.listAnnotationGroups(file);
        }, seeded.file);
        return res.ok ? (res.data?.length ?? -1) : -1;
      })
      .toBe(1);

    // 一旦空白領域をクリックして選択・Transformerを完全に解除してから選び直す
    // （直前の選択状態が残ったままだと、同じシェイプへの再クリックがTransformerの
    // 内部状態と干渉し意図通りに選択し直せないことがあるため、まっさらな状態から選び直す）
    const blank = await docPointToPagePosition(canvas, { x: 300, y: 50 }, PAGE_SIZE);
    await page.mouse.click(blank.x, blank.y);

    // Aを単体クリックしても、AnnotationLayer.vueの選択展開watchによりグループ全体へ自動的に広がる
    const { a } = await centers(canvas);
    await page.mouse.click(a.x, a.y);
    await page.keyboard.press('Control+c');
    await page.keyboard.press('Control+v');

    // ペーストによって新しいグループが1件増え、合計2件になることを検証する
    await expect
      .poll(async () => {
        const res = await page.evaluate(async (file: TestContainerFile) => {
          const api = window.__kumihimoTest?.api;
          if (!api) throw new Error('__kumihimoTest hook is not available');
          return api.listAnnotationGroups(file);
        }, seeded.file);
        return res.ok ? (res.data?.length ?? -1) : -1;
      })
      .toBe(2);

    const groupsRes = await page.evaluate(async (file: TestContainerFile) => {
      const api = window.__kumihimoTest?.api;
      if (!api) throw new Error('__kumihimoTest hook is not available');
      return api.listAnnotationGroups(file);
    }, seeded.file);
    expect(groupsRes.ok).toBe(true);
    const groups = groupsRes.data ?? [];
    expect(groups).toHaveLength(2);
    // 新しいグループのメンバーは複製された新IDのため、元のグループのメンバーとは重複しない
    const originalGroup = groups.find(
      (g) => g.memberIds.sort().join() === [idA, idB].sort().join(),
    );
    const pastedGroup = groups.find((g) => g.id !== originalGroup?.id);
    expect(pastedGroup?.memberIds).toHaveLength(2);
    expect(pastedGroup?.memberIds.some((id) => id === idA || id === idB)).toBe(false);
  });

  test('グループとアノテーション間の関係性は、メンバーの1件ではなくグループ自身を端点として登録される', async ({
    page,
  }) => {
    const seeded = await seedThreeBoxes(page, 'group-relational');
    const canvas = await openFileInSelectMode(page, 'group-relational');

    await selectAAndB(page, canvas);
    await groupViaContextMenu(page, canvas);

    await expect
      .poll(async () => {
        const res = await page.evaluate(async (file: TestContainerFile) => {
          const api = window.__kumihimoTest?.api;
          if (!api) throw new Error('__kumihimoTest hook is not available');
          return api.listAnnotationGroups(file);
        }, seeded.file);
        return res.ok ? (res.data?.length ?? -1) : -1;
      })
      .toBe(1);

    const groupsRes = await page.evaluate(async (file: TestContainerFile) => {
      const api = window.__kumihimoTest?.api;
      if (!api) throw new Error('__kumihimoTest hook is not available');
      return api.listAnnotationGroups(file);
    }, seeded.file);
    expect(groupsRes.ok).toBe(true);
    const groupId = groupsRes.data?.[0]?.id;
    expect(groupId).toBeDefined();

    // グループ化直後は自動的にグループ全体（A・B）が選択された状態になっているため、
    // このままリンクボタンを押すとグループを起点とした関係性定義の待機状態に入る
    await expect(page.locator('[data-testid="relational-define-link"]')).toBeVisible();
    await page.locator('[data-testid="relational-define-link"]').click();

    // 3件目のアノテーション（C）を選択すると、グループ↔Cの関係性が確定する
    const { c } = await centers(canvas);
    await page.mouse.click(c.x, c.y);

    await expect
      .poll(async () => {
        const res = await page.evaluate(async (file: TestContainerFile) => {
          const api = window.__kumihimoTest?.api;
          if (!api) throw new Error('__kumihimoTest hook is not available');
          return api.getRelationalsInFile(file);
        }, seeded.file);
        return res.ok ? (res.data?.length ?? -1) : -1;
      })
      .toBeGreaterThan(0);

    const relRes = await page.evaluate(async (file: TestContainerFile) => {
      const api = window.__kumihimoTest?.api;
      if (!api) throw new Error('__kumihimoTest hook is not available');
      return api.getRelationalsInFile(file);
    }, seeded.file);
    expect(relRes.ok).toBe(true);
    const relational = relRes.data?.[0];
    // 端点のどちらかがグループのID、もう一方がCであること（メンバーA・Bのいずれでもないこと）
    const endpoints = [relational?.srcID, relational?.targetID];
    expect(endpoints).toContain(groupId);
    expect(endpoints).toContain(idC);
    expect(endpoints).not.toContain(idA);
    expect(endpoints).not.toContain(idB);
  });

  test('グループごと削除すると、グループとメンバー双方が消え、Undoで両方が復元される', async ({
    page,
  }) => {
    // 注記：グループの1メンバーだけを選択することはUI上できない（AnnotationLayer.vueの
    // 選択展開watchにより、グループの1メンバーでも選択すると常にグループ全体へ自動的に
    // 展開されるため）。そのため「メンバーの一部だけ削除する」経路は実際のUI操作としては
    // 到達しない。ここでは実際にUIから到達できる「グループを丸ごと削除する」経路を検証する
    // （削除対象がグループの全メンバーちょうどの場合、annotationGroup.tsのremoveGroupMembersは
    // 残りメンバー数不足で失敗し、ungroupAnnotationsへフォールバックしてグループごと解散する。
    // このフォールバック・Undoでの復元ロジック自体はremoveGroupMembersの単体テストで
    // 個別に検証済み）
    const seeded = await seedThreeBoxes(page, 'group-delete-all');
    const canvas = await openFileInSelectMode(page, 'group-delete-all');

    await selectAAndB(page, canvas);
    await groupViaContextMenu(page, canvas);

    await expect
      .poll(async () => {
        const res = await page.evaluate(async (file: TestContainerFile) => {
          const api = window.__kumihimoTest?.api;
          if (!api) throw new Error('__kumihimoTest hook is not available');
          return api.listAnnotationGroups(file);
        }, seeded.file);
        return res.ok ? (res.data?.length ?? -1) : -1;
      })
      .toBe(1);

    // 一旦空白領域をクリックして選択・Transformerを完全に解除してから選び直す
    // （直前の選択状態が残ったままだと、同じシェイプへの再クリックがTransformerの
    // 内部状態と干渉し意図通りに選択し直せないことがあるため、まっさらな状態から選び直す）
    const blank = await docPointToPagePosition(canvas, { x: 300, y: 50 }, PAGE_SIZE);
    await page.mouse.click(blank.x, blank.y);

    // Aを単体クリックしても、選択展開watchによりグループ全体へ自動的に広がるため、
    // これでA・B双方が削除対象になる
    const { a } = await centers(canvas);
    await page.mouse.click(a.x, a.y);
    await page.keyboard.press('Delete');

    await expect
      .poll(async () => {
        const groupsRes = await page.evaluate(async (file: TestContainerFile) => {
          const api = window.__kumihimoTest?.api;
          if (!api) throw new Error('__kumihimoTest hook is not available');
          return api.listAnnotationGroups(file);
        }, seeded.file);
        const annotsRes = await page.evaluate(async (file: TestContainerFile) => {
          const api = window.__kumihimoTest?.api;
          if (!api) throw new Error('__kumihimoTest hook is not available');
          return api.getAnnotationsByFile(file);
        }, seeded.file);
        if (!groupsRes.ok || !annotsRes.ok) return undefined;
        return {
          groupCount: groupsRes.data?.length ?? -1,
          remainingIds: (annotsRes.data ?? []).map((info) => info.style.id).sort(),
        };
      })
      .toEqual({ groupCount: 0, remainingIds: [idC].sort() });

    // Undoで、グループとA・B双方が完全に復元されることを検証する
    await page.keyboard.press('Control+z');
    await expect
      .poll(async () => {
        const groupsRes = await page.evaluate(async (file: TestContainerFile) => {
          const api = window.__kumihimoTest?.api;
          if (!api) throw new Error('__kumihimoTest hook is not available');
          return api.listAnnotationGroups(file);
        }, seeded.file);
        const annotsRes = await page.evaluate(async (file: TestContainerFile) => {
          const api = window.__kumihimoTest?.api;
          if (!api) throw new Error('__kumihimoTest hook is not available');
          return api.getAnnotationsByFile(file);
        }, seeded.file);
        if (!groupsRes.ok || !annotsRes.ok) return undefined;
        return {
          groupMemberIds: groupsRes.data?.[0]?.memberIds.sort(),
          remainingIds: (annotsRes.data ?? []).map((info) => info.style.id).sort(),
        };
      })
      .toEqual({ groupMemberIds: [idA, idB].sort(), remainingIds: [idA, idB, idC].sort() });
  });
});
