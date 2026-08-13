'use strict';
/**
 * A35 — 주간 뷰 (rev.5 설계서 §1 A35 / §2 A35, C6)
 * "[data-week-view] 토글 → [data-view-mode="week"] + 그 주의 날짜 셀 정확히 7개, 해당 주 3건의
 *  일정 텍스트가 그대로 표시 → 재토글 시 month 복귀(셀 28개 이상, 일정 무손실) → 주간 상태로
 *  재기동하면 주간 뷰로 열린다"
 *
 * ── rev.5 필수 DOM 계약 (설계서 §2 A35 — 그대로 기록) ──
 * [data-week-view] — 토글 버튼. [data-view-mode="month"|"week"] — 그리드 컨테이너 반영 속성
 * (판정 앵커). 날짜 셀은 .cell 또는 [data-day-cell]. 주간 뷰의 날짜 셀도 기존 셀 규약을 따르되
 * A7 전수 검사는 월간 뷰 기준 유지. 저장 키 cal-view.
 * 신규 훅은 폴백 셀렉터 없음: data-속성 부재 = 즉시 FAIL (fail-closed).
 *
 * 채점 절차: 뷰 월 15일이 속한 주(일~토, 항상 본월 내부)의 월·수·금에 일정 3건 생성 →
 * 주간 토글(마지막 선택 날짜의 주가 표시) → week 판정 → month 복귀 판정 → 주간 상태로 재기동
 * → week 로 열림(재기동 후 표시 주는 오늘 기준이므로 셀 수·모드만 판정) → 월간 전환 후 3건
 * 무손실 확인.
 */
const { test, expect } = require('@playwright/test');
const {
  CALENDAR_PATH,
  freshProfileDir,
  launchApp,
  closeApp,
  removeDirWithRetry,
  pollLocalStorage,
  requireHook,
  assertNoDialogs,
} = require('../lib/helpers');

const EVENTS = [
  { off: 1, text: 'A35-월요일-일정' },
  { off: 3, text: 'A35-수요일-일정' },
  { off: 5, text: 'A35-금요일-일정' },
];

const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

function readMonth(page) {
  return page.evaluate(() => {
    const m = document.getElementById('monthTitle').textContent.match(/(\d+)년\s*(\d+)월/);
    return m ? { y: Number(m[1]), m: Number(m[2]) } : null;
  });
}

async function gotoMonth(page, y, m, label) {
  for (let guard = 0; guard < 40; guard++) {
    const cur = await readMonth(page);
    if (!cur) throw new Error(`${label}: #monthTitle 에서 연·월을 읽을 수 없습니다`);
    const diff = y * 12 + m - (cur.y * 12 + cur.m);
    if (diff === 0) return;
    await page.click(diff > 0 ? '#nextBtn' : '#prevBtn');
  }
  throw new Error(`${label}: 월 이동으로 ${y}년 ${m}월에 도달하지 못했습니다`);
}

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

/** [data-view-mode] 컨테이너의 모드 + 날짜 셀(.cell 또는 [data-day-cell]) 수 */
async function viewInfo(page, label) {
  await requireHook(page, '[data-view-mode]', label);
  return page.evaluate(() => {
    const c = document.querySelector('[data-view-mode]');
    return {
      mode: c.getAttribute('data-view-mode'),
      cells: c.querySelectorAll('.cell, [data-day-cell]').length,
    };
  });
}

async function assertMode(page, wantMode, cellPredicate, cellDesc, label) {
  const info = await viewInfo(page, label);
  expect(
    info.mode,
    `${label}: [data-view-mode] 가 "${info.mode}" 입니다 ("${wantMode}" 이어야 함)`
  ).toBe(wantMode);
  expect(
    cellPredicate(info.cells),
    `${label}: 날짜 셀이 ${info.cells}개입니다 (${cellDesc}이어야 함)`
  ).toBe(true);
}

