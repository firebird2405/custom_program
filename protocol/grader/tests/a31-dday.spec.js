'use strict';
/**
 * A31 — D-day 배지 (rev.5 설계서 §1 A31 / §2 A31, C2)
 * "채점기 시계 기준 n일 뒤(테스트는 n=3) 날짜의 일정을 [data-dday] 로 기념일 지정 →
 *  [data-dday-badge] 텍스트가 채점기가 자기 시계로 산출한 "D-3" 과 일치(당일 지정 시 "D-day"),
 *  재기동 후 유지된다"
 *
 * ── rev.5 필수 DOM 계약 (설계서 §2 A31 — 그대로 기록) ──
 * [data-dday] — 추가/수정 폼의 체크박스(라벨 "기념일" 또는 "D-day" 포함).
 * [data-dday-badge] — 배지 요소, textContent 형식 D-n(n=잔여 일수, 자정 기준 달력일 산술) /
 * 당일 D-day(대소문자 무시) / 경과 D+n. 날짜 산술은 로컬 자정 기준(시간 성분 무시).
 * 신규 훅은 폴백 셀렉터 없음: data-속성 부재 = 즉시 FAIL (fail-closed).
 *
 * 굿하트 차단 (설계서 §6): 배지 문자열 하드코딩 → 기대값은 채점기 실행 시점 산술로 대조
 * (매 단언 시점에 재산출 — 자정 경과에도 안전). 클록 모킹 금지 (설계서 §5) — 실시간 기준.
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

const pad2 = (n) => String(n).padStart(2, '0');
const isoOf = (d) => d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

/** 채점기 자기 산술: 로컬 자정 기준 달력일 차이 → 기대 배지 문자열 (하드코딩 차단) */
function ddayExpected(targetKey) {
  const n = new Date();
  const t0 = new Date(n.getFullYear(), n.getMonth(), n.getDate());
  const p = targetKey.split('-').map(Number);
  const t1 = new Date(p[0], p[1] - 1, p[2]);
  const diff = Math.round((t1.getTime() - t0.getTime()) / 86400000);
  if (diff === 0) return 'D-day';
  return diff > 0 ? 'D-' + diff : 'D+' + -diff;
}

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

/** targetKey 날짜 셀의 [data-dday-badge] 텍스트가 채점기 산술 기대값과 일치하는지 단언 */
async function assertBadge(page, targetKey, label) {
  await gotoMonth(page, Number(targetKey.slice(0, 4)), Number(targetKey.slice(5, 7)), label);
  const day = Number(targetKey.slice(8, 10));
  const badge = dayCell(page, day).locator('[data-dday-badge]').first();
  let n = 0;
  try {
    await badge.waitFor({ state: 'visible', timeout: 5000 });
    n = 1;
  } catch (e) {}
  if (n === 0) {
    throw new Error(
      `${label}: ${targetKey} 셀에 [data-dday-badge] 배지가 표시되지 않았습니다 — rev.5 DOM 계약 미구현 (fail-closed: 폴백 셀렉터 없음)`
    );
  }
  const got = ((await badge.textContent()) || '').replace(/\s+/g, ' ').trim();
  const want = ddayExpected(targetKey); // 단언 시점에 재산출 (채점기 자기 시계 산술)
  expect(
    got.toUpperCase() === want.toUpperCase(),
    `${label}: ${targetKey} 셀의 [data-dday-badge] 텍스트가 "${got}" 입니다 (채점기 산술 기대값 "${want}" 와 일치해야 함 — 로컬 자정 기준 달력일 산술)`
  ).toBe(true);
}

test.describe('A31 D-day 배지', () => {
  test('A31: [data-dday] 기념일 지정 → [data-dday-badge] = 채점기 산술 "D-3" (당일은 "D-day") → 재기동 유지', async () => {
    const dir = freshProfileDir();
    const states = [];
    let app = null;
    const TODAY_TEXT = 'A31-당일-기념일';
    const D3_TEXT = 'A31-사흘뒤-기념일';
    try {
      // ── 기동 1 ──
      app = await launchApp(dir, CALENDAR_PATH);
      states.push(app.state);
      let page = app.page;
      await requireHook(page, '[data-dday]', 'A31');

      const now = new Date(); // 채점기 시계
      const todayKey = isoOf(now);
      const d3Key = isoOf(addDays(now, 3)); // n=3 — 채점기 실행 시점 산출 (월 경계 시 월 이동)

      // 당일 기념일: 오늘 셀 선택 → [data-dday] 체크 → 추가
      await gotoMonth(page, now.getFullYear(), now.getMonth() + 1, 'A31');
      await dayCell(page, now.getDate()).click();
      await page.locator('[data-dday]').first().check();
      await page.fill('#addText', TODAY_TEXT);
      await page.click('#addBtn');

      // D+3 기념일
      await gotoMonth(page, Number(d3Key.slice(0, 4)), Number(d3Key.slice(5, 7)), 'A31');
      await dayCell(page, Number(d3Key.slice(8, 10))).click();
      await page.locator('[data-dday]').first().check();
      await page.fill('#addText', D3_TEXT);
      await page.click('#addBtn');

      await pollLocalStorage(
        page,
        'cal-events',
        (raw) => !!raw && raw.includes(TODAY_TEXT) && raw.includes(D3_TEXT),
        5000
      );

      // 배지 대조 — 기대값은 채점기 자기 시계 산술 (하드코딩 차단)
      await assertBadge(page, d3Key, 'A31');    // 통상 "D-3"
      await assertBadge(page, todayKey, 'A31'); // "D-day" (대소문자 무시)

      assertNoDialogs(app.state, 'A31');
      await closeApp(app);
      app = null;

      // ── 재기동: 기념일 지정과 배지 유지 ──
      app = await launchApp(dir, CALENDAR_PATH);
      states.push(app.state);
      page = app.page;
      await assertBadge(page, d3Key, 'A31 재기동');
      await assertBadge(page, todayKey, 'A31 재기동');

      for (const s of states) assertNoDialogs(s, 'A31');
    } finally {
      await closeApp(app);
      await removeDirWithRetry(dir);
    }
  });
});
