// ============================================================================
// 쁘띠캘린더 — 마이그레이션 엔진 (main 프로세스 모듈)
//
// 계약 (protocol/SCORECARD.md rev.6 A43):
//   - 소스 프로필 경로 인자: --source-cal= / --source-postit= (argv) 또는
//     PETIT_SOURCE_CAL / PETIT_SOURCE_POSTIT (env) → 기본값 저장소 루트의 .edge\calendar·.edge\postit.
//   - 전 범위 이전: 모든 cal-*/postit-* localStorage 키(다중 보드 postit-notes-b*, 보드 이름,
//     cal-repeats, 설정, 창 상태) + IndexedDB postit-decor·cal-decor 전수.
//   - 원본 불가침(읽기 전용): 덤프는 electron\migrate-dump.ps1 이 수행 — backup_snapshot.ps1 의
//     검증된 헤드리스 Edge 덤프 메커니즘을 복사·확장한 읽기 전용 절차. 원본 삭제·변형 없음.
//   - 병합·멱등: id 기준 병합(기존 Electron 데이터 무손실 보존), 2회 실행 중복 0.
//
// 메커니즘 요약:
//   detect() ─ 소스 프로필 존재 확인 (fs 만, Edge 실행 없음)
//   run()    ─ ① migrate-dump.ps1 을 임시 폴더에 복사(asar 패키지에서도 동작)하고
//                powershell(System32 절대 경로, -NoProfile -NonInteractive)로 실행,
//                프로필별 JSON 덤프 수신
//              ② 앱 창(webContents.executeJavaScript — 호출 창 우선)에 병합 스크립트
//                주입: localStorage 는 키 유형별 병합(아래 MERGE 규칙), IndexedDB 는
//                같은 DB/스토어에 동일 값이 아닐 때만 put (멱등)
//              ③ 어떤 창도 자동 reload 하지 않는다 (pagehide 의 창 상태 재기록이
//                이전값을 덮는 것 방지) — 화면 반영은 preload UI 의 지연 self-reload
//   status() ─ 진행 상태·마지막 결과
//
// MERGE 규칙 (정본: grader a43 spec 상단 주석 — 콘텐츠 키만 병합, 그 외는 통째):
//   콘텐츠 키 (cal-events · postit-notes · postit-notes-*):
//     앱의 merge-on-write 관례와 동형 — id 기준으로 없는 항목만 추가 (무손실·중복 0)
//   그 외 모든 cal-*/postit-* 키 (cal-repeats·설정·보드 이름·꾸미기 레이아웃·창 상태·합성 키):
//     값 "통째" 이전 — 소스값으로 기록 (부분 병합으로 소스도 선값도 아닌 제3의 값을
//     만들지 않는다는 a43 계약). 이미 소스와 같은 값이면 무변경 (멱등).
//   제외: 셸 내부 플래그(cal-migrated·cal-migrate-declined·postit-onboarded)는
//     소스에서 절대 가져오지 않는다.
//   완료 플래그: 병합 스크립트가 마지막에 cal-migrated=1 을 기록 — 이후 어떤 창이
//     reload 되어도 제안 UI 가 다시 뜨지 않는다 (완료 상태 기억).
//
// A44: 이 파일은 http/https/net/dns/dgram/tls 를 일절 require 하지 않는다.
//      자식 프로세스는 powershell(덤프 전용) 하나뿐이며 그 안의 Edge 도
//      백그라운드 네트워킹 차단 플래그로 실행된다.
// ============================================================================

'use strict';

const { ipcMain, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFile } = require('child_process');
const {
  REPO_ROOT,
  POWERSHELL_EXE, // PATH 섀도잉 차단 — 항상 System32 절대 경로 (backup/a39 관례와 동일)
  cleanChildEnv,
  windowAppKind,
  appWindows,
  assertTrustedSender,
} = require('./lib-shared');

const DUMP_PS1 = path.join(__dirname, 'migrate-dump.ps1');

// ── 소스 프로필 경로 결정 (A43 채점 계약: argv > env > 기본 .edge) ──────────

