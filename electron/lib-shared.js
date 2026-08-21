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
//
// ※ preload.js 는 이 모듈을 require 하지 않는다 — sandbox preload 에서 쓸 수 있는
//   모듈은 electron 뿐이고, A49③ 정적 검사가 preload 의 require 를
//   electron·path·url 로 제한한다 (preload 쪽 중복은 preload 내부에서만 통합).
//
// A44: 이 파일은 http/https/net/dns/dgram/tls 를 일절 require 하지 않는다.
// ============================================================================

'use strict';

const { BrowserWindow, webContents } = require('electron');
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

module.exports = {
  REPO_ROOT,
  POWERSHELL_EXE,
  readJsonFile,
  writeJsonFile,
  windowAppKind,
  appWindows,
  assertTrustedSender,
  cleanChildEnv,
};
