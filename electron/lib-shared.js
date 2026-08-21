// ============================================================================
// 쁘띠캘린더 — 셸 공용 유틸 (main 프로세스 전용 모듈)
//
// main.js·migrate.js·backup.js 가 중복 정의하던 유틸의 단일 정의처:
//   - 경로 해석: REPO_ROOT(저장소 루트 — 패키지에서는 resources\), POWERSHELL_EXE
//   - 안전 JSON 파일 IO: readJsonFile / writeJsonFile — 부재·손상 시 크래시 없이 강등
//     (아키텍처 원칙 5 준용)
//   - 앱 페이지 식별: windowAppKind / appWindows — 로드 URL 기준 (창 생성 코드와 결합도
//     없음). 단일 창 탭 모드의 앱 WebContentsView 를 webContents 단위로 잡는다 —
//     호출측은 .webContents 만 쓴다.
//   - IPC 방어: assertTrustedSender — 우리 앱 창(file://)의 요청만 허용
//   - 자식 프로세스 환경 정돈: cleanChildEnv — 부모 환경 오염 방어
//   - 회전 로그: logsDir / logEvent / recentLogLines — userData\logs\ 에 최대 5파일×1MB
//     (개인정보 미포함 — 사건 요약만. 발주 #28④ 진단·크래시 기록)
//
// ※ preload.js 는 이 모듈을 require 하지 않는다 — sandbox preload 에서 쓸 수 있는
//   모듈은 electron 뿐이고, A49③ 정적 검사가 preload 의 require 를
//   electron·path·url 로 제한한다 (preload 쪽 중복은 preload 내부에서만 통합).
//
// A44: 이 파일은 http/https/net/dns/dgram/tls 를 일절 require 하지 않는다.
// ============================================================================

'use strict';

const { app, BrowserWindow, webContents } = require('electron');
const path = require('path');
const fs = require('fs');

/** 저장소 루트 — 개발 트리에서는 저장소 최상위, asar 패키지에서는 resources\ 를 가리킨다. */
const REPO_ROOT = path.resolve(__dirname, '..');

// PATH 섀도잉 차단 — powershell 은 항상 System32 절대 경로 (backup/a39 관례와 동일)
const POWERSHELL_EXE = path.join(
  process.env.SystemRoot || 'C:\\Windows',
  'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'
);

/**
 * JSON 파일 안전 판독 — 부재·손상 시 크래시 없이 null 로 강등한다.
 * @param {string} filePath 절대 경로
 * @returns {*} 파싱된 값, 실패 시 null
 */
function readJsonFile(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (_err) {
    return null;
  }
}

/**
 * JSON 파일 안전 기록 — 상위 폴더를 만들고 보기 좋은 JSON(2칸 들여쓰기)으로 기록한다.
 * 저장 실패는 치명적이지 않다 — 호출측은 메모리 값으로 계속 동작한다.
 * @param {string} filePath 절대 경로
 * @param {*} value JSON 직렬화 가능한 값
 * @returns {boolean} 저장 성공 여부
 */
function writeJsonFile(filePath, value) {
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(value, null, 2), 'utf8');
    return true;
  } catch (_err) {
    return false;
  }
}

/**
 * webContents 가 어느 앱 페이지인지 로드 URL 로 판별한다.
 * @param {Electron.WebContents} wc
 * @returns {'calendar'|'postit'|null}
 */
function wcAppKind(wc) {
  let u = '';
  try { u = String(wc.getURL()).toLowerCase(); } catch (_err) { return null; }
  if (u.endsWith('/calendar.html') || u.endsWith('\\calendar.html')) return 'calendar';
  if (u.endsWith('/postit.html') || u.endsWith('\\postit.html')) return 'postit';
  return null;
}

