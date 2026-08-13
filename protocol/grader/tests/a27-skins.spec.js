'use strict';
/**
 * A27 — 노트 스킨 (rev.5 설계서 §1 A27)
 * "[data-skin] 선택지 ≥3(기본/줄노트/모눈) — 한 노트를 줄노트로 바꾸면 그 노트의 computed
 *  background-image 문자열만 변경(타 노트 불변)되고, 모눈은 기본·줄노트 어느 쪽과도 상이하며,
 *  재기동 후 노트별 스킨이 보존된다"
 *
 * ── rev.5 필수 DOM 계약 (설계서 §2 A27 — 그대로 기록) ──
 * [data-skin] — 컨텍스트 메뉴 하위 또는 노트 활성 시 패널의 선택 UI, 항목당
 * [data-skin-option](라벨 텍스트 포함 매칭: "기본"/"줄노트"/"모눈"). 스킨은 background-image
 * 레이어로 구현(질감·색 레이어와 병존 가능 — A3/A10 계약과 충돌 금지: background-color 판정은
 * A3 그대로 유효해야 함). 노트별 저장.
 * 신규 훅은 폴백 셀렉터 없음: data-속성 부재 = 즉시 FAIL (fail-closed).
 */
const { test, expect } = require('@playwright/test');
const {
  POSTIT_PATH,
  requirePostit,
  freshProfileDir,
  launchApp,
  closeApp,
  removeDirWithRetry,
  sleep,
  POSTIT_SEL,
  assertNoDialogs,
  addNote,
  pollVisibleNoteCount,
  openContextMenuOn,
} = require('../lib/helpers');

const STORE_KEY = 'postit-notes';

async function noteBgImage(page, idx) {
  const v = await page.evaluate(
    ({ N, idx }) => {
      const el = document.querySelectorAll(N)[idx];
      return el ? getComputedStyle(el).backgroundImage : null;
    },
    { N: POSTIT_SEL.NOTE, idx }
  );
  if (v === null) throw new Error(`A27: 노트 ${idx + 1}번을 찾을 수 없습니다`);
  return v;
}

/** 노트 활성(클릭) → [data-skin] 선택 UI 를 연다 (직접 노출 → 컨텍스트 메뉴 순, fail-closed) */
async function openSkinUI(page, noteLoc) {
  try {
    await noteLoc.click({ timeout: 5000 });
  } catch (e) {
    throw new Error('A27: 노트를 클릭(활성)할 수 없습니다: ' + e.message);
  }
  await sleep(150);
  if (await page.locator('[data-skin]').first().isVisible().catch(() => false)) return;
  await openContextMenuOn(page, noteLoc);
  await sleep(200);
  if (await page.locator('[data-skin]').first().isVisible().catch(() => false)) return;
  throw new Error(
    'A27: 필수 훅 [data-skin] 스킨 선택 UI 가 노트 활성 시 패널에도, 노트 컨텍스트 메뉴에도 없습니다 — rev.5 DOM 계약 미구현 (fail-closed: 폴백 없음)'
  );
}

async function clickSkinOption(page, noteLoc, label) {
  await openSkinUI(page, noteLoc);
  const opt = page.locator('[data-skin-option]').filter({ hasText: label }).first();
  if ((await opt.count()) === 0) {
    throw new Error(`A27: 라벨 "${label}" 을 포함한 [data-skin-option] 항목이 없습니다 (fail-closed)`);
  }
  try {
    await opt.click({ timeout: 3000 });
  } catch (e) {
    throw new Error(`A27: [data-skin-option] "${label}" 을 클릭할 수 없습니다: ` + e.message);
  }
  await sleep(200);
}

