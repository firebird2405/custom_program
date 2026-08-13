'use strict';
/**
 * A25 — 다중 보드 (rev.5 설계서 §1 A25)
 * "[data-board-switcher] 의 [data-add-board] 로 보드 2 생성 → 보드 2에서 추가한 노트는
 *  `postit-notes` 가 아닌 `postit-notes-` 접두 신규 키에 저장되고 보드 1 전환 시 비표시
 *  (보드 1 노트는 표시), 역방향도 성립. 재기동 후 활성 보드(보드 2)와 각 보드 노트 구성이
 *  유지되고 `postit-notes` 의 보드 1 데이터는 그대로다(하위호환)"
 *
 * ── rev.5 필수 DOM 계약 (설계서 §2 A25 — 그대로 기록) ──
 * [data-board-switcher] 컨테이너, [data-board-tab](활성 탭 data-active="true"),
 * [data-add-board] 새 보드 버튼. 저장: 보드 1 = 기존 postit-notes(하위호환 고정),
 * 추가 보드 = postit-notes-<boardId>(예: postit-notes-b2), 활성 보드 = postit-active-board.
 * A9 손상 백업 규약(<키>-corrupt-<ts>)은 보드 키에도 동일 적용.
 * 신규 훅은 폴백 셀렉터 없음: data-속성 부재 = 즉시 FAIL (fail-closed).
 * 굿하트 차단(설계서 §6): 보드 전환을 삭제/재생성으로 구현, 보드 2가 같은 키의 필터
 * 플래그일 뿐 → 키 분리 + postit-notes 에 보드 2 노트 부재 + 양방향 재전환 단언.
 */
const { test, expect } = require('@playwright/test');
const {
  POSTIT_PATH,
  requirePostit,
  freshProfileDir,
  launchApp,
  closeApp,
  removeDirWithRetry,
  pollLocalStorage,
  pollPage,
  sleep,
  POSTIT_SEL,
  assertNoDialogs,
  requireHook,
  addNote,
  setNoteText,
  pollVisibleNoteCount,
  hasVisibleNoteText,
} = require('../lib/helpers');

const STORE_KEY = 'postit-notes';
const NOTE_A = 'A25-보드1-노트';
const NOTE_B = 'A25-보드2-노트';

/** 텍스트가 visible 하게 표시될 때까지(want=true)/사라질 때까지(want=false) 폴링 */
async function pollNoteTextVisibility(page, text, want, timeoutMs, failMsg) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const has = await hasVisibleNoteText(page, text);
    if (has === want) return;
    if (Date.now() > deadline) throw new Error(failMsg);
    await sleep(100);
  }
}

async function clickTab(page, which, label) {
  const tabs = page.locator('[data-board-tab]');
  const n = await tabs.count();
  if (n < 2) {
    throw new Error(`${label}: [data-board-tab] 이 ${n}개입니다 (보드 2 생성 후 2개 이상이어야 함) — rev.5 DOM 계약 미구현 (fail-closed)`);
  }
  const tab = which === 'first' ? tabs.first() : tabs.last();
  try {
    await tab.click({ timeout: 3000 });
  } catch (e) {
    throw new Error(`${label}: 보드 탭([data-board-tab])을 클릭할 수 없습니다: ` + e.message);
  }
  await sleep(150);
}

