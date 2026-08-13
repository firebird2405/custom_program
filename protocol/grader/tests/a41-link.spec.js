'use strict';
/**
 * A41 — 포스트잇 날짜 지정 → 캘린더 일정 연동 (rev.5 설계서 §1 A41 / §2 A41)
 * "노트 메뉴 '날짜 지정'([data-note-date] date 입력)으로 날짜 D 저장 → 2초 내 cal-events 의 D 에
 *  {id, time:\"\", text:\"📌 \"+노트텍스트} 가 정확히 1건 생기고 같은 프로필로 calendar.html 을 열면
 *  D 셀에 그 텍스트가 visible → 같은 날짜를 다시 저장해도 여전히 1건(중복 0), 날짜를 D2 로 바꾸면
 *  D 의 연동 일정은 제거되고 D2 에 1건, 날짜 해제 시 연동 일정이 제거되어 재기동 후에도 부재,
 *  기존 수동 일정은 불변이다"
 *
 * ── rev.5 필수 DOM 계약 (설계서 §2 A41 — 그대로 기록) ──
 * 노트 컨텍스트 메뉴 항목 라벨 "날짜 지정"([data-ctx-item]), 입력 [data-note-date](input[type=date]),
 * 해제 진입점 라벨 "날짜 해제" 또는 입력 clear+저장. 연동 일정은 additive `id` 필드 보유(기존
 * {time,text} 소비자와 하위호환), 동일 노트 재저장은 upsert. 수동 일정(다른 id)은 절대 불변 —
 * id 기반 매칭 강제. 신규 훅은 폴백 셀렉터 없음 (fail-closed).
 * 날짜는 상수 대신 채점기 실행 시점 +30일(D)·+31일(D2)을 산출해 사용 (설계서 §2 A41).
 *
 * 참고(설계서 §2 A41 설계 유의): 실사용 launch 프로필은 앱별 분리(A13)라 창 간 실시간 동기화는
 * rev.5 범위 밖 — 본 항목은 동일 origin·동일 프로필 내 저장소 연동만 채점한다.
 */
const { test, expect } = require('@playwright/test');
const {
  CALENDAR_PATH,
  POSTIT_PATH,
  fileUrl,
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
  pollVisibleNoteCount,
  openContextMenuOn,
} = require('../lib/helpers');

const NOTE_TEXT = '우유 사기';
const LINKED_TEXT = '📌 ' + NOTE_TEXT;
const MANUAL_ID = 'manual-a41';
const MANUAL_TEXT = 'A41-수동-일정';

function pad(n) {
  return String(n).padStart(2, '0');
}
function keyOfDate(d) {
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}

/** cal-events raw 에서 dateKey 의 연동 일정({time:'', text:LINKED_TEXT, id 보유}) 목록 추출 */
function linkedItems(raw, dateKey) {
  let obj = null;
  try {
    obj = JSON.parse(raw);
  } catch (e) {
    return null;
  }
  if (!obj || typeof obj !== 'object') return null;
  const arr = Array.isArray(obj[dateKey]) ? obj[dateKey] : [];
  return arr.filter(
    (it) => it && typeof it === 'object' && it.text === LINKED_TEXT && it.time === '' && typeof it.id === 'string' && it.id
  );
}

/** cal-events raw 전체에서 특정 id 항목이 존재하는지 */
function idAnywhere(raw, id) {
  let obj = null;
  try {
    obj = JSON.parse(raw);
  } catch (e) {
    return false;
  }
  if (!obj || typeof obj !== 'object') return false;
  for (const k of Object.keys(obj)) {
    const arr = obj[k];
    if (!Array.isArray(arr)) continue;
    if (arr.some((it) => it && typeof it === 'object' && it.id === id)) return true;
  }
  return false;
}

/** 수동 일정 불변 단언: dateKey 에 MANUAL_ID 일정이 정확히 1건, 텍스트 그대로 */
function manualIntact(raw, dateKey) {
  let obj = null;
  try {
    obj = JSON.parse(raw);
  } catch (e) {
    return false;
  }
  if (!obj || typeof obj !== 'object') return false;
  const arr = Array.isArray(obj[dateKey]) ? obj[dateKey] : [];
  const hits = arr.filter((it) => it && it.id === MANUAL_ID);
  return hits.length === 1 && hits[0].text === MANUAL_TEXT;
}

async function readCalRaw(page) {
  return page.evaluate(() => {
    try {
      return localStorage.getItem('cal-events');
    } catch (e) {
      return null;
    }
  });
}

