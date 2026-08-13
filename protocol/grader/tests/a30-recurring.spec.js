'use strict';
/**
 * A30 — 매주 반복 일정 (rev.5 설계서 §1 A30 / §2 A30, C1)
 * "추가 폼 [data-repeat] 에서 '매주' 를 선택해 일정 생성 → 그 날짜와 +7일·+14일 셀에 동일 텍스트가
 *  표시(월 경계 넘김 포함) → +7일 발생분만 삭제([data-del-one]) → +7일 셀에서만 사라지고 원일·+14일은
 *  유지, 재기동 후 반복 규칙과 예외가 모두 보존되며 기존 단발 일정(cal-events)은 불변이다"
 *
 * ── rev.5 필수 DOM 계약 (설계서 §2 A30 — 그대로 기록) ──
 * [data-repeat] — 추가 폼의 select(옵션 라벨 "매주" 포함, "없음" 기본).
 * 반복 발생분 삭제 시 발생분/전체 선택 UI: [data-del-one]("이 일정만" 라벨 포함) / [data-del-all](선택).
 * 저장: cal-events 는 불변 유지, 반복 규칙은 별도 키(cal-repeats 권장) 또는 additive 필드 + 예외 날짜
 * 목록 — 판정은 UI·왕복만, 키 이름은 자유(단 cal- 접두).
 * 신규 훅은 폴백 셀렉터 없음: data-속성 부재 = 즉시 FAIL (fail-closed).
 *
 * 채점 절차 (설계서 §2 A30): 뷰 월 15일 기준 D·D+7·D+14 를 채점기가 자체 계산(월 경계를 넘으면
 * 해당 월로 이동해 확인). D+21(항상 다음 달)로 월 경계 넘김 표시를 고정 검증한다.
 * 사전에 무관한 단발 일정 1건을 만들어 전 과정 불변 단언 (스키마 파괴 감지, B 조항 연동).
 */
const { test, expect } = require('@playwright/test');
const {
  CALENDAR_PATH,
  freshProfileDir,
  launchApp,
  closeApp,
  removeDirWithRetry,
  pollLocalStorage,
  pollPage,
  requireHook,
  assertNoDialogs,
} = require('../lib/helpers');

const pad2 = (n) => String(n).padStart(2, '0');
const isoOf = (d) => d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

/** #monthTitle "YYYY년 M월" 파싱 (a07 방식) */
function readMonth(page) {
  return page.evaluate(() => {
    const m = document.getElementById('monthTitle').textContent.match(/(\d+)년\s*(\d+)월/);
    return m ? { y: Number(m[1]), m: Number(m[2]) } : null;
  });
}

/** 월 네비게이션 버튼으로 y년 m월까지 이동 (a07 방식) */
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

/** YYYY-MM-DD 키의 달로 이동 */
async function gotoKeyMonth(page, key, label) {
  await gotoMonth(page, Number(key.slice(0, 4)), Number(key.slice(5, 7)), label);
}

/** 현재 표시 달의 (다른 달 아님) 날짜 셀 (a06 방식) */
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

/** [data-repeat] 에서 라벨에 "매주" 를 포함한 옵션을 선택 (fail-closed) */
async function selectWeekly(page) {
  const val = await page.evaluate(() => {
    const sel = document.querySelector('[data-repeat]');
    if (!sel || !sel.options) return null;
    for (const o of sel.options) if ((o.textContent || '').includes('매주')) return o.value;
    return '__NONE__';
  });
  if (val === null) {
    throw new Error('A30: [data-repeat] 이 옵션을 가진 select 요소가 아닙니다 — rev.5 DOM 계약 미구현 (fail-closed)');
  }
  if (val === '__NONE__') {
    throw new Error('A30: [data-repeat] 옵션 중 라벨에 "매주" 를 포함한 항목이 없습니다 — rev.5 DOM 계약 미구현 (fail-closed)');
  }
  await page.selectOption('[data-repeat]', val);
}

/** key 셀에 텍스트 visible 단언 (해당 월로 이동 포함) */
async function expectOnCell(page, key, text, should, label) {
  await gotoKeyMonth(page, key, label);
  const day = Number(key.slice(8, 10));
  const loc = dayCell(page, day).filter({ hasText: text });
  if (should) {
    await expect(
      loc,
      `${label}: ${key} 셀에 매주 반복 일정 "${text}" 이(가) 표시되지 않았습니다`
    ).toBeVisible({ timeout: 5000 });
  } else {
    await expect(
      loc,
      `${label}: ${key} 셀에서 삭제한 발생분 "${text}" 이(가) 여전히 표시됩니다 ([data-del-one] 은 해당 날짜만 제외해야 함)`
    ).toHaveCount(0, { timeout: 5000 });
  }
}

/** cal-events 의 단발 일정 불변 단언 */
async function assertSingleIntact(page, singleKey, text, label) {
  const raw = await page.evaluate((k) => localStorage.getItem(k), 'cal-events');
  let obj = null;
  try {
    obj = JSON.parse(raw);
  } catch (e) {}
  expect(
    obj && typeof obj === 'object' && !Array.isArray(obj),
    `${label}: cal-events 를 JSON 객체로 해석할 수 없습니다 (반복 기능이 기존 스키마를 파괴 — B 조항 위반)`
  ).toBeTruthy();
  const list = (obj[singleKey] || []).filter((e) => e && e.text === text);
  expect(
    list.length,
    `${label}: 단발 일정 "${text}" 이 cal-events["${singleKey}"] 에 ${list.length}건입니다 (정확히 1건 불변이어야 함 — 반복 기능이 기존 단발 일정을 파괴)`
  ).toBe(1);
  expect(list[0].time, `${label}: 단발 일정의 time 필드가 변형되었습니다 ("09:00" 이어야 함)`).toBe('09:00');
}

