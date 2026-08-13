'use strict';
/**
 * 채점기 공용 유틸리티 — SCORECARD "채점 메커니즘 공통 규정" 구현
 * - 재기동 = chromium.launchPersistentContext(전용 user-data-dir) → close → 같은 dir로 재기동
 *   (plain newContext 는 file:// localStorage 를 잃으므로 금지)
 * - 네트워크: context.route(/^https?:/ 프레디킷) abort — file:// 서브리소스(assets/)는 통과
 * - 공통 감시: dialog(기본 dismiss·기록, A9만 autoAcceptDialogs 옵션으로 자동 수락),
 *   pageerror 수집, console error 수집, http(s) 요청 카운터
 * - user-data-dir 은 반드시 os.tmpdir() 하위에 생성 (protocol/grader/ 내부 금지 — A12 해시 오염 방지)
 *   테스트 teardown 에서 removeDirWithRetry 로 정리
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');
const { chromium } = require('@playwright/test');

const APP_ROOT = path.resolve(__dirname, '..', '..', '..'); // d:\custom_program
const CALENDAR_PATH = path.join(APP_ROOT, 'calendar.html');
const POSTIT_PATH = path.join(APP_ROOT, 'postit.html');
const POSTIT_MISSING_MSG = 'postit.html 미구현 (3단계 예정)';

function fileUrl(p) {
  return pathToFileURL(p).href; // 예: file:///D:/custom_program/calendar.html
}

/** postit.html 부재 시 크래시 대신 명확한 한국어 메시지로 즉시 실패 */
function requirePostit() {
  if (!fs.existsSync(POSTIT_PATH)) throw new Error(POSTIT_MISSING_MSG);
}

/** os.tmpdir() 하위 전용 프로필 디렉터리 생성 */
function freshProfileDir(prefix = 'grader-udd-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * 앱 기동: persistent context + 네트워크 차단/카운터 + dialog/pageerror/console 감시.
 * @returns {{context, page, state:{httpRequests:string[], dialogs:{type,message}[], pageErrors:string[], consoleErrors:string[]}}}
 */
async function launchApp(userDataDir, htmlPath, opts = {}) {
  const context = await chromium.launchPersistentContext(
    userDataDir,
    Object.assign(
      {
        channel: 'msedge',
        headless: true,
        viewport: { width: 1280, height: 800 },
        deviceScaleFactor: 1,
      },
      opts.contextOptions || {}
    )
  );

  const state = { httpRequests: [], dialogs: [], pageErrors: [], consoleErrors: [] };

  // http(s)만 차단 — file:// 서브리소스는 통과
  await context.route((u) => /^https?:/i.test(u.href), (route) => route.abort());
  context.on('request', (req) => {
    if (/^https?:/i.test(req.url())) state.httpRequests.push(req.url());
  });

  const attachWatchers = (page) => {
    page.on('dialog', async (dialog) => {
      state.dialogs.push({ type: dialog.type(), message: dialog.message() });
      try {
        if (opts.autoAcceptDialogs) await dialog.accept();
        else await dialog.dismiss();
      } catch (e) {
        /* 이미 처리된 dialog — 무시 */
      }
    });
    page.on('pageerror', (err) => state.pageErrors.push(String((err && err.message) || err)));
    page.on('console', (msg) => {
      if (msg.type() === 'error') state.consoleErrors.push(msg.text());
    });
  };
  context.pages().forEach(attachWatchers);
  context.on('page', attachWatchers);

  let page = context.pages()[0];
  if (!page) page = await context.newPage();
  if (htmlPath) await page.goto(fileUrl(htmlPath), { waitUntil: 'load' });

  return { context, page, state };
}

async function closeApp(app) {
  if (app && app.context) {
    try {
      await app.context.close();
    } catch (e) {
      /* 이미 닫힘 */
    }
  }
}

/** Windows 파일 잠금 대비 재시도 삭제 (teardown 정리용) */
async function removeDirWithRetry(dir, tries = 6, delayMs = 250) {
  for (let i = 0; i < tries; i++) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
      return true;
    } catch (e) {
      await sleep(delayMs);
    }
  }
  return false;
}

/** 새 프로필로 앱을 열어 fn 실행 후 컨텍스트·프로필을 정리하는 편의 래퍼 */
async function withFreshApp(htmlPath, fn, opts = {}) {
  const dir = freshProfileDir();
  const app = await launchApp(dir, htmlPath, opts);
  try {
    return await fn(app, dir);
  } finally {
    await closeApp(app);
    await removeDirWithRetry(dir);
  }
}

/**
 * localStorage[key] 를 100ms 간격으로 폴링해 predicate(rawString) 가 참이 되면 그 값을 반환.
 * 시간 초과 시 한국어 메시지로 실패.
 */
