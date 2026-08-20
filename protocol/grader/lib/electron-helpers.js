'use strict';
/**
 * rev.6 공용 유틸 — Electron 셸 채점 (tests/a42~a50 공유, 신설 파일)
 *
 * 근거: protocol/SCORECARD.md rev.6 (A42~A50) + SCORECARD-rev6-draft.md 승인본.
 * 기존 lib/helpers.js 는 수정하지 않는다(재사용만) — Electron 전용 유틸은 이 파일에만 추가한다.
 *
 * 계약 요점:
 *  - 기동: Playwright `_electron.launch` (개발 트리 d:\custom_program\electron,
 *    electron devDependency 의 dist/electron.exe). 환경변수 PETIT_USERDATA 로
 *    userData 를 os.tmpdir() 하위 fresh 디렉터리로 격리한다 (main.js 의 계약 훅).
 *  - fail-closed: 셸(main.js·electron.exe) 부재 시 크래시·skip-pass 없이
 *    "electron 셸 미구축 (2단계 진행 중)" 한국어 FAIL.
 *  - 정돈된 환경변수: NODE_OPTIONS·ELECTRON_RUN_AS_NODE 는 제거하고 기동한다
 *    (SCORECARD B — 실행 환경 후킹 금지).
 *  - 창 획득: BrowserWindow 의 URL(file://…/calendar.html·postit.html)로 판별.
 *  - 감시: 각 창의 dialog(기록 후 dismiss)·pageerror·console error 수집 —
 *    helpers.assertNoDialogs 와 동일한 state 형태를 공유한다.
 *  - SHA·크기 유틸: A42(출시-소스 동일성)·A46(산출물 fs 직접 측정) 공용.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { _electron } = require('@playwright/test');
const { sleep } = require('./helpers');

const APP_ROOT = path.resolve(__dirname, '..', '..', '..'); // d:\custom_program
const ELECTRON_DIR = path.join(APP_ROOT, 'electron');
const ELECTRON_MAIN = path.join(ELECTRON_DIR, 'main.js');
const ELECTRON_EXE = path.join(ELECTRON_DIR, 'node_modules', 'electron', 'dist', 'electron.exe');
const ELECTRON_DIST_DIR = path.join(ELECTRON_DIR, 'dist');
const WIN_UNPACKED_DIR = path.join(ELECTRON_DIST_DIR, 'win-unpacked');

/** 셸 미구축 사유 (없으면 null) */
function shellMissingReason() {
  if (!fs.existsSync(ELECTRON_MAIN)) return 'electron/main.js 부재';
  if (!fs.existsSync(ELECTRON_EXE)) {
    return 'electron/node_modules/electron/dist/electron.exe 부재 (electron devDependency 미설치)';
  }
  return null;
}

/** fail-closed: 셸 부재 = 명확한 한국어 FAIL (크래시·skip-pass 금지) */
function requireElectronShell(itemLabel) {
  const reason = shellMissingReason();
  if (reason) {
    throw new Error(
      `${itemLabel}: electron 셸 미구축 (2단계 진행 중) — ${reason}. ` +
        '셸 완성 전까지 본 항목은 red 가 정상 문서화 상태입니다 (fail-closed).'
    );
  }
}

/** os.tmpdir() 하위 fresh userData 디렉터리 (protocol/grader/ 내부 금지 — A12 해시 오염 방지) */
function freshUserDataDir(prefix = 'grader-petit-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

/**
 * Electron 셸 기동 (PETIT_USERDATA 격리 + 감시 부착).
 * @returns {{ app, state:{dialogs:[],pageErrors:[],consoleErrors:[]}, userDataDir }}
 */
async function launchElectronShell(userDataDir, opts = {}) {
  requireElectronShell(opts.label || 'rev.6');
  const env = { ...process.env, PETIT_USERDATA: userDataDir, ...(opts.env || {}) };
  // 정돈된 환경변수 (B — 실행 환경 후킹 금지): 프리로드·런타임 변조 벡터 제거
  delete env.NODE_OPTIONS;
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await _electron.launch({
    executablePath: ELECTRON_EXE,
    args: [ELECTRON_DIR, ...(opts.args || [])],
    env,
    timeout: opts.timeout || 60000,
  });

  const state = { dialogs: [], pageErrors: [], consoleErrors: [] };
  const attach = (page) => {
    page.on('dialog', async (dialog) => {
      state.dialogs.push({ type: dialog.type(), message: dialog.message() });
      try {
        // 기본 dismiss·기록 — A9 계열 시나리오만 opts.autoAcceptDialogs 로 자동 수락 (rev.5 관례)
        if (opts.autoAcceptDialogs) await dialog.accept();
        else await dialog.dismiss();
      } catch (e) {
        /* 이미 처리됨 */
      }
    });
    page.on('pageerror', (err) => state.pageErrors.push(String((err && err.message) || err)));
    page.on('console', (msg) => {
      if (msg.type() === 'error') state.consoleErrors.push(msg.text());
    });
  };
  app.windows().forEach(attach);
  app.on('window', attach);

  return { app, state, userDataDir };
}

/**
 * URL 파일명으로 창 획득 ('calendar.html' | 'postit.html').
 * 시간 초과 시 현재 창 URL 목록을 포함한 한국어 FAIL.
 */
async function getAppWindow(shell, fileName, timeoutMs = 30000, itemLabel = 'rev.6') {
  const want = String(fileName).toLowerCase();
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const wins = shell.app.windows();
    for (const w of wins) {
      let u = '';
      try {
        u = (w.url() || '').toLowerCase();
      } catch (e) {
        u = '';
      }
      if (u.endsWith('/' + want) || u.endsWith('\\' + want)) {
        try {
          await w.waitForLoadState('domcontentloaded', { timeout: 10000 });
        } catch (e) {
          /* 이미 로드됨 */
        }
        return w;
      }
    }
    if (Date.now() > deadline) {
      const urls = shell.app.windows().map((w) => {
        try {
          return w.url();
        } catch (e) {
          return '(url 조회 불가)';
        }
      });
      throw new Error(
        `${itemLabel}: electron 셸 기동 후 ${timeoutMs}ms 내 ${fileName} 창을 찾지 못했습니다 ` +
          `(현재 창 ${urls.length}개: ${urls.join(', ') || '없음'}) — A42 창 2개 계약 미충족 (fail-closed)`
      );
    }
    await sleep(200);
  }
}

/** 셸 종료 — close 가 15초 내 안 끝나면 프로세스 강제 종료 (teardown 안정성) */
async function closeElectronShell(shell) {
  if (!shell || !shell.app) return;
  let timer = null;
  try {
    await Promise.race([
      shell.app.close(),
      new Promise((_, rej) => {
        timer = setTimeout(() => rej(new Error('close timeout')), 15000);
      }),
    ]);
  } catch (e) {
    try {
      const proc = shell.app.process();
      if (proc && !proc.killed) proc.kill();
    } catch (e2) {
      /* 이미 종료됨 */
    }
  } finally {
    if (timer) clearTimeout(timer);
  }
  await sleep(300); // userData 파일 잠금 해제 유예
}

