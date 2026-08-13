'use strict';
/**
 * A34 — 카테고리 색 (rev.5 설계서 §1 A34 / §2 A34, C5)
 * "[data-category] 카테고리 색 ≥3(쌍별 RGB 유클리드 거리 ≥ 100) — 특정 카테고리로 일정 생성 시
 *  그 일정의 그리드 점/배지([data-event-dot])의 computed 색이 선택 카테고리 색과 채널별 ±3 이내로
 *  일치하고 다른 카테고리 일정과 상이하며 재기동 후 유지된다"
 *
 * ── rev.5 필수 DOM 계약 (설계서 §2 A34 — 그대로 기록) ──
 * [data-category] — 추가/수정 폼의 카테고리 선택 UI. 견본 [data-category-color]
 * (견본 자신의 computed background-color = 적용 색; A3 팔레트 규약과 동형).
 * [data-event-dot] — 그리드 내 일정 표식(점·바·배지 무엇이든 background-color 로 카테고리 색 표현).
 * 저장은 일정 additive 필드 (cal-events 스키마 하위호환 — B 조항).
 * 신규 훅은 폴백 셀렉터 없음: data-속성 부재 = 즉시 FAIL (fail-closed).
 *
 * 채점 절차: 견본 2번(인덱스 1)로 일정 A(14일), 견본 3번(인덱스 2)로 일정 B(15일) 생성 —
 * 셀당 일정 1건이라 점↔일정 대응이 유일하다. 재기동 후 동일 단언.
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
  parseRgb,
  rgbDist,
} = require('../lib/helpers');

const A_TEXT = 'A34-카테고리2-일정';
const B_TEXT = 'A34-카테고리3-일정';

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

/** [data-category-color] 견본들의 computed background-color 수집 + 개수·쌍별 거리 검증 */
async function collectSwatches(page, label) {
  await requireHook(page, '[data-category]', label);
  await requireHook(page, '[data-category-color]', label);
  const raw = await page.evaluate(() =>
    Array.from(document.querySelectorAll('[data-category-color]')).map((el) => getComputedStyle(el).backgroundColor)
  );
  expect(
    raw.length >= 3,
    `${label}: 카테고리 색 견본([data-category-color])이 ${raw.length}개입니다 (3개 이상이어야 함)`
  ).toBe(true);
  const rgbs = raw.map((s, i) => {
    const c = parseRgb(s);
    if (!c) throw new Error(`${label}: 견본 ${i + 1}번의 background-color 를 해석할 수 없습니다: "${s}"`);
    return c;
  });
  for (let i = 0; i < rgbs.length; i++) {
    for (let j = i + 1; j < rgbs.length; j++) {
      const d = rgbDist(rgbs[i], rgbs[j]);
      expect(
        d >= 100,
        `${label}: 카테고리 견본 ${i + 1}번(${raw[i]})과 ${j + 1}번(${raw[j]})의 RGB 유클리드 거리가 ${d.toFixed(1)} 입니다 (쌍별 100 이상이어야 함)`
      ).toBe(true);
    }
  }
  return rgbs;
}

/** day 셀 안에서 해당 일정 텍스트에 대응하는 [data-event-dot] 의 computed background-color */
async function cellDotColor(page, day, text, label) {
  const res = await page.evaluate(
    ({ day, text }) => {
      const cells = Array.from(document.querySelectorAll('#grid .cell:not(.other)'));
      const cell = cells.find((c) => {
        const n = c.querySelector('.num');
        return n && n.textContent.trim() === String(day);
      });
      if (!cell) return { err: '해당 날짜 셀을 찾을 수 없음' };
      const dots = Array.from(cell.querySelectorAll('[data-event-dot]'));
      if (dots.length === 0) return { err: '[data-event-dot] 부재' };
      const byText = dots.find((d) => d.parentElement && (d.parentElement.textContent || '').includes(text));
      const dot = byText || (dots.length === 1 ? dots[0] : null);
      if (!dot) return { err: `일정 텍스트 "${text}" 에 대응하는 [data-event-dot] 을 특정할 수 없음` };
      return { color: getComputedStyle(dot).backgroundColor };
    },
    { day, text }
  );
  if (res.err) {
    throw new Error(
      `${label}: ${day}일 셀의 일정 "${text}" 그리드 표식을 확인할 수 없습니다 — ${res.err} (rev.5 DOM 계약, fail-closed)`
    );
  }
  const c = parseRgb(res.color);
  if (!c) throw new Error(`${label}: [data-event-dot] 색을 해석할 수 없습니다: "${res.color}"`);
  return c;
}