async function pollLocalStorage(page, key, predicate, timeoutMs = 2000) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  for (;;) {
    last = await page.evaluate((k) => {
      try {
        return localStorage.getItem(k);
      } catch (e) {
        return null;
      }
    }, key);
    let ok = false;
    try {
      ok = !!predicate(last);
    } catch (e) {
      ok = false;
    }
    if (ok) return last;
    if (Date.now() > deadline) {
      throw new Error(
        `localStorage 폴링 시간 초과 (${timeoutMs}ms): 키 "${key}" 값이 조건을 만족하지 않습니다. ` +
          `마지막 값: ${last === null ? '(없음)' : String(last).slice(0, 200)}`
      );
    }
    await sleep(100);
  }
}

/** 임의 page.evaluate 조건 폴링 (저장 키가 미정인 앱 검사용) */
async function pollPage(page, evalFn, arg, timeoutMs, failMsg) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    let ok = false;
    try {
      ok = !!(await page.evaluate(evalFn, arg));
    } catch (e) {
      ok = false;
    }
    if (ok) return;
    if (Date.now() > deadline) throw new Error(failMsg);
    await sleep(100);
  }
}

module.exports = {
  APP_ROOT,
  CALENDAR_PATH,
  POSTIT_PATH,
  POSTIT_MISSING_MSG,
  fileUrl,
  requirePostit,
  freshProfileDir,
  sleep,
  launchApp,
  closeApp,
  removeDirWithRetry,
  withFreshApp,
  pollLocalStorage,
  pollPage,
};

/* ════════════════════════════════════════════════════════════════════
 * rev.5 (발주 #2, A19~A41) 공용 유틸 — 추가 전용 (기존 코드·수출은 수정하지 않음)
 * - a02/a04/a18 스펙의 유효 opacity·회전-미적용 top-left·드래그·노트 조작 유틸을
 *   설계서 §5 규정에 따라 lib/helpers.js 로 승격 (신규 스펙 공유, 중복 구현 금지)
 * - 신규 data-훅은 폴백 셀렉터 없음: 부재 = 즉시 한국어 FAIL (fail-closed)
 * ════════════════════════════════════════════════════════════════════ */

/** 포스트잇 공통 셀렉터 (기존 A2~A18 계약의 폴백 포함 — 신규 훅에는 적용하지 않음) */
const POSTIT_SEL = Object.freeze({
  BOARD: '[data-board], #board, .board, [data-role="board"]',
  NOTE: '[data-note], .note, .postit',
  ADD: '[data-add-note], button:has-text("새 포스트잇")',
  EDIT: '[data-note-edit], textarea, input[type="text"], [contenteditable]',
  DELETE: '[data-delete-note], .note-delete, .delete-note, button:has-text("삭제")',
  SWATCH: '[data-color], .swatch, .color-swatch, .palette button',
});

/** dialog 0건 공통 단언 (A9 외) — 위반 시 한국어 메시지로 throw */
function assertNoDialogs(state, label) {
  if (state.dialogs.length > 0) {
    throw new Error(
      (label ? label + ': ' : '') +
        `dialog ${state.dialogs.length}건 발생 (A9 외 0건이어야 함 — B 금지 조항: alert/confirm/prompt 를 필수 UI 경로로 사용 금지): ` +
        state.dialogs.map((d) => d.type + ':' + d.message).join(' | ')
    );
  }
}

/** rev.5 fail-closed: 신규 data-훅 부재 = 즉시 한국어 FAIL (폴백 셀렉터 없음) */
async function requireHook(page, selector, itemLabel) {
  let n = 0;
  try {
    n = await page.locator(selector).count();
  } catch (e) {
    n = 0;
  }
  if (n === 0) {
    throw new Error(
      `${itemLabel}: 필수 훅 ${selector} 이(가) 페이지에 없습니다 — ` +
        'rev.5 DOM 계약 미구현 (fail-closed: 폴백 셀렉터 없음, 훅 부재 = FAIL)'
    );
  }
  return page.locator(selector).first();
}

/** "+ 새 포스트잇" 추가 버튼 클릭 (a02 승격) */
async function addNote(page) {
  try {
    await page.locator(POSTIT_SEL.ADD).first().click({ timeout: 5000 });
  } catch (e) {
    throw new Error('"+ 새 포스트잇" 추가 버튼([data-add-note])을 찾거나 클릭할 수 없습니다: ' + e.message);
  }
}

/** 노트 클릭 → 편집기([data-note-edit])에 텍스트 입력 → blur (a02 승격) */
async function setNoteText(page, noteLoc, text) {
  try {
    await noteLoc.click({ timeout: 5000 });
  } catch (e) {
    throw new Error('노트를 클릭할 수 없습니다 (겹침/가림 여부 확인): ' + e.message);
  }
  let editor = noteLoc.locator(POSTIT_SEL.EDIT).first();
  try {
    await editor.waitFor({ state: 'visible', timeout: 2000 });
  } catch (e) {
    editor = page.locator(POSTIT_SEL.EDIT).first();
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

/** 유효 opacity(조상 누적) > 0.05 를 포함한 visible 노트 수 (a02 승격) */
async function countVisibleNotes(page) {
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
  }, POSTIT_SEL.NOTE);
}