/** helpers.js 관용구와 동일한 엄격 가시성(크기>0·display·visibility·유효 opacity>0.05) 카운트 */
async function countVisibleStrict(page, selector) {
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
  }, selector);
}

/** selector 의 엄격 가시성 여부가 want 가 될 때까지 폴링 */
async function pollVisibleStrict(page, selector, want, timeoutMs, failMsg) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const n = await countVisibleStrict(page, selector).catch(() => 0);
    if ((n > 0) === want) return n;
    if (Date.now() > deadline) throw new Error(failMsg);
    await sleep(120);
  }
}

/** rev.6 fail-closed 훅 검사 (helpers.requireHook 의 rev.6 문구판 — 폴백 셀렉터 없음) */
async function requireHook6(page, selector, itemLabel) {
  let n = 0;
  try {
    n = await page.locator(selector).count();
  } catch (e) {
    n = 0;
  }
  if (n === 0) {
    throw new Error(
      `${itemLabel}: 필수 훅 ${selector} 이(가) 페이지에 없습니다 — ` +
        'rev.6 DOM 계약 미구현 (fail-closed: 폴백 셀렉터 없음, 훅 부재 = FAIL)'
    );
  }
  return page.locator(selector).first();
}

/**
 * 온보딩 오버레이가 떠 있으면 건너뛰기([data-onboarding-skip])로 닫는다.
 * (A47 외 항목이 fresh Electron 프로필에서 온보딩에 가려지지 않기 위한 공용 처치.
 *  오버레이가 보이는데 skip 훅이 없으면 fail-closed FAIL — A47 계약 위반이기도 하다.)
 */
async function dismissOnboardingIfPresent(page, itemLabel) {
  const visible = (await countVisibleStrict(page, '[data-onboarding]').catch(() => 0)) > 0;
  if (!visible) return false;
  const skipVisible = (await countVisibleStrict(page, '[data-onboarding-skip]').catch(() => 0)) > 0;
  if (!skipVisible) {
    throw new Error(
      `${itemLabel}: 온보딩([data-onboarding])이 표시 중인데 건너뛰기 훅 [data-onboarding-skip] 이 ` +
        '보이지 않습니다 — A47 계약(항상 건너뛸 수 있어야 함) 미구현 (fail-closed)'
    );
  }
  await page.locator('[data-onboarding-skip]').first().click({ timeout: 5000 });
  await pollVisibleStrict(
    page,
    '[data-onboarding]',
    false,
    5000,
    `${itemLabel}: [data-onboarding-skip] 클릭 후 5초 내 온보딩이 닫히지 않았습니다`
  );
  return true;
}

/**
 * 이전(마이그레이션) 제안 UI([data-migrate], A43)가 떠 있으면 최선 노력으로 닫는다.
 * 닫기 후보(있는 것만): [data-migrate-later] · [data-migrate-close] · "나중에"/"닫기" 버튼 · Escape.
 * 그래도 화면을 덮고 있으면 한국어 FAIL (다른 항목 조작 불가 상태).
 */
async function dismissMigrateIfPresent(page, itemLabel) {
  const visible = (await countVisibleStrict(page, '[data-migrate]').catch(() => 0)) > 0;
  if (!visible) return false;
  const candidates = [
    '[data-migrate-later]',
    '[data-migrate-close]',
    '[data-migrate] button:has-text("나중에")',
    '[data-migrate] button:has-text("닫기")',
  ];
  for (const sel of candidates) {
    const loc = page.locator(sel).first();
    if ((await loc.count()) > 0 && (await loc.isVisible().catch(() => false))) {
      await loc.click({ timeout: 3000 }).catch(() => {});
      break;
    }
  }
  if ((await countVisibleStrict(page, '[data-migrate]').catch(() => 0)) > 0) {
    await page.keyboard.press('Escape').catch(() => {});
  }
  await sleep(300);
  if ((await countVisibleStrict(page, '[data-migrate]').catch(() => 0)) > 0) {
    throw new Error(
      `${itemLabel}: 이전 제안 UI([data-migrate])를 닫을 수 없어 다른 조작이 불가합니다 — ` +
        'A43 계약(거절/나중에 경로 필요) 확인 요망'
    );
  }
  return true;
}

/** 파일 SHA256 hex(소문자) — A42 출시-소스 동일성·A45 픽스처 등 공용 */
function sha256File(p) {
  return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
}

/** 디렉터리 재귀 파일 목록 (절대경로) — 심볼릭 링크는 따라가지 않는다 */
function listFilesRecursive(dir, out = []) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, ent.name);
    if (ent.isSymbolicLink()) continue;
    if (ent.isDirectory()) listFilesRecursive(abs, out);
    else if (ent.isFile()) out.push(abs);
  }
  return out;
}

/** 디렉터리 총 바이트 (fs 직접 측정 — 자기신고 스크립트 금지, A46) */
function dirSizeBytes(dir) {
  let total = 0;
  for (const f of listFilesRecursive(dir)) total += fs.statSync(f).size;
  return total;
}

/**
 * asar 아카이브의 내부 경로 목록 (외부 도구 없이 헤더 JSON 직접 파싱).
 * 형식: [0..3]=4, [4..7]=pickle 크기, [8..11]=pickle 내부 크기, [12..15]=헤더 문자열 길이,
 *       [16..]=헤더 JSON. 파싱 실패 시 한국어 오류 throw (블랙리스트 검증 불가 = fail-closed).
 */
function readAsarPaths(asarFile) {
  let fd = null;
  try {
    fd = fs.openSync(asarFile, 'r');
    const head = Buffer.alloc(16);
    fs.readSync(fd, head, 0, 16, 0);
    const strSize = head.readUInt32LE(12);
    if (!(strSize > 0 && strSize < 64 * 1024 * 1024)) throw new Error('헤더 크기 비정상: ' + strSize);
    const jsonBuf = Buffer.alloc(strSize);
    fs.readSync(fd, jsonBuf, 0, strSize, 16);
    const header = JSON.parse(jsonBuf.toString('utf8'));
    const out = [];
    const walk = (node, prefix) => {
      if (!node || typeof node !== 'object') return;
      const files = node.files;
      if (!files || typeof files !== 'object') return;
      for (const name of Object.keys(files)) {
        const child = files[name];
        const rel = prefix ? prefix + '/' + name : name;
        if (child && typeof child === 'object' && child.files) walk(child, rel);
        else out.push(rel);
      }
    };
    walk(header, '');
    return out;
  } catch (e) {
    throw new Error(
      `asar 헤더 파싱 실패 (${asarFile}): ${e.message} — 내부 파일 블랙리스트를 검증할 수 없어 FAIL 처리합니다 (fail-closed)`
    );
  } finally {
    if (fd !== null) fs.closeSync(fd);
  }
}

