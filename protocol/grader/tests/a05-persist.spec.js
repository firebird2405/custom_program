'use strict';
/**
 * A5 — 위치 이동·색 변경·텍스트 입력 각각이 2초 내 localStorage 폴링으로 확인됨.
 * persistent context 재기동 후 모든 노트의 위치·색·내용 동일.
 * 노트 30개 생성 후 재기동 시 정확히 30개 보존(조용한 상한 차단).
 * 재기동 = launchPersistentContext(같은 user-data-dir) close → 재기동 (공통 규정).
 * 전 테스트 공통 dialog 0건.
 * postit.html 부재 시 크래시 없이 한국어 메시지("postit.html 미구현 (3단계 예정)")로 즉시 실패.
 *
 * 저장 키 이름은 3단계 구현에 위임하므로 텍스트는 "값에 마커 포함", 위치·색은
 * "localStorage 스냅샷 변화(무인터랙션 자가 변경 '하트비트' 키 제외)"로 2초 내 반영을 판정한다.
 * — 더미 키 주기 쓰기로 스냅샷 변화만 만들고 실데이터 저장을 종료 시점으로 미루는 우회 차단.
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

const BOARD_SEL = '[data-board], #board, .board, [data-role="board"]';
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

async function dragNoteTo(page, idx, target) {
  const p0 = await noteTopLeft(page, idx);
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
  await page.mouse.move(gx, gy);
  await page.mouse.down();
  await page.mouse.move(gx + (target.x - p0.x), gy + (target.y - p0.y), { steps: 10 });
  await page.mouse.up();
  await sleep(120);
}

/** idx 노트를 활성화한 뒤 현재 색과 가장 먼 색 견본을 클릭 */
async function applyAnyColor(page, idx) {
  try {
    await page.locator(NOTE_SEL).nth(idx).click({ timeout: 5000 });
  } catch (e) {
    throw new Error('노트를 클릭(활성)할 수 없습니다: ' + e.message);
  }
  await sleep(120);
  const swatches = await page.evaluate(({ N, S, idx }) => {
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
  if (!swatches.length) {
    throw new Error('색상 견본([data-color])을 찾을 수 없습니다 — 노트 클릭(활성) 상태에서 팔레트가 보여야 합니다');
  }
  const cur = parseRgb((await readNotes(page))[idx].bg) || { r: -999, g: -999, b: -999 };
  let best = swatches[0];
  let bestD = -1;
  for (const s of swatches) {
    const c = parseRgb(s.bg);
    if (!c) continue;
    const d = rgbDist(c, cur);
    if (d > bestD) { bestD = d; best = s; }
  }
  await page.mouse.click(best.x, best.y);
  await sleep(150);
}

const SNAPSHOT_JSON_FN = () => {
  const o = {};
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    o[k] = localStorage.getItem(k);
  }
  return JSON.stringify(o);
};

const CONTAINS_FN = (m) =>
  Object.keys(localStorage).some((k) => (localStorage.getItem(k) || '').includes(m));

/**
 * 무인터랙션 구간(idleMs)에서 저절로 값이 변하는 키(타이머 하트비트) 탐지.
 * 이런 키의 변화만으로는 "저장 반영"으로 인정하지 않는다 — 실데이터 저장을 종료 시점으로
 * 미루면서 더미 키를 주기적으로 써서 스냅샷 변화 검사를 통과하는 우회(D: 종료 시점 저장) 차단.
 * idle 2.2초는 공통 저장 규정(변경 후 2초 내 저장)보다 길어, 2초 내 반복 쓰기 하트비트를 잡는다.
 */
async function detectNoisyKeys(page, idleMs = 2200) {
  const a = JSON.parse(await page.evaluate(SNAPSHOT_JSON_FN));
  await sleep(idleMs);
  const b = JSON.parse(await page.evaluate(SNAPSHOT_JSON_FN));
  const keys = new Set(Object.keys(a).concat(Object.keys(b)));
  const noisy = [];
  for (const k of keys) if (a[k] !== b[k]) noisy.push(k);
  return noisy;
}

/** prev(JSON 스냅샷) 대비, noisy 키를 제외한 어떤 키라도 생성·삭제·변경되면 참 */
const CHANGED_NON_NOISY_FN = ({ prev, noisy }) => {
  const p = JSON.parse(prev);
  const keys = new Set(Object.keys(p));
  for (let i = 0; i < localStorage.length; i++) keys.add(localStorage.key(i));
  for (const k of keys) {
    if (noisy.indexOf(k) !== -1) continue;
    const before = Object.prototype.hasOwnProperty.call(p, k) ? p[k] : null;
    if (localStorage.getItem(k) !== before) return true;
  }
  return false;
};

test.describe('A5 저장·재기동 보존', () => {
  test('A5: 텍스트·색·위치 각 2초 내 저장 + 재기동 후 위치·색·내용 동일', async () => {
    requirePostit();
    const dir = freshProfileDir();
    let app = null;
    try {
      app = await launchApp(dir, POSTIT_PATH);
      let page = app.page;
      const T1 = 'A5-노트-알파';
      const T2 = 'A5-노트-베타';

      // (1) 텍스트 입력 → 2초 내 localStorage 확인
      await addNote(page);
      await pollVisibleNoteCount(page, 1, 5000, 'A5');
      await setNoteText(page, page.locator(NOTE_SEL).nth(0), T1);
      await pollPage(page, CONTAINS_FN, T1, 2000, '텍스트 입력이 2초 내 localStorage 에서 확인되지 않았습니다 (노트 1)');
      await addNote(page);
      await pollVisibleNoteCount(page, 2, 5000, 'A5');
      await setNoteText(page, page.locator(NOTE_SEL).nth(1), T2);
      await pollPage(page, CONTAINS_FN, T2, 2000, '텍스트 입력이 2초 내 localStorage 에서 확인되지 않았습니다 (노트 2)');

      // 하트비트 키 탐지 (무인터랙션 2.2초간 저절로 변한 키는 저장 증거로 인정하지 않음)
      const noisy = await detectNoisyKeys(page);

      // (2) 색 변경 → 2초 내 저장(하트비트 제외 스냅샷 변화) 확인
      const s1 = await page.evaluate(SNAPSHOT_JSON_FN);
      await applyAnyColor(page, 0);
      await pollPage(
        page,
        CHANGED_NON_NOISY_FN,
        { prev: s1, noisy },
        2000,
        '색 변경이 2초 내 localStorage 에 반영되지 않았습니다' +
          (noisy.length ? ` (무인터랙션 자가 변경 키 ${JSON.stringify(noisy)} 는 저장 증거로 제외 — 타이머 더미 쓰기가 아닌 변경 저장이 필요합니다)` : '')
      );

      // (3) 위치 이동 → 2초 내 저장 확인
      const s2 = await page.evaluate(SNAPSHOT_JSON_FN);
      const p = await noteTopLeft(page, 0);
      const target = Math.abs(p.x - 220) < 5 && Math.abs(p.y - 180) < 5 ? { x: 320, y: 260 } : { x: 220, y: 180 };
      await dragNoteTo(page, 0, target);
      await pollPage(
        page,
        CHANGED_NON_NOISY_FN,
        { prev: s2, noisy },
        2000,
        '위치 이동이 2초 내 localStorage 에 반영되지 않았습니다' +
          (noisy.length ? ` (무인터랙션 자가 변경 키 ${JSON.stringify(noisy)} 는 저장 증거로 제외 — 타이머 더미 쓰기가 아닌 변경 저장이 필요합니다)` : '')
      );

      // 재기동 전 상태 기록
      const infosBefore = await readNotes(page);
      const posBefore = [await noteTopLeft(page, 0), await noteTopLeft(page, 1)];
      assertNoDialog(app.state);
      await closeApp(app);
      app = null;

      // 재기동
      app = await launchApp(dir, POSTIT_PATH);
      page = app.page;
      await pollVisibleNoteCount(page, 2, 5000, 'A5 재기동');
      const infosAfter = await readNotes(page);

      for (let iOld = 0; iOld < 2; iOld++) {
        const marker = [T1, T2][iOld];
        const jNew = infosAfter.findIndex((n) => n.text.includes(marker));
        expect(jNew >= 0, `재기동 후 "${marker}" 노트를 찾을 수 없습니다 (내용 유실)`).toBe(true);
        expect(
          infosAfter[jNew].text,
          `재기동 후 "${marker}" 노트의 내용이 다릅니다 ("${infosBefore[iOld].text}" → "${infosAfter[jNew].text}")`
        ).toBe(infosBefore[iOld].text);

        const cB = parseRgb(infosBefore[iOld].bg);
        const cA = parseRgb(infosAfter[jNew].bg);
        expect(!!cB && !!cA, `배경색을 해석할 수 없습니다 (${infosBefore[iOld].bg} / ${infosAfter[jNew].bg})`).toBe(true);
        expect(
          Math.abs(cA.r - cB.r) <= 2 && Math.abs(cA.g - cB.g) <= 2 && Math.abs(cA.b - cB.b) <= 2,
          `재기동 후 "${marker}" 노트의 색이 다릅니다 (${infosBefore[iOld].bg} → ${infosAfter[jNew].bg})`
        ).toBe(true);

        const pA = await noteTopLeft(page, jNew);
        expect(
          Math.abs(pA.x - posBefore[iOld].x) <= 2 && Math.abs(pA.y - posBefore[iOld].y) <= 2,
          `재기동 후 "${marker}" 노트의 위치가 다릅니다 ((${posBefore[iOld].x.toFixed(1)},${posBefore[iOld].y.toFixed(1)}) → (${pA.x.toFixed(1)},${pA.y.toFixed(1)}), ±2px 허용)`
        ).toBe(true);
      }

      assertNoDialog(app.state);
    } finally {
      await closeApp(app);
      await removeDirWithRetry(dir);
    }
  });

  test('A5: 노트 30개 생성 → 재기동 후 정확히 30개 보존', async () => {
    requirePostit();
    const dir = freshProfileDir();
    let app = null;
    try {
      app = await launchApp(dir, POSTIT_PATH);
      for (let i = 0; i < 30; i++) await addNote(app.page);
      await pollVisibleNoteCount(app.page, 30, 15000, 'A5 30개 생성');
      // 공통 저장 규정(변경 후 2초 내 저장)에 따라 마지막 생성 후 2.5초 대기
      await sleep(2500);
      const nonEmpty = await app.page.evaluate(() =>
        Object.keys(localStorage).some((k) => (localStorage.getItem(k) || '').length > 2)
      );
      expect(nonEmpty, '30개 생성 후에도 localStorage 가 비어 있습니다 (저장 미수행)').toBe(true);
      assertNoDialog(app.state);
      await closeApp(app);
      app = null;

      app = await launchApp(dir, POSTIT_PATH);
      await pollVisibleNoteCount(app.page, 30, 10000, 'A5 재기동 30개').catch(() => {});
      await sleep(300);
      const count = await countVisible(app.page);
      expect(
        count,
        `재기동 후 visible 노트가 ${count}개입니다 (정확히 30개여야 함 — 조용한 저장 상한/유실 의심)`
      ).toBe(30);
      assertNoDialog(app.state);
    } finally {
      await closeApp(app);
      await removeDirWithRetry(dir);
    }
  });
});
