'use strict';
/**
 * A1 — http(s) 요청을 전부 차단·감시하고 두 앱을 file:// 로 열면:
 *  - http(s) 요청 0건
 *  - console error 0건 + pageerror 0건
 *  - 캘린더: 날짜 셀 28개 이상 visible
 *  - 포스트잇: 보드가 visible 이며 창 면적의 90% 이상
 * 전 테스트 공통: dialog 0건.
 * postit.html 부재 시 크래시 없이 한국어 메시지로 즉시 실패.
 */
const { test, expect } = require('@playwright/test');
const { CALENDAR_PATH, POSTIT_PATH, requirePostit, withFreshApp } = require('../lib/helpers');

function assertQuiet(state) {
  expect(
    state.httpRequests,
    `http(s) 요청 ${state.httpRequests.length}건 발생 (0건이어야 함): ${state.httpRequests.join(', ')}`
  ).toHaveLength(0);
  expect(
    state.consoleErrors,
    `console error ${state.consoleErrors.length}건 발생 (0건이어야 함): ${state.consoleErrors.join(' | ')}`
  ).toHaveLength(0);
  expect(
    state.pageErrors,
    `pageerror ${state.pageErrors.length}건 발생 (0건이어야 함): ${state.pageErrors.join(' | ')}`
  ).toHaveLength(0);
  expect(
    state.dialogs,
    `dialog ${state.dialogs.length}건 발생 (0건이어야 함): ${state.dialogs.map((d) => d.type + ':' + d.message).join(' | ')}`
  ).toHaveLength(0);
}

test.describe('A1 오프라인 실행', () => {
  test('A1: 캘린더 — http(s) 0건, 에러 0건, 날짜 셀 28개 이상 visible', async () => {
    await withFreshApp(CALENDAR_PATH, async ({ page, state }) => {
      await page.waitForLoadState('load');
      await page.waitForSelector('.cell', { state: 'attached', timeout: 10000 }).catch(() => {});

      const visibleCells = await page.evaluate(() => {
        return Array.from(document.querySelectorAll('.cell')).filter((el) => {
          const r = el.getBoundingClientRect();
          const s = getComputedStyle(el);
          return r.width > 0 && r.height > 0 && s.display !== 'none' && s.visibility !== 'hidden';
        }).length;
      });

      assertQuiet(state);
      expect(
        visibleCells,
        `visible 날짜 셀이 ${visibleCells}개입니다 (28개 이상이어야 함)`
      ).toBeGreaterThanOrEqual(28);
    });
  });

  test('A1: 포스트잇 — http(s) 0건, 에러 0건, 보드 visible + 창 면적 90% 이상', async () => {
    requirePostit();
    await withFreshApp(POSTIT_PATH, async ({ page, state }) => {
      await page.waitForLoadState('load');

      const board = await page.evaluate(() => {
        const el = document.querySelector('#board, .board, [data-role="board"]');
        if (!el) return null;
        const s = getComputedStyle(el);
        if (s.display === 'none' || s.visibility === 'hidden') return { ratio: 0 };
        const r = el.getBoundingClientRect();
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        const ix = Math.max(0, Math.min(r.right, vw) - Math.max(r.left, 0));
        const iy = Math.max(0, Math.min(r.bottom, vh) - Math.max(r.top, 0));
        return { ratio: (ix * iy) / (vw * vh) };
      });

      assertQuiet(state);
      expect(board, '보드 요소(#board / .board / [data-role="board"])를 찾을 수 없습니다').not.toBeNull();
      expect(
        board.ratio,
        `보드의 화면 내 visible 면적이 창 면적의 ${(board.ratio * 100).toFixed(1)}% 입니다 (90% 이상이어야 함)`
      ).toBeGreaterThanOrEqual(0.9);
    });
  });
});