test.describe('A30 매주 반복 일정', () => {
  test('A30: [data-repeat] 매주 생성 → D·D+7·D+14(+익월 D+21) 표시 → [data-del-one] 발생분만 삭제 → 재기동 보존 + 단발 일정 불변', async () => {
    const dir = freshProfileDir();
    const states = [];
    let app = null;
    const REP = 'A30-매주-반복-회의';
    const SINGLE = 'A30-단발-불변-일정';
    try {
      // ── 기동 1 ──
      app = await launchApp(dir, CALENDAR_PATH);
      states.push(app.state);
      let page = app.page;
      await requireHook(page, '[data-repeat]', 'A30');

      const cur = await readMonth(page);
      expect(cur, 'A30: #monthTitle 에서 연·월을 읽을 수 없습니다').not.toBeNull();
      const D = new Date(cur.y, cur.m - 1, 15); // 뷰 월 15일 (설계서 §2 A30 — 월말 경계 회피)
      const keys = [0, 7, 14, 21].map((n) => isoOf(addDays(D, n))); // D+21 은 항상 다음 달 → 월 경계 넘김 검증
      const singleKey = isoOf(new Date(cur.y, cur.m - 1, 10));

      // 무관 단발 일정 1건 (같은 달 10일) — 전 과정 불변 대상
      await dayCell(page, 10).click();
      await addViaForm(page, '09:00', SINGLE);
      await pollLocalStorage(page, 'cal-events', (raw) => !!raw && raw.includes(SINGLE), 5000);

      // 15일 셀 선택 → [data-repeat] "매주" + 텍스트 입력 → 추가
      await gotoMonth(page, cur.y, cur.m, 'A30');
      await dayCell(page, 15).click();
      await selectWeekly(page);
      await addViaForm(page, '', REP);
      // 저장 폴링: cal- 접두 저장 키 어딘가에 반복 일정 텍스트 (키 이름은 자유 — 설계서 §2 A30)
      await pollPage(
        page,
        (m) => Object.keys(localStorage).some((k) => k.indexOf('cal-') === 0 && (localStorage.getItem(k) || '').includes(m)),
        REP,
        5000,
        `A30: 매주 반복 일정 "${REP}" 이 cal- 접두 localStorage 키에 저장되지 않았습니다`
      );

      // D, D+7, D+14, D+21(다음 달 — 월 경계 넘김) 셀 표시
      for (const k of keys) await expectOnCell(page, k, REP, true, 'A30');

      // cal-events 불변 (중간 점검)
      await assertSingleIntact(page, singleKey, SINGLE, 'A30');

      // D+7 발생분만 삭제: 셀 클릭 → 패널 삭제 → [data-del-one]
      await gotoKeyMonth(page, keys[1], 'A30');
      await dayCell(page, Number(keys[1].slice(8, 10))).click();
      try {
        await page.locator('#eventList li', { hasText: REP }).locator('button[title="삭제"]').first().click({ timeout: 5000 });
      } catch (e) {
        throw new Error('A30: D+7 발생분의 삭제 버튼(title="삭제")을 찾거나 클릭할 수 없습니다: ' + e.message);
      }
      const delOne = page.locator('[data-del-one]').first();
      try {
        await delOne.waitFor({ state: 'visible', timeout: 3000 });
      } catch (e) {
        throw new Error(
          'A30: 반복 발생분 삭제 선택 UI 의 [data-del-one] 버튼이 나타나지 않았습니다 — rev.5 DOM 계약 미구현 (fail-closed: 폴백 셀렉터 없음)'
        );
      }
      const delLabel = ((await delOne.textContent()) || '').replace(/\s+/g, ' ').trim();
      expect(
        delLabel.includes('이 일정만'),
        `A30: [data-del-one] 라벨에 "이 일정만" 이 포함되어야 합니다 (현재: "${delLabel}")`
      ).toBe(true);
      await delOne.click();

      // D+7 부재 · D/D+14/D+21 유지
      await expectOnCell(page, keys[1], REP, false, 'A30');
      await expectOnCell(page, keys[0], REP, true, 'A30');
      await expectOnCell(page, keys[2], REP, true, 'A30');
      await expectOnCell(page, keys[3], REP, true, 'A30');

      assertNoDialogs(app.state, 'A30');
      await closeApp(app);
      app = null;

      // ── 재기동: 반복 규칙 + 예외 + 단발 일정 모두 보존 ──
      app = await launchApp(dir, CALENDAR_PATH);
      states.push(app.state);
      page = app.page;
      await expectOnCell(page, keys[0], REP, true, 'A30 재기동');
      await expectOnCell(page, keys[1], REP, false, 'A30 재기동');
      await expectOnCell(page, keys[2], REP, true, 'A30 재기동');
      await expectOnCell(page, keys[3], REP, true, 'A30 재기동');

      await gotoKeyMonth(page, singleKey, 'A30 재기동');
      await expect(
        dayCell(page, 10).filter({ hasText: SINGLE }),
        `A30 재기동: 단발 일정 "${SINGLE}" 이 ${singleKey} 셀에 표시되지 않습니다 (반복 기능이 기존 일정을 파괴)`
      ).toBeVisible({ timeout: 5000 });
      await assertSingleIntact(page, singleKey, SINGLE, 'A30 재기동');

      for (const s of states) assertNoDialogs(s, 'A30');
    } finally {
      await closeApp(app);
      await removeDirWithRetry(dir);
    }
  });
});
