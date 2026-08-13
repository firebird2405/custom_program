'use strict';
/**
 * A14 — 일정 수정·삭제 왕복 (SCORECARD A14)
 * 기존 일정의 시간·텍스트를 수정하면 재기동 후 수정본이,
 * 삭제하면 재기동 후 부재가 관찰된다.
 * (기존 일정 = 별도 기동에서 미리 저장해 둔 일정. 전 테스트 공통 dialog 0건)
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
const ORIG_TEXT = '수정 전 일정';
const EDITED_TEXT = '수정 후 일정';
const DOOMED_TEXT = '삭제 대상 일정';

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

function flatten(raw) {
  try {
    const o = JSON.parse(raw);
    if (!o || typeof o !== 'object' || Array.isArray(o)) return null;
    const all = [];
    for (const k of Object.keys(o)) if (Array.isArray(o[k])) all.push(...o[k]);
    return all;
  } catch (e) {
    return null;
  }
}

test.describe('A14 일정 수정·삭제', () => {
  test('A14: 기존 일정 시간·텍스트 수정 → 재기동 후 수정본, 삭제 → 재기동 후 부재', async () => {
    const dir = freshProfileDir();
    const states = [];
    let app = null;
    try {
      // 1차 기동: 기존 일정 2건 준비
      app = await launchApp(dir, CALENDAR_PATH);
      states.push(app.state);
      const page1 = app.page;
      await dayCell(page1, 15).click();
      await addViaForm(page1, '09:00', ORIG_TEXT);
      await addViaForm(page1, '10:00', DOOMED_TEXT);
      await pollLocalStorage(page1, STORE_KEY, (raw) => {
        const all = flatten(raw);
        return (
          !!all &&
          all.some((e) => e && e.text === ORIG_TEXT) &&
          all.some((e) => e && e.text === DOOMED_TEXT)
        );
      });
      await closeApp(app);

      // 2차 기동: 수정 + 삭제
      app = await launchApp(dir, CALENDAR_PATH);
      states.push(app.state);
      const page2 = app.page;
      await dayCell(page2, 15).click();

      // 수정: 시간 09:00→14:30, 텍스트 "수정 전 일정"→"수정 후 일정"
      await page2
        .locator('#eventList li', { hasText: ORIG_TEXT })
        .locator('button[title="수정"]')
        .click();
      const editRow = page2.locator('#eventList .editRow');
      await expect(editRow, '수정 버튼을 눌렀는데 수정 입력줄이 나타나지 않습니다').toBeVisible();
      await editRow.locator('input[type="time"]').fill('14:30');
      await editRow.locator('input[type="text"]').fill(EDITED_TEXT);
      await editRow.locator('button', { hasText: '저장' }).click();
      await pollLocalStorage(page2, STORE_KEY, (raw) => {
        const all = flatten(raw);
        return (
          !!all &&
          all.some((e) => e && e.text === EDITED_TEXT && e.time === '14:30') &&
          !all.some((e) => e && e.text === ORIG_TEXT)
        );
      });

      // 삭제
      await page2
        .locator('#eventList li', { hasText: DOOMED_TEXT })
        .locator('button[title="삭제"]')
        .click();
      await pollLocalStorage(page2, STORE_KEY, (raw) => {
        const all = flatten(raw);
        return (
          !!all &&
          !all.some((e) => e && e.text === DOOMED_TEXT) &&
          all.some((e) => e && e.text === EDITED_TEXT)
        );
      });
      await closeApp(app);

      // 3차 기동: 수정본 관찰 + 삭제분 부재 관찰
      app = await launchApp(dir, CALENDAR_PATH);
      states.push(app.state);
      const page3 = app.page;
      await dayCell(page3, 15).click();
      const editedLi = page3.locator('#eventList li', { hasText: EDITED_TEXT });
      await expect(editedLi, `재기동 후 수정본("${EDITED_TEXT}")이 보이지 않습니다`).toBeVisible();
      await expect(editedLi, '재기동 후 수정된 시간(14:30)이 함께 표시되지 않습니다').toContainText('14:30');
      await expect(
        page3.locator('#eventList li', { hasText: ORIG_TEXT }),
        `재기동 후 수정 전 텍스트("${ORIG_TEXT}")가 여전히 남아 있습니다`
      ).toHaveCount(0);
      await expect(
        page3.locator('#eventList li', { hasText: DOOMED_TEXT }),
        `삭제한 일정("${DOOMED_TEXT}")이 재기동 후 되살아났습니다`
      ).toHaveCount(0);

      const allDialogs = states.reduce((acc, s) => acc.concat(s.dialogs), []);
      expect(
        allDialogs,
        `dialog ${allDialogs.length}건 발생 (A9 외 0건이어야 함): ${allDialogs
          .map((d) => d.type + ':' + d.message)
          .join(' | ')}`
      ).toHaveLength(0);
    } finally {
      await closeApp(app);
      await removeDirWithRetry(dir);
    }
  });
});
