'use strict';
/**
 * A22 — 체크리스트 노트 (rev.5 설계서 §1 A22)
 * "`- [ ] ` 로 시작하는 줄 2개+일반 줄 1개인 노트는 체크박스 input 정확히 2개를 렌더하고
 *  일반 줄은 리터럴 textContent 로 표시된다. 체크박스 클릭 → 2초 내 저장 반영(원문 마커가
 *  `- [x]` 로) + 그 줄 computed text-decoration 에 line-through → 재기동 후 체크 상태·취소선
 *  유지, 편집기 재진입 시 원문 마커 텍스트가 보존된다"
 *
 * ── rev.5 필수 DOM 계약 (설계서 §2 A22 — 그대로 기록) ──
 * 렌더 줄 래퍼 [data-check-line](체크박스 + 줄 텍스트, 줄 텍스트는 textContent),
 * 마커 문법은 줄 시작 `- [ ] ` / `- [x] ` 고정. 비체크 줄은 기존 [data-note-text]
 * 규약(리터럴·pre-wrap) 유지. A11 병존: 마크업 해석 금지 원칙은 유지 — 체크리스트는
 * 앱이 줄 단위 파싱 후 createElement 로 생성.
 * 신규 훅은 폴백 셀렉터 없음: data-속성 부재 = 즉시 FAIL (fail-closed).
 */
const { test, expect } = require('@playwright/test');
const {
  POSTIT_PATH,
  requirePostit,
  freshProfileDir,
  launchApp,
  closeApp,
  removeDirWithRetry,
  pollPage,
  sleep,
  POSTIT_SEL,
  assertNoDialogs,
  addNote,
  setNoteText,
  pollVisibleNoteCount,
} = require('../lib/helpers');

const LINE1 = '- [ ] 우유 사기';
const LINE2 = '- [ ] 산책';
const PLAIN = '일반 메모 줄';
const CHECK_TEXT = `${LINE1}\n${LINE2}\n${PLAIN}`;
const LINE1_CHECKED = '- [x] 우유 사기';

const CONTAINS_FN = (m) => Object.keys(localStorage).some((k) => (localStorage.getItem(k) || '').includes(m));

/** 노트 렌더 상태 채집: 체크박스·체크라인 수, 체크 상태, 취소선, 일반 줄 리터럴 표시 */
async function readChecklistRender(page) {
  return page.evaluate(
    ({ N, plain, kw }) => {
      const note = document.querySelector(N);
      if (!note) return { err: '노트를 찾을 수 없습니다' };
      const boxes = Array.from(note.querySelectorAll('input[type="checkbox"]'));
      const lines = Array.from(note.querySelectorAll('[data-check-line]'));
      // 키워드(우유 사기)를 포함한 체크라인의 취소선 여부: 래퍼·자손 중 하나라도 line-through
      let milkLine = lines.find((l) => (l.textContent || '').includes(kw)) || null;
      let milkStruck = false;
      let milkChecked = null;
      if (milkLine) {
        const cands = [milkLine, ...milkLine.querySelectorAll('*')];
        milkStruck = cands.some((el) => (getComputedStyle(el).textDecorationLine || '').includes('line-through'));
        const box = milkLine.querySelector('input[type="checkbox"]');
        milkChecked = box ? box.checked : null;
      }
      // 일반 줄 리터럴 표시: 정확 일치 요소 또는 [data-note-text] 내 리터럴 포함
      const vis = (el) => {
        const r = el.getBoundingClientRect();
        const s = getComputedStyle(el);
        return r.width > 0 && r.height > 0 && s.display !== 'none' && s.visibility !== 'hidden';
      };
      let plainLiteral = false;
      for (const el of [note, ...note.querySelectorAll('*')]) {
        if (el.textContent === plain && vis(el)) {
          plainLiteral = true;
          break;
        }
      }
      if (!plainLiteral) {
        const nt = note.querySelector('[data-note-text]');
        if (nt && vis(nt) && (nt.textContent || '').includes(plain)) plainLiteral = true;
      }
      return {
        boxCount: boxes.length,
        lineCount: lines.length,
        checkedStates: boxes.map((b) => b.checked),
        milkFound: !!milkLine,
        milkStruck,
        milkChecked,
        plainLiteral,
      };
    },
    { N: POSTIT_SEL.NOTE, plain: PLAIN, kw: '우유 사기' }
  );
}