/**
 * 창(또는 webContents 를 가진 앱 타깃)이 어느 앱인지 로드 URL 로 판별한다
 * (main.js 창 생성과 결합도 없음). BrowserWindow 와 appWindows() 타깃 둘 다 받는다
 * — 판별 기준은 .webContents 의 URL.
 * @param {Electron.BrowserWindow|{webContents: Electron.WebContents}} win
 * @returns {'calendar'|'postit'|null}
 */
function windowAppKind(win) {
  if (!win || !win.webContents) return null;
  return wcAppKind(win.webContents);
}

/**
 * 살아 있는 앱 페이지 타깃 목록 — 각 항목은 { webContents } 형태.
 * 단일 창 탭 모드에서는 앱 WebContentsView 의 webContents 가 잡힌다 —
 * 호출측(backup/migrate)은 .webContents.executeJavaScript 만 쓴다.
 * preferred(BrowserWindow 또는 타깃)를 주면 같은 webContents 항목을 맨 앞으로 정렬한다.
 * (모든 앱 페이지는 같은 file:// 오리진 저장소를 공유한다 — 아무 페이지에서나 읽으면 전체가 보인다.)
 * @param {Electron.BrowserWindow|{webContents: Electron.WebContents}|null} [preferred] 우선 타깃
 * @returns {{webContents: Electron.WebContents}[]}
 */
function appWindows(preferred) {
  const targets = [];
  for (const wc of webContents.getAllWebContents()) {
    try {
      if (!wc.isDestroyed() && wcAppKind(wc)) targets.push({ webContents: wc });
    } catch (_err) { /* 파괴 중인 webContents — 건너뛴다 */ }
  }
  const prefWc = preferred && preferred.webContents ? preferred.webContents : null;
  if (prefWc) {
    targets.sort((a, b) => (a.webContents === prefWc ? -1 : 0) - (b.webContents === prefWc ? -1 : 0));
  }
  return targets;
}

/**
 * IPC 호출자 검증 — 우리 앱 페이지(file://)의 요청만 처리한다. 그 외는 한국어 오류 throw.
 * 허용 호출자: ① 우리 BrowserWindow 소속 webContents(셸 탭바 페이지),
 * ② 앱 WebContentsView(calendar/postit URL) — 둘 다 file:// 필수.
 * @param {Electron.IpcMainInvokeEvent} event
 */
function assertTrustedSender(event) {
  const frameUrl = String((event.senderFrame && event.senderFrame.url) || '');
  const win = BrowserWindow.fromWebContents(event.sender);
  const isAppView = wcAppKind(event.sender) !== null;
  if ((!win && !isAppView) || !frameUrl.startsWith('file://')) {
    throw new Error('허용되지 않은 호출자입니다.');
  }
}

/**
 * 자식 프로세스용 정돈된 환경 — 부모 환경 오염 방어:
 * ELECTRON_RUN_AS_NODE·NODE_OPTIONS 를 제거한 사본을 돌려준다.
 * @returns {NodeJS.ProcessEnv}
 */
function cleanChildEnv() {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.NODE_OPTIONS;
  return env;
}

// ============================================================================
// 회전 로그 (userData\logs\) — 진단·크래시 기록 (발주 #28④)
//
// 왜 필요한가: 지금까지 셸에는 uncaughtException·렌더러 크래시 훅도, 로그 파일도 0건이라
// "흰 화면으로 굳었어요" 티켓에 물어볼 근거가 없었다. 이 로거가 그 근거를 만든다.
//
// 규칙:
//   - 위치는 userData\logs (PETIT_USERDATA 격리 훅을 그대로 따라간다 — 채점 프로필은
//     tmpdir 안에서 자기 로그만 쓴다). 저장소·설치 폴더에는 절대 쓰지 않는다 (A46 산출물
//     블랙리스트 *.log 무영향).
//   - 최대 5파일 × 1MB 회전: petit-shell.log → .1 → … → .4 (가장 오래된 것부터 버린다).
//   - **개인정보 미포함**: 메모 본문·일정 제목은 어떤 경로로도 여기 들어오지 않는다.
//     호출측은 "무슨 일이 일어났는가"만 넘긴다 (한 줄 ≤400자로 잘린다).
//   - 기록 실패는 치명적이지 않다 — 앱 동작에 영향을 주지 않는다 (전부 try/catch).
// ============================================================================

