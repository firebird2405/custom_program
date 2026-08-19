// ============================================================================
// 쁘띠캘린더 — 백업 엔진 (main 프로세스 모듈)
//
// 발주: 클라우드 폴더 백업 + Pro 예약 자동 백업
//   - 두 앱 저장소를 "기존 내보내기 v2 형식" 그대로 지정 폴더에 저장:
//       calendar-backup-<타임스탬프>.json — { …평면 날짜 키, version:2, events, repeats }
//         (calendar.html buildExportPayload 와 동형 — 구형식 가져오기 호환 유지)
//       postit-backup-<타임스탬프>.json   — { app:'postit', version:2, exportedAt,
//         boards:{저장키:노트[]}, decor?, decorImages? } (postit.html doExport 와 동형)
//   - 기존 파일 미덮어쓰기: 'wx' 플래그 + 이름 충돌 시 -2·-3… 접미 (SCORECARD 93행
//     "backups/ 내 기존 파일의 삭제·덮어쓰기는 금지" 준용 — 어느 폴더든 동일 원칙).
//   - 기본 폴더: 저장소 루트의 backups\ — 사용자가 OneDrive/드라이브 동기화 폴더를
//     지정하면 그 자체로 클라우드 백업이 된다 (안내 문구는 preload UI 담당).
//   - IDB 이미지(배경·사진 스티커)는 용량이 커 기본 제외 — includeImages 옵션일 때만
//     postit 파일에 decorImages 로 동봉 (앱 "이미지 포함" 내보내기와 동일 형식).
//   - 예약 자동 백업 = Pro 게이트: postit-license(A45 서명 라이선스)를 main 에서
//     재검증(동일 공개키·형식 — postit.html verifyLicenseText 로직 재사용)해 통과할
//     때만 주기 실행. Free 는 수동 "지금 백업"만 (신규 기능의 무료 부분 —
//     동결 하한 침해 아님). 주기는 매일 1회(앱 실행 중 체크), 테스트 훅
//     PETIT_BACKUP_INTERVAL_MS 로 단축 가능.
//   - 설정 파일: userData\backup-config.json { folder, includeImages, auto, lastAutoAt }
//     — 손상 시 크래시 없이 기본값 강등 (아키텍처 원칙 5 준용).
//
// A44: 이 파일은 http/https/net/dns/dgram/tls 를 일절 require 하지 않는다.
//      (crypto 는 서명 검증용 — 네트워크 모듈 아님. 소켓 0건 유지.)
// 대화상자: 폴더 선택은 Electron dialog.showOpenDialog(네이티브 파일/폴더 대화상자 —
//      허용 범위). window.alert/confirm/prompt 는 어디에도 없다.
// ============================================================================

'use strict';