/** 노트 컨텍스트 메뉴를 열고 '날짜 지정' 행의 [data-note-date] 입력 locator 반환 (fail-closed) */
async function openDateMenu(page) {
  await openContextMenuOn(page, page.locator(POSTIT_SEL.NOTE).nth(0));
  const label = page.locator('[data-ctx-menu] [data-ctx-item]', { hasText: '날짜 지정' });
  await pollPage(
    page,
    () => {
      const menu = document.querySelector('[data-ctx-menu]');
      if (!menu) return false;
      const r = menu.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    },
    null,
    3000,
    "A41: 노트 contextmenu 디스패치 후 [data-ctx-menu] 가 열리지 않았습니다"
  );
  expect(
    (await label.count()) > 0,
    'A41: 노트 컨텍스트 메뉴에 "날짜 지정" 항목([data-ctx-item])이 없습니다 — rev.5 DOM 계약 미구현 (fail-closed)'
  ).toBe(true);
  const input = page.locator('[data-ctx-menu] [data-note-date]').first();
  expect(
    (await input.count()) > 0,
    'A41: 필수 훅 [data-note-date](input[type=date]) 가 노트 컨텍스트 메뉴에 없습니다 — rev.5 DOM 계약 미구현 (fail-closed)'
  ).toBe(true);
  return input;
}

async function closeMenu(page) {
  await page.keyboard.press('Escape');
  await sleep(150);
}

