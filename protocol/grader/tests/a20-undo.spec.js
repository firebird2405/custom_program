'use strict';
/**
 * A20 — 삭제 실행 취소 (rev.5 설계서 §1 A20, 두 앱)
 * "두 앱 각각: 항목(노트/일정) 삭제 직후 2초 내 저장소에서 해당 항목이 부재(지연 삭제 차단)하면서
 *  [data-toast]에 textContent "실행 취소" 버튼([data-undo])이 2초 내 표시되고 최소 5초 유지 →
 *  클릭하면 항목이 UI와 저장소에 복원되고 재기동 후에도 유지된다. 버튼을 누르지 않으면 항목은 계속 부재"
 *
 * ── rev.5 필수 DOM 계약 (설계서 §2 A20 — 그대로 기록) ──
 * [data-toast] 토스트 컨테이너(두 앱 공통 명칭), [data-undo] 버튼(textContent "실행 취소" 포함).
 * 토스트는 비모달·클릭 차단 오버레이 금지(다른 조작 가능해야 A 항목들과 공존).
 * 신규 훅은 폴백 셀렉터 없음: data-속성 부재 = 즉시 FAIL (fail-closed).
 * 굿하트 차단(설계서 §6): 삭제를 미뤄두고 undo 를 흉내(저장은 토스트 소멸 후) →
 * 삭제 직후 2초 내 저장소 부재 단언으로 차단 (전 localStorage 키 스캔).
 */
const { test, expect } = require('@playwright/test');
const {
  CALENDAR_PATH,
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
  addNote,
  setNoteText,
  noteIndexByText,
  pollVisibleNoteCount,
  hasVisibleNoteText,
} = require('../lib/helpers');

const CONTAINS_FN = (m) => Object.keys(localStorage).some((k) => (localStorage.getItem(k) || '').includes(m));
const NOT_CONTAINS_FN = (m) => !Object.keys(localStorage).some((k) => (localStorage.getItem(k) || '').includes(m));

/** [data-toast] visible + 내부 [data-undo] textContent "실행 취소" 포함 여부 (1회 평가) */
const UNDO_TOAST_VISIBLE_FN = () => {
  const effOpacity = (el) => {
    let o = 1;
    for (let c = el; c && c.nodeType === 1; c = c.parentElement) o *= parseFloat(getComputedStyle(c).opacity) || 0;
    return o;
  };
  const vis = (el) => {
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && s.display !== 'none' && s.visibility !== 'hidden' && effOpacity(el) > 0.05;
  };
  for (const toast of document.querySelectorAll('[data-toast]')) {
    if (!vis(toast)) continue;
    const undo = toast.querySelector('[data-undo]');
    if (undo && vis(undo) && (undo.textContent || '').includes('실행 취소')) return true;
  }
  return false;
};

async function pollUndoToast(page, label) {
  await pollPage(
    page,
    UNDO_TOAST_VISIBLE_FN,
    null,
    2000,
    `${label}: 삭제 직후 2초 내 [data-toast] 토스트와 그 안의 [data-undo]("실행 취소" 포함) 버튼이 표시되지 않았습니다 — rev.5 DOM 계약 미구현 (fail-closed)`
  );
  // 최소 5초 유지 규정: 1초 대기 후에도 클릭 가능해야 한다
  await sleep(1000);
  const still = await page.evaluate(UNDO_TOAST_VISIBLE_FN);
  expect(
    still,
    `${label}: [data-undo] 토스트가 1초 만에 사라졌습니다 (최소 5초 유지 규정 위반)`
  ).toBe(true);
}

async function clickUndo(page, label) {
  try {
    await page.locator('[data-toast] [data-undo]').first().click({ timeout: 3000 });
  } catch (e) {
    throw new Error(`${label}: [data-undo] 버튼을 클릭할 수 없습니다: ` + e.message);
  }
}

/* ── 포스트잇 ── */

async function deleteNoteByText(page, marker, label) {
  const idx = await noteIndexByText(page, marker);
  expect(idx >= 0, `${label}: "${marker}" 노트를 찾을 수 없습니다`).toBe(true);
  const noteLoc = page.locator(POSTIT_SEL.NOTE).nth(idx);
  try {
    await noteLoc.click({ timeout: 5000 });
    await noteLoc.hover();
  } catch (e) {
    throw new Error(`${label}: 삭제할 노트를 클릭할 수 없습니다: ` + e.message);
  }
  const del = noteLoc.locator(POSTIT_SEL.DELETE).first();
  let ok = (await del.count()) > 0;
  if (ok) {
    try {
      await del.click({ timeout: 3000 });
    } catch (e) {
      ok = false;
    }
  }
  if (!ok) throw new Error(`${label}: 노트 삭제 버튼([data-delete-note])을 찾거나 클릭할 수 없습니다`);
}