const { app, BrowserWindow, dialog, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const {
  REPO_ROOT,
  readJsonFile,
  writeJsonFile,
  appWindows,
  assertTrustedSender,
} = require('./lib-shared');

const DAY_MS = 24 * 60 * 60 * 1000;

// ── 주기 (테스트 훅: PETIT_BACKUP_INTERVAL_MS — 양수 정수일 때만 단축) ───────
function intervalMs() {
  const raw = process.env.PETIT_BACKUP_INTERVAL_MS;
  if (raw) {
    const n = parseInt(raw, 10);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return DAY_MS;
}

function defaultFolder() {
  return path.join(REPO_ROOT, 'backups');
}

// ── 설정 (userData\backup-config.json) ──────────────────────────────────────
function configPath() {
  return path.join(app.getPath('userData'), 'backup-config.json');
}

function sanitizeConfig(v) {
  const out = { folder: null, includeImages: false, auto: false, lastAutoAt: 0 };
  if (v && typeof v === 'object') {
    if (typeof v.folder === 'string' && v.folder.trim() !== '') out.folder = v.folder;
    out.includeImages = v.includeImages === true;
    out.auto = v.auto === true;
    if (Number.isFinite(v.lastAutoAt) && v.lastAutoAt > 0) out.lastAutoAt = v.lastAutoAt;
  }
  return out;
}

function loadConfig() {
  // 부재·손상 모두 기본값 강등 (크래시 없음 — lib-shared readJsonFile)
  return sanitizeConfig(readJsonFile(configPath()));
}

function saveConfig(cfg) {
  // 저장 실패는 치명적이지 않다 — 이번 세션 메모리 값으로 계속 (lib-shared writeJsonFile)
  return writeJsonFile(configPath(), cfg);
}

let config = null;
function getConfig() {
  if (!config) config = loadConfig();
  return config;
}

function effectiveFolder() {
  return getConfig().folder || defaultFolder();
}

// ── Pro 게이트: postit-license 서명 재검증 ──────────────────────────────────
// postit.html A45 verifyLicenseText 와 동일한 검증(동일 공개키 JWK·형식·알고리즘)을
// main 에서 수행한다 — 라이선스 정본은 렌더러 localStorage(postit-license)이며
// 여기서는 읽기만 한다. 실패는 전부 조용한 거부 (throw 없음).
const PRO_PUB_JWK = {
  kty: 'EC',
  crv: 'P-256',
  x: 'eudcFe3QrdCQ1AONNVWwY0-TvX1jBNKyaZ8Zkf4oPhY',
  y: 'Y-GAm55Bgo1zLKVHjwExfop04FdCxNFPolmoQzOi8As'
};

let proKeyPromise = null;
function getProKey() {
  if (!proKeyPromise) {
    proKeyPromise = crypto.webcrypto.subtle.importKey(
      'jwk', PRO_PUB_JWK, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']
    );
    proKeyPromise.catch(function () { /* unhandledrejection 방지 */ });
  }
  return proKeyPromise;
}

function b64ToBytes(s) {
  const clean = String(s).replace(/\s+/g, '');
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(clean)) return null;
  const buf = Buffer.from(clean, 'base64');
  return buf.length ? new Uint8Array(buf) : null;
}

async function verifyLicenseText(text) {
  let obj = null;
  try { obj = JSON.parse(text); } catch (_err) { return false; }
  if (!obj || typeof obj !== 'object' || obj.format !== 'petit-license' || obj.v !== 1 ||
      typeof obj.payload !== 'string' || typeof obj.sig !== 'string') {
    return false;
  }
  const payloadBytes = b64ToBytes(obj.payload);
  const sigBytes = b64ToBytes(obj.sig);
  if (!payloadBytes || !sigBytes) return false;
  try {
    const key = await getProKey();
    const valid = await crypto.webcrypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' }, key, sigBytes, payloadBytes
    );
    if (!valid) return false;
    const p = JSON.parse(Buffer.from(payloadBytes).toString('utf8'));
    return !!(p && p.app === 'petit' && p.product === 'pro');
  } catch (_err) {
    return false;
  }
}

// ── 창 열거는 lib-shared appWindows (URL 기준 창 식별 — 결합도 없음) ────────

// 두 창은 같은 file:// 오리진 저장소를 공유한다 — 아무 창에서나 읽으면 전체가 보인다.
async function readLicenseText(preferredWin) {
  for (const win of appWindows(preferredWin)) {
    try {
      const text = await win.webContents.executeJavaScript(
        '(function(){try{return localStorage.getItem("postit-license")}catch(e){return null}})()', true
      );
      if (typeof text === 'string' && text !== '') return text;
      if (text === null) return null; // 저장소는 읽혔고 라이선스가 없다 — 확정
    } catch (_err) { /* 이 창은 로드 전 — 다음 창 시도 */ }
  }
  return null;
}

// 같은 원문은 재검증하지 않는다 (텍스트 키 캐시 — 검증 자체는 저비용)
const proCache = { text: undefined, ok: false };
async function isProUnlocked(preferredWin) {
  const text = await readLicenseText(preferredWin);
  if (text === null) { proCache.text = null; proCache.ok = false; return false; }
  if (text === proCache.text) return proCache.ok;
  const ok = await verifyLicenseText(text);
  proCache.text = text;
  proCache.ok = ok;
  return ok;
}