module.exports = {
  APP_ROOT,
  ELECTRON_DIR,
  ELECTRON_MAIN,
  ELECTRON_EXE,
  ELECTRON_DIST_DIR,
  WIN_UNPACKED_DIR,
  shellMissingReason,
  requireElectronShell,
  freshUserDataDir,
  launchElectronShell,
  getAppWindow,
  closeElectronShell,
  countVisibleStrict,
  pollVisibleStrict,
  requireHook6,
  dismissOnboardingIfPresent,
  dismissMigrateIfPresent,
  sha256File,
  listFilesRecursive,
  dirSizeBytes,
  readAsarPaths,
};

/* ════════════════════════════════════════════════════════════════════
 * rev.6 추가 공용 유틸 (a42~a44 슬라이스) — 추가 전용 (기존 수출·시그니처 무변경)
 *  - 창 조작(main 프로세스 관점)·A8 재현용 추가 창·A43 시딩(IDB/스냅샷)·
 *    캘린더/포스트잇 조작 유틸(a05/a06/a08 지역 구현의 Electron 공용 승격판)
 * ════════════════════════════════════════════════════════════════════ */
const { fileURLToPath } = require('url');
const { POSTIT_SEL } = require('./helpers');

/** 두 앱 창을 한 번에 획득 (URL 판별 — A42 창 2개 계약) */
async function getBothAppWindows(shell, itemLabel = 'rev.6') {
  const calPage = await getAppWindow(shell, 'calendar.html', 30000, itemLabel);
  const postitPage = await getAppWindow(shell, 'postit.html', 30000, itemLabel);
  return { calPage, postitPage };
}

/** file:// URL → 로컬 경로 (창이 실제 로드한 파일의 SHA 검증용, A42) */
function urlToLocalPath(urlStr) {
  return fileURLToPath(urlStr);
}

/** 임의 비동기 조건 폴링 (page 불요 버전) */
async function poll(asyncPred, timeoutMs, failMsg) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    let ok = false;
    try {
      ok = !!(await asyncPred());
    } catch (e) {
      ok = false;
    }
    if (ok) return;
    if (Date.now() > deadline) throw new Error(failMsg);
    await sleep(150);
  }
}

/** 부분 문자열 등장 횟수 (정확 1건/중복 0 판정용) */
function occurrences(str, sub) {
  if (!str || !sub) return 0;
  return String(str).split(sub).length - 1;
}

/** main 프로세스 관점의 전 창 정보 (제목·bounds·리사이즈/이동 가능·URL — A42) */
async function mainWindowsInfo(electronApp) {
  return electronApp.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows().map((w) => ({
      id: w.id,
      title: w.getTitle(),
      bounds: w.getBounds(),
      resizable: w.isResizable(),
      movable: w.isMovable(),
      visible: w.isVisible(),
      url: w.webContents.getURL(),
    }))
  );
}

/**
 * main 프로세스에서 추가 창을 열어 같은 HTML 을 로드 (A8 두 창 시나리오의 Electron 재현).
 * 같은 세션·같은 file:// 오리진이므로 localStorage 를 공유한다.
 */
async function openExtraWindow(electronApp, htmlAbsPath) {
  const [page] = await Promise.all([
    electronApp.waitForEvent('window', { timeout: 20000 }).catch(() => null),
    electronApp.evaluate(({ BrowserWindow }, file) => {
      const win = new BrowserWindow({
        width: 900,
        height: 700,
        webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
      });
      win.removeMenu();
      win.loadFile(file);
    }, htmlAbsPath),
  ]);
  if (!page) {
    throw new Error('추가 창(BrowserWindow) 생성 후 20초 내 Playwright 창 이벤트가 관찰되지 않았습니다');
  }
  await page.waitForLoadState('load').catch(() => {});
  return page;
}

/** cal-* / postit-* 접두 localStorage 스냅샷 (A43 항목별 비교용) */
async function lsPrefixSnapshot(page) {
  return page.evaluate(() => {
    const o = {};
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (/^(cal-|postit-)/.test(k)) o[k] = localStorage.getItem(k);
    }
    return o;
  });
}

/** IndexedDB put — DB/스토어가 없으면 생성(버전 상향), 있으면 그대로 사용 (A43 시딩) */
async function idbPutValue(page, dbName, storeName, key, value) {
  return page.evaluate(
    ({ dbName, storeName, key, value }) =>
      new Promise((resolve, reject) => {
        const open = (version) => {
          const rq = version ? indexedDB.open(dbName, version) : indexedDB.open(dbName);
          rq.onupgradeneeded = () => {
            const db = rq.result;
            if (!db.objectStoreNames.contains(storeName)) db.createObjectStore(storeName);
          };
          rq.onerror = () => reject(new Error('IDB open 실패: ' + (rq.error && rq.error.message)));
          rq.onsuccess = () => {
            const db = rq.result;
            if (!db.objectStoreNames.contains(storeName)) {
              const v = db.version + 1;
              db.close();
              open(v);
              return;
            }
            const tx = db.transaction(storeName, 'readwrite');
            tx.objectStore(storeName).put(value, key);
            tx.oncomplete = () => {
              db.close();
              resolve(true);
            };
            tx.onerror = () => {
              db.close();
              reject(new Error('IDB put 실패: ' + (tx.error && tx.error.message)));
            };
          };
        };
        open(null);
      }),
    { dbName, storeName, key, value }
  );
}

/** IndexedDB get — DB/스토어/키 부재 시 null (예외 없이, A43 검증) */
async function idbGetValue(page, dbName, storeName, key) {
  return page.evaluate(
    ({ dbName, storeName, key }) =>
      new Promise((resolve) => {
        let rq;
        try {
          rq = indexedDB.open(dbName);
        } catch (e) {
          resolve(null);
          return;
        }
        rq.onerror = () => resolve(null);
        rq.onsuccess = () => {
          const db = rq.result;
          if (!db.objectStoreNames.contains(storeName)) {
            db.close();
            resolve(null);
            return;
          }
          let getRq;
          try {
            getRq = db.transaction(storeName, 'readonly').objectStore(storeName).get(key);
          } catch (e) {
            db.close();
            resolve(null);
            return;
          }
          getRq.onerror = () => {
            db.close();
            resolve(null);
          };
          getRq.onsuccess = () => {
            const v = getRq.result;
            db.close();
            resolve(v === undefined ? null : v);
          };
        };
      }),
    { dbName, storeName, key }
  );
}

/** msedge 실행 파일 탐지 (a39 동형 — 픽스처 프로필 시딩용, Edge 미설치 시 SKIP 판단) */
function findEdgeExe() {
  const candidates = [
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    process.env.LOCALAPPDATA
      ? path.join(process.env.LOCALAPPDATA, 'Microsoft', 'Edge', 'Application', 'msedge.exe')
      : null,
  ];
  return candidates.find((p) => p && fs.existsSync(p)) || null;
}

