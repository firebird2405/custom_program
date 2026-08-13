'use strict';
/**
 * A17 — 각 노트의 computed box-shadow ≠ none, transform 에 0이 아닌 회전각(노트별 상이 허용),
 * 노트 폰트가 assets/ 의 @font-face 로 resolve, 보드 배경에 assets/ 질감 적용.
 * "그 결과물이 취향에 맞는가"는 C(사람 시사) 판정 — 본 스펙은 존재만 검사한다.
 * 전 테스트 공통 dialog 0건.
 * postit.html 부재 시 크래시 없이 한국어 메시지("postit.html 미구현 (3단계 예정)")로 즉시 실패.
 *
 * 회전각은 computed `rotate` 속성(개별 transform 속성) 또는 transform 행렬 atan2(b,a) 로 판독.
 * 폰트는 노트 텍스트 요소의 computed font-family 1순위 패밀리가
 * (1) src 에 "assets/" 를 포함한 @font-face 규칙과 일치하고 (2) document.fonts.check 로 로드 확인.
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
const { POSTIT_PATH, requirePostit, withFreshApp, pollPage, sleep } = require('../lib/helpers');

const BOARD_SEL = '[data-board], #board, .board, [data-role="board"]';
const NOTE_SEL = '[data-note], .note, .postit';
const ADD_SEL = '[data-add-note], button:has-text("새 포스트잇")';
const EDIT_SEL = '[data-note-edit], textarea, input[type="text"], [contenteditable]';

function assertNoDialog(state) {
  expect(
    state.dialogs,
    `dialog ${state.dialogs.length}건 발생 (0건이어야 함): ${state.dialogs.map((d) => d.type + ':' + d.message).join(' | ')}`
  ).toHaveLength(0);
}

async function addNote(page) {
  try {
    await page.locator(ADD_SEL).first().click({ timeout: 5000 });
  } catch (e) {
    throw new Error('"+ 새 포스트잇" 추가 버튼([data-add-note])을 찾거나 클릭할 수 없습니다: ' + e.message);
  }
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

test.describe('A17 감성 스타일 존재 검사', () => {
  test('A17: 노트별 그림자·회전·assets 폰트 + 보드 assets 질감', async () => {
    requirePostit();
    await withFreshApp(POSTIT_PATH, async ({ page, state }) => {
      for (let i = 0; i < 3; i++) {
        await addNote(page);
        await pollVisibleNoteCount(page, i + 1, 5000, 'A17');
        await setNoteText(page, page.locator(NOTE_SEL).nth(i), `A17-노트-${i + 1}`);
      }
      await sleep(200);

      const res = await page.evaluate(async ({ B, N }) => {
        await document.fonts.ready;

        // 문서 내 @font-face 규칙 수집
        const faces = [];
        for (const sheet of Array.from(document.styleSheets)) {
          let rules = null;
          try { rules = sheet.cssRules; } catch (e) { continue; }
          if (!rules) continue;
          for (const r of Array.from(rules)) {
            if (r.type === CSSRule.FONT_FACE_RULE) {
              faces.push({
                family: (r.style.getPropertyValue('font-family') || '').replace(/^["']|["']$/g, '').trim(),
                src: r.style.getPropertyValue('src') || '',
              });
            }
          }
        }

        const notes = Array.from(document.querySelectorAll(N)).map((el) => {
          const s = getComputedStyle(el);
          // 회전각: rotate 속성 우선, 없으면 transform 행렬
          let rot = null;
          const rp = s.rotate;
          if (rp && rp !== 'none') {
            const m = /(-?[\d.]+)deg/.exec(rp);
            if (m) rot = parseFloat(m[1]);
          }
          if (rot === null) {
            const t = s.transform;
            if (t && t !== 'none') {
              const m2 = /matrix(?:3d)?\(([^)]+)\)/.exec(t);
              if (m2) {
                const p = m2[1].split(',').map(Number);
                rot = (Math.atan2(p[1], p[0]) * 180) / Math.PI;
              }
            }
            if (rot === null) rot = 0;
          }
          const textEl = el.querySelector('[data-note-text]') || el;
          const famRaw = getComputedStyle(textEl).fontFamily || '';
          const fam = (famRaw.split(',')[0] || '').replace(/^["']|["']$/g, '').trim();
          let fontLoaded = false;
          try { fontLoaded = document.fonts.check('12px "' + fam + '"'); } catch (e) { fontLoaded = false; }
          return { boxShadow: s.boxShadow, rot, fam, fontLoaded };
        });

        const board = document.querySelector(B);
        return {
          faces,
          notes,
          boardBg: board ? getComputedStyle(board).backgroundImage : null,
        };
      }, { B: BOARD_SEL, N: NOTE_SEL });

      expect(res.boardBg, '보드 요소([data-board])를 찾을 수 없습니다').not.toBeNull();
      expect(res.notes.length, `노트가 ${res.notes.length}개입니다 (3개 생성 실패)`).toBeGreaterThanOrEqual(3);

      res.notes.forEach((n, i) => {
        expect(
          n.boxShadow && n.boxShadow !== 'none',
          `노트 ${i + 1}번의 computed box-shadow 가 "${n.boxShadow}" 입니다 (none 이 아니어야 함)`
        ).toBe(true);
        expect(
          Math.abs(n.rot) > 0.05,
          `노트 ${i + 1}번의 회전각이 ${n.rot.toFixed(3)}deg 입니다 (0이 아닌 회전각이어야 함 — transform/rotate)`
        ).toBe(true);
        const face = res.faces.find(
          (f) => f.family && f.family.toLowerCase() === n.fam.toLowerCase() && /assets\//i.test(f.src)
        );
        expect(
          !!face,
          `노트 ${i + 1}번의 폰트 "${n.fam}" 가 assets/ 를 가리키는 @font-face 로 resolve 되지 않습니다 ` +
            `(발견된 @font-face: ${res.faces.map((f) => `${f.family}←${f.src}`).join(' | ') || '없음'})`
        ).toBe(true);
        expect(
          n.fontLoaded,
          `노트 ${i + 1}번의 폰트 "${n.fam}" 가 document.fonts 에 로드되어 있지 않습니다`
        ).toBe(true);
      });

      expect(
        /assets\//i.test(res.boardBg),
        `보드의 computed background-image 가 assets/ 질감을 가리키지 않습니다 (현재: ${res.boardBg})`
      ).toBe(true);

      assertNoDialog(state);
    });
  });
});