// ── 저장소 수집 스크립트 (앱 창 평가 — localStorage/indexedDB 읽기 전용) ────
function buildCollectScript(includeImages) {
  return '(async () => {\n' +
    '"use strict";\n' +
    'var out = { warnings: [], calendar: null, postit: null, counts: { events: 0, notes: 0, boards: 0, images: 0 } };\n' +
    'var ls = function (k) { try { return localStorage.getItem(k); } catch (e) { return null; } };\n' +
    'var parse = function (k) {\n' +
    '  var raw = ls(k);\n' +
    '  if (raw === null) return { present: false, value: null };\n' +
    '  try { return { present: true, value: JSON.parse(raw) }; } catch (e) { return { present: true, value: undefined }; }\n' +
    '};\n' +

    // ── 캘린더 v2 (calendar.html buildExportPayload 동형: 평면 날짜 키 + version/events/repeats) ──
    'var events = {};\n' +
    'var pe = parse("cal-events");\n' +
    'if (pe.present && pe.value && typeof pe.value === "object" && !Array.isArray(pe.value)) events = pe.value;\n' +
    'else if (pe.present) out.warnings.push("cal-events 데이터가 손상되어 캘린더 일정은 비운 채 백업했어요");\n' +
    'var repeats = [];\n' +
    'var pr = parse("cal-repeats");\n' +
    'if (pr.present && Array.isArray(pr.value)) repeats = pr.value;\n' +
    'else if (pr.present) out.warnings.push("cal-repeats 데이터가 손상되어 반복 규칙은 뺐어요");\n' +
    'var cal = {};\n' +
    'Object.keys(events).forEach(function (k) { cal[k] = events[k]; });\n' +
    'cal.version = 2;\n' +
    'cal.events = events;\n' +
    'cal.repeats = repeats;\n' +
    'out.calendar = cal;\n' +
    'Object.keys(events).forEach(function (k) {\n' +
    '  if (/^\\d{4}-\\d{2}-\\d{2}$/.test(k) && Array.isArray(events[k])) out.counts.events += events[k].length;\n' +
    '});\n' +

    // ── 포스트잇 v2 (postit.html doExport 동형: 전 보드 + decor 메타) ──
    'var found = { b1: true };\n' +
    'try {\n' +
    '  for (var i = 0; i < localStorage.length; i++) {\n' +
    '    var k = localStorage.key(i);\n' +
    '    var m = /^postit-notes-(b\\d+)$/.exec(k || "");\n' +
    '    if (m) found[m[1]] = true;\n' + // -corrupt- 백업 키는 패턴상 제외
    '  }\n' +
    '} catch (e) { /* 저장소 접근 불가 — 기본 보드만 */ }\n' +
    'var act = ls("postit-active-board");\n' +
    'if (act && /^b\\d+$/.test(act)) found[act] = true;\n' +
    'var ids = Object.keys(found).sort(function (a, b) { return parseInt(a.slice(1), 10) - parseInt(b.slice(1), 10); });\n' +
    'var boards = {};\n' +
    'ids.forEach(function (id) {\n' +
    '  var sk = id === "b1" ? "postit-notes" : "postit-notes-" + id;\n' +
    '  var p = parse(sk);\n' +
    '  var list = (p.present && Array.isArray(p.value)) ? p.value : [];\n' +
    '  if (p.present && !Array.isArray(p.value)) out.warnings.push(sk + " 데이터가 손상되어 빈 보드로 기록했어요");\n' +
    '  boards[sk] = list;\n' +
    '  out.counts.notes += list.length;\n' +
    '});\n' +
    'out.counts.boards = ids.length;\n' +
    'var pp = { app: "postit", version: 2, exportedAt: new Date().toISOString(), boards: boards };\n' +
    'var pd = parse("postit-decor-layout");\n' +
    'if (pd.present && pd.value && typeof pd.value === "object" && !Array.isArray(pd.value) &&\n' +
    '    pd.value.boards && typeof pd.value.boards === "object" && Object.keys(pd.value.boards).length) {\n' +
    '  pp.decor = pd.value;\n' +
    '}\n' +

    // ── IDB 이미지 (옵션 — 기본 제외): postit-decor/images 의 검증된 data:image URI 만 ──
    (includeImages
      ? ('var imgs = await new Promise(function (resolve) {\n' +
        '  var IMG_RE = /^data:image\\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/;\n' +
        '  var req;\n' +
        '  try { req = indexedDB.open("postit-decor", 1); } catch (e) { resolve(null); return; }\n' +
        '  req.onupgradeneeded = function () { try { req.result.createObjectStore("images"); } catch (e) {} };\n' +
        '  req.onerror = function () { resolve(null); };\n' +
        '  req.onblocked = function () { resolve(null); };\n' +
        '  req.onsuccess = function () {\n' +
        '    var db = req.result;\n' +
        '    var o = {};\n' +
        '    var rq;\n' +
        '    try { rq = db.transaction("images", "readonly").objectStore("images").openCursor(); }\n' +
        '    catch (e) { db.close(); resolve(null); return; }\n' +
        '    rq.onsuccess = function () {\n' +
        '      var cur = rq.result;\n' +
        '      if (cur) {\n' +
        '        if (typeof cur.value === "string" && IMG_RE.test(cur.value)) o[String(cur.key)] = cur.value;\n' +
        '        cur["continue"]();\n' +
        '      } else { db.close(); resolve(o); }\n' +
        '    };\n' +
        '    rq.onerror = function () { db.close(); resolve(null); };\n' +
        '  };\n' +
        '});\n' +
        'if (imgs === null) out.warnings.push("이미지 저장소를 읽지 못해 이미지는 뺐어요");\n' +
        'else {\n' +
        '  var ik = Object.keys(imgs);\n' +
        '  if (ik.length) { pp.decorImages = imgs; out.counts.images = ik.length; }\n' +
        '}\n')
      : '') +
    'out.postit = pp;\n' +
    'return out;\n' +
    '})()';
}