test.describe('A41 포스트잇 날짜 지정 → 캘린더 일정', () => {
  test('A41: 날짜 지정·재저장 upsert·날짜 변경·해제 왕복 + 수동 일정 불변', async () => {
    requirePostit();
    test.setTimeout(120 * 1000);
    const dir = freshProfileDir();
    const states = [];
    let app = null;

    const base = new Date();
    const D = keyOfDate(new Date(base.getFullYear(), base.getMonth(), base.getDate() + 30));
    const D2 = keyOfDate(new Date(base.getFullYear(), base.getMonth(), base.getDate() + 31));

    try {
      // ── 기동 1: postit — 수동 일정 사전 심기 + 노트 생성 ──
      app = await launchApp(dir, POSTIT_PATH);
      states.push(app.state);
      let page = app.page;

      await page.evaluate(
        ({ D, MANUAL_ID, MANUAL_TEXT }) => {
          const obj = {};
          obj[D] = [{ id: MANUAL_ID, time: '', text: MANUAL_TEXT }];
          localStorage.setItem('cal-events', JSON.stringify(obj));
        },
        { D, MANUAL_ID, MANUAL_TEXT }
      );

      await addNote(page);
      await pollVisibleNoteCount(page, 1, 5000, 'A41');
      await setNoteText(page, page.locator(POSTIT_SEL.NOTE).nth(0), NOTE_TEXT);
      await pollLocalStorage(page, 'postit-notes', (raw) => !!raw && raw.includes(NOTE_TEXT), 5000);

      // ── 날짜 D 지정 → 2초 내 cal-events D 에 연동 일정 정확히 1건 ──
      let dateInput = await openDateMenu(page);
      await dateInput.fill(D);
      const rawAfterSet = await pollLocalStorage(
        page,
        'cal-events',
        (raw) => {
          const l = linkedItems(raw, D);
          return !!l && l.length === 1;
        },
        2000
      );
      const linkedId = linkedItems(rawAfterSet, D)[0].id;
      expect(
        manualIntact(rawAfterSet, D),
        `A41: 날짜 지정 직후 사전 심은 수동 일정(id "${MANUAL_ID}")이 훼손되었습니다`
      ).toBe(true);
      await closeMenu(page);

      // ── 같은 날짜 재저장(메뉴 재진입 → 동일 날짜 확인 → change 재발화) → 여전히 1건 ──
      dateInput = await openDateMenu(page);
      const shownDate = await dateInput.inputValue();
      expect(
        shownDate,
        `A41: 메뉴 재진입 시 [data-note-date] 값이 지정한 날짜 ${D} 를 보여주지 않습니다 (실제 "${shownDate}")`
      ).toBe(D);
      await dateInput.evaluate((el) => {
        el.dispatchEvent(new Event('change', { bubbles: true }));
      });
      await sleep(800);
      const rawAfterResave = await readCalRaw(page);
      const afterResave = linkedItems(rawAfterResave, D);
      expect(
        !!afterResave && afterResave.length === 1 && afterResave[0].id === linkedId,
        `A41: 같은 날짜를 다시 저장하자 연동 일정이 ${afterResave ? afterResave.length : '파싱 불가'}건이 되었습니다 ` +
          '(upsert 로 정확히 1건 유지 필요 — 중복 생성 금지)'
      ).toBe(true);
      expect(manualIntact(rawAfterResave, D), 'A41: 재저장 후 수동 일정이 훼손되었습니다').toBe(true);
      await closeMenu(page);

      // ── 같은 프로필로 calendar.html: D 셀에 텍스트 visible ──
      await page.goto(fileUrl(CALENDAR_PATH), { waitUntil: 'load' });
      await page.waitForSelector('#grid .cell', { timeout: 5000 });
      const diffMonths =
        (Number(D.slice(0, 4)) - base.getFullYear()) * 12 + (Number(D.slice(5, 7)) - 1 - base.getMonth());
      for (let i = 0; i < diffMonths; i++) await page.click('#nextBtn');
      for (let i = 0; i < -diffMonths; i++) await page.click('#prevBtn');
      await pollPage(
        page,
        ({ D, LINKED_TEXT }) => {
          const cells = Array.from(document.querySelectorAll('#grid .cell'));
          const cell = cells.find((c) => c.dataset.key === D && !c.classList.contains('other'));
          if (!cell) return false;
          const r = cell.getBoundingClientRect();
          const s = getComputedStyle(cell);
          if (!(r.width > 0 && r.height > 0 && s.display !== 'none' && s.visibility !== 'hidden')) return false;
          return (cell.textContent || '').includes(LINKED_TEXT);
        },
        { D, LINKED_TEXT },
        5000,
        `A41: calendar.html 의 ${D} 셀에 연동 일정 텍스트 "${LINKED_TEXT}" 가 visible 하지 않습니다`
      );

      // ── postit 복귀 → 날짜 D2 로 변경: D 에서 제거·D2 에 1건 ──
      await page.goto(fileUrl(POSTIT_PATH), { waitUntil: 'load' });
      await pollVisibleNoteCount(page, 1, 5000, 'A41 복귀');
      dateInput = await openDateMenu(page);
      await dateInput.fill(D2);
      const rawAfterMove = await pollLocalStorage(
        page,
        'cal-events',
        (raw) => {
          const l2 = linkedItems(raw, D2);
          const l1 = linkedItems(raw, D);
          return !!l2 && !!l1 && l2.length === 1 && l1.length === 0;
        },
        2000
      );
      const movedItems = linkedItems(rawAfterMove, D2);
      expect(
        movedItems.length === 1,
        `A41: 날짜를 ${D2} 로 바꾼 뒤 D2 의 연동 일정이 ${movedItems.length}건입니다 (정확히 1건 필요)`
      ).toBe(true);
      expect(
        linkedItems(rawAfterMove, D).length === 0,
        `A41: 날짜를 ${D2} 로 바꿨지만 이전 날짜 ${D} 의 연동 일정이 제거되지 않았습니다`
      ).toBe(true);
      expect(manualIntact(rawAfterMove, D), 'A41: 날짜 변경 후 수동 일정이 훼손되었습니다 (id 기반 매칭 필요)').toBe(true);
      const movedId = movedItems[0].id;
      await closeMenu(page);

      // ── 날짜 해제: 라벨 "날짜 해제" 우선, 없으면 입력 clear (설계서 허용 2경로) ──
      dateInput = await openDateMenu(page);
      const clearItem = page.locator('[data-ctx-menu] [data-ctx-item]', { hasText: '날짜 해제' }).first();
      if ((await clearItem.count()) > 0) {
        await clearItem.click({ timeout: 3000 });
      } else {
        await dateInput.fill('');
      }
      await pollLocalStorage(page, 'cal-events', (raw) => !idAnywhere(raw, movedId) && !idAnywhere(raw, linkedId), 2000);
      const rawAfterClear = await readCalRaw(page);
      expect(manualIntact(rawAfterClear, D), 'A41: 날짜 해제 후 수동 일정이 훼손되었습니다').toBe(true);
      assertNoDialogs(app.state, 'A41');
      expect(
        app.state.pageErrors,
        `A41: pageerror ${app.state.pageErrors.length}건 발생 (0건이어야 함): ${app.state.pageErrors.join(' | ')}`
      ).toHaveLength(0);
      await closeApp(app);
      app = null;

      // ── 재기동: 연동 일정 계속 부재 + 수동 일정 불변 ──
      app = await launchApp(dir, POSTIT_PATH);
      states.push(app.state);
      page = app.page;
      await pollVisibleNoteCount(page, 1, 5000, 'A41 재기동');
      const rawFinal = await readCalRaw(page);
      expect(
        !idAnywhere(rawFinal, movedId) && !idAnywhere(rawFinal, linkedId),
        'A41: 날짜 해제한 연동 일정이 재기동 후 cal-events 에 되살아났습니다 (계속 부재여야 함)'
      ).toBe(true);
      expect(manualIntact(rawFinal, D), 'A41: 재기동 후 수동 일정이 훼손되었습니다').toBe(true);
      for (const s of states) assertNoDialogs(s, 'A41');
    } finally {
      await closeApp(app);
      await removeDirWithRetry(dir);
    }
  });
});