/** 각 노트의 {text, bg(배경색)} 목록 (a05 지역 구현 동형) */
async function readNotesWithBg(page) {
  return page.evaluate((N) => {
    return Array.from(document.querySelectorAll(N)).map((el) => {
      const t = el.querySelector('[data-note-text]');
      const ta = el.querySelector('textarea');
      const text = (t && t.textContent) || (ta && ta.value) || el.textContent || '';
      return { text, bg: getComputedStyle(el).backgroundColor };
    });
  }, POSTIT_SEL.NOTE);
}

/** idx 노트를 활성화한 뒤 현재 색과 가장 먼 색 견본을 클릭 (a05 지역 구현 동형) */
async function applyAnyColor(page, idx) {
  const parseRgbLocal = (s) => {
    const m = /rgba?\(([^)]+)\)/.exec(s || '');
    if (!m) return null;
    const p = m[1].split(',').map((x) => parseFloat(x));
    return { r: p[0], g: p[1], b: p[2] };
  };
  try {
    await page.locator(POSTIT_SEL.NOTE).nth(idx).click({ timeout: 5000 });
  } catch (e) {
    throw new Error('노트를 클릭(활성)할 수 없습니다: ' + e.message);
  }
  await sleep(120);
  const swatches = await page.evaluate(
    ({ N, S, idx }) => {
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
    },
    { N: POSTIT_SEL.NOTE, S: POSTIT_SEL.SWATCH, idx }
  );
  if (!swatches.length) {
    throw new Error('색상 견본([data-color])을 찾을 수 없습니다 — 노트 클릭(활성) 상태에서 팔레트가 보여야 합니다');
  }
  const cur = parseRgbLocal((await readNotesWithBg(page))[idx].bg) || { r: -999, g: -999, b: -999 };
  let best = swatches[0];
  let bestD = -1;
  for (const s of swatches) {
    const c = parseRgbLocal(s.bg);
    if (!c) continue;
    const d = Math.hypot(c.r - cur.r, c.g - cur.g, c.b - cur.b);
    if (d > bestD) {
      bestD = d;
      best = s;
    }
  }
  await page.mouse.click(best.x, best.y);
  await sleep(150);
}

/** 캘린더: 현재 표시 달의 날짜 셀 (a06/a08 지역 구현 동형) */
function calDayCell(page, day) {
  return page.locator('#grid .cell:not(.other)', {
    has: page.locator(`.num:text-is("${day}")`),
  });
}

/** 캘린더: 현재 표시 달 기준 YYYY-MM-DD 키 (#monthTitle "YYYY년 M월" 파싱) */
function calViewedMonthKey(page, day) {
  return page.evaluate((d) => {
    const m = document.getElementById('monthTitle').textContent.match(/(\d+)년\s*(\d+)월/);
    const pad = (n) => String(n).padStart(2, '0');
    return m[1] + '-' + pad(Number(m[2])) + '-' + pad(d);
  }, day);
}

/** 캘린더: 페이지 내 DOM 입력요소로 일정 추가 */
async function calAddViaForm(page, time, text) {
  if (time) await page.fill('#addTime', time);
  await page.fill('#addText', text);
  await page.click('#addBtn');
}

/** cal-events raw 에서 해당 텍스트 일정 총 개수 (해석 불가 시 -1, a08-cal 동형) */
function countCalText(raw, text) {
  try {
    const o = JSON.parse(raw);
    if (!o || typeof o !== 'object' || Array.isArray(o)) return -1;
    let n = 0;
    for (const k of Object.keys(o)) {
      if (Array.isArray(o[k])) n += o[k].filter((e) => e && e.text === text).length;
    }
    return n;
  } catch (e) {
    return -1;
  }
}

Object.assign(module.exports, {
  getBothAppWindows,
  urlToLocalPath,
  poll,
  occurrences,
  mainWindowsInfo,
  openExtraWindow,
  lsPrefixSnapshot,
  idbPutValue,
  idbGetValue,
  findEdgeExe,
  readNotesWithBg,
  applyAnyColor,
  calDayCell,
  calViewedMonthKey,
  calAddViaForm,
  countCalText,
});

/* ════════════════════════════════════════════════════════════════════
 * rev.6 추가 공용 유틸 (a48~a50 슬라이스) — 추가 전용 (기존 수출·시그니처 무변경)
 *  감사 복원 노트(2026-08-19): a48~a50 스펙이 import 하는 본 블록 수출들이 병행 병합에서
 *  유실되어 있었다(스펙은 존재하나 헬퍼 부재 → TypeError 크래시). fail-closed 원칙(크래시
 *  금지·한국어 FAIL)에 따라 계약 주석(각 스펙 상단 REQUIRED CONTRACT)이 요구하는 이름
 *  그대로 복원한다. 기존 스펙·헬퍼는 약화하지 않는다.
 *  - 정적 검사: stripJsComments 는 lib/static-checks 토크나이저(noComments)를 재사용.
 *  - PNG: 자체 디코더 (grader 에 pngjs 없음) — IHDR 치수 + 고유색 수(비인터레이스,
 *    colorType 0/2/3/4/6, bitDepth 8/16 + 팔레트 1/2/4/8). 미지원 형식은 한국어 오류
 *    throw (fail-closed — 호출측이 FAIL 로 목록화).
 *  - zip: System32 절대 경로 PowerShell + .NET System.IO.Compression (PATH 섀도잉 차단).
 * ════════════════════════════════════════════════════════════════════ */
const zlib = require('zlib');
const { execFileSync } = require('child_process');
const { tokenize } = require('./static-checks');
const { removeDirWithRetry } = require('./helpers');

const ELECTRON_MAIN_JS = ELECTRON_MAIN; // 별칭 (a48/a49 계약 명)
const ELECTRON_PRELOAD_JS = path.join(ELECTRON_DIR, 'preload.js');
const ELECTRON_BUILDER_YML = path.join(ELECTRON_DIR, 'electron-builder.yml');
const ELECTRON_PKG_JSON = path.join(ELECTRON_DIR, 'package.json');
const APPX_ICON_DIR = path.join(ELECTRON_DIR, 'build', 'appx');
const DIST_DIR = ELECTRON_DIST_DIR; // 별칭 (a48/a50 계약 명)
const SHELL_MISSING_MSG = 'electron 셸 미구축 (2단계 진행 중)';
const BRAND_RE = /쁘띠캘린더|PetitCalendar/i;
/** MyApp 류 플레이스홀더 리터럴 (A48② — 설정 값 필드에만 적용) */
const PLACEHOLDER_RE =
  /(my[-_ ]?app|your[-_ ]?(?:app|name|company)|example|placeholder|change[-_ ]?me|app[-_ ]?name[-_ ]?here|electron[-_ ]?quick[-_ ]?start|hello[-_ ]?world|untitled|acme|sample[-_ ]?app|test[-_ ]?app|todo[-_ ]?app|company[-_ ]?name)/i;

const PS_EXE_ABS = path.join(
  process.env.SystemRoot || 'C:\\Windows',
  'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'
);

