'use strict';
/**
 * A6 — 캘린더 일정 영속성 (SCORECARD A6)
 *  - 페이지 내 DOM 입력요소(시간·텍스트 입력 + 추가 버튼)로 일정 추가 (전 테스트 공통 dialog 0건)
 *  - 재기동(launchPersistentContext 동일 user-data-dir close 후 재기동) → 같은 날짜에 관찰
 *  - 일정 30건 생성 후 재기동 시 전량(정확히 30건) 보존 — 조용한 상한 차단
 */
const { test, expect } = require('@playwright/test');
const {
  CALENDAR_PATH,
  launchApp,
  closeApp,
  freshProfileDir,
  removeDirWithRetry,
  pollLocalStorage,
} = require('../lib/helpers');

const STORE_KEY = 'cal-events';

/** 현재 표시 달의 (다른 달 아님) 날짜 셀 로케이터 */
function dayCell(page, day) {
  return page.locator('#grid .cell:not(.other)', {
    has: page.locator(`.num:text-is("${day}")`),
  });
}

/** 현재 표시 달 기준 YYYY-MM-DD 키 계산 (#monthTitle "YYYY년 M월" 파싱) */
function dateKeyOfViewedMonth(page, day) {
  return page.evaluate((d) => {
    const m = document.getElementById('monthTitle').textContent.match(/(\d+)년\s*(\d+)월/);
    const pad = (n) => String(n).padStart(2, '0');
    return m[1] + '-' + pad(Number(m[2])) + '-' + pad(d);
  }, day);
}

/** 페이지 내 DOM 입력요소로 일정 추가 (시간 입력 + 텍스트 입력 + 추가 버튼) */
async function addViaForm(page, time, text) {
  if (time) await page.fill('#addTime', time);
  await page.fill('#addText', text);
  await page.click('#addBtn');
}

function parseStore(raw) {
  try {
    const o = JSON.parse(raw);
    return o && typeof o === 'object' && !Array.isArray(o) ? o : null;
  } catch (e) {
    return null;
  }
}

function assertNoDialogs(states) {
  const all = states.reduce((acc, s) => acc.concat(s.dialogs), []);
  expect(
    all,
    `dialog ${all.length}건 발생 (A9 외 0건이어야 함): ${all.map((d) => d.type + ':' + d.message).join(' | ')}`
  ).toHaveLength(0);
}

test.describe('A6 캘린더 일정 영속성', () => {
  test('A6: DOM 입력으로 일정 추가 → 재기동 → 같은 날짜에 관찰', async () => {
    const dir = freshProfileDir();
    const states = [];
    let app = null;
    try {
      app = await launchApp(dir, CALENDAR_PATH);
      states.push(app.state);
      const page = app.page;

      await dayCell(page, 15).click();
      const key = await dateKeyOfViewedMonth(page, 15);
      await addViaForm(page, '13:45', '재기동 확인 일정');
      await pollLocalStorage(page, STORE_KEY, (raw) => {
        const o = parseStore(raw);
        return (
          !!o &&
          Array.isArray(o[key]) &&
          o[key].some((e) => e && e.text === '재기동 확인 일정' && e.time === '13:45')
        );
      });
      await closeApp(app);

      app = await launchApp(dir, CALENDAR_PATH);
      states.push(app.state);
      const page2 = app.page;
      await dayCell(page2, 15).click();
      const li = page2.locator('#eventList li', { hasText: '재기동 확인 일정' });
      await expect(
        li,
        `재기동 후 같은 날짜(${key})에 "재기동 확인 일정"이 보이지 않습니다`
      ).toBeVisible();
      await expect(li, '재기동 후 일정의 시간(13:45)이 함께 표시되지 않습니다').toContainText('13:45');

      assertNoDialogs(states);
    } finally {
      await closeApp(app);
      await removeDirWithRetry(dir);
    }
  });

  test('A6: 일정 30건 생성 → 재기동 → 정확히 30건 전량 보존', async () => {
    const dir = freshProfileDir();
    const states = [];
    const pad2 = (n) => String(n).padStart(2, '0');
    let app = null;
    try {
      app = await launchApp(dir, CALENDAR_PATH);
      states.push(app.state);
      const page = app.page;

      await dayCell(page, 15).click();
      const key = await dateKeyOfViewedMonth(page, 15);
      for (let i = 1; i <= 30; i++) {
        await addViaForm(page, `09:${pad2(i - 1)}`, `부하 테스트 일정 ${pad2(i)}`);
      }
      await pollLocalStorage(page, STORE_KEY, (raw) => {
        const o = parseStore(raw);
        return !!o && Array.isArray(o[key]) && o[key].length === 30;
      });
      await closeApp(app);

      app = await launchApp(dir, CALENDAR_PATH);
      states.push(app.state);
      const page2 = app.page;

      const raw = await page2.evaluate((k) => localStorage.getItem(k), STORE_KEY);
      const store = parseStore(raw);
      expect(store, '재기동 후 저장소(cal-events)를 JSON 객체로 해석할 수 없습니다').not.toBeNull();
      const list = (store && store[key]) || [];
      expect(
        list.length,
        `재기동 후 ${key}의 저장 일정이 ${list.length}건입니다 (정확히 30건 전량 보존이어야 함 — 조용한 상한 의심)`
      ).toBe(30);
      for (let i = 1; i <= 30; i++) {
        const t = `부하 테스트 일정 ${pad2(i)}`;
        const n = list.filter((e) => e && e.text === t).length;
        expect(n, `"${t}" 이(가) 저장소에 ${n}건입니다 (정확히 1건이어야 함)`).toBe(1);
      }

      await dayCell(page2, 15).click();
      const liCount = await page2.locator('#eventList li').count();
      expect(
        liCount,
        `재기동 후 화면의 일정 목록이 ${liCount}건입니다 (30건이어야 함)`
      ).toBe(30);

      assertNoDialogs(states);
    } finally {
      await closeApp(app);
      await removeDirWithRetry(dir);
    }
  });
});
