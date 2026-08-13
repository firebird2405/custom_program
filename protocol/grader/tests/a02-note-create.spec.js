'use strict';
/**
 * A2 — "+ 새 포스트잇" 클릭 → visible 노트 1개 증가(렌더 크기 ≥ 120×120px, 보드 내부).
 * 줄바꿈 2개 이상 포함 200자 문자열을 입력하면 textContent 가 입력과 일치하게 표시
 * (font-size ≥ 12px, 글자색 ≠ 배경색). 전 테스트 공통 dialog 0건.
 * visible 판정은 유효 opacity(조상 누적) > 0.05 를 포함하고, 글자색 알파 ≈ 0(투명 글자)을
 * 거부한다 — opacity:0 노트/rgba(...,0) 글자로 A2 를 통과하는 은닉 우회 차단 (굿하트 D:
 * "보이지 않는 노트 … DOM 존재만 충족" — 레드팀 디코이 검증으로 확인된 구멍의 봉합).
 * postit.html 부재 시 크래시 없이 한국어 메시지("postit.html 미구현 (3단계 예정)")로 즉시 실패.
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

function parseRgb(s) {
  const m = /rgba?\(([^)]+)\)/.exec(s || '');
  if (!m) return null;
  const p = m[1].split(',').map((x) => parseFloat(x));
  return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
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
    const effOpacity = (el) => {
      let o = 1;
      for (let c = el; c && c.nodeType === 1; c = c.parentElement) o *= parseFloat(getComputedStyle(c).opacity) || 0;
      return o;
    };
    return Array.from(document.querySelectorAll(sel)).filter((el) => {
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && s.display !== 'none' && s.visibility !== 'hidden' && effOpacity(el) > 0.05;
    }).length;
  }, NOTE_SEL);
}

async function pollVisibleNoteCount(page, want, timeoutMs, label) {
  await pollPage(
    page,
    ({ sel, want }) => {
      const effOpacity = (el) => {
        let o = 1;
        for (let c = el; c && c.nodeType === 1; c = c.parentElement) o *= parseFloat(getComputedStyle(c).opacity) || 0;
        return o;
      };
      return (
        Array.from(document.querySelectorAll(sel)).filter((el) => {
          const r = el.getBoundingClientRect();
          const s = getComputedStyle(el);
          return r.width > 0 && r.height > 0 && s.display !== 'none' && s.visibility !== 'hidden' && effOpacity(el) > 0.05;
        }).length === want
      );
    },
    { sel: NOTE_SEL, want },
    timeoutMs,
    `${label}: visible 노트 수가 ${want}개가 되지 않았습니다 (0×0 크기·display:none·visibility:hidden·유효 opacity ≤ 0.05 는 비가시로 판정)`
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

test.describe('A2 포스트잇 생성·텍스트 표시', () => {
  test('A2: 새 포스트잇 생성 — visible +1, ≥120×120px, 보드 내부, 200자·줄바꿈 리터럴 표시', async () => {
    requirePostit();

    // 줄바꿈 2개 포함 정확히 200자
    const SEG = 'A2-줄바꿈-보존-검사-'.repeat(10).slice(0, 66);
    const TEXT200 = `${SEG}\n${SEG}\n${SEG}`;
    expect(TEXT200.length, '테스트 자체 오류: 검사 문자열이 200자가 아닙니다').toBe(200);
    expect((TEXT200.match(/\n/g) || []).length, '테스트 자체 오류: 줄바꿈이 2개 미만입니다').toBeGreaterThanOrEqual(2);

    await withFreshApp(POSTIT_PATH, async ({ page, state }) => {
      // 추가 버튼의 표시 텍스트 검증 (SCORECARD A2: '"+ 새 포스트잇" 클릭' —
      // [data-add-note] 훅을 쓰더라도 표시 텍스트에 "새 포스트잇" 이 포함되어야 한다)
      const addBtnCount = await page.locator(ADD_SEL).count();
      expect(addBtnCount >= 1, '"+ 새 포스트잇" 추가 버튼([data-add-note])을 찾을 수 없습니다').toBe(true);
      const addLabel = ((await page.locator(ADD_SEL).first().textContent()) || '').replace(/\s+/g, ' ').trim();
      expect(
        addLabel.includes('새 포스트잇'),
        `추가 버튼의 표시 텍스트가 "${addLabel}" 입니다 — "새 포스트잇" 을 포함해야 합니다 (SCORECARD A2)`
      ).toBe(true);

      const before = await countVisible(page);
      await addNote(page);
      await pollVisibleNoteCount(page, before + 1, 5000, 'A2');

      // 새 노트(마지막 노트)의 렌더 크기 · 보드 내부 여부 (회전 보정: 중심점 - 레이아웃 크기/2)
      const geo = await page.evaluate(({ B, N }) => {
        const board = document.querySelector(B);
        if (!board) return { err: '보드 요소([data-board])를 찾을 수 없습니다' };
        const notes = Array.from(document.querySelectorAll(N));
        const el = notes[notes.length - 1];
        if (!el) return { err: '생성된 노트([data-note])를 찾을 수 없습니다' };
        const b = board.getBoundingClientRect();
        const r = el.getBoundingClientRect();
        const cx = r.left + r.width / 2;
        const cy = r.top + r.height / 2;
        return {
          w: el.offsetWidth,
          h: el.offsetHeight,
          x: cx - el.offsetWidth / 2 - b.left,
          y: cy - el.offsetHeight / 2 - b.top,
          bw: b.width,
          bh: b.height,
        };
      }, { B: BOARD_SEL, N: NOTE_SEL });
      expect(geo.err, geo.err || '').toBeUndefined();
      expect(geo.w, `노트 렌더 폭이 ${geo.w}px 입니다 (120px 이상이어야 함)`).toBeGreaterThanOrEqual(120);
      expect(geo.h, `노트 렌더 높이가 ${geo.h}px 입니다 (120px 이상이어야 함)`).toBeGreaterThanOrEqual(120);
      expect(
        geo.x >= -2 && geo.y >= -2 && geo.x + geo.w <= geo.bw + 2 && geo.y + geo.h <= geo.bh + 2,
        `노트가 보드 내부에 있지 않습니다 (top-left (${geo.x.toFixed(1)},${geo.y.toFixed(1)}), 크기 ${geo.w}×${geo.h}, 보드 ${geo.bw.toFixed(0)}×${geo.bh.toFixed(0)})`
      ).toBe(true);

      // 200자·줄바꿈 문자열 입력 → textContent 일치 표시
      await setNoteText(page, page.locator(NOTE_SEL).last(), TEXT200);
      await sleep(150);

      const disp = await page.evaluate(({ N, txt }) => {
        const effOpacity = (el) => {
          let o = 1;
          for (let c = el; c && c.nodeType === 1; c = c.parentElement) o *= parseFloat(getComputedStyle(c).opacity) || 0;
          return o;
        };
        const notes = Array.from(document.querySelectorAll(N));
        const note = notes[notes.length - 1];
        if (!note) return { found: false };
        const cands = [note, ...note.querySelectorAll('*')];
        for (const el of cands) {
          if (el.textContent !== txt) continue;
          const r = el.getBoundingClientRect();
          const s = getComputedStyle(el);
          if (!(r.width > 0 && r.height > 0) || s.display === 'none' || s.visibility === 'hidden') continue;
          // 유효 배경색: el 부터 조상 방향으로 첫 불투명 background-color
          let bg = null;
          let cur = el;
          while (cur && cur !== document.documentElement) {
            const v = getComputedStyle(cur).backgroundColor;
            const m = /rgba?\(([^)]+)\)/.exec(v);
            if (m) {
              const p = m[1].split(',').map(parseFloat);
              if (p.length < 4 || p[3] > 0.01) { bg = v; break; }
            }
            cur = cur.parentElement;
          }
          return { found: true, fontSize: parseFloat(s.fontSize), color: s.color, bg, effOpacity: effOpacity(el) };
        }
        return { found: false };
      }, { N: NOTE_SEL, txt: TEXT200 });

      expect(
        disp.found,
        '입력한 200자(줄바꿈 2개 포함) 문자열이 textContent 로 일치 표시되지 않았습니다 — [data-note-text] 요소의 textContent 가 입력과 정확히 같아야 합니다 (줄바꿈 \\n 보존, white-space:pre-wrap 권장)'
      ).toBe(true);
      expect(disp.fontSize, `표시 글자 크기가 ${disp.fontSize}px 입니다 (12px 이상이어야 함)`).toBeGreaterThanOrEqual(12);
      expect(
        disp.effOpacity > 0.05,
        `표시 요소의 유효 opacity(조상 누적)가 ${disp.effOpacity} 입니다 — 글자가 보이지 않습니다 (opacity 은닉 차단)`
      ).toBe(true);

      const c = parseRgb(disp.color);
      const g = parseRgb(disp.bg);
      expect(!!c && !!g, `글자색/배경색을 해석할 수 없습니다 (color=${disp.color}, bg=${disp.bg})`).toBe(true);
      expect(
        c.a > 0.05,
        `글자색 알파가 ${c.a} 입니다 (${disp.color}) — 완전 투명 글자는 보이지 않습니다 (투명 글자색 은닉 차단)`
      ).toBe(true);
      expect(
        c.r !== g.r || c.g !== g.g || c.b !== g.b,
        `글자색과 배경색이 동일합니다 (${disp.color} == ${disp.bg}) — 글자가 보이지 않습니다`
      ).toBe(true);

      assertNoDialog(state);
    });
  });
});