/** visible 노트 수가 want 가 될 때까지 폴링 (유효 opacity 포함, a02 승격) */
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
    { sel: POSTIT_SEL.NOTE, want },
    timeoutMs,
    `${label}: visible 노트 수가 ${want}개가 되지 않았습니다 (0×0·display:none·visibility:hidden·유효 opacity ≤ 0.05 는 비가시로 판정)`
  );
}

/** 각 노트의 표시 텍스트 목록 ([data-note-text] → textarea → textContent 순, a18 승격) */
async function readNoteTexts(page) {
  return page.evaluate((N) => {
    return Array.from(document.querySelectorAll(N)).map((el) => {
      const t = el.querySelector('[data-note-text]');
      const ta = el.querySelector('textarea');
      return (t && t.textContent) || (ta && ta.value) || el.textContent || '';
    });
  }, POSTIT_SEL.NOTE);
}

/** marker 를 포함하는 첫 노트의 인덱스 (없으면 -1, a18 승격) */
async function noteIndexByText(page, marker) {
  const texts = await readNoteTexts(page);
  return texts.findIndex((t) => t.includes(marker));
}

/** 텍스트가 visible 하게 표시된 노트 존재 여부 (exact=true 면 textContent 정확 일치) */
async function hasVisibleNoteText(page, text, exact) {
  return page.evaluate(
    ({ N, text, exact }) => {
      const effOpacity = (el) => {
        let o = 1;
        for (let c = el; c && c.nodeType === 1; c = c.parentElement) o *= parseFloat(getComputedStyle(c).opacity) || 0;
        return o;
      };
      const vis = (el) => {
        const r = el.getBoundingClientRect();
        const s = getComputedStyle(el);
        return r.width > 0 && r.height > 0 && s.display !== 'none' && s.visibility !== 'hidden' && effOpacity(el) > 0.05;
      };
      for (const note of document.querySelectorAll(N)) {
        if (!vis(note)) continue;
        const cands = [note, ...note.querySelectorAll('*')];
        for (const el of cands) {
          const t = el.textContent || '';
          if ((exact ? t === text : t.includes(text)) && vis(el)) return true;
        }
        const ta = note.querySelector('textarea');
        if (ta && vis(ta) && (exact ? ta.value === text : (ta.value || '').includes(text))) return true;
      }
      return false;
    },
    { N: POSTIT_SEL.NOTE, text, exact: !!exact }
  );
}

/** hasVisibleNoteText 폴링 래퍼 */
async function pollVisibleNoteText(page, text, timeoutMs, failMsg, exact) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await hasVisibleNoteText(page, text, exact)) return;
    if (Date.now() > deadline) throw new Error(failMsg);
    await sleep(100);
  }
}

/** idx 노트의 보드 기준 회전-미적용 top-left + 크기 (a04 승격) */
async function noteTopLeft(page, idx) {
  const arr = await page.evaluate(
    ({ B, N }) => {
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
          bw: b.width,
          bh: b.height,
        };
      });
    },
    { B: POSTIT_SEL.BOARD, N: POSTIT_SEL.NOTE }
  );
  const p = arr[idx];
  if (!p) throw new Error(`노트 ${idx + 1}번을 찾을 수 없습니다 (현재 노트 ${arr.length}개)`);
  return p;
}

/** idx 노트를 보드 기준 target 으로 드래그 — mouse.down → move(steps 12 ≥ 10) → up (a04 승격) */
async function dragNoteTo(page, idx, target) {
  const p0 = await noteTopLeft(page, idx);
  let gx;
  let gy;
  const handle = page.locator(POSTIT_SEL.NOTE).nth(idx).locator('[data-drag-handle]').first();
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
  await page.mouse.move(gx + dx, gy + dy, { steps: 12 });
  await page.mouse.up();
  await sleep(120);
  const after = await noteTopLeft(page, idx);
  return { p0, after };
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

/**
 * loc 에 cancelable contextmenu 를 디스패치 (설계서 §5 공통 유틸).
 * 반환 false = preventDefault 호출됨(기본 메뉴 대체). 네이티브 메뉴는 headless 관찰 불가.
 */
async function openContextMenuOn(page, loc) {
  const bb = await loc.boundingBox();
  if (!bb) throw new Error('컨텍스트 메뉴 대상 요소의 boundingBox 를 얻을 수 없습니다 (비가시 요소)');
  return loc.evaluate((el, pt) => {
    const ev = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: pt.x, clientY: pt.y });
    return el.dispatchEvent(ev); // false = preventDefault 호출됨
  }, { x: bb.x + bb.width / 2, y: bb.y + bb.height / 2 });
}

Object.assign(module.exports, {
  POSTIT_SEL,
  assertNoDialogs,
  requireHook,
  addNote,
  setNoteText,
  countVisibleNotes,
  pollVisibleNoteCount,
  readNoteTexts,
  noteIndexByText,
  hasVisibleNoteText,
  pollVisibleNoteText,
  noteTopLeft,
  dragNoteTo,
  parseRgb,
  rgbDist,
  openContextMenuOn,
});