test.describe('A25 다중 보드', () => {
  test('A25: [data-add-board] 보드 2 생성 → postit-notes- 접두 신규 키 분리 저장·양방향 전환·재기동 후 활성 보드/구성 유지·보드 1 하위호환', async () => {
    requirePostit();
    const dir = freshProfileDir();
    const states = [];
    let app = null;
    try {
      // ── 기동 1 ──
      app = await launchApp(dir, POSTIT_PATH);
      states.push(app.state);
      let page = app.page;

      // 보드 1에 노트 A
      await addNote(page);
      await pollVisibleNoteCount(page, 1, 5000, 'A25');
      await setNoteText(page, page.locator(POSTIT_SEL.NOTE).first(), NOTE_A);
      const rawBoard1 = await pollLocalStorage(page, STORE_KEY, (raw) => !!raw && raw.includes(NOTE_A), 5000);

      // 보드 2 생성 (fail-closed 훅)
      await requireHook(page, '[data-board-switcher]', 'A25 보드 전환기');
      const addBoard = await requireHook(page, '[data-add-board]', 'A25 새 보드');
      await addBoard.click();
      await pollPage(
        page,
        () => {
          const tabs = document.querySelectorAll('[data-board-tab]');
          const active = document.querySelectorAll('[data-board-tab][data-active="true"]');
          return tabs.length >= 2 && active.length === 1 && active[0] === tabs[tabs.length - 1];
        },
        null,
        3000,
        'A25: [data-add-board] 클릭 후 [data-board-tab] 2개 이상 + 마지막(새 보드) 탭의 data-active="true" 활성 전환이 관찰되지 않았습니다 — rev.5 DOM 계약 미구현 (fail-closed)'
      );

      // 보드 2에서 노트 B (보드 1 노트 A 는 비표시 상태여야 함)
      await pollNoteTextVisibility(page, NOTE_A, false, 3000, 'A25: 보드 2 전환 후에도 보드 1 노트가 계속 표시됩니다');
      await addNote(page);
      await pollVisibleNoteCount(page, 1, 5000, 'A25 보드 2');
      await setNoteText(page, page.locator(POSTIT_SEL.NOTE).last(), NOTE_B);

      // 저장 키 분리: postit-notes-<boardId> 신규 키에 B, postit-notes 에는 B 부재 + A 원문 불변
      await pollPage(
        page,
        (b) =>
          Object.keys(localStorage).some(
            (k) => /^postit-notes-/.test(k) && !/corrupt/.test(k) && (localStorage.getItem(k) || '').includes(b)
          ),
        NOTE_B,
        5000,
        `A25: 보드 2 노트("${NOTE_B}")가 "postit-notes-" 접두 신규 키에 저장되지 않았습니다 (키 분리 — rev.5 저장 계약, fail-closed)`
      );
      const rawBoard1After = await page.evaluate((k) => localStorage.getItem(k), STORE_KEY);
      expect(
        (rawBoard1After || '').includes(NOTE_B),
        `A25: 보드 2 노트("${NOTE_B}")가 기존 postit-notes 키에 저장되었습니다 — 보드 2는 같은 키의 필터 플래그가 아니라 별도 키여야 합니다`
      ).toBe(false);
      expect(
        rawBoard1After,
        'A25: 보드 2 작업 후 postit-notes(보드 1) 원문이 변경되었습니다 (하위호환: 보드 1 데이터는 그대로여야 함)'
      ).toBe(rawBoard1);

      // 보드 1 전환: B 비표시·A 표시
      await clickTab(page, 'first', 'A25 보드 1 전환');
      await pollNoteTextVisibility(page, NOTE_A, true, 3000, `A25: 보드 1 전환 후 "${NOTE_A}" 가 표시되지 않습니다`);
      await pollNoteTextVisibility(page, NOTE_B, false, 3000, `A25: 보드 1 전환 후 보드 2 노트("${NOTE_B}")가 여전히 표시됩니다`);

      // 역방향: 보드 2 재전환 → A 비표시·B 표시
      await clickTab(page, 'last', 'A25 보드 2 재전환');
      await pollNoteTextVisibility(page, NOTE_B, true, 3000, `A25: 보드 2 재전환 후 "${NOTE_B}" 가 표시되지 않습니다`);
      await pollNoteTextVisibility(page, NOTE_A, false, 3000, `A25: 보드 2 재전환 후 보드 1 노트("${NOTE_A}")가 여전히 표시됩니다`);

      // 활성 보드 저장 확인 (재기동 복원의 전제)
      await pollLocalStorage(
        page,
        'postit-active-board',
        (raw) => raw !== null && raw !== '',
        2000
      ).catch(() => {
        throw new Error('A25: 활성 보드가 postit-active-board 키에 저장되지 않았습니다 — rev.5 저장 계약 (fail-closed)');
      });
      assertNoDialogs(app.state, 'A25');
      await closeApp(app);
      app = null;

      // ── 재기동: 활성 보드 2 + 구성 유지 + 보드 1 하위호환 ──
      app = await launchApp(dir, POSTIT_PATH);
      states.push(app.state);
      page = app.page;
      await pollNoteTextVisibility(page, NOTE_B, true, 5000, `A25: 재기동 후 활성 보드(보드 2)의 "${NOTE_B}" 가 표시되지 않습니다 (활성 보드 유지 실패)`);
      await pollNoteTextVisibility(page, NOTE_A, false, 3000, `A25: 재기동 후 보드 1 노트("${NOTE_A}")가 보드 2에 표시됩니다`);
      const activeIsLast = await page.evaluate(() => {
        const tabs = document.querySelectorAll('[data-board-tab]');
        const active = document.querySelector('[data-board-tab][data-active="true"]');
        return tabs.length >= 2 && !!active && active === tabs[tabs.length - 1];
      });
      expect(activeIsLast, 'A25: 재기동 후 활성 탭(data-active="true")이 보드 2가 아닙니다').toBe(true);

      // 보드 1 전환 → A 표시 + postit-notes 원문 그대로
      await clickTab(page, 'first', 'A25 재기동 보드 1');
      await pollNoteTextVisibility(page, NOTE_A, true, 3000, `A25: 재기동 후 보드 1 전환 시 "${NOTE_A}" 가 표시되지 않습니다`);
      const rawFinal = await page.evaluate((k) => localStorage.getItem(k), STORE_KEY);
      expect(
        (rawFinal || '').includes(NOTE_A) && !(rawFinal || '').includes(NOTE_B),
        'A25: 재기동 후 postit-notes(보드 1) 데이터가 하위호환으로 유지되지 않았습니다'
      ).toBe(true);
      for (const s of states) assertNoDialogs(s, 'A25');
    } finally {
      await closeApp(app);
      await removeDirWithRetry(dir);
    }
  });
});