/** PowerShell 싱글쿼트 이스케이프 */
function psq(s) {
  return String(s).replace(/'/g, "''");
}

/** System32 절대 경로 PowerShell 실행 → stdout (B 실행 환경 후킹 금지 관용구) */
function runPowerShell(script, timeoutMs = 60000) {
  return execFileSync(
    PS_EXE_ABS,
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
    { encoding: 'utf8', timeout: timeoutMs, windowsHide: true, maxBuffer: 64 * 1024 * 1024 }
  );
}

/** JS 소스 주석 제거(길이 보존, 문자열 원문 유지) — static-checks 토크나이저 재사용 */
function stripJsComments(src) {
  return tokenize(src).noComments;
}

/** 디렉터리 재귀 파일 목록 — dir 기준 상대경로(슬래시 정규화) */
function listFilesRel(dir) {
  return listFilesRecursive(dir).map((abs) => path.relative(dir, abs).replace(/\\/g, '/'));
}

/* ── PNG (자체 파서 — pngjs 부재) ─────────────────────────────────── */

function pngChunks(buf, label) {
  const SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (buf.length < 8 || !buf.slice(0, 8).equals(SIG)) {
    throw new Error('PNG 시그니처가 아닙니다: ' + label);
  }
  const chunks = [];
  let off = 8;
  while (off + 8 <= buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    if (off + 8 + len > buf.length) throw new Error('PNG 청크(' + type + ') 길이가 파일 밖을 가리킵니다: ' + label);
    chunks.push({ type, data: buf.slice(off + 8, off + 8 + len) });
    off += 12 + len;
    if (type === 'IEND') break;
  }
  return chunks;
}

/** PNG IHDR 치수 {width,height} — 실패 시 한국어 오류 throw */
function pngSize(p) {
  const chunks = pngChunks(fs.readFileSync(p), p);
  const ihdr = chunks.find((c) => c.type === 'IHDR');
  if (!ihdr || ihdr.data.length < 13) throw new Error('IHDR 청크가 없습니다: ' + p);
  return { width: ihdr.data.readUInt32BE(0), height: ihdr.data.readUInt32BE(4) };
}

/**
 * PNG 고유색(RGBA) 수 — cap 도달 시 조기 반환 (플레이스홀더 아이콘 차단용 하한 판정, A48①).
 * 지원: 비인터레이스, colorType 0/2/4/6(bitDepth 8/16) · 3(팔레트, bitDepth 1/2/4/8).
 * 미지원 형식·손상 파일은 한국어 오류 throw (fail-closed).
 */
function countPngUniqueColors(p, cap = 4096) {
  const chunks = pngChunks(fs.readFileSync(p), p);
  const ihdr = chunks.find((c) => c.type === 'IHDR');
  if (!ihdr || ihdr.data.length < 13) throw new Error('IHDR 청크가 없습니다: ' + p);
  const width = ihdr.data.readUInt32BE(0);
  const height = ihdr.data.readUInt32BE(4);
  const bitDepth = ihdr.data[8];
  const colorType = ihdr.data[9];
  const interlace = ihdr.data[12];
  if (interlace !== 0) {
    throw new Error('인터레이스(Adam7) PNG 는 고유색 검사 미지원 — 비인터레이스로 저장하세요: ' + p);
  }
  const channelsMap = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };
  const channels = channelsMap[colorType];
  if (channels === undefined) throw new Error('알 수 없는 PNG colorType ' + colorType + ': ' + p);
  if (colorType === 3) {
    if (![1, 2, 4, 8].includes(bitDepth)) throw new Error('팔레트 PNG bitDepth ' + bitDepth + ' 미지원: ' + p);
  } else if (![8, 16].includes(bitDepth)) {
    throw new Error('PNG bitDepth ' + bitDepth + ' 미지원 (8/16 만): ' + p);
  }
  const idat = Buffer.concat(chunks.filter((c) => c.type === 'IDAT').map((c) => c.data));
  if (!idat.length) throw new Error('IDAT 청크가 없습니다: ' + p);
  const raw = zlib.inflateSync(idat);
  const bitsPerPixel = channels * bitDepth;
  const bytesPerLine = Math.ceil((width * bitsPerPixel) / 8);
  const bpp = Math.max(1, Math.ceil(bitsPerPixel / 8));
  if (raw.length < height * (bytesPerLine + 1)) throw new Error('PNG 압축 해제 데이터가 짧습니다: ' + p);
  const out = Buffer.alloc(height * bytesPerLine);
  let pos = 0;
  for (let y = 0; y < height; y++) {
    const ft = raw[pos];
    pos += 1;
    const rowStart = y * bytesPerLine;
    for (let x = 0; x < bytesPerLine; x++) {
      const rb = raw[pos + x];
      const left = x >= bpp ? out[rowStart + x - bpp] : 0;
      const up = y > 0 ? out[rowStart - bytesPerLine + x] : 0;
      const ul = y > 0 && x >= bpp ? out[rowStart - bytesPerLine + x - bpp] : 0;
      let v;
      if (ft === 0) v = rb;
      else if (ft === 1) v = rb + left;
      else if (ft === 2) v = rb + up;
      else if (ft === 3) v = rb + ((left + up) >> 1);
      else if (ft === 4) {
        const pa = Math.abs(up - ul);
        const pb = Math.abs(left - ul);
        const pc = Math.abs(left + up - 2 * ul);
        v = rb + (pa <= pb && pa <= pc ? left : pb <= pc ? up : ul);
      } else throw new Error('알 수 없는 PNG 필터 타입 ' + ft + ' (y=' + y + '): ' + p);
      out[rowStart + x] = v & 0xff;
    }
    pos += bytesPerLine;
  }
  const plteChunk = chunks.find((c) => c.type === 'PLTE');
  const plte = plteChunk ? plteChunk.data : null;
  const trnsChunk = chunks.find((c) => c.type === 'tRNS');
  const trns = trnsChunk ? trnsChunk.data : null;
  const colors = new Set();
  const bps = bitDepth === 16 ? 2 : 1;
  for (let y = 0; y < height && colors.size < cap; y++) {
    const rowStart = y * bytesPerLine;
    for (let x = 0; x < width; x++) {
      let r;
      let g;
      let b;
      let a = 255;
      if (colorType === 3) {
        let pi;
        if (bitDepth === 8) pi = out[rowStart + x];
        else {
          const bitPos = x * bitDepth;
          pi = (out[rowStart + (bitPos >> 3)] >> (8 - bitDepth - (bitPos & 7))) & ((1 << bitDepth) - 1);
        }
        if (!plte || pi * 3 + 2 >= plte.length) throw new Error('PLTE 범위 밖 팔레트 인덱스 ' + pi + ': ' + p);
        r = plte[pi * 3];
        g = plte[pi * 3 + 1];
        b = plte[pi * 3 + 2];
        a = trns && pi < trns.length ? trns[pi] : 255;
      } else {
        const px = rowStart + x * channels * bps;
        const s = (i) => out[px + i * bps];
        if (colorType === 0) r = g = b = s(0);
        else if (colorType === 2) {
          r = s(0);
          g = s(1);
          b = s(2);
        } else if (colorType === 4) {
          r = g = b = s(0);
          a = s(1);
        } else {
          r = s(0);
          g = s(1);
          b = s(2);
          a = s(3);
        }
      }
      colors.add(r * 16777216 + g * 65536 + b * 256 + a);
      if (colors.size >= cap) break;
    }
  }
  return colors.size;
}