/** `--이름=값` 형태의 실행 인자 값 판독 — 없으면 null. */
function argvValue(name) {
  const pfx = name + '=';
  for (const a of process.argv) {
    if (typeof a === 'string' && a.startsWith(pfx)) return a.slice(pfx.length);
  }
  return null;
}

function resolveSources() {
  const cal = argvValue('--source-cal') || process.env.PETIT_SOURCE_CAL ||
    path.join(REPO_ROOT, '.edge', 'calendar');
  const postit = argvValue('--source-postit') || process.env.PETIT_SOURCE_POSTIT ||
    path.join(REPO_ROOT, '.edge', 'postit');
  return { cal: path.resolve(cal), postit: path.resolve(postit) };
}

// 프로필에 실데이터가 있는지 — Chromium 프로필은 항상 Default\ 하위에 저장한다
function profileHasData(dir) {
  try {
    return fs.existsSync(path.join(dir, 'Default'));
  } catch (_err) {
    return false;
  }
}

function detect() {
  const s = resolveSources();
  const cal = { path: s.cal, exists: profileHasData(s.cal) };
  const postit = { path: s.postit, exists: profileHasData(s.postit) };
  return { cal, postit, any: cal.exists || postit.exists };
}

// ── 덤프 실행 (읽기 전용) ────────────────────────────────────────────────────

/**
 * migrate-dump.ps1 을 정돈된 환경(cleanChildEnv)으로 실행해 프로필 1개를 JSON 덤프한다.
 * @param {string} ps1Path 임시 폴더로 복사된 스크립트 경로 (asar 패키지 대응)
 * @param {string} profileDir 읽기 전용으로 덤프할 Edge 프로필 경로
 * @param {string} outFile 덤프 JSON 출력 경로
 * @returns {Promise<string>} stdout (실패 시 한국어 사유로 reject)
 */
function runDump(ps1Path, profileDir, outFile) {
  return new Promise((resolve, reject) => {
    execFile(
      POWERSHELL_EXE,
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
        '-File', ps1Path, '-ProfileDir', profileDir, '-OutFile', outFile],
      { env: cleanChildEnv(), timeout: 240000, windowsHide: true, maxBuffer: 32 * 1024 * 1024 },
      (err, stdout) => {
        if (err) {
          const msg = String(stdout || (err && err.message) || '').trim().slice(0, 300);
          reject(new Error(msg || '프로필 덤프 실행에 실패했습니다.'));
          return;
        }
        resolve(String(stdout || ''));
      }
    );
  });
}