async function collectAppData(includeImages, preferredWin) {
  const wins = appWindows(preferredWin);
  if (wins.length === 0) {
    throw new Error('앱 창을 찾지 못해 저장 데이터를 읽을 수 없어요.');
  }
  let lastErr = null;
  for (const win of wins) {
    try {
      const out = await win.webContents.executeJavaScript(buildCollectScript(includeImages), true);
      if (out && out.calendar && out.postit) return out;
      lastErr = new Error('저장 데이터 수집 결과가 비어 있어요.');
    } catch (err) {
      lastErr = err;
    }
  }
  throw new Error('저장 데이터를 읽지 못했어요: ' + String((lastErr && lastErr.message) || lastErr));
}

// ── 파일 기록 (기존 파일 미덮어쓰기 — 'wx' + 접미 루프) ─────────────────────
function pad2(v) { return v < 10 ? '0' + v : '' + v; }
function fileStamp(d) {
  return '' + d.getFullYear() + pad2(d.getMonth() + 1) + pad2(d.getDate()) +
    '-' + pad2(d.getHours()) + pad2(d.getMinutes()) + pad2(d.getSeconds());
}

/**
 * 기존 파일을 절대 덮지 않는 기록 — 'wx' 플래그 + 이름 충돌 시 -2·-3… 접미.
 * @returns {string} 실제 기록된 전체 경로 (99회 충돌 시 한국어 오류 throw)
 */
function writeNoClobber(dir, base, text) {
  for (let n = 1; n <= 99; n++) {
    const name = n === 1 ? base + '.json' : base + '-' + n + '.json';
    const full = path.join(dir, name);
    try {
      fs.writeFileSync(full, text, { encoding: 'utf8', flag: 'wx' }); // 존재 시 EEXIST — 절대 미덮어쓰기
      return full;
    } catch (err) {
      if (err && err.code === 'EEXIST') continue;
      throw err;
    }
  }
  throw new Error('백업 파일 이름이 계속 겹쳐 저장하지 못했어요: ' + base);
}

// ── 백업 실행 ────────────────────────────────────────────────────────────────
const bkState = { running: false, last: null };

/**
 * 백업 본체: 앱 창에서 저장 데이터 수집 → 지정 폴더에 캘린더/포스트잇 v2 파일 기록.
 * @param {'manual'|'auto'} kind 실행 종류 (상태 표기용)
 * @param {Electron.BrowserWindow|null} preferredWin 수집을 먼저 시도할 창
 * @returns {Promise<{ok:boolean, summary?:string, reason?:string}>} 한국어 요약/사유
 */
async function runBackup(kind, preferredWin) {
  if (bkState.running) {
    return { ok: false, reason: '이미 백업이 진행 중이에요.' };
  }
  bkState.running = true;
  let result;
  try {
    const cfg = getConfig();
    const dir = effectiveFolder();
    try {
      fs.mkdirSync(dir, { recursive: true });
    } catch (err) {
      result = { ok: false, reason: '백업 폴더를 만들 수 없어요: ' + dir };
      return result;
    }

    const data = await collectAppData(cfg.includeImages === true, preferredWin);
    const stamp = fileStamp(new Date());
    const files = [];
    files.push(writeNoClobber(dir, 'calendar-backup-' + stamp, JSON.stringify(data.calendar, null, 2)));
    files.push(writeNoClobber(dir, 'postit-backup-' + stamp, JSON.stringify(data.postit, null, 2)));

    const c = data.counts || {};
    let summary = '일정 ' + (c.events || 0) + '건 · 노트 ' + (c.notes || 0) + '개(보드 ' + (c.boards || 0) + '개)를 백업했어요.';
    if (cfg.includeImages === true) summary += c.images ? ' (이미지 ' + c.images + '개 포함)' : ' (포함할 이미지 없음)';
    if (data.warnings && data.warnings.length) summary += ' (경고 ' + data.warnings.length + '건)';

    result = { ok: true, kind, folder: dir, files, summary, warnings: data.warnings || [] };
    return result;
  } catch (err) {
    result = { ok: false, reason: String((err && err.message) || err).slice(0, 400) };
    return result;
  } finally {
    bkState.running = false;
    bkState.last = {
      at: new Date().toISOString(),
      kind,
      ok: !!(result && result.ok),
      summary: result ? (result.summary || result.reason) : '(결과 없음)'
    };
  }
}

