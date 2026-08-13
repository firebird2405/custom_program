'use strict';
/**
 * A3 — 팔레트에 4색 이상, 모든 색 쌍의 RGB 유클리드 거리 ≥ 100.
 * 노트 2개 이상 상태에서 한 노트의 색을 바꾸면 그 노트의 computed background-color 만
 * 선택 색으로 변경(타 노트 불변). 질감은 background-image 레이어로 유지 가능하므로
 * 본 스펙은 background-color 만 검사한다. 전 테스트 공통 dialog 0건.
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

const NOTE_SEL = '[data-note], .note, .postit';
const ADD_SEL = '[data-add-note], button:has-text("새 포스트잇")';
const EDIT_SEL = '[data-note-edit], textarea, input[type="text"], [contenteditable]';
const SWATCH_SEL = '[data-color], .swatch, .color-swatch, .palette button';

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

function rgbDist(a, b) {
  return Math.hypot(a.r - b.r, a.g - b.g, a.b - b.b);
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

async function readNoteBgs(page) {
  return page.evaluate((N) => {
    return Array.from(document.querySelectorAll(N)).map((el) => getComputedStyle(el).backgroundColor);
  }, NOTE_SEL);
}

/** idx 노트를 활성화(클릭)한 뒤 보이는 색 견본 목록 {x,y,bg} 반환 (노트 내부 우선, 없으면 전역) */
async function getSwatches(page, idx) {
  try {
    await page.locator(NOTE_SEL).nth(idx).click({ timeout: 5000 });
  } catch (e) {
    throw new Error('노트를 클릭(활성)할 수 없습니다: ' + e.message);
  }
  await sleep(120);
  return page.evaluate(({ N, S, idx }) => {
    const vis = (el) => {
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && s.display !== 'none' && s.visibility !== 'hidden';
    };
    const notes = document.querySelectorAll(N);
    let els = [];
    if (notes[idx]) els = Array.from(notes[idx].querySelectorAll(S)).filter(vis);
    if (!els.length) els = Array.from(document.querySelectorAll(S)).filter(vis);
    return els.map((el) => {
      const r = el.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2, bg: getComputedStyle(el).backgroundColor };
    });
  }, { N: NOTE_SEL, S: SWATCH_SEL, idx });
}

test.describe('A3 색상 팔레트·개별 색 변경', () => {
  test('A3: 팔레트 4색 이상(쌍별 거리 ≥ 100) + 선택 노트만 색 변경', async () => {
    requirePostit();
    await withFreshApp(POSTIT_PATH, async ({ page, state }) => {
      await addNote(page);
      await pollVisibleNoteCount(page, 1, 5000, 'A3');
      await setNoteText(page, page.locator(NOTE_SEL).nth(0), 'A3-노트-1');
      await addNote(page);
      await pollVisibleNoteCount(page, 2, 5000, 'A3');
      await setNoteText(page, page.locator(NOTE_SEL).nth(1), 'A3-노트-2');

      // 팔레트 검사 — 노트 0 활성 상태에서 보이는 견본
      const swatches = await getSwatches(page, 0);
      expect(
        swatches.length,
        `색상 견본([data-color])이 ${swatches.length}개입니다 (4개 이상이어야 함 — 노트 클릭(활성) 시 팔레트가 보여야 합니다)`
      ).toBeGreaterThanOrEqual(4);

      const colors = swatches.map((s) => parseRgb(s.bg));
      colors.forEach((c, i) => {
        expect(c, `색상 견본 ${i + 1}번의 배경색(${swatches[i].bg})을 해석할 수 없습니다`).not.toBeNull();
      });
      for (let i = 0; i < colors.length; i++) {
        for (let j = i + 1; j < colors.length; j++) {
          const d = rgbDist(colors[i], colors[j]);
          expect(
            d >= 100,
            `팔레트 색 ${i + 1}번(${swatches[i].bg})과 ${j + 1}번(${swatches[j].bg})의 RGB 유클리드 거리가 ${d.toFixed(1)} 입니다 (모든 쌍 100 이상이어야 함)`
          ).toBe(true);
        }
      }

      // 색 변경: 현재 색과 가장 먼 견본 선택 → 노트 0 만 변경
      const bgsBefore = await readNoteBgs(page);
      const cur = parseRgb(bgsBefore[0]) || { r: -999, g: -999, b: -999 };
      let best = null;
      let bestD = -1;
      for (const s of swatches) {
        const c = parseRgb(s.bg);
        if (!c) continue;
        const d = rgbDist(c, cur);
        if (d > bestD) { bestD = d; best = s; }
      }
      expect(best, '클릭할 색상 견본을 결정할 수 없습니다').not.toBeNull();
      await page.mouse.click(best.x, best.y);
      await sleep(200);

      const bgsAfter = await readNoteBgs(page);
      const want = parseRgb(best.bg);
      const got = parseRgb(bgsAfter[0]);
      expect(got, `색 변경 후 노트 1번의 배경색(${bgsAfter[0]})을 해석할 수 없습니다`).not.toBeNull();
      expect(
        Math.abs(got.r - want.r) <= 2 && Math.abs(got.g - want.g) <= 2 && Math.abs(got.b - want.b) <= 2,
        `노트 1번의 배경색이 선택 색으로 변경되지 않았습니다 (선택 ${best.bg}, 실제 ${bgsAfter[0]})`
      ).toBe(true);
      expect(
        bgsAfter[1],
        `색을 바꾸지 않은 노트 2번의 배경색이 변했습니다 (${bgsBefore[1]} → ${bgsAfter[1]}) — 선택 노트만 변경되어야 합니다`
      ).toBe(bgsBefore[1]);

      assertNoDialog(state);
    });
  });
});