/** [data-view-mode] 컨테이너 안 셀에 텍스트 visible 단언 */
async function expectEventVisible(page, text, label) {
  await expect(
    page.locator('[data-view-mode] .cell, [data-view-mode] [data-day-cell]').filter({ hasText: text }).first(),
    `${label}: 일정 "${text}" 이(가) 그리드에 표시되지 않았습니다 (일정 무손실 위반)`
  ).toBeVisible({ timeout: 5000 });
}

test.describe('A35 주간 뷰', () => {
  test('A35: [data-week-view] 토글 → week(셀 7개·일정 3건 표시) → month 복귀(셀 ≥28·무손실) → 주간 상태 재기동 시 week 로 열림', async () => {
    const dir = freshProfileDir();
    const states = [];
    let app = null;
    try {
      // ── 기동 1 ──
      app = await launchApp(dir, CALENDAR_PATH);
      states.push(app.state);
      let page = app.page;
      await requireHook(page, '[data-week-view]', 'A35');
      await requireHook(page, '[data-view-mode]', 'A35');

      // 뷰 월 15일이 속한 주(일~토)의 월·수·금 — 9~21일 범위라 항상 본월 내부
      const cur = await readMonth(page);
      expect(cur, 'A35: #monthTitle 에서 연·월을 읽을 수 없습니다').not.toBeNull();
      const base = new Date(cur.y, cur.m - 1, 15);
      const sunday = addDays(base, -base.getDay());
      for (const ev of EVENTS) {
        const d = addDays(sunday, ev.off);
        await dayCell(page, d.getDate()).click();
        await addViaForm(page, '', ev.text);
      }
      await pollLocalStorage(
        page,
        'cal-events',
        (raw) => !!raw && EVENTS.every((ev) => raw.includes(ev.text)),
        5000
      );

      // 주간 토글 → week + 셀 정확히 7개 + 3건 표시 (마지막 선택 날짜의 주 = 일정 주)
      await page.locator('[data-week-view]').first().click();
      await assertMode(page, 'week', (n) => n === 7, '그 주의 날짜 셀 정확히 7개', 'A35 주간');
      for (const ev of EVENTS) await expectEventVisible(page, ev.text, 'A35 주간');

      // 재토글 → month 복귀 + 셀 ≥ 28 + 일정 무손실
      await page.locator('[data-week-view]').first().click();
      await assertMode(page, 'month', (n) => n >= 28, '28개 이상', 'A35 월간 복귀');
      for (const ev of EVENTS) await expectEventVisible(page, ev.text, 'A35 월간 복귀');

      // 주간 상태로 전환 → 저장 키 cal-view 폴링 (설계서 §2 A35)
      await page.locator('[data-week-view]').first().click();
      await assertMode(page, 'week', (n) => n === 7, '그 주의 날짜 셀 정확히 7개', 'A35 주간 재전환');
      await pollLocalStorage(page, 'cal-view', (raw) => !!raw && raw.includes('week'), 2000);

      assertNoDialogs(app.state, 'A35');
      await closeApp(app);
      app = null;

      // ── 재기동: 주간 뷰로 열림 (표시 주는 오늘 기준 — 모드·셀 수 판정) ──
      app = await launchApp(dir, CALENDAR_PATH);
      states.push(app.state);
      page = app.page;
      await assertMode(page, 'week', (n) => n === 7, '그 주의 날짜 셀 정확히 7개', 'A35 재기동');

      // 월간 전환 후 3건 무손실 확인
      await page.locator('[data-week-view]').first().click();
      await assertMode(page, 'month', (n) => n >= 28, '28개 이상', 'A35 재기동 월간');
      await gotoMonth(page, cur.y, cur.m, 'A35 재기동');
      for (const ev of EVENTS) await expectEventVisible(page, ev.text, 'A35 재기동 월간');

      for (const s of states) assertNoDialogs(s, 'A35');
    } finally {
      await closeApp(app);
      await removeDirWithRetry(dir);
    }
  });
});
