'use strict';
/**
 * A9 (포스트잇 저장 키) — 전용 컨텍스트에서 addInitScript 로 저장 키에 비JSON 주입 후 열면
 * (dialog 자동 수락) 크래시·pageerror 0건, 직후 노트 생성→표시→저장이 성공하며,
 * `<원래키>-corrupt-<타임스탬프>` 키로 손상 원본이 보존(기존 백업 미덮어쓰기).
 * A9 는 공통 dialog 0건 단언의 예외: dialog 는 자동 수락하고 건수만 기록(annotation)한다.
 * postit.html 부재 시 크래시 없이 한국어 메시지("postit.html 미구현 (3단계 예정)")로 즉시 실패.
 *
 * 저장 키 이름은 3단계 확정 전이므로 하드코딩하지 않는다. 1차(탐지) 세션에서 노트를 만들고
 * 마커가 포함된 localStorage 키를 읽어 그 키를 손상 대상으로 쓴다.
 * 가정(계약): 모든 노트는 "단일" localStorage 키(권장 "postit-notes")에 JSON 으로 저장된다.
 * 마커를 포함한 키가 여럿이면 정렬 후 첫 키를 쓰며, 이는 계약 위반 신호다.
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
const { POSTIT_PATH, requirePostit, withFreshApp, fileUrl, pollPage, sleep } = require('../lib/helpers');

const NOTE_SEL = '[data-note], .note, .postit';
const ADD_SEL = '[data-add-note], button:has-text("새 포스트잇")';
const EDIT_SEL = '[data-note-edit], textarea, input[type="text"], [contenteditable]';

async function addNote(page) {
  try {
    await page.locator(ADD_SEL).first().click({ timeout: 5000 });
  } catch (e) {
    throw new Error('"+ 새 포스트잇" 추가 버튼([data-add-note])을 찾거나 클릭할 수 없습니다: ' + e.message);
  }
}

async function setNoteText(page, noteLoc, text) {
  try {
    await noteLoc.click({ timeout: 5000 });
  } catch (e) {
    throw new Error('노트를 클릭할 수 없습니다: ' + e.message);
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

test.describe('A9 저장 손상 복구 (포스트잇)', () => {
  test('A9: 비JSON 주입 → 크래시 없이 열림 + 노트 생성·저장 성공 + corrupt 백업 보존', async () => {
    requirePostit();

    // ── 1차 세션: 저장 키 탐지 ──
    const DISCOVER_MARK = 'A9-키탐지-노트';
    let storageKey = null;
    await withFreshApp(POSTIT_PATH, async ({ page }) => {
      await addNote(page);
      await setNoteText(page, page.locator(NOTE_SEL).last(), DISCOVER_MARK);
      await pollPage(
        page,
        (m) => Object.keys(localStorage).some((k) => (localStorage.getItem(k) || '').includes(m)),
        DISCOVER_MARK,
        5000,
        '포스트잇 저장 키 탐지 실패: 노트 내용이 localStorage 어느 키에서도 확인되지 않습니다'
      );
      storageKey = await page.evaluate((m) => {
        const ks = Object.keys(localStorage)
          .filter((k) => (localStorage.getItem(k) || '').includes(m))
          .sort();
        return ks[0] || null;
      }, DISCOVER_MARK);
    });
    expect(storageKey, '포스트잇 저장 키를 특정할 수 없습니다 (단일 localStorage 키 계약 위반 의심)').not.toBeNull();

    // ── 2차 세션(전용 컨텍스트): 손상 주입 + 기존 백업 선점 ──
    const CORRUPT = '{{{A9-비JSON-손상::이 값은 JSON 이 아님';
    const OLD_BACKUP_KEY = `${storageKey}-corrupt-1111111111111`;
    const OLD_BACKUP_VAL = 'A9-기존-백업-원본';
    const M2 = 'A9-복구후-노트';

    await withFreshApp(
      null,
      async ({ context, page, state }) => {
        await context.addInitScript(({ k, c, ok, ov }) => {
          try {
            localStorage.setItem(k, c);
            localStorage.setItem(ok, ov);
          } catch (e) { /* 무시 */ }
        }, { k: storageKey, c: CORRUPT, ok: OLD_BACKUP_KEY, ov: OLD_BACKUP_VAL });

        await page.goto(fileUrl(POSTIT_PATH), { waitUntil: 'load' });
        await sleep(400);

        // 크래시 없음 — 페이지가 응답한다
        const alive = await page.evaluate(() => 1 + 1).catch(() => null);
        expect(alive, '손상 데이터 주입 후 페이지가 응답하지 않습니다 (크래시)').toBe(2);

        // 직후 노트 생성 → 표시 → 저장 성공
        await addNote(page);
        await setNoteText(page, page.locator(NOTE_SEL).last(), M2);
        const shown = await page.evaluate(({ N, m }) => {
          const vis = (el) => {
            const r = el.getBoundingClientRect();
            const s = getComputedStyle(el);
            return r.width > 0 && r.height > 0 && s.display !== 'none' && s.visibility !== 'hidden';
          };
          const text = (el) => {
            const t = el.querySelector('[data-note-text]');
            const ta = el.querySelector('textarea');
            return (t && t.textContent) || (ta && ta.value) || el.textContent || '';
          };
          return Array.from(document.querySelectorAll(N)).some((el) => vis(el) && text(el).includes(m));
        }, { N: NOTE_SEL, m: M2 });
        expect(shown, '손상 복구 직후 생성한 노트가 화면에 표시되지 않습니다').toBe(true);

        await pollPage(
          page,
          ({ k, m }) => {
            const v = localStorage.getItem(k);
            if (!v || !v.includes(m)) return false;
            try { JSON.parse(v); return true; } catch (e) { return false; }
          },
          { k: storageKey, m: M2 },
          5000,
          `손상 복구 후 저장 실패: 키 "${storageKey}" 가 새 노트를 포함한 유효 JSON 이 되지 않았습니다`
        );

        // 손상 원본 백업 + 기존 백업 미덮어쓰기
        const backups = await page.evaluate((k) => {
          const esc = k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          const re = new RegExp('^' + esc + '-corrupt-\\d+$');
          return Object.keys(localStorage)
            .filter((x) => re.test(x))
            .map((x) => ({ key: x, val: localStorage.getItem(x) }));
        }, storageKey);

        const oldB = backups.find((b) => b.key === OLD_BACKUP_KEY);
        expect(
          !!oldB && oldB.val === OLD_BACKUP_VAL,
          `기존 백업 키(${OLD_BACKUP_KEY})가 덮어써졌거나 사라졌습니다 — 백업은 새 타임스탬프 키로 쌓아야 합니다`
        ).toBe(true);
        const newB = backups.filter((b) => b.key !== OLD_BACKUP_KEY && b.val === CORRUPT);
        expect(
          newB.length >= 1,
          `손상 원본이 "<원래키>-corrupt-<타임스탬프>" 키로 보존되지 않았습니다 (발견된 백업: ${backups.map((b) => b.key).join(', ') || '없음'})`
        ).toBe(true);

        // pageerror 0건 (A9 는 dialog 0건 단언의 예외 — 자동 수락 + 건수 기록만)
        expect(
          state.pageErrors,
          `pageerror ${state.pageErrors.length}건 발생 (0건이어야 함): ${state.pageErrors.join(' | ')}`
        ).toHaveLength(0);
        test.info().annotations.push({ type: 'A9-dialog-count', description: String(state.dialogs.length) });
      },
      { autoAcceptDialogs: true }
    );
  });
});