// ── 예약 자동 백업 (Pro 게이트 — 매일 1회, 앱 실행 중 체크) ─────────────────
let schedTimer = null;

async function checkAutoBackup() {
  try {
    if (bkState.running) return;
    const cfg = getConfig();
    if (cfg.auto !== true) return;
    const iv = intervalMs();
    const now = Date.now();
    if (now - (cfg.lastAutoAt || 0) < iv) return;
    if (!(await isProUnlocked(null))) return; // 라이선스 없이는 예약 백업이 절대 돌지 않는다
    await runBackup('auto', null);
    // 실패해도 다음 주기까지 대기 — 실패 연타로 폴더·디스크를 괴롭히지 않는다
    cfg.lastAutoAt = Date.now();
    saveConfig(cfg);
  } catch (_err) { /* 예약 체크 실패는 조용히 다음 주기로 */ }
}

function startBackupScheduler() {
  if (schedTimer) return;
  const iv = intervalMs();
  const tick = Math.max(1000, Math.min(iv, 60 * 1000)); // 하루 주기여도 체크는 1분 간격 (저비용)
  schedTimer = setInterval(checkAutoBackup, tick);
}

function stopBackupScheduler() {
  if (schedTimer) { clearInterval(schedTimer); schedTimer = null; }
}

// ── IPC (preload 화이트리스트 채널의 main 측 종단) ──────────────────────────
// 호출자 검증(assertTrustedSender)은 lib-shared — 우리 앱 창(file://)의 요청만 처리한다.

/** 'petit:backup:status' 응답 본문 — 설정·Pro 여부·실행 상태를 한 번에 담는다. */
function statusPayload(pro) {
  const cfg = getConfig();
  return {
    ok: true,
    folder: effectiveFolder(),
    folderIsDefault: !cfg.folder,
    defaultFolder: defaultFolder(),
    auto: cfg.auto === true,
    includeImages: cfg.includeImages === true,
    pro: pro === true,
    intervalMs: intervalMs(),
    lastAutoAt: cfg.lastAutoAt || 0,
    running: bkState.running,
    last: bkState.last
  };
}

function registerBackupIpc() {
  ipcMain.handle('petit:backup:status', async (event) => {
    assertTrustedSender(event);
    const win = BrowserWindow.fromWebContents(event.sender);
    const pro = await isProUnlocked(win);
    return statusPayload(pro);
  });

  ipcMain.handle('petit:backup:choose-folder', async (event) => {
    assertTrustedSender(event);
    const win = BrowserWindow.fromWebContents(event.sender);
    let res;
    try {
      res = await dialog.showOpenDialog(win, {
        title: '백업 폴더 선택',
        defaultPath: effectiveFolder(),
        buttonLabel: '이 폴더에 백업',
        properties: ['openDirectory', 'createDirectory']
      });
    } catch (err) {
      return { ok: false, reason: '폴더 선택 창을 열지 못했어요.' };
    }
    if (!res || res.canceled || !res.filePaths || !res.filePaths[0]) {
      return { ok: true, canceled: true, folder: effectiveFolder() };
    }
    const cfg = getConfig();
    cfg.folder = res.filePaths[0];
    saveConfig(cfg);
    return { ok: true, canceled: false, folder: effectiveFolder() };
  });

  ipcMain.handle('petit:backup:run-now', async (event) => {
    assertTrustedSender(event);
    const win = BrowserWindow.fromWebContents(event.sender);
    return runBackup('manual', win); // Free 포함 누구나 — 수동 백업은 무료 기능
  });

  ipcMain.handle('petit:backup:set-auto', async (event, enabled) => {
    assertTrustedSender(event);
    const on = enabled === true;
    const cfg = getConfig();
    if (on) {
      const win = BrowserWindow.fromWebContents(event.sender);
      const pro = await isProUnlocked(win);
      if (!pro) {
        return {
          ok: false,
          locked: true,
          reason: '예약 자동 백업은 프리미엄(Pro) 기능이에요. 라이선스를 적용하면 켤 수 있어요.'
        };
      }
    }
    cfg.auto = on;
    saveConfig(cfg);
    return { ok: true, auto: cfg.auto };
  });

  ipcMain.handle('petit:backup:set-include-images', (event, enabled) => {
    assertTrustedSender(event);
    const cfg = getConfig();
    cfg.includeImages = enabled === true;
    saveConfig(cfg);
    return { ok: true, includeImages: cfg.includeImages };
  });
}

module.exports = { registerBackupIpc, startBackupScheduler, stopBackupScheduler };