test.describe('A27 노트 스킨', () => {
  test('A27: 스킨 ≥3(기본/줄노트/모눈) — 노트별 background-image 변경·타 노트 불변·3종 상이·재기동 보존', async () => {
    requirePostit();
    const dir = freshProfileDir();
    const states = [];
    let app = null;
    try {
      app = await launchApp(dir, POSTIT_PATH);
      states.push(app.state);
      let page = app.page;
      await addNote(page);
      await pollVisibleNoteCount(page, 1, 5000, 'A27');
      await addNote(page);
      await pollVisibleNoteCount(page, 2, 5000, 'A27');

      const note1 = page.locator(POSTIT_SEL.NOTE).nth(0);

      // 선택지 ≥ 3 + 라벨 "기본"/"줄노트"/"모눈" 포함 (fail-closed)
      await openSkinUI(page, note1);
      const optCount = await page.locator('[data-skin-option]').count();
      expect(
        optCount >= 3,
        `A27: [data-skin-option] 이 ${optCount}개입니다 (기본/줄노트/모눈 3개 이상이어야 함 — fail-closed)`
      ).toBe(true);
      const labels = await page.locator('[data-skin-option]').allTextContents();
      const norm = labels.map((t) => t.replace(/\s+/g, ' ').trim());
      for (const need of ['기본', '줄노트', '모눈']) {
        expect(
          norm.some((t) => t.includes(need)),
          `A27: 스킨 선택지 라벨에 "${need}" 이(가) 없습니다 (현재: ${norm.join(', ')})`
        ).toBe(true);
      }

      const bgBasic1 = await noteBgImage(page, 0); // 노트 1 기본
      const bgBasic2 = await noteBgImage(page, 1); // 노트 2 기본 (불변 대조군)
      const rawBefore = await page.evaluate((k) => localStorage.getItem(k), STORE_KEY);

      // 줄노트: 노트 1만 변경, 노트 2 불변
      await clickSkinOption(page, note1, '줄노트');
      const bgLined = await noteBgImage(page, 0);
      expect(
        bgLined !== bgBasic1,
        'A27: "줄노트" 선택 후에도 노트 1의 computed background-image 가 변하지 않았습니다'
      ).toBe(true);
      expect(
        await noteBgImage(page, 1),
        'A27: 노트 1의 스킨 변경이 노트 2의 background-image 까지 바꿨습니다 (노트별 스킨이어야 함)'
      ).toBe(bgBasic2);

      // 모눈: 기본·줄노트 어느 쪽과도 상이 (3종 pairwise 상이)
      await clickSkinOption(page, note1, '모눈');
      const bgGrid = await noteBgImage(page, 0);
      expect(bgGrid !== bgBasic1, 'A27: "모눈" 스킨이 "기본" 과 동일한 background-image 입니다').toBe(true);
      expect(bgGrid !== bgLined, 'A27: "모눈" 스킨이 "줄노트" 와 동일한 background-image 입니다').toBe(true);

      // 노트별 저장 폴링 (노트 1=모눈, 노트 2=기본)
      const deadline = Date.now() + 2500;
      for (;;) {
        const raw = await page.evaluate((k) => localStorage.getItem(k), STORE_KEY);
        if (raw !== null && raw !== rawBefore) break;
        if (Date.now() > deadline) {
          throw new Error('A27: 스킨 선택이 2초 내 localStorage(postit-notes)에 저장되지 않았습니다 (노트별 저장 계약)');
        }
        await sleep(100);
      }
      assertNoDialogs(app.state, 'A27');
      await closeApp(app);
      app = null;

      // ── 재기동: 노트별 스킨 보존 ──
      app = await launchApp(dir, POSTIT_PATH);
      states.push(app.state);
      page = app.page;
      await pollVisibleNoteCount(page, 2, 5000, 'A27 재기동');
      const bgAfter1 = await noteBgImage(page, 0);
      const bgAfter2 = await noteBgImage(page, 1);
      expect(
        bgAfter1,
        `A27: 재기동 후 노트 1의 스킨(모눈)이 보존되지 않았습니다 (종료 시 "${bgGrid.slice(0, 80)}...", 현재 "${bgAfter1.slice(0, 80)}...")`
      ).toBe(bgGrid);
      expect(
        bgAfter2,
        'A27: 재기동 후 노트 2의 스킨(기본)이 보존되지 않았습니다'
      ).toBe(bgBasic2);
      for (const s of states) assertNoDialogs(s, 'A27');
    } finally {
      await closeApp(app);
      await removeDirWithRetry(dir);
    }
  });
});
