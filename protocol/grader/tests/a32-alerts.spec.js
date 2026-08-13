'use strict';
/**
 * A32 — 일정 알림 토스트 (rev.5 설계서 §1 A32 / §2 A32, C3)
 * "현재 분(도래 직전 분)의 시각으로 일정을 UI 입력하면 도래 후 60초 내 [data-toast] 에
 *  그 일정 텍스트를 포함한 알림이 표시된다(앱 폴링 주기 ≤15초 함의). dialog 0건·pageerror 0건"
 *
 * ── rev.5 필수 DOM 계약 (설계서 §2 A32 — 그대로 기록) ──
 * 알림은 A20 과 동일한 [data-toast] 채널 재사용 (알림용 구분 필요 시 [data-toast-kind="alarm"] 선택).
 * OS 알림 API 사용 금지 (file:// 제약 — dialog 0건 규정으로 겸사 차단).
 * 신규 훅은 폴백 셀렉터 없음: data-속성 부재 = 즉시 FAIL (fail-closed).
 *
 * 채점 절차 (설계서 §2/§5): 클록 모킹(page.clock) 금지 — 실시간 대기. 채점기가
 * page.evaluate 로 앱 시계를 읽어 현재 분 HH:MM 을 산출(초 ≥ 45 면 다음 분으로 넘기고 도래까지
 * 대기) → 그 시각·오늘 날짜로 일정을 UI 입력 → 도래 시점부터 60초 폴링. test.setTimeout(150000).
 */
const { test, expect } = require('@playwright/test');
const {
  CALENDAR_PATH,
  withFreshApp,
  pollLocalStorage,
  requireHook,
  assertNoDialogs,
  sleep,
} = require('../lib/helpers');

const pad2 = (n) => String(n).padStart(2, '0');

function dayCell(page, day) {
  return page.locator('#grid .cell:not(.other)', {
    has: page.locator(`.num:text-is("${day}")`),
  });
}

/** 앱 시계 읽기 (실시간 — 클록 모킹 금지) */
function readAppClock(page) {
  return page.evaluate(() => {
    const n = new Date();
    return { y: n.getFullYear(), mo: n.getMonth() + 1, d: n.getDate(), h: n.getHours(), m: n.getMinutes(), s: n.getSeconds() };
  });
}

/** [data-toast] 가 visible 이고 textContent 에 일정 텍스트를 포함하는지 (1회 평가) */
const TOAST_HAS_TEXT_FN = (text) => {
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
    if (vis(toast) && (toast.textContent || '').includes(text)) return true;
  }
  return false;
};

test.describe('A32 일정 알림 토스트', () => {
  test('A32: 도래 직전 분 일정 UI 입력 → 도래 후 60초 내 [data-toast] 알림 (dialog·pageerror·console error 0건)', async () => {
    test.setTimeout(150000); // 설계서 §5 — A32 개별 부여 (실시간 대기 최대 약 2.5분)
    const TEXT = 'A32-알림-리허설-일정';
    await withFreshApp(CALENDAR_PATH, async ({ page, state }) => {
      await requireHook(page, '[data-toast]', 'A32');

      // 앱 시계 산출 — 자정 직전 가장자리(23:59, 초 ≥ 45)면 새 날로 넘어간 뒤 재산출
      let t = await readAppClock(page);
      if (t.h === 23 && t.m === 59 && t.s >= 45) {
        await sleep((60 - t.s + 2) * 1000);
        t = await readAppClock(page);
      }
      // 초가 ≥ 45 면 다음 분으로 (설계서 §2 A32)
      let th = t.h;
      let tm = t.m;
      if (t.s >= 45) {
        tm += 1;
        if (tm >= 60) {
          tm = 0;
          th += 1; // 위 가드로 자정을 넘지 않음
        }
      }
      const hhmm = pad2(th) + ':' + pad2(tm);

      // 오늘 날짜 셀 선택 (사용자 제스처 겸) → 그 시각으로 일정 UI 입력
      const cellLoc = dayCell(page, t.d);
      try {
        await cellLoc.click({ timeout: 5000 });
      } catch (e) {
        throw new Error(`A32: 오늘 날짜(${t.d}일) 셀을 클릭할 수 없습니다: ` + e.message);
      }
      await page.fill('#addTime', hhmm);
      await page.fill('#addText', TEXT);
      await page.click('#addBtn');
      await pollLocalStorage(page, 'cal-events', (raw) => !!raw && raw.includes(TEXT), 5000);

      // 도래 시점(앱 시계 기준)부터 60초 폴링
      const msUntilDue = await page.evaluate(({ h, m }) => {
        const n = new Date();
        const due = new Date(n.getFullYear(), n.getMonth(), n.getDate(), h, m, 0, 0);
        return due.getTime() - n.getTime();
      }, { h: th, m: tm });
      const deadline = Date.now() + Math.max(0, msUntilDue) + 60000;
      let seen = false;
      while (Date.now() < deadline) {
        seen = await page.evaluate(TOAST_HAS_TEXT_FN, TEXT);
        if (seen) break;
        await sleep(500);
      }
      expect(
        seen,
        `A32: 일정 시각(${hhmm}) 도래 후 60초 내 [data-toast] 에 일정 텍스트("${TEXT}")를 포함한 알림이 표시되지 않았습니다 (앱 자체 폴링 주기 ≤ 15초 함의)`
      ).toBe(true);

      assertNoDialogs(state, 'A32');
      expect(
        state.pageErrors,
        `A32: pageerror ${state.pageErrors.length}건 발생 (0건이어야 함): ${state.pageErrors.join(' | ')}`
      ).toHaveLength(0);
      expect(
        state.consoleErrors,
        `A32: console error ${state.consoleErrors.length}건 발생 (0건이어야 함 — 자동재생 오디오 오류 포함): ${state.consoleErrors.join(' | ')}`
      ).toHaveLength(0);
    });
  });
});
