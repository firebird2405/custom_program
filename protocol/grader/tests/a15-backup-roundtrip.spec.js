'use strict';
/**
 * A15 — 백업 왕복 (SCORECARD A15)
 * 일정 2건 입력 → 내보내기 클릭 시 JSON 다운로드 발생 → 저장소 비움 →
 * 그 파일 가져오기 → 동일 일정 복원.
 * 전 테스트 공통: dialog 0건 (A9 외).
 * 다운로드 파일은 os.tmpdir() 하위에 저장 후 정리한다 (채점기 해시 오염 방지).
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { test, expect } = require('@playwright/test');
const {
  CALENDAR_PATH,
  withFreshApp,
  pollLocalStorage,
  removeDirWithRetry,
} = require('../lib/helpers');

const STORE_KEY = 'cal-events';
const EV1 = { time: '09:00', text: '백업 일정 하나' };
const EV2 = { time: '18:30', text: '백업 일정 둘' };

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

async function addViaForm(page, time, text) {
  if (time) await page.fill('#addTime', time);
  await page.fill('#addText', text);
  await page.click('#addBtn');
}

function eventsOf(raw, key) {
  try {
    const o = JSON.parse(raw);
    if (!o || typeof o !== 'object' || Array.isArray(o)) return null;
    return Array.isArray(o[key]) ? o[key] : [];
  } catch (e) {
    return null;
  }
}

test.describe('A15 백업 왕복', () => {
  test('A15: 일정 2건 → 내보내기(JSON 다운로드) → 저장소 비움 → 가져오기 → 동일 일정 복원', async () => {
    const dlDir = fs.mkdtempSync(path.join(os.tmpdir(), 'grader-dl-'));
    try {
      await withFreshApp(
        CALENDAR_PATH,
        async ({ page, state }) => {
          // 일정 2건 입력
          await dayCell(page, 15).click();
          const key = await dateKeyOfViewedMonth(page, 15);
          await addViaForm(page, EV1.time, EV1.text);
          await addViaForm(page, EV2.time, EV2.text);
          await pollLocalStorage(page, STORE_KEY, (raw) => {
            const list = eventsOf(raw, key);
            return (
              !!list &&
              list.some((e) => e && e.text === EV1.text && e.time === EV1.time) &&
              list.some((e) => e && e.text === EV2.text && e.time === EV2.time)
            );
          });

          // 내보내기 → JSON 다운로드 발생
          const [download] = await Promise.all([
            page.waitForEvent('download', { timeout: 15000 }),
            page.click('#exportBtn'),
          ]);
          const fname = download.suggestedFilename() || 'calendar-backup.json';
          expect(fname, `다운로드 파일명이 JSON 형식이 아닙니다: ${fname}`).toMatch(/\.json$/i);
          const filePath = path.join(dlDir, fname);
          await download.saveAs(filePath);
          let exported = null;
          try {
            exported = JSON.parse(fs.readFileSync(filePath, 'utf8'));
          } catch (e) {
            exported = null;
          }
          expect(exported, '내보낸 파일이 유효한 JSON 이 아닙니다').not.toBeNull();
          const expList = (exported && exported[key]) || [];
          expect(
            expList.some((e) => e && e.text === EV1.text && e.time === EV1.time) &&
              expList.some((e) => e && e.text === EV2.text && e.time === EV2.time),
            `내보낸 JSON 에 두 일정(${EV1.text}, ${EV2.text})이 모두 들어 있지 않습니다`
          ).toBe(true);

          // 저장소 비움 → 재로드 → 목록 비어 있음 확인
          await page.evaluate((k) => localStorage.removeItem(k), STORE_KEY);
          await page.reload({ waitUntil: 'load' });
          await dayCell(page, 15).click();
          await expect(
            page.locator('#eventList li'),
            '저장소를 비웠는데 일정 목록이 비어 있지 않습니다'
          ).toHaveCount(0);

          // 그 파일 가져오기 (가져오기 버튼 → 파일 선택기)
          const [chooser] = await Promise.all([
            page.waitForEvent('filechooser', { timeout: 15000 }),
            page.click('#importBtn'),
          ]);
          await chooser.setFiles(filePath);

          // 동일 일정 복원 (저장소 + UI)
          const raw = await pollLocalStorage(
            page,
            STORE_KEY,
            (r) => {
              const list = eventsOf(r, key);
              return (
                !!list &&
                list.some((e) => e && e.text === EV1.text && e.time === EV1.time) &&
                list.some((e) => e && e.text === EV2.text && e.time === EV2.time)
              );
            },
            5000
          );
          const restored = eventsOf(raw, key);
          expect(
            restored.length,
            `가져오기 후 ${key}의 일정이 ${restored.length}건입니다 (정확히 2건이어야 함)`
          ).toBe(2);
          await expect(
            page.locator('#eventList li', { hasText: EV1.text }),
            `가져오기 후 "${EV1.text}"이(가) 화면에 보이지 않습니다`
          ).toBeVisible();
          await expect(
            page.locator('#eventList li', { hasText: EV2.text }),
            `가져오기 후 "${EV2.text}"이(가) 화면에 보이지 않습니다`
          ).toBeVisible();

          expect(
            state.dialogs,
            `dialog ${state.dialogs.length}건 발생 (A9 외 0건이어야 함 — 금지 조항 B: alert/confirm/prompt 를 필수 UI 경로로 사용 금지): ${state.dialogs
              .map((d) => d.type + ':' + d.message)
              .join(' | ')}`
          ).toHaveLength(0);
        },
        { contextOptions: { acceptDownloads: true } }
      );
    } finally {
      await removeDirWithRetry(dlDir);
    }
  });
});
