'use strict';
/**
 * A18 — 재기동 후 기존 노트를 클릭해 내용을 수정하면 수정본이 표시·유지되고,
 * 노트를 삭제하면 visible 노트 수 1 감소 + localStorage 제거 + 재기동 후 미복귀.
 * 재기동 = launchPersistentContext(같은 user-data-dir) close → 재기동 (공통 규정).
 * 전 테스트 공통 dialog 0건 (삭제 확인에 confirm() 사용 금지 — B 금지 조항).
 * postit.html 부재 시 크래시 없이 한국어 메시지("postit.html 미구현 (3단계 예정)")로 즉시 실패.
 *
 * 흐름: [기동1] 노트 2개 생성·저장 → [재기동2] 노트1 클릭·수정 → 수정본 표시·저장,
 *       노트2 삭제 → visible -1 + localStorage 제거 → [재기동3] 수정본 유지·삭제분 미복귀.
 *
 * ── 3단계 필수 DOM 계약 (REQUIRED DOM CONTRACT — 전 포스트잇 스펙 공통) ──
 * 3단계 postit.html 은 아래 data-속성 훅을 반드시 구현한다 (괄호는 이 채점기가 허용하는 폴백):
 *  - 보드:        [data-board]      (#board, .board, [data-role="board"])
 *  - 노트:        [data-note]       (.note, .postit) — 보드 자손, 생성 순 DOM 추가(새 노트 = 마지막),
 *                 자유 배치(absolute), 새 노트는 기존 노트와 겹치지 않게 생성, 회전은 중심 기준(기본
 *                 transform-origin), 드래그 중 위치에 CSS transition 금지
 *  - 추가 버튼:   [data-add-note]   — 표시 텍스트에 "새 포스트잇" 포함
 *  - 텍스트 표시: [data-note-text]  — textContent === 노트 내용(줄바꿈 \n 문자 보존, white-space:pre-wrap)
 *  - 편집기:      [data-note-edit]  — 노트 클릭 시 입력 가능한 textarea(여러 줄), input/blur 후 2초 내 저장
 *  - 드래그:      [data-drag-handle] 선택 — 없으면 노트 상단 24px 띠에서 mousedown 으로 드래그 시작.
 *                 mousedown+move = 드래그, 이동 없는 click = 편집. 드래그는 잡은 오프셋 유지:
 *                 도중·최종 top-left = 시작 top-left + 커서 이동량
 *  - 색상:        [data-color] 견본 ≥ 4 — 견본 자신의 computed background-color 가 적용 색.
 *                 클릭 시 "가장 최근에 클릭(활성)된 노트"의 background-color 만 변경
 *  - 삭제:        [data-delete-note] — 각 노트 내부, 노트 클릭(활성) 시 보이면 됨, confirm() 금지
 *  - 저장:        모든 노트를 localStorage 단일 키(권장 "postit-notes")에 JSON 저장.
 *                 손상 백업 키: <원래키>-corrupt-<타임스탬프ms>, 기존 백업은 절대 덮어쓰지 않음
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
} = require('../lib/helpers');

const NOTE_SEL = '[data-note], .note, .postit';
const ADD_SEL = '[data-add-note], button:has-text("새 포스트잇")';
const EDIT_SEL = '[data-note-edit], textarea, input[type="text"], [contenteditable]';
const DEL_SEL = '[data-delete-note], .note-delete, .delete-note, button:has-text("삭제")';

function assertNoDialog(state) {
  expect(
    state.dialogs,
    `dialog ${state.dialogs.length}건 발생 (0건이어야 함 — 삭제 확인에 confirm() 금지): ${state.dialogs.map((d) => d.type + ':' + d.message).join(' | ')}`
  ).toHaveLength(0);
}

async function addNote(page) {
  try {
    await page.locator(ADD_SEL).first().click({ timeout: 5000 });
  } catch (e) {
    throw new Error('"+ 새 포스트잇" 추가 버튼([data-add-note])을 찾거나 클릭할 수 없습니다: ' + e.message);
  }
}

async function countVisible(page) {
  return page.evaluate((sel) => {
    return Array.from(document.querySelectorAll(sel)).filter((el) => {
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && s.display !== 'none' && s.visibility !== 'hidden';
    }).length;
  }, NOTE_SEL);
}

async function pollVisibleNoteCount(page, want, timeoutMs, label) {
  await pollPage(
    page,
    ({ sel, want }) =>
      Array.from(document.querySelectorAll(sel)).filter((el) => {
        const r = el.getBoundingClientRect();
        const s = getComputedStyle(el);
        return r.width > 0 && r.height > 0 && s.display !== 'none' && s.visibility !== 'hidden';
      }).length === want,
    { sel: NOTE_SEL, want },
    timeoutMs,
    `${label}: visible 노트 수가 ${want}개가 되지 않았습니다`
  );
}

async function setNoteText(page, noteLoc, text) {
  try {
    await noteLoc.click({ timeout: 5000 });
  } catch (e) {
    throw new Error('노트를 클릭할 수 없습니다 (겹침/가림 여부 확인 — 새 노트는 겹치지 않게 생성되어야 함): ' + e.message);
  }
  let editor = noteLoc.locator(EDIT_SEL).first();
  try {
    await editor.waitFor({ state: 'visible', timeout: 2000 });
  } catch (e) {
    editor = page.locator(EDIT_SEL).first();
    try {
      await editor.waitFor({ state: 'visible', timeout: 2000 });
    } catch (e2) {
      throw new Error('노트 편집기([data-note-edit]/textarea)를 찾을 수 없습니다 — 노트 클릭 시 편집기가 나타나야 합니다');
    }
  }
  try {
    await editor.fill(text);
  } catch (e) {
    throw new Error('노트 편집기에 텍스트를 입력할 수 없습니다: ' + e.message);
  }
  await editor.evaluate((el) => el.blur());
}

async function readNoteTexts(page) {
  return page.evaluate((N) => {
    return Array.from(document.querySelectorAll(N)).map((el) => {
      const t = el.querySelector('[data-note-text]');
      const ta = el.querySelector('textarea');
      return (t && t.textContent) || (ta && ta.value) || el.textContent || '';
    });
  }, NOTE_SEL);
}

async function indexOfNoteWithText(page, marker) {
  const texts = await readNoteTexts(page);
  return texts.findIndex((t) => t.includes(marker));
}

const CONTAINS_FN = (m) =>
  Object.keys(localStorage).some((k) => (localStorage.getItem(k) || '').includes(m));

const NOT_CONTAINS_FN = (m) =>
  !Object.keys(localStorage).some((k) => (localStorage.getItem(k) || '').includes(m));

test.describe('A18 노트 수정·삭제 왕복', () => {
  test('A18: 재기동 후 수정 → 표시·유지, 삭제 → -1·저장 제거·재기동 미복귀', async () => {
    requirePostit();
    const dir = freshProfileDir();
    let app = null;
    const T1 = 'A18-원본-노트';
    const T1B = 'A18-수정본-노트';
    const T2 = 'A18-삭제될-노트';
    try {
      // ── 기동 1: 노트 2개 생성·저장 ──
      app = await launchApp(dir, POSTIT_PATH);
      let page = app.page;
      await addNote(page);
      await pollVisibleNoteCount(page, 1, 5000, 'A18');
      await setNoteText(page, page.locator(NOTE_SEL).nth(0), T1);
      await pollPage(page, CONTAINS_FN, T1, 5000, '노트 1 내용이 localStorage 에 저장되지 않았습니다');
      await addNote(page);
      await pollVisibleNoteCount(page, 2, 5000, 'A18');
      await setNoteText(page, page.locator(NOTE_SEL).nth(1), T2);
      await pollPage(page, CONTAINS_FN, T2, 5000, '노트 2 내용이 localStorage 에 저장되지 않았습니다');
      assertNoDialog(app.state);
      await closeApp(app);
      app = null;

      // ── 재기동 2: 기존 노트 수정 + 삭제 ──
      app = await launchApp(dir, POSTIT_PATH);
      page = app.page;
      await pollVisibleNoteCount(page, 2, 5000, 'A18 재기동');

      // 수정: T1 노트 클릭 → 내용 교체 → 수정본 표시 + 저장(공통 규정 2초)
      const i1 = await indexOfNoteWithText(page, T1);
      expect(i1 >= 0, `재기동 후 "${T1}" 노트를 찾을 수 없습니다`).toBe(true);
      await setNoteText(page, page.locator(NOTE_SEL).nth(i1), T1B);
      await sleep(150);
      const textsAfterEdit = await readNoteTexts(page);
      expect(
        textsAfterEdit.some((t) => t.includes(T1B)),
        '수정본이 화면에 표시되지 않습니다'
      ).toBe(true);
      await pollPage(page, CONTAINS_FN, T1B, 2000, '수정본이 2초 내 localStorage 에 저장되지 않았습니다');
      await pollPage(page, NOT_CONTAINS_FN, T1, 2000, '수정 후에도 이전 내용이 localStorage 에 남아 있습니다');

      // 삭제: T2 노트 클릭(활성) → [data-delete-note] 클릭
      const before = await countVisible(page);
      const i2 = await indexOfNoteWithText(page, T2);
      expect(i2 >= 0, `재기동 후 "${T2}" 노트를 찾을 수 없습니다`).toBe(true);
      const noteLoc = page.locator(NOTE_SEL).nth(i2);
      try {
        await noteLoc.click({ timeout: 5000 });
        await noteLoc.hover();
      } catch (e) {
        throw new Error('삭제할 노트를 클릭할 수 없습니다: ' + e.message);
      }
      const del = noteLoc.locator(DEL_SEL).first();
      let delOk = (await del.count()) > 0;
      if (delOk) {
        try {
          await del.click({ timeout: 3000 });
        } catch (e) {
          delOk = false;
        }
      }
      if (!delOk) {
        throw new Error('노트 삭제 버튼([data-delete-note])을 찾거나 클릭할 수 없습니다 — 노트 클릭(활성) 시 삭제 버튼이 노트 내부에 보여야 합니다');
      }

      await pollVisibleNoteCount(page, before - 1, 5000, 'A18 삭제');
      await pollPage(page, NOT_CONTAINS_FN, T2, 2000, '삭제 후에도 노트 내용이 localStorage 에 남아 있습니다');
      assertNoDialog(app.state);
      await closeApp(app);
      app = null;

      // ── 재기동 3: 수정본 유지 + 삭제분 미복귀 ──
      app = await launchApp(dir, POSTIT_PATH);
      page = app.page;
      await pollVisibleNoteCount(page, 1, 5000, 'A18 최종 재기동');
      const finalTexts = await readNoteTexts(page);
      expect(
        finalTexts.some((t) => t.includes(T1B)),
        '재기동 후 수정본이 유지되지 않았습니다'
      ).toBe(true);
      expect(
        finalTexts.some((t) => t.includes(T2)),
        '삭제한 노트가 재기동 후 되살아났습니다 (미복귀여야 함)'
      ).toBe(false);
      expect(
        finalTexts.some((t) => t.includes(T1) && !t.includes(T1B)),
        '수정 전 원본 내용이 재기동 후 되살아났습니다'
      ).toBe(false);
      assertNoDialog(app.state);
    } finally {
      await closeApp(app);
      await removeDirWithRetry(dir);
    }
  });
});