// ── 병합 스크립트 (앱 창 main world 에서 실행 — localStorage/indexedDB 만 사용) ──
function buildMergeScript(payload) {
  // JSON 을 JS 리터럴로 안전 삽입 (U+2028/U+2029 는 JS 문자열에서 개행 취급)
  const payloadJson = JSON.stringify(payload)
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');

  return '(async () => {\n' +
    '"use strict";\n' +
    'var PAYLOAD = ' + payloadJson + ';\n' +
    'var rep = { added: {}, copied: [], overwritten: [], unchanged: [], skipped: [], idb: {}, errors: [] };\n' +
    // 셸 내부 플래그 — 소스에서 절대 이전하지 않는다
    'var SKIP_KEYS = { "cal-migrated": 1, "cal-migrate-declined": 1, "postit-onboarded": 1 };\n' +
    'try {\n' +
    // 현재 저장값 판독: null=없음, undefined=손상(점유로 간주해 덮지 않음)
    'var getJSON = function (k) {\n' +
    '  var raw = null;\n' +
    '  try { raw = localStorage.getItem(k); } catch (e) { return undefined; }\n' +
    '  if (raw === null) return null;\n' +
    '  try { return JSON.parse(raw); } catch (e) { return undefined; }\n' +
    '};\n' +
    'var setJSON = function (k, v) { localStorage.setItem(k, JSON.stringify(v)); };\n' +
    'var bumpAdded = function (k, n) { if (n > 0) rep.added[k] = (rep.added[k] || 0) + n; };\n' +

    // 배열+id 병합 (콘텐츠 키 postit-notes[-*]) — 소스가 배열이 아니면(손상 백업 키 등)
    // 타깃이 비어 있을 때만 원문 통째 복사 (전수 이전 + 기존 데이터 보호)
    'var mergeIdArray = function (k, srcRaw) {\n' +
    '  var src = null; try { src = JSON.parse(srcRaw); } catch (e) { src = null; }\n' +
    '  if (!Array.isArray(src)) {\n' +
    '    var raw = null;\n' +
    '    try { raw = localStorage.getItem(k); } catch (e) { rep.skipped.push(k + ":판독 불가"); return; }\n' +
    '    if (raw === null) { localStorage.setItem(k, srcRaw); rep.copied.push(k); }\n' +
    '    else rep.skipped.push(k + ":소스 비배열 — 기존값 유지");\n' +
    '    return;\n' +
    '  }\n' +
    '  var cur = getJSON(k);\n' +
    '  if (cur === undefined) { rep.skipped.push(k + ":현재값 손상"); return; }\n' +
    '  if (cur === null) cur = [];\n' +
    '  if (!Array.isArray(cur)) { rep.skipped.push(k + ":현재값 형식 상이"); return; }\n' +
    '  var have = {};\n' +
    '  cur.forEach(function (n) { if (n && typeof n.id === "string") have[n.id] = true; });\n' +
    '  var added = 0;\n' +
    '  src.forEach(function (n) {\n' +
    '    if (n && typeof n === "object" && typeof n.id === "string" && !have[n.id]) {\n' +
    '      cur.push(n); have[n.id] = true; added += 1;\n' +
    '    }\n' +
    '  });\n' +
    '  if (added) { setJSON(k, cur); bumpAdded(k, added); }\n' +
    '};\n' +

    // cal-events: {날짜:[{id,…}]} — 일정 id 전역 집합 기준 병합
    'var mergeCalEvents = function (srcRaw) {\n' +
    '  var k = "cal-events";\n' +
    '  var src; try { src = JSON.parse(srcRaw); } catch (e) { rep.errors.push("소스 손상:" + k); return; }\n' +
    '  if (!src || typeof src !== "object" || Array.isArray(src)) { rep.errors.push("소스 형식:" + k); return; }\n' +
    '  var cur = getJSON(k);\n' +
    '  if (cur === undefined) { rep.skipped.push(k + ":현재값 손상"); return; }\n' +
    '  if (cur === null) cur = {};\n' +
    '  if (typeof cur !== "object" || Array.isArray(cur)) { rep.skipped.push(k + ":현재값 형식 상이"); return; }\n' +
    '  var have = {};\n' +
    '  Object.keys(cur).forEach(function (d) {\n' +
    '    (Array.isArray(cur[d]) ? cur[d] : []).forEach(function (ev) {\n' +
    '      if (ev && typeof ev.id === "string") have[ev.id] = true;\n' +
    '    });\n' +
    '  });\n' +
    '  var added = 0;\n' +
    '  Object.keys(src).forEach(function (d) {\n' +
    '    if (!/^\\d{4}-\\d{2}-\\d{2}$/.test(d) || !Array.isArray(src[d])) return;\n' +
    '    src[d].forEach(function (ev) {\n' +
    '      if (!ev || typeof ev !== "object" || typeof ev.id !== "string" || have[ev.id]) return;\n' +
    '      if (!Array.isArray(cur[d])) cur[d] = [];\n' +
    '      cur[d].push(ev); have[ev.id] = true; added += 1;\n' +
    '    });\n' +
    '  });\n' +
    '  if (added) { setJSON(k, cur); bumpAdded(k, added); }\n' +
    '};\n' +

    // 값 통째 이전 (콘텐츠 키 외 전부) — 소스값으로 기록, 이미 같으면 무변경 (멱등).
    // 부분 병합으로 "소스도 선값도 아닌 제3의 값"을 만들지 않는다 (a43 계약).
    'var wholesale = function (k, v) {\n' +
    '  var cur = null;\n' +
    '  try { cur = localStorage.getItem(k); } catch (e) { rep.skipped.push(k + ":판독 불가"); return; }\n' +
    '  if (cur === v) { rep.unchanged.push(k); return; }\n' +
    '  localStorage.setItem(k, v);\n' +
    '  if (cur === null) rep.copied.push(k); else rep.overwritten.push(k);\n' +
    '};\n' +

    // ── localStorage 이전: 소스(캘린더 프로필 → 포스트잇 프로필) 순서로, 키 유형별 ──
    '(PAYLOAD.sources || []).forEach(function (srcSnap) {\n' +
    '  var ls = srcSnap.ls || {};\n' +
    '  Object.keys(ls).forEach(function (k) {\n' +
    '    if (!/^(cal-|postit-)/.test(k)) return;\n' + // 계약 범위: cal-*/postit-* 키만
    '    if (Object.prototype.hasOwnProperty.call(SKIP_KEYS, k)) return;\n' +
    '    var v = ls[k];\n' +
    '    if (typeof v !== "string") return;\n' +
    '    try {\n' +
    '      if (k === "cal-events") mergeCalEvents(v);\n' +
    '      else if (/^postit-notes(-.*)?$/.test(k)) mergeIdArray(k, v);\n' + // 콘텐츠 키 (a43 CONTENT_KEY_RE 동형)
    '      else wholesale(k, v);\n' +
    '    } catch (e) { rep.errors.push("병합 실패:" + k + ":" + String(e && e.message || e)); }\n' +
    '  });\n' +
    '});\n' +

    // ── IndexedDB 병합: 앱과 동일한 DB/스토어에 "없는 키만" put (기존 보존 + 멱등) ──
    'var IDB_STORES = { "postit-decor": "images", "cal-decor": "img" };\n' +
    'var writeDb = function (name, entries) {\n' +
    '  var store = IDB_STORES[name];\n' +
    '  var res = rep.idb[name] || (rep.idb[name] = { put: 0, kept: 0, errors: 0 });\n' +
    '  return new Promise(function (resolve) {\n' +
    '    var req;\n' +
    '    try { req = indexedDB.open(name, 1); } catch (e) { res.errors += 1; resolve(); return; }\n' +
    '    req.onupgradeneeded = function () { try { req.result.createObjectStore(store); } catch (e) {} };\n' +
    '    req.onerror = function () { res.errors += 1; resolve(); };\n' +
    '    req.onsuccess = function () {\n' +
    '      var db = req.result;\n' +
    '      var keys = Object.keys(entries);\n' +
    '      var i = 0;\n' +
    '      var step = function () {\n' +
    '        if (i >= keys.length) { db.close(); resolve(); return; }\n' +
    '        var key = keys[i]; i += 1;\n' +
    '        var ent = entries[key];\n' +
    '        var val;\n' +
    '        if (ent && ent.t === "s") val = ent.v;\n' +
    '        else if (ent && ent.t === "j") { try { val = JSON.parse(ent.v); } catch (e) { res.errors += 1; step(); return; } }\n' +
    '        else { res.errors += 1; step(); return; }\n' +
    '        var tx;\n' +
    '        try { tx = db.transaction(store, "readwrite"); } catch (e) { res.errors += 1; db.close(); resolve(); return; }\n' +
    '        var st = tx.objectStore(store);\n' +
    '        var g = st.get(key);\n' +
    '        g.onsuccess = function () {\n' +
    '          var ex = g.result;\n' +
    '          if (ex !== undefined) {\n' +
    // 동일 값이면 무변경 (멱등) — 다르면 소스값으로 이전 (a43: 시딩 레코드 동일 키·값 도착)
    '            var same = false;\n' +
    '            try {\n' +
    '              same = (typeof ex === "string" && typeof val === "string")\n' +
    '                ? ex === val : JSON.stringify(ex) === JSON.stringify(val);\n' +
    '            } catch (e) { same = false; }\n' +
    '            if (same) { res.kept += 1; step(); return; }\n' +
    '          }\n' +
    '          var p = st.put(val, key);\n' +
    '          p.onsuccess = function () { res.put += 1; step(); };\n' +
    '          p.onerror = function () { res.errors += 1; step(); };\n' +
    '        };\n' +
    '        g.onerror = function () { res.errors += 1; step(); };\n' +
    '      };\n' +
    '      step();\n' +
    '    };\n' +
    '  });\n' +
    '};\n' +
    'var srcs = PAYLOAD.sources || [];\n' +
    'for (var si = 0; si < srcs.length; si += 1) {\n' +
    '  var idb = srcs[si].idb || {};\n' +
    '  var dns = Object.keys(idb);\n' +
    '  for (var di = 0; di < dns.length; di += 1) {\n' +
    '    if (IDB_STORES[dns[di]]) await writeDb(dns[di], idb[dns[di]]);\n' +
    '  }\n' +
    '}\n' +
    // 완료 플래그 — 저장소 공유 창 어느 쪽이 reload 되어도 제안 UI 재표시 없음 (완료 상태 기억)
    'try { localStorage.setItem("cal-migrated", "1"); } catch (e) { rep.errors.push("완료 플래그 기록 실패"); }\n' +
    '} catch (e) { rep.errors.push("치명 오류:" + String(e && e.message || e)); }\n' +
    'return rep;\n' +
    '})()';
}

