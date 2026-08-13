'use strict';
/**
 * A4 — 보드 좌상단 기준 (137,211)·(613,97)·(311,449)로 드래그(mouse.down→move steps≥10→up)하면
 * 노트 좌상단이 각 ±2px 이내. 드래그 도중 3회 샘플링에서 노트가 커서 ±30px 추종.
 * (351,275)→(352,276) 재드래그 시 최종 위치 차가 정확히 (1,1) — 격자 스냅 차단.
 * 1600×900 뷰포트에서도 1회 성공. 드래그 후 내용·색 불변. 전 테스트 공통 dialog 0건.
 * postit.html 부재 시 크래시 없이 한국어 메시지("postit.html 미구현 (3단계 예정)")로 즉시 실패.
 *
 * 좌표계: 보드 border-box 좌상단이 원점. 노트 좌상단 = "회전 미적용" top-left —
 * 시각 중심(getBoundingClientRect 중심, 중심 기준 회전에 불변)에서 (offsetWidth/2, offsetHeight/2)를
 * 뺀 값. 드래그는 잡은 오프셋을 유지해야 하므로 기대 위치 = 시작 top-left + 커서 이동량.
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

async function readNotes(page) {
  return page.evaluate((N) => {
    return Array.from(document.querySelectorAll(N)).map((el) => {
      const t = el.querySelector('[data-note-text]');
      const ta = el.querySelector('textarea');
      const text = (t && t.textContent) || (ta && ta.value) || el.textContent || '';
      return { text, bg: getComputedStyle(el).backgroundColor };
    });
  }, NOTE_SEL);
}

/** idx 노트의 보드 기준 회전-미적용 top-left (+보드 뷰포트 원점) */
async function noteTopLeft(page, idx) {
  const arr = await page.evaluate(({ B, N }) => {
    const board = document.querySelector(B);
    if (!board) throw new Error('보드 요소([data-board])를 찾을 수 없습니다');
    const b = board.getBoundingClientRect();
    return Array.from(document.querySelectorAll(N)).map((el) => {
      const r = el.getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      return {
        x: cx - el.offsetWidth / 2 - b.left,
        y: cy - el.offsetHeight / 2 - b.top,
        w: el.offsetWidth,
        h: el.offsetHeight,
        bLeft: b.left,
        bTop: b.top,
      };
    });
  }, { B: BOARD_SEL, N: NOTE_SEL });
  const p = arr[idx];
  if (!p) throw new Error(`노트 ${idx + 1}번을 찾을 수 없습니다 (현재 노트 ${arr.length}개)`);
  return p;
}

/**
 * idx 노트를 보드 기준 target 으로 드래그.
 * mouse.down → 4구간 × steps:3 (총 12 steps ≥ 10) → mouse.up.
 * doSample 이면 진행률 0.3/0.6/0.85 에서 3회 커서 추종 샘플링.
 */
async function dragNoteTo(page, idx, target, doSample) {
  const p0 = await noteTopLeft(page, idx);
  // 잡기 지점: [data-drag-handle] 중심, 없으면 노트 상단 띠(가로 중앙, 위에서 18px)
  let gx;
  let gy;
  const handle = page.locator(NOTE_SEL).nth(idx).locator('[data-drag-handle]').first();
  let hb = null;
  if ((await handle.count()) > 0) hb = await handle.boundingBox();
  if (hb) {
    gx = hb.x + hb.width / 2;
    gy = hb.y + hb.height / 2;
  } else {
    gx = p0.bLeft + p0.x + p0.w / 2;
    gy = p0.bTop + p0.y + Math.min(18, p0.h / 2);
  }
  const dx = target.x - p0.x;
  const dy = target.y - p0.y;

  await page.mouse.move(gx, gy);
  await page.mouse.down();
  const fractions = [0.3, 0.6, 0.85, 1];
  const samples = [];
  for (let i = 0; i < fractions.length; i++) {
    const f = fractions[i];
    await page.mouse.move(gx + dx * f, gy + dy * f, { steps: 3 });
    if (doSample && i < 3) {
      await sleep(60);
      const now = await noteTopLeft(page, idx);
      samples.push({ f, ex: p0.x + dx * f, ey: p0.y + dy * f, ax: now.x, ay: now.y });
    }
  }
  await page.mouse.up();
  await sleep(120);
  const after = await noteTopLeft(page, idx);
  return { p0, after, samples };
}