/* ── zip (.appx/.msix/.nupkg 포함 — 전부 zip 컨테이너) ────────────── */

/** zip 엔트리 전체 이름 목록 */
function zipEntryList(zipPath) {
  let out = '';
  try {
    out = runPowerShell(
      '[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; ' +
        'Add-Type -AssemblyName System.IO.Compression.FileSystem | Out-Null; ' +
        "$z=[System.IO.Compression.ZipFile]::OpenRead('" + psq(zipPath) + "'); " +
        'try { $z.Entries | ForEach-Object { $_.FullName } } finally { $z.Dispose() }',
      180000
    );
  } catch (e) {
    throw new Error('zip 엔트리 목록 조회 실패 (' + zipPath + ') — 검증 불능 = FAIL (fail-closed): ' + e.message);
  }
  return String(out)
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .map((s) => s.replace(/\r$/, ''))
    .filter((s) => s.length > 0);
}

/** zip 안 단일 엔트리의 텍스트 (대소문자 무시 일치, 부재/빈 내용 시 null) */
function zipEntryText(zipPath, entryName) {
  let out = '';
  try {
    out = runPowerShell(
      '[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; ' +
        'Add-Type -AssemblyName System.IO.Compression.FileSystem | Out-Null; ' +
        "$z=[System.IO.Compression.ZipFile]::OpenRead('" + psq(zipPath) + "'); " +
        "try { $e = $z.Entries | Where-Object { $_.FullName -ieq '" + psq(entryName) + "' } | Select-Object -First 1; " +
        'if ($null -ne $e) { $sr = New-Object System.IO.StreamReader($e.Open()); ' +
        'try { $sr.ReadToEnd() } finally { $sr.Dispose() } } } finally { $z.Dispose() }',
      180000
    );
  } catch (e) {
    throw new Error('zip 엔트리 추출 실패 (' + zipPath + ' → ' + entryName + ') — 검증 불능 = FAIL (fail-closed): ' + e.message);
  }
  const text = String(out).replace(/^\uFEFF/, '');
  return text.trim() ? text : null;
}

/* ── ASSETS.md (a10 동형 파서 + rev.6 상업 배포 판정) ─────────────── */