// ── 창 선택 (창 식별은 lib-shared windowAppKind — URL 기준) ─────────────────

/** 병합 주입 창의 폴백 선택 — 캘린더 창 우선 (호출 창이 없거나 이미 닫힌 경우). */
function pickTargetWindow() {
  const wins = appWindows(null);
  wins.sort((a, b) => (windowAppKind(a) === 'calendar' ? -1 : 1) - (windowAppKind(b) === 'calendar' ? -1 : 1));
  return wins[0] || null;
}

// ── 실행 상태 (status 계약 + 중복 실행 차단) ────────────────────────────────
const migState = { running: false, last: null };

/** 병합 리포트를 사용자용 한국어 한 줄 요약으로 만든다. */
function summarize(rep, warnings) {
  let items = 0;
  for (const k of Object.keys(rep.added || {})) items += rep.added[k];
  const settings = (rep.copied || []).length + (rep.overwritten || []).length;
  let images = 0;
  for (const d of Object.keys(rep.idb || {})) images += rep.idb[d].put;
  if (items === 0 && settings === 0 && images === 0) {
    return '새로 가져올 항목이 없었어요 (이미 최신 상태).';
  }
  let s = '일정·노트 등 ' + items + '건, 설정·기타 ' + settings + '건, 이미지 ' + images + '건을 가져왔어요.';
  if (warnings && warnings.length) s += ' (경고 ' + warnings.length + '건)';
  return s;
}

