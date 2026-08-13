'use strict';
/**
 * A9 (캘린더) — 손상 저장 데이터 복구·백업 (SCORECARD A9)
 * 전용 컨텍스트에서 addInitScript 로 저장 키(cal-events)에 비JSON 문자열을 주입 후 열면:
 *  - 크래시·pageerror 0건 (dialog 는 이 항목만 자동 수락 허용 + 건수 집계)
 *  - 직후 일정 생성 → 표시 → 저장이 성공
 *  - `cal-events-corrupt-<타임스탬프>` 키로 손상 원본이 보존되고, 기존 백업 키는 덮어쓰지 않는다
 */
const { test, expect } = require('@playwright/test');
const { CALENDAR_PATH, fileUrl, withFreshApp, pollLocalStorage } = require('../lib/helpers');

const STORE_KEY = 'cal-events';
const GARBAGE = '###비JSON 손상 데이터###{{{';
const OLD_BACKUP_KEY = 'cal-events-corrupt-1111111111111';
const OLD_BACKUP_VAL = '기존 백업 원본(덮어쓰기 금지)';

function dayCell(page, day) {
  return page.locator('#grid .cell:not(.other)', {
    has: page.locator(`.num:text-is("${day}")`),
  });
}

function dateKeyOfViewedMonth(page, day) {
  return page.evaluate((d) => {
    const m = document.getElementById('monthTitle').textContent.match(/(\d+)년\s*(\d+)월/);
    const pad = (n) => String(n).padStart(2, '0');
    return m[1] + '-' + pad(Number(m[2])) + '-' + pad(d);
  }, day);
}

test.describe('A9 손상 데이터 복구 (캘린더)', () => {
  test('A9: cal-events 비JSON 주입 → 크래시 없음 + 일정 추가 성공 + corrupt 백업 보존(기존 백업 미덮어쓰기)', async () => {
    await withFreshApp(
      null, // 직접 addInitScript 등록 후 이동한다
      async ({ context, page, state }) => {
        await context.addInitScript(
          ([storeKey, garbage, oldKey, oldVal]) => {
            try {
              if (!localStorage.getItem('__a9_injected')) {
                localStorage.setItem(storeKey, garbage);
                localStorage.setItem(oldKey, oldVal);
                localStorage.setItem('__a9_injected', '1');
              }
            } catch (e) {}
          },
          [STORE_KEY, GARBAGE, OLD_BACKUP_KEY, OLD_BACKUP_VAL]
        );
        await page.goto(fileUrl(CALENDAR_PATH), { waitUntil: 'load' });

        // 크래시·pageerror 0건
        expect(
          state.pageErrors,
          `손상 데이터 로드 중 pageerror ${state.pageErrors.length}건 발생 (0건이어야 함): ${state.pageErrors.join(' | ')}`
        ).toHaveLength(0);

        // 손상 원본 백업 확인
        const snapshot = await page.evaluate(() => {
          const o = {};
          for (let i = 0; i < localStorage.length; i++) {
            const k = localStorage.key(i);
            o[k] = localStorage.getItem(k);
          }
          return o;
        });
        expect(
          snapshot[OLD_BACKUP_KEY],
          `기존 백업 키(${OLD_BACKUP_KEY})가 덮어써졌습니다 (기존 백업은 보존되어야 함)`
        ).toBe(OLD_BACKUP_VAL);
        const newBackupKeys = Object.keys(snapshot).filter(
          (k) => /^cal-events-corrupt-\d+$/.test(k) && k !== OLD_BACKUP_KEY
        );
        expect(
          newBackupKeys.length,
          `손상 원본 백업 키(cal-events-corrupt-<타임스탬프>)가 생성되지 않았습니다. 현재 키 목록: ${Object.keys(snapshot).join(', ')}`
        ).toBeGreaterThanOrEqual(1);
        expect(
          newBackupKeys.some((k) => snapshot[k] === GARBAGE),
          '백업 키에 손상 원본이 원문 그대로 보존되어 있지 않습니다'
        ).toBe(true);

        // 직후 일정 생성 → 표시 → 저장 성공
        await dayCell(page, 15).click();
        const key = await dateKeyOfViewedMonth(page, 15);
        await page.fill('#addTime', '11:00');
        await page.fill('#addText', '복구 확인 일정');
        await page.click('#addBtn');
        await expect(
          page.locator('#eventList li', { hasText: '복구 확인 일정' }),
          '손상 복구 직후 추가한 일정이 화면에 보이지 않습니다'
        ).toBeVisible();
        await pollLocalStorage(page, STORE_KEY, (raw) => {
          try {
            const o = JSON.parse(raw);
            return (
              !!o &&
              Array.isArray(o[key]) &&
              o[key].some((e) => e && e.text === '복구 확인 일정' && e.time === '11:00')
            );
          } catch (e) {
            return false;
          }
        });

        // A9 는 공통 dialog 0건 단언의 예외 — 자동 수락하고 건수만 기록한다
        // (SCORECARD A9 는 dialog 를 "허용+집계"할 뿐 발생을 요구하지 않는다 —
        //  dialog 없이 조용히 백업·복구하는 구현도 합격이어야 한다)
        test.info().annotations.push({ type: 'A9-dialog-count', description: String(state.dialogs.length) });
      },
      { autoAcceptDialogs: true }
    );
  });
});
