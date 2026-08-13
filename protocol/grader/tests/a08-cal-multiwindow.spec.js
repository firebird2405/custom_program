'use strict';
/**
 * A8 (캘린더 절반) — 두 창 동시 입력 무손실 (SCORECARD A8)
 * 같은 앱을 한 persistent context 의 두 페이지로 열고:
 *  창A 추가 → 저장 폴링 → 창B 추가 → 최종 저장소에 두 항목이 각각 정확히 1건(중복 0)
 *  → 한 창 새로고침 후 둘 다 UI 에 visible.
 * storage 이벤트 전파에 의존하지 않는다 (폴링 + 재로드로만 관찰).
 * 전 테스트 공통: dialog 0건. (포스트잇 절반은 별도 스펙에서 검사)
 */
const { test, expect } = require('@playwright/test');
const { CALENDAR_PATH, fileUrl, withFreshApp, pollLocalStorage } = require('../lib/helpers');

const STORE_KEY = 'cal-events';
const TEXT_A = '창A 일정';
const TEXT_B = '창B 일정';

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

/** 저장소 전체에서 해당 텍스트의 일정 개수 (해석 불가 시 -1) */
function countText(raw, text) {
  try {
    const o = JSON.parse(raw);
    if (!o || typeof o !== 'object' || Array.isArray(o)) return -1;
    let n = 0;
    for (const k of Object.keys(o)) {
      if (Array.isArray(o[k])) n += o[k].filter((e) => e && e.text === text).length;
    }
    return n;
  } catch (e) {
    return -1;
  }
}

test.describe('A8 두 창 동시 사용 (캘린더)', () => {
  test('A8: 캘린더 — 창A·창B 각각 추가 → 저장소에 각 1건(중복 0) → 새로고침 후 둘 다 visible', async () => {
    await withFreshApp(CALENDAR_PATH, async ({ context, page: pageA, state }) => {
      const pageB = await context.newPage();
      await pageB.goto(fileUrl(CALENDAR_PATH), { waitUntil: 'load' });

      // 창A: 20일 선택 후 추가 → 저장 폴링
      await dayCell(pageA, 20).click();
      await addViaForm(pageA, '09:00', TEXT_A);
      await pollLocalStorage(pageA, STORE_KEY, (raw) => countText(raw, TEXT_A) === 1);

      // 창B: 같은 날짜에 추가 → 최종 저장소 폴링 (두 항목 공존)
      await dayCell(pageB, 20).click();
      await addViaForm(pageB, '10:00', TEXT_B);
      const finalRaw = await pollLocalStorage(
        pageB,
        STORE_KEY,
        (raw) => countText(raw, TEXT_A) >= 1 && countText(raw, TEXT_B) >= 1
      );

      const cA = countText(finalRaw, TEXT_A);
      const cB = countText(finalRaw, TEXT_B);
      expect(cA, `최종 저장소에 "${TEXT_A}"이(가) ${cA}건입니다 (정확히 1건이어야 함 — 유실/중복 금지)`).toBe(1);
      expect(cB, `최종 저장소에 "${TEXT_B}"이(가) ${cB}건입니다 (정확히 1건이어야 함 — 유실/중복 금지)`).toBe(1);

      // 창A 새로고침 → 둘 다 UI 에 visible
      await pageA.reload({ waitUntil: 'load' });
      await dayCell(pageA, 20).click();
      await expect(
        pageA.locator('#eventList li', { hasText: TEXT_A }),
        `새로고침한 창에서 "${TEXT_A}"이(가) 보이지 않습니다`
      ).toBeVisible();
      await expect(
        pageA.locator('#eventList li', { hasText: TEXT_B }),
        `새로고침한 창에서 "${TEXT_B}"이(가) 보이지 않습니다 (다른 창의 입력이 유실됨)`
      ).toBeVisible();

      expect(
        state.dialogs,
        `dialog ${state.dialogs.length}건 발생 (A9 외 0건이어야 함): ${state.dialogs
          .map((d) => d.type + ':' + d.message)
          .join(' | ')}`
      ).toHaveLength(0);
    });
  });
});