function assertDragResult(r, target, label) {
  for (const s of r.samples) {
    expect(
      Math.abs(s.ax - s.ex) <= 30 && Math.abs(s.ay - s.ey) <= 30,
      `${label}: 드래그 도중(진행률 ${s.f}) 노트가 커서를 추종하지 않습니다 — 기대 top-left (${s.ex.toFixed(1)},${s.ey.toFixed(1)}), 실제 (${s.ax.toFixed(1)},${s.ay.toFixed(1)}) (±30px 허용)`
    ).toBe(true);
  }
  expect(
    Math.abs(r.after.x - target.x) <= 2 && Math.abs(r.after.y - target.y) <= 2,
    `${label}: 드래그 최종 top-left (${r.after.x.toFixed(1)},${r.after.y.toFixed(1)}) 가 목표 (${target.x},${target.y}) ±2px 를 벗어났습니다`
  ).toBe(true);
}

test.describe('A4 드래그 자유 배치', () => {
  test('A4: 3좌표 드래그 ±2px + 도중 커서 추종 + 1px 스냅 차단 + 내용·색 불변', async () => {
    requirePostit();
    await withFreshApp(POSTIT_PATH, async ({ page, state }) => {
      await addNote(page);
      await pollVisibleNoteCount(page, 1, 5000, 'A4');
      await setNoteText(page, page.locator(NOTE_SEL).last(), 'A4-드래그-검사');
      await sleep(150);
      const before = (await readNotes(page))[0];

      const targets = [
        { x: 137, y: 211 },
        { x: 613, y: 97 },
        { x: 311, y: 449 },
      ];
      for (const t of targets) {
        const r = await dragNoteTo(page, 0, t, true);
        assertDragResult(r, t, `A4 목표 (${t.x},${t.y})`);
      }

      // 1px 차이 보존 — 어떤 2px 이상 격자 스냅도 통과 불가
      const r1 = await dragNoteTo(page, 0, { x: 351, y: 275 }, false);
      const r2 = await dragNoteTo(page, 0, { x: 352, y: 276 }, false);
      const ddx = r2.after.x - r1.after.x;
      const ddy = r2.after.y - r1.after.y;
      expect(
        Math.abs(ddx - 1) <= 0.4 && Math.abs(ddy - 1) <= 0.4,
        `(351,275)→(352,276) 재드래그 시 최종 위치 차가 (${ddx.toFixed(2)},${ddy.toFixed(2)}) 입니다 — 정확히 (1,1)이어야 합니다 (격자 스냅 의심)`
      ).toBe(true);

      // 드래그 후 내용·색 불변
      const after = (await readNotes(page))[0];
      expect(after.text, `드래그 후 노트 내용이 변했습니다 ("${before.text}" → "${after.text}")`).toBe(before.text);
      expect(after.bg, `드래그 후 노트 배경색이 변했습니다 (${before.bg} → ${after.bg})`).toBe(before.bg);

      assertNoDialog(state);
    });
  });

  test('A4: 1600×900 뷰포트에서 드래그 1회 성공', async () => {
    requirePostit();
    await withFreshApp(
      POSTIT_PATH,
      async ({ page, state }) => {
        await addNote(page);
        await pollVisibleNoteCount(page, 1, 5000, 'A4(1600×900)');
        const t = { x: 613, y: 97 };
        const r = await dragNoteTo(page, 0, t, true);
        assertDragResult(r, t, 'A4 1600×900');
        assertNoDialog(state);
      },
      { contextOptions: { viewport: { width: 1600, height: 900 } } }
    );
  });
});