/** ASSETS.md 마크다운 표 파싱 → [{file, url, license, line}] (a10 동형) */
function parseAssetsTable(mdText) {
  const rows = [];
  const lines = mdText.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line.startsWith('|')) continue;
    const cells = line
      .replace(/^\|/, '')
      .replace(/\|$/, '')
      .split('|')
      .map((c) => c.replace(/`/g, '').replace(/\*\*/g, '').trim());
    if (cells.length < 3) continue;
    if (/^:?-{2,}:?$/.test(cells[0])) continue;
    if (/파일|^file/i.test(cells[0]) && /라이선스|license/i.test(cells[2])) continue;
    rows.push({
      file: cells[0].replace(/\\/g, '/').replace(/^\.?\/*/, '').replace(/^assets\//i, ''),
      url: cells[1],
      license: cells[2],
      line: i + 1,
    });
  }
  return rows;
}

/**
 * 상업 배포 허용 판정 (A48⑤ — rev.6 문언: "상업 배포 허용 명시" 자료만).
 * 허용 식별자: CC0 · Public Domain · OFL/SIL Open Font License · MIT · CC BY(무조건부).
 * NC/ND/불명은 사유 문자열 반환(FAIL), 허용이면 null.
 */
function commercialLicenseProblem(license) {
  const s = String(license == null ? '' : license).trim();
  if (!s || /불명|미상|\bunknown\b/i.test(s)) {
    return '라이선스 "' + (s || '(빈 값)') + '" — 불명/미기재 (상업 배포 허용 명시 필요, A48⑤)';
  }
  if (/\bNC\b|non[-\s]?commercial|비영리/i.test(s)) {
    return '라이선스 "' + s + '" — NC(비상업) 조건은 상업 배포 불가 (A48⑤)';
  }
  if (/\bND\b|no[-\s]?derivat|변경\s*금지/i.test(s)) {
    return '라이선스 "' + s + '" — ND(변경 금지) 조건은 상업 배포판 불가 (A48⑤)';
  }
  const ALLOW = [
    /\bCC0\b/i,
    /public\s*domain|퍼블릭\s*도메인/i,
    /\bOFL\b|SIL\s+Open\s+Font\s+License/i,
    /\bMIT\b/,
    /\bCC[\s-]?BY(?:[\s-]?\d(?:\.\d)?)?\b(?![\s-]?(?:SA|NC|ND))/i,
  ];
  if (ALLOW.some((re) => re.test(s))) return null;
  return '라이선스 "' + s + '" — 상업 배포 허용 식별자(CC0·Public Domain·OFL·MIT·CC BY)에 매치하지 않습니다 (A48⑤)';
}

/* ── 셸 기동 편의 래퍼 (a48⑤·a49① 공용) ──────────────────────────── */

/** electron.exe 경로 (부재 시 null — 호출측 분기용) */
function electronExecutable() {
  return fs.existsSync(ELECTRON_EXE) ? ELECTRON_EXE : null;
}

/**
 * 창 대기·분류: BrowserWindow 가 minCount 개가 될 때까지 폴링, calendar/postit 을 URL 로 분류.
 * 창 수 미달 시 한국어 오류 throw. 창 수 충족·분류 미완 시 시한에서 {calendar,postit} 이
 * null 인 채 반환 (호출측 단언이 명확한 메시지로 FAIL).
 */
async function waitForAppWindows(app, minCount = 2, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const wins = app.windows();
    if (wins.length >= minCount) {
      const byName = (n) => {
        return (
          wins.find((w) => {
            try {
              const u = (w.url() || '').toLowerCase();
              return u.endsWith('/' + n) || u.endsWith('\\' + n);
            } catch (e) {
              return false;
            }
          }) || null
        );
      };
      const calendar = byName('calendar.html');
      const postit = byName('postit.html');
      if (calendar && postit) {
        for (const w of [calendar, postit]) {
          try {
            await w.waitForLoadState('domcontentloaded', { timeout: 10000 });
          } catch (e) {
            /* 이미 로드됨 */
          }
        }
        return { all: wins, calendar, postit };
      }
      if (Date.now() > deadline) return { all: wins, calendar, postit };
    }
    if (Date.now() > deadline) {
      const urls = app.windows().map((w) => {
        try {
          return w.url();
        } catch (e) {
          return '(url 조회 불가)';
        }
      });
      throw new Error(
        'electron 셸 기동 후 ' + timeoutMs + 'ms 내 창 ' + minCount + '개가 생성되지 않았습니다 ' +
          '(현재 ' + urls.length + '개: ' + (urls.join(', ') || '없음') + ') — A42 창 계약 미충족 (fail-closed)'
      );
    }
    await sleep(200);
  }
}

/** fresh userData 로 셸 기동 → fn({app,state,userDataDir}) → 종료·정리 보장 */
async function withShell(fn, opts = {}) {
  requireElectronShell(opts.label || 'rev.6');
  const dir = freshUserDataDir('grader-shell-');
  let shell = null;
  try {
    shell = await launchElectronShell(dir, opts);
    return await fn({ app: shell.app, state: shell.state, userDataDir: dir });
  } finally {
    await closeElectronShell(shell);
    await removeDirWithRetry(dir);
  }
}

Object.assign(module.exports, {
  ELECTRON_MAIN_JS,
  ELECTRON_PRELOAD_JS,
  ELECTRON_BUILDER_YML,
  ELECTRON_PKG_JSON,
  APPX_ICON_DIR,
  DIST_DIR,
  SHELL_MISSING_MSG,
  BRAND_RE,
  PLACEHOLDER_RE,
  psq,
  runPowerShell,
  stripJsComments,
  listFilesRel,
  pngSize,
  countPngUniqueColors,
  zipEntryList,
  zipEntryText,
  parseAssetsTable,
  commercialLicenseProblem,
  electronExecutable,
  waitForAppWindows,
  withShell,
});

/* ════════════════════════════════════════════════════════════════════
 * rev.7 추가 공용 유틸 (A42 병합 1창 탭 모드) — 추가 전용 (기존 수출·시그니처 무변경)
 *
 * 실측 기록 (2026-08-20, Electron 41.7.1 + @playwright/test 1.49, Windows 10 — 별도
 * 실험 앱으로 WebContentsView 노출 방식을 실증한 결과. 본 유틸들은 이 실측에 근거한다):
 *  - WebContentsView 가 로드한 페이지는 electronApp.windows() 에 Page 로 노출된다
 *    (electronApp.context().pages() 와 동일 목록, 신규 페이지엔 'window' 이벤트 발화 —
 *    launchElectronShell 의 dialog/pageerror 감시 부착이 뷰 페이지에도 그대로 적용됨).
 *  - BrowserWindow.getAllWindows() 는 뷰를 세지 않는다 (병합 셸 = 정확히 1).
 *  - 뷰 트리는 win.contentView 재귀(children)로 걷고, View.getVisible()/getBounds() 로
 *    활성 탭을 판정할 수 있다. 숨긴 뷰(setVisible(false))의 DOM 은 페이지 내부 관점에선
 *    여전히 '보임'(visibilityState=visible, rect>0)이라 DOM 단독으로는 활성 판정 불가 —
 *    활성 판정은 반드시 main 프로세스 뷰 정보로 한다.
 *  - 숨긴 뷰 페이지에도 evaluate·클릭이 동작하고, window 전역 마커는 setVisible 토글에
 *    잔존하며 reload() 시 소거된다 (→ 마커 잔존 = 무리로드 증명으로 유효).
 *  - 병합 창 자체(호스트) webContents 가 아무 문서도 로드하지 않으면 _electron.launch 가
 *    타임아웃한다 — 셸은 호스트 webContents 에 최소 문서를 로드해야 한다.
 * ════════════════════════════════════════════════════════════════════ */

const ELECTRON_TABBAR_HTML = path.join(ELECTRON_DIR, 'tabbar.html');
const ELECTRON_TABBAR_PRELOAD = path.join(ELECTRON_DIR, 'tabbar-preload.js');

/** URL 경로의 쿼리·해시 제거 + 소문자 정규화 (파일명 판별 공용) */
function cleanUrl(u) {
  return String(u || '').split(/[?#]/)[0].toLowerCase();
}

/**
 * URL 정규식으로 페이지 획득 — BrowserWindow 페이지와 WebContentsView 페이지 모두
 * app.windows() 에서 찾는다 (실측 근거 위 참조). 폴링 포함, 시간 초과 시 현재 페이지
 * URL 목록을 담은 한국어 FAIL.
 */
async function pageByUrl(app, re, timeoutMs = 30000, itemLabel = 'rev.7') {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    for (const w of app.windows()) {
      let u = '';
      try {
        u = cleanUrl(w.url());
      } catch (e) {
        u = '';
      }
      if (u && re.test(u)) {
        try {
          await w.waitForLoadState('domcontentloaded', { timeout: 10000 });
        } catch (e) {
          /* 이미 로드됨 */
        }
        return w;
      }
    }
    if (Date.now() > deadline) {
      const urls = app.windows().map((w) => {
        try {
          return w.url();
        } catch (e) {
          return '(url 조회 불가)';
        }
      });
      throw new Error(
        `${itemLabel}: ${timeoutMs}ms 내 ${re} 에 일치하는 페이지를 찾지 못했습니다 ` +
          `(현재 페이지 ${urls.length}개: ${urls.join(', ') || '없음'}) — rev.7 병합 셸 계약 미충족 (fail-closed)`
      );
    }
    await sleep(200);
  }
}

/** main 프로세스 관점 BrowserWindow 개수 (뷰는 세지 않는다 — 실측) */
async function browserWindowCount(app) {
  return app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length);
}

/** BrowserWindow 개수가 want 가 될 때까지 폴링 — 실패 메시지에 현재 개수 포함 */
async function pollBrowserWindowCount(app, want, timeoutMs, failMsgBase) {
  const deadline = Date.now() + timeoutMs;
  let n = -1;
  for (;;) {
    try {
      n = await browserWindowCount(app);
    } catch (e) {
      n = -1;
    }
    if (n === want) return;
    if (Date.now() > deadline) {
      throw new Error(`${failMsgBase} (기대 BrowserWindow ${want}개, 현재 ${n}개)`);
    }
    await sleep(150);
  }
}

/**
 * 전 BrowserWindow 의 contentView 트리를 **부착 순서 그대로**(in-order 재귀) 걸어
 * webContents 를 가진 뷰 정보를 수집한다: [{winId, url, visible, bounds}].
 * 창 자체(호스트) webContents 는 contentView 트리에 나타나지 않는다 (실측) — 뷰만 반환.
 * 순서 보존이 중요하다: Electron 의 View.addChildView 는 재호출 시 해당 뷰를 형제 목록
 * 맨 뒤(= z순서 맨 위)로 옮기므로, 같은 창에서 나중에 나오는 뷰가 위에 그려진다
 * (셸의 탭 전환 = addChildView 재호출에 의한 z순서 재배치 — judgeActiveAppView 가 사용).
 */
async function shellViewsInfo(app) {
  return app.evaluate(({ BrowserWindow }) => {
    const out = [];
    for (const w of BrowserWindow.getAllWindows()) {
      const walk = (v) => {
        if (!v) return;
        if (v.webContents) {
          let url = '';
          let visible = null;
          let bounds = null;
          try {
            url = v.webContents.getURL();
          } catch (e) {
            url = '';
          }
          try {
            visible = typeof v.getVisible === 'function' ? v.getVisible() : null;
          } catch (e) {
            visible = null;
          }
          try {
            bounds = v.getBounds();
          } catch (e) {
            bounds = null;
          }
          out.push({ winId: w.id, url, visible, bounds });
        }
        let kids = [];
        try {
          kids = v.children || [];
        } catch (e) {
          kids = [];
        }
        for (const k of kids) walk(k);
      };
      walk(w.contentView);
    }
    return out;
  });
}

/**
 * 병합 모드 활성 앱 뷰 판정 (rev.7 A42 활성 판정 계약 — main 프로세스 뷰 관찰, 실측 근거).
 * 표시 = visible !== false 이고 bounds 폭·높이 > 0.
 *  ① 표시 중인 앱 뷰가 정확히 1개 → 그 앱이 활성 (숨김 방식: setVisible(false)·0 bounds).
 *  ② 표시 중인 앱 뷰가 2개라도 같은 창에서 bounds 가 실질 동일하게 겹치면(교차 면적 ≥
 *     작은 쪽의 80%) 스택 구성이다 — 부착 순서 맨 뒤(= z순서 맨 위, addChildView 재호출
 *     의미론)가 사용자에게 보이는 활성 뷰다 (아래 뷰는 완전히 가려짐 = "활성만 표시" 충족).
 *  그 외(서로 다른 영역에 동시 표시 등)는 active:null + 한국어 사유(problem) 반환.
 * views 는 shellViewsInfo 의 반환값(부착 순서 보존)이어야 한다.
 */
function judgeActiveAppView(views) {
  const nameOf = (u) => {
    const c = cleanUrl(u);
    if (c.endsWith('/calendar.html') || c.endsWith('\\calendar.html')) return 'calendar';
    if (c.endsWith('/postit.html') || c.endsWith('\\postit.html')) return 'postit';
    return null;
  };
  const apps = (views || []).map((v) => ({ v, app: nameOf(v.url) })).filter((x) => x.app);
  if (apps.length === 0) {
    return {
      active: null,
      problem: '앱 뷰(calendar.html·postit.html)가 뷰 트리에 없습니다 — 병합 탭 모드 미구현 (rev.7 진행 중)',
    };
  }
  const displayed = apps.filter(
    (x) => x.v.visible !== false && x.v.bounds && x.v.bounds.width > 0 && x.v.bounds.height > 0
  );
  const names = Array.from(new Set(displayed.map((x) => x.app)));
  if (names.length === 1) return { active: names[0], problem: null };
  if (names.length === 0) return { active: null, problem: '표시 중인 앱 뷰가 없습니다 (전부 숨김 또는 0 크기 bounds)' };

  // ② 동일 창 + 실질 동일 bounds 스택 → z순서 맨 위(배열 맨 뒤)가 활성
  const sameWin = displayed.every((x) => x.v.winId === displayed[0].v.winId);
  const overlapEnough = (a, b) => {
    const ix = Math.max(a.x, b.x);
    const iy = Math.max(a.y, b.y);
    const iw = Math.min(a.x + a.width, b.x + b.width) - ix;
    const ih = Math.min(a.y + a.height, b.y + b.height) - iy;
    const inter = Math.max(0, iw) * Math.max(0, ih);
    const minArea = Math.min(a.width * a.height, b.width * b.height);
    return minArea > 0 && inter >= 0.8 * minArea;
  };
  const allOverlap = displayed.every((x, i) =>
    displayed.every((y, j) => i === j || overlapEnough(x.v.bounds, y.v.bounds))
  );
  if (sameWin && allOverlap) {
    return { active: displayed[displayed.length - 1].app, problem: null };
  }
  return {
    active: null,
    problem:
      '앱 뷰 2개가 서로 다른 영역에 동시 표시 상태입니다 — 비활성 뷰는 setVisible(false)·0 크기 ' +
      'bounds 로 숨기거나, 동일 bounds 스택(z순서 맨 위 = 활성)이어야 판정 가능합니다 (rev.7 활성 판정 계약)',
  };
}

/**
 * 해당 앱 HTML 을 (창 자체 webContents 또는 하위 뷰로) 호스팅하는 BrowserWindow id.
 * 분리 모드가 뷰 재부착이든 직접 loadFile 이든 모두 커버한다. 없으면 null.
 */
async function windowIdForApp(app, fileName) {
  return app.evaluate(({ BrowserWindow }, want) => {
    const matches = (u) => {
      const c = String(u || '').split(/[?#]/)[0].toLowerCase();
      return c.endsWith('/' + want) || c.endsWith('\\' + want);
    };
    for (const w of BrowserWindow.getAllWindows()) {
      try {
        if (matches(w.webContents.getURL())) return w.id;
      } catch (e) {
        /* 파괴된 창 — 무시 */
      }
      const stack = [w.contentView];
      while (stack.length) {
        const v = stack.pop();
        if (!v) continue;
        try {
          if (v.webContents && matches(v.webContents.getURL())) return w.id;
        } catch (e) {
          /* 무시 */
        }
        try {
          for (const k of v.children || []) stack.push(k);
        } catch (e) {
          /* 무시 */
        }
      }
    }
    return null;
  }, String(fileName).toLowerCase());
}

/** id 로 BrowserWindow close() — 창을 찾았으면 true (독립 종료 검증용) */
async function closeWindowById(app, id) {
  return app.evaluate(({ BrowserWindow }, wantId) => {
    const w = BrowserWindow.getAllWindows().find((x) => x.id === wantId);
    if (w) w.close();
    return !!w;
  }, id);
}

/**
 * launchElectronShell 의 한국어 래퍼 — 기동 실패·타임아웃을 rev.7 진단 힌트가 담긴
 * 한국어 메시지로 변환한다 (셸 미구축의 기존 한국어 메시지는 그대로 통과).
 */
async function launchShellChecked(userDataDir, opts = {}) {
  try {
    return await launchElectronShell(userDataDir, opts);
  } catch (e) {
    const msg = String((e && e.message) || e);
    if (msg.includes('셸 미구축')) throw e;
    throw new Error(
      `${opts.label || 'rev.7'}: electron 셸 기동 실패 — ${msg} ` +
        '(참고: 병합 창의 호스트 webContents 가 아무 문서도 로드하지 않으면 Playwright 연결이 ' +
        '타임아웃한다 — 실측. 호스트에 최소 문서를 로드해야 한다)'
    );
  }
}

Object.assign(module.exports, {
  ELECTRON_TABBAR_HTML,
  ELECTRON_TABBAR_PRELOAD,
  cleanUrl,
  pageByUrl,
  browserWindowCount,
  pollBrowserWindowCount,
  shellViewsInfo,
  judgeActiveAppView,
  windowIdForApp,
  closeWindowById,
  launchShellChecked,
});