/** 채널별 ±3 일치 단언 */
function assertChannelClose(got, want, what, label) {
  const ok = Math.abs(got.r - want.r) <= 3 && Math.abs(got.g - want.g) <= 3 && Math.abs(got.b - want.b) <= 3;
  expect(
    ok,
    `${label}: ${what} 의 색 rgb(${got.r},${got.g},${got.b}) 이(가) 선택 카테고리 견본 색 rgb(${want.r},${want.g},${want.b}) 과 채널별 ±3 이내로 일치하지 않습니다`
  ).toBe(true);
}

/** 점 2개 검증 (일치 + 상호 상이) — 생성 직후·재기동 후 공용 */
async function assertDots(page, swatches, label) {
  const dotA = await cellDotColor(page, 14, A_TEXT, label);
  const dotB = await cellDotColor(page, 15, B_TEXT, label);
  assertChannelClose(dotA, swatches[1], `일정 A("${A_TEXT}") 의 [data-event-dot]`, label);
  assertChannelClose(dotB, swatches[2], `일정 B("${B_TEXT}") 의 [data-event-dot]`, label);
  const d = rgbDist(dotA, dotB);
  expect(
    d >= 50,
    `${label}: 서로 다른 카테고리의 두 일정 점 색이 상이하지 않습니다 (거리 ${d.toFixed(1)} — 견본 쌍별 거리 ≥100 이면 ±3 오차를 감안해도 충분히 벌어져야 함)`
  ).toBe(true);
}

test.describe('A34 카테고리 색', () => {
  test('A34: [data-category] 색 ≥3(쌍별 거리 ≥100) → 카테고리별 [data-event-dot] 색 일치(채널 ±3)·상이 → 재기동 유지', async () => {
    const dir = freshProfileDir();
    const states = [];
    let app = null;
    try {
      // ── 기동 1: 견본 검증 + 카테고리 일정 2건 생성 ──
      app = await launchApp(dir, CALENDAR_PATH);
      states.push(app.state);
      let page = app.page;
      const swatches = await collectSwatches(page, 'A34');

      // 일정 A: 14일 + 카테고리 2 (견본 인덱스 1)
      await dayCell(page, 14).click();
      await page.locator('[data-category-color]').nth(1).click();
      await addViaForm(page, '', A_TEXT);
      // 일정 B: 15일 + 카테고리 3 (견본 인덱스 2)
      await dayCell(page, 15).click();
      await page.locator('[data-category-color]').nth(2).click();
      await addViaForm(page, '', B_TEXT);
      await pollLocalStorage(page, 'cal-events', (raw) => !!raw && raw.includes(A_TEXT) && raw.includes(B_TEXT), 5000);

      await assertDots(page, swatches, 'A34');
      assertNoDialogs(app.state, 'A34');
      await closeApp(app);
      app = null;

      // ── 재기동: 카테고리 색 유지 ──
      app = await launchApp(dir, CALENDAR_PATH);
      states.push(app.state);
      page = app.page;
      const swatches2 = await collectSwatches(page, 'A34 재기동');
      await assertDots(page, swatches2, 'A34 재기동');

      for (const s of states) assertNoDialogs(s, 'A34');
    } finally {
      await closeApp(app);
      await removeDirWithRetry(dir);
    }
  });
});