/**
 * 마이그레이션 본체: ① 프로필 덤프(읽기 전용) → ② 앱 창에 병합 스크립트 주입 → 결과 요약.
 * @param {Electron.WebContents|null} invokerWebContents 호출한 창 (병합 주입 창 우선 후보)
 * @returns {Promise<{ok:boolean, summary?:string, reason?:string, report?:object, warnings?:string[]}>}
 */
async function runMigration(invokerWebContents) {
  if (migState.running) {
    return { ok: false, reason: '이미 가져오기가 진행 중이에요.' };
  }
  migState.running = true;
  let tmpDir = null;
  let result;
  try {
    const det = detect();
    if (!det.any) {
      result = { ok: false, reason: '가져올 기존 Edge 프로필을 찾지 못했어요.' };
      return result;
    }

    // ① 프로필 덤프 (읽기 전용 — migrate-dump.ps1)
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'petit-migrate-'));
    // asar 패키지 안에서도 powershell 이 읽을 수 있도록 ps1 을 임시 폴더로 사본 실행
    const ps1Tmp = path.join(tmpDir, 'migrate-dump.ps1');
    fs.writeFileSync(ps1Tmp, fs.readFileSync(DUMP_PS1));

    const sources = [];
    const warnings = [];
    const plan = [
      ['캘린더', det.cal, 'cal-dump.json'],
      ['포스트잇', det.postit, 'postit-dump.json'],
    ];
    for (const [label, info, fileName] of plan) {
      if (!info.exists) continue;
      const outFile = path.join(tmpDir, fileName);
      try {
        await runDump(ps1Tmp, info.path, outFile);
      } catch (err) {
        result = { ok: false, reason: label + ' ' + String(err && err.message || err) };
        return result;
      }
      let dump;
      try {
        dump = JSON.parse(fs.readFileSync(outFile, 'utf8'));
      } catch (err) {
        result = { ok: false, reason: label + ' 덤프 파일을 해석하지 못했어요.' };
        return result;
      }
      sources.push({ label, ls: dump.ls || {}, idb: dump.idb || {} });
      for (const w of dump.warnings || []) warnings.push(label + ':' + w);
    }
    if (sources.length === 0) {
      result = { ok: false, reason: '가져올 기존 Edge 프로필을 찾지 못했어요.' };
      return result;
    }

    // ② 앱 창에 병합 주입 (두 창은 같은 file:// 오리진 저장소를 공유 — 한 창에서 전체 병합)
    //    주입 창은 "호출한 창" 우선 — 다른 창이 도중 reload 되어도 주입이 파괴되지 않는다.
    let target = null;
    if (invokerWebContents) {
      const w = BrowserWindow.fromWebContents(invokerWebContents);
      if (w && !w.isDestroyed() && windowAppKind(w)) target = w;
    }
    if (!target) target = pickTargetWindow();
    if (!target) {
      result = { ok: false, reason: '앱 창을 찾지 못해 병합할 수 없어요.' };
      return result;
    }
    const rep = await target.webContents.executeJavaScript(buildMergeScript({ sources }), true);

    // 어떤 창도 자동 reload 하지 않는다 — reload 는 pagehide 를 발화시켜 앱의 창 상태
    // 키(cal-window·postit-window)를 재기록해 방금 이전한 값을 덮어쓰고(a43 "제3의 값"
    // 금지 판정과 충돌), 진행 중인 렌더러 평가 컨텍스트를 파괴할 수 있다.
    // 화면 반영: 호출한 창의 preload UI 가 지연 self-reload, 나머지 창은 재기동 시 반영.

    result = { ok: true, summary: summarize(rep, warnings), report: rep, warnings };
    return result;
  } catch (err) {
    result = { ok: false, reason: String(err && err.message || err).slice(0, 400) };
    return result;
  } finally {
    migState.running = false;
    migState.last = {
      at: new Date().toISOString(),
      ok: !!(result && result.ok),
      summary: result ? (result.summary || result.reason) : '(결과 없음)',
    };
    if (tmpDir) {
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_err) { /* 임시 파일 잔존 무해 */ }
    }
  }
}

// ── IPC 등록 (preload 화이트리스트 채널의 main 측 종단) ─────────────────────
// 호출자 검증(assertTrustedSender)은 lib-shared — 우리 앱 창(file://)의 요청만 처리한다.

/** 'petit:migrate:detect' / ':run' / ':status' 채널 종단 등록. */
function registerMigrateIpc() {
  ipcMain.handle('petit:migrate:detect', (event) => {
    assertTrustedSender(event);
    const d = detect();
    return {
      any: d.any,
      cal: { path: d.cal.path, exists: d.cal.exists },
      postit: { path: d.postit.path, exists: d.postit.exists },
    };
  });
  ipcMain.handle('petit:migrate:run', (event) => {
    assertTrustedSender(event);
    return runMigration(event.sender);
  });
  ipcMain.handle('petit:migrate:status', (event) => {
    assertTrustedSender(event);
    return { running: migState.running, last: migState.last };
  });
}

module.exports = { registerMigrateIpc, detect };