/* ── 캘린더 ── */

function dayCell(page, day) {
  return page.locator('#grid .cell:not(.other)', {
    has: page.locator(`.num:text-is("${day}")`),
  });
}

async function addViaForm(page, time, text) {
  if (time) await page.fill('#addTime', time);
  await page.fill('#addText', text);
  await page.click('#addBtn');
}

test.describe('A20 삭제 실행 취소', () => {
  test('A20: 포스트잇 — 삭제 즉시 저장 제거 + 실행 취소 토스트 → 클릭 시 복원·재기동 유지, 미클릭 시 계속 부재', async () => {
    requirePostit();
    const dir = freshProfileDir();
    const states = [];
    let app = null;
    const KEEP = 'A20-복원될-노트';
    const GONE = 'A20-소멸될-노트';
    try {
      // ── 기동 1: 노트 2개 생성 → 각각 삭제 (하나는 undo, 하나는 방치) ──
      app = await launchApp(dir, POSTIT_PATH);
      states.push(app.state);
      let page = app.page;
      await addNote(page);
      await pollVisibleNoteCount(page, 1, 5000, 'A20 포스트잇');
      await setNoteText(page, page.locator(POSTIT_SEL.NOTE).nth(0), KEEP);
      await pollPage(page, CONTAINS_FN, KEEP, 5000, `A20 포스트잇: "${KEEP}" 가 localStorage 에 저장되지 않았습니다`);
      await addNote(page);
      await pollVisibleNoteCount(page, 2, 5000, 'A20 포스트잇');
      await setNoteText(page, page.locator(POSTIT_SEL.NOTE).nth(1), GONE);
      await pollPage(page, CONTAINS_FN, GONE, 5000, `A20 포스트잇: "${GONE}" 가 localStorage 에 저장되지 않았습니다`);

      // 삭제 1 (undo 대상): 삭제 직후 2초 내 저장소 부재 (지연 삭제 차단)
      await deleteNoteByText(page, KEEP, 'A20 포스트잇');
      await pollPage(
        page,
        NOT_CONTAINS_FN,
        KEEP,
        2000,
        `A20 포스트잇: 삭제 직후 2초 내 "${KEEP}" 가 localStorage 에서 제거되지 않았습니다 (삭제를 미뤄 undo 를 흉내내는 지연 삭제 금지)`
      );
      await pollUndoToast(page, 'A20 포스트잇');
      await clickUndo(page, 'A20 포스트잇');

      // 복원: 저장소 + UI
      await pollPage(page, CONTAINS_FN, KEEP, 5000, `A20 포스트잇: 실행 취소 후 "${KEEP}" 가 localStorage 에 복원되지 않았습니다`);
      expect(
        await hasVisibleNoteText(page, KEEP),
        `A20 포스트잇: 실행 취소 후 "${KEEP}" 노트가 화면에 복원되지 않았습니다`
      ).toBe(true);

      // 삭제 2 (방치 대상): undo 미클릭
      await deleteNoteByText(page, GONE, 'A20 포스트잇');
      await pollPage(
        page,
        NOT_CONTAINS_FN,
        GONE,
        2000,
        `A20 포스트잇: 삭제 직후 2초 내 "${GONE}" 가 localStorage 에서 제거되지 않았습니다 (지연 삭제 금지)`
      );
      await pollUndoToast(page, 'A20 포스트잇');
      // 실행 취소를 누르지 않고 종료
      assertNoDialogs(app.state, 'A20 포스트잇');
      await closeApp(app);
      app = null;

      // ── 재기동: undo 한 노트 유지, 방치한 노트 계속 부재 ──
      app = await launchApp(dir, POSTIT_PATH);
      states.push(app.state);
      page = app.page;
      await pollVisibleNoteCount(page, 1, 5000, 'A20 포스트잇 재기동');
      expect(
        await hasVisibleNoteText(page, KEEP),
        `A20 포스트잇: 재기동 후 실행 취소로 복원한 "${KEEP}" 노트가 유지되지 않았습니다`
      ).toBe(true);
      expect(
        await hasVisibleNoteText(page, GONE),
        `A20 포스트잇: 실행 취소를 누르지 않은 "${GONE}" 노트가 재기동 후 되살아났습니다 (계속 부재여야 함)`
      ).toBe(false);
      await pollPage(page, NOT_CONTAINS_FN, GONE, 2000, `A20 포스트잇: 재기동 후에도 "${GONE}" 가 localStorage 에 남아 있습니다`);
      for (const s of states) assertNoDialogs(s, 'A20 포스트잇');
    } finally {
      await closeApp(app);
      await removeDirWithRetry(dir);
    }
  });

  test('A20: 캘린더 — 삭제 즉시 저장 제거 + 실행 취소 토스트 → 클릭 시 복원·재기동 유지, 미클릭 시 계속 부재', async () => {
    const dir = freshProfileDir();
    const states = [];
    let app = null;
    const KEEP = 'A20-복원될-일정';
    const GONE = 'A20-소멸될-일정';
    try {
      // ── 기동 1: 일정 2건 생성 → 각각 삭제 (하나는 undo, 하나는 방치) ──
      app = await launchApp(dir, CALENDAR_PATH);
      states.push(app.state);
      let page = app.page;
      await dayCell(page, 15).click();
      await addViaForm(page, '09:00', KEEP);
      await addViaForm(page, '10:00', GONE);
      await pollLocalStorage(page, 'cal-events', (raw) => !!raw && raw.includes(KEEP) && raw.includes(GONE), 5000);

      // 삭제 1 (undo 대상)
      await page.locator('#eventList li', { hasText: KEEP }).locator('button[title="삭제"]').click();
      await pollPage(
        page,
        NOT_CONTAINS_FN,
        KEEP,
        2000,
        `A20 캘린더: 삭제 직후 2초 내 "${KEEP}" 가 localStorage 에서 제거되지 않았습니다 (삭제를 미뤄 undo 를 흉내내는 지연 삭제 금지)`
      );
      await pollUndoToast(page, 'A20 캘린더');
      await clickUndo(page, 'A20 캘린더');

      // 복원: 저장소 + UI
      await pollPage(page, CONTAINS_FN, KEEP, 5000, `A20 캘린더: 실행 취소 후 "${KEEP}" 이(가) localStorage 에 복원되지 않았습니다`);
      await dayCell(page, 15).click();
      await expect(
        page.locator('#eventList li', { hasText: KEEP }),
        `A20 캘린더: 실행 취소 후 "${KEEP}" 일정이 목록에 복원되지 않았습니다`
      ).toBeVisible();

      // 삭제 2 (방치 대상)
      await page.locator('#eventList li', { hasText: GONE }).locator('button[title="삭제"]').click();
      await pollPage(
        page,
        NOT_CONTAINS_FN,
        GONE,
        2000,
        `A20 캘린더: 삭제 직후 2초 내 "${GONE}" 가 localStorage 에서 제거되지 않았습니다 (지연 삭제 금지)`
      );
      await pollUndoToast(page, 'A20 캘린더');
      // 실행 취소를 누르지 않고 종료
      assertNoDialogs(app.state, 'A20 캘린더');
      await closeApp(app);
      app = null;

      // ── 재기동: undo 한 일정 유지, 방치한 일정 계속 부재 ──
      app = await launchApp(dir, CALENDAR_PATH);
      states.push(app.state);
      page = app.page;
      await dayCell(page, 15).click();
      await expect(
        page.locator('#eventList li', { hasText: KEEP }),
        `A20 캘린더: 재기동 후 실행 취소로 복원한 "${KEEP}" 일정이 유지되지 않았습니다`
      ).toBeVisible();
      await expect(
        page.locator('#eventList li', { hasText: GONE }),
        `A20 캘린더: 실행 취소를 누르지 않은 "${GONE}" 일정이 재기동 후 되살아났습니다 (계속 부재여야 함)`
      ).toHaveCount(0);
      await pollPage(page, NOT_CONTAINS_FN, GONE, 2000, `A20 캘린더: 재기동 후에도 "${GONE}" 가 localStorage 에 남아 있습니다`);
      for (const s of states) assertNoDialogs(s, 'A20 캘린더');
    } finally {
      await closeApp(app);
      await removeDirWithRetry(dir);
    }
  });
});