test.describe('A22 체크리스트 노트', () => {
  test('A22: "- [ ]" 2줄+일반 1줄 → 체크박스 2개 렌더, 체크 → 저장 "- [x]"·취소선 → 재기동 유지·원문 마커 보존', async () => {
    requirePostit();
    const dir = freshProfileDir();
    const states = [];
    let app = null;
    try {
      // ── 기동 1: 체크리스트 노트 생성 ──
      app = await launchApp(dir, POSTIT_PATH);
      states.push(app.state);
      let page = app.page;
      await addNote(page);
      await pollVisibleNoteCount(page, 1, 5000, 'A22');
      await setNoteText(page, page.locator(POSTIT_SEL.NOTE).first(), CHECK_TEXT);
      await pollPage(page, CONTAINS_FN, '우유 사기', 5000, 'A22: 체크리스트 원문이 localStorage 에 저장되지 않았습니다');
      await sleep(200);

      // 렌더: 체크박스 정확 2개 + [data-check-line] 2개 + 일반 줄 리터럴
      let r = await readChecklistRender(page);
      expect(r.err, r.err || '').toBeUndefined();
      expect(
        r.boxCount,
        `A22: 노트에 렌더된 체크박스 input 이 ${r.boxCount}개입니다 (정확히 2개여야 함) — "- [ ] " 줄의 체크리스트 렌더 미구현 (fail-closed)`
      ).toBe(2);
      expect(
        r.lineCount,
        `A22: [data-check-line] 렌더 줄 래퍼가 ${r.lineCount}개입니다 (정확히 2개여야 함) — rev.5 DOM 계약 미구현 (fail-closed)`
      ).toBe(2);
      expect(
        r.plainLiteral,
        `A22: 일반 줄 "${PLAIN}" 이 리터럴 textContent 로 표시되지 않았습니다`
      ).toBe(true);
      expect(r.milkFound, 'A22: "우유 사기" 체크라인을 찾을 수 없습니다').toBe(true);
      expect(r.milkChecked, 'A22: 초기 상태에서 "우유 사기" 체크박스가 이미 체크되어 있습니다').toBe(false);

      // 체크박스 클릭 → 2초 내 저장 원문 마커 "- [x]" + 취소선
      try {
        await page
          .locator(POSTIT_SEL.NOTE)
          .first()
          .locator('[data-check-line]', { hasText: '우유 사기' })
          .locator('input[type="checkbox"]')
          .first()
          .click({ timeout: 5000 });
      } catch (e) {
        throw new Error('A22: "우유 사기" 줄([data-check-line])의 체크박스를 클릭할 수 없습니다: ' + e.message);
      }
      await pollPage(
        page,
        CONTAINS_FN,
        LINE1_CHECKED,
        2000,
        `A22: 체크 후 2초 내 저장 원문 마커가 "${LINE1_CHECKED}" 로 반영되지 않았습니다`
      );
      r = await readChecklistRender(page);
      expect(r.milkChecked, 'A22: 클릭 후 "우유 사기" 체크박스가 checked 상태가 아닙니다').toBe(true);
      expect(
        r.milkStruck,
        'A22: 체크된 줄의 computed text-decoration-line 에 line-through(취소선)가 없습니다'
      ).toBe(true);
      assertNoDialogs(app.state, 'A22');
      await closeApp(app);
      app = null;

      // ── 재기동: 체크 상태·취소선 유지 + 편집기 원문 마커 보존 ──
      app = await launchApp(dir, POSTIT_PATH);
      states.push(app.state);
      page = app.page;
      await pollVisibleNoteCount(page, 1, 5000, 'A22 재기동');
      await sleep(200);
      r = await readChecklistRender(page);
      expect(r.err, r.err || '').toBeUndefined();
      expect(r.boxCount, `A22: 재기동 후 체크박스가 ${r.boxCount}개입니다 (정확히 2개여야 함)`).toBe(2);
      expect(r.milkChecked, 'A22: 재기동 후 "우유 사기" 체크 상태가 유지되지 않았습니다').toBe(true);
      expect(r.milkStruck, 'A22: 재기동 후 체크된 줄의 취소선(line-through)이 유지되지 않았습니다').toBe(true);

      // 편집기 재진입 → 원문 마커 텍스트 보존
      const noteLoc = page.locator(POSTIT_SEL.NOTE).first();
      try {
        await noteLoc.click({ timeout: 5000 });
      } catch (e) {
        throw new Error('A22: 편집 재진입을 위해 노트를 클릭할 수 없습니다: ' + e.message);
      }
      let editor = noteLoc.locator(POSTIT_SEL.EDIT).first();
      try {
        await editor.waitFor({ state: 'visible', timeout: 2000 });
      } catch (e) {
        editor = page.locator(POSTIT_SEL.EDIT).first();
        try {
          await editor.waitFor({ state: 'visible', timeout: 2000 });
        } catch (e2) {
          throw new Error('A22: 노트 편집기([data-note-edit])가 나타나지 않습니다 — 편집 재진입 시 원문 마커를 보여줘야 합니다');
        }
      }
      const editVal = await editor.evaluate((el) => (el.value !== undefined ? el.value : el.textContent) || '');
      expect(
        editVal.includes(LINE1_CHECKED),
        `A22: 편집기 재진입 시 체크된 줄 원문 "${LINE1_CHECKED}" 가 보존되지 않았습니다 (편집기 값: ${editVal.slice(0, 120)})`
      ).toBe(true);
      expect(
        editVal.includes(LINE2),
        `A22: 편집기 재진입 시 미체크 줄 원문 "${LINE2}" 가 보존되지 않았습니다`
      ).toBe(true);
      expect(
        editVal.includes(PLAIN),
        `A22: 편집기 재진입 시 일반 줄 "${PLAIN}" 이 보존되지 않았습니다`
      ).toBe(true);
      for (const s of states) assertNoDialogs(s, 'A22');
    } finally {
      await closeApp(app);
      await removeDirWithRetry(dir);
    }
  });
});