const LOG_FILE_NAME = 'petit-shell.log';
const LOG_MAX_BYTES = 1024 * 1024;   // 1파일 1MB
const LOG_MAX_FILES = 5;             // petit-shell.log + .1 ~ .4
const LOG_LINE_MAX = 400;            // 한 줄 상한 (스택은 앞부분만)
const RECENT_MAX = 20;               // 진단 정보 복사에 쓰는 메모리 링 버퍼

const recentLines = [];

/** 로그 폴더 경로 — app 미준비·경로 조회 실패 시 null (호출측은 조용히 생략) */
function logsDir() {
  try {
    return path.join(app.getPath('userData'), 'logs');
  } catch (_err) {
    return null;
  }
}

/** 한 줄 정돈 — 개행·연속 공백을 접고 길이를 자른다 (파일 한 줄 = 사건 하나) */
function oneLine(value) {
  const s = String(value === undefined || value === null ? '' : value).replace(/\s+/g, ' ').trim();
  return s.length > LOG_LINE_MAX ? s.slice(0, LOG_LINE_MAX) + '…' : s;
}

/** 1MB 초과 시 세대 교체 — .4 삭제 → .3→.4 … → 현재 로그→.1 */
function rotateLogs(file) {
  try {
    const st = fs.statSync(file);
    if (st.size < LOG_MAX_BYTES) return;
  } catch (_err) {
    return; // 파일 없음 = 회전 불요
  }
  for (let i = LOG_MAX_FILES - 1; i >= 1; i--) {
    const from = i === 1 ? file : file + '.' + (i - 1);
    const to = file + '.' + i;
    try {
      if (i === LOG_MAX_FILES - 1) { try { fs.unlinkSync(file + '.' + i); } catch (_e) { /* 없으면 무해 */ } }
      if (fs.existsSync(from)) fs.renameSync(from, to);
    } catch (_err) { /* 회전 실패 — 다음 기록은 그냥 이어 쓴다 */ }
  }
}

/**
 * 사건 한 줄 기록 — 파일(회전) + 메모리 링 버퍼.
 * @param {string} tag 사건 종류 (예: 'uncaughtException', 'renderer-gone')
 * @param {*} message 사람이 읽을 요약 (개인정보 금지 — 호출측 책임)
 * @returns {string} 실제 기록된 줄
 */
function logEvent(tag, message) {
  const line = '[' + new Date().toISOString() + '] [' + oneLine(tag) + '] ' + oneLine(message);
  recentLines.push(line);
  if (recentLines.length > RECENT_MAX) recentLines.shift();
  const dir = logsDir();
  if (dir) {
    try {
      fs.mkdirSync(dir, { recursive: true });
      const file = path.join(dir, LOG_FILE_NAME);
      rotateLogs(file);
      fs.appendFileSync(file, line + '\r\n', 'utf8');
    } catch (_err) { /* 기록 실패는 앱 무영향 */ }
  }
  return line;
}

/**
 * 최근 기록 줄 — 진단 정보 복사에 붙인다 (개인정보 미포함, 최신 것부터 n개).
 * @param {number} [n]
 * @returns {string[]}
 */
function recentLogLines(n) {
  const count = Number.isFinite(n) && n > 0 ? Math.min(n, RECENT_MAX) : RECENT_MAX;
  return recentLines.slice(-count);
}

module.exports = {
  REPO_ROOT,
  POWERSHELL_EXE,
  readJsonFile,
  writeJsonFile,
  windowAppKind,
  appWindows,
  assertTrustedSender,
  cleanChildEnv,
  logsDir,
  logEvent,
  recentLogLines,
};
