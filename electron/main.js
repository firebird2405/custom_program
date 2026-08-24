// ============================================================================
// 쁘띠캘린더 — Electron 셸 (main 프로세스)
//
// 계약 (protocol/SCORECARD.md rev.8):
//   A42 — 단일 창 탭 모드(유일한 모드): BrowserWindow 는 언제나 정확히 1개
//         (제목 "쁘띠캘린더"). 그 창 안에 탭바(tabbar.html, 창의 기본 페이지) +
//         두 앱 WebContentsView(calendar·postit)를 모두 생성·로드해 유지하고,
//         탭 전환은 z순서 재배치만 한다(리로드 금지 — webContents 유지 = 작성 상태 보존).
//         셸 설정(기본 탭)은 userData\shell-settings.json 에 영속.
//         저장소 원본 calendar.html·postit.html 은 바이트 동일하게 loadFile —
//         빌드 변형·주입 금지 (주입이 필요하면 preload로만).
//         ※ 창 분리(2창 구성)는 rev.8 에서 폐지됐다 — 어떤 경로로도 창을 늘리지 않는다.
//   A44 — 외부 네트워크 요청 0. 이 파일은 http/https/net/dns/dgram/tls 를
//         일절 require하지 않는다. 텔레메트리·autoUpdater 금지.
//   A49 — 렌더러 격리: contextIsolation·sandbox 활성, nodeIntegration·webview 비활성,
//         setWindowOpenHandler deny-all, will-navigate 외부 차단 — 창·뷰·탭바 전부.
//
// 채점 격리 훅: 환경변수 PETIT_USERDATA가 설정되면 해당 경로를 userData로 사용
// (채점기가 fresh 프로필로 격리 기동할 수 있게 하는 계약).
//
// A43 배선: preload.js(브리지·셸 UI) + migrate.js(마이그레이션 엔진·IPC 종단) —
// 소스 프로필 인자는 --source-cal=/--source-postit= 또는 PETIT_SOURCE_CAL/POSTIT env.
// 공용 유틸(경로·안전 JSON IO·앱 페이지 식별·IPC 방어·회전 로그)은 lib-shared.js 가 단일 정의처다.
//
// 운영 장비 (발주 #28·#30·#31 — 전부 로컬 처리, 외부 전송 0):
//   - 버전 정본 = app.getVersion() (electron\package.json). 셸 표기는 이 값만 쓴다.
//   - 진단: 'petit:shell:info' / ':copy-diagnostics' — 버전·런타임·OS·화면·경로·저장
//     사용량·최근 로그 5줄. **메모·일정 본문은 어떤 필드에도 담지 않는다.**
//   - 로그: userData\logs\petit-shell.log (5파일×1MB 회전) + uncaughtException·
//     unhandledRejection·render-process-gone·unresponsive 훅, [로그 폴더 열기].
//   - 항상 위: shell-settings.json 의 additive 필드 alwaysOnTop (기본 꺼짐, 재기동 유지).
//   - 보드 자랑하기: 활성 앱 뷰만 capturePage → 클립보드 복사 / PNG 저장 (탭바 미포함).
//
// 발주 #33 (셸 몫 — 전부 로컬 처리, 외부 전송 0):
//   ① 트레이 상주 + 닫기 1회 선택 — shell-settings.json additive 필드 closeToTray·
//      closeAskAck (부재=false=현행 X=종료). 트레이로 내릴 때는 hide 만 한다 (destroy 금지 —
//      렌더러 타이머·알림 폴링 유지). app.quit() 경로는 before-quit → isQuitting 플래그로
//      닫기 인터셉트를 우회한다 (Playwright electronApp.close() 정상 종료 계약 — 필수).
//   ② OS 알림 승격 — alarm-relay 수신 시 창이 미표시·최소화·비포커스면 Notification 발화,
//      클릭 = 복귀+캘린더 탭. AppUserModelId 는 electron-builder appId 와 동일 값.
//   ③ 코르크색 즉시 창 — backgroundColor + 생성 직후 show (ready-to-show 대기 폐지),
//      탭바 페이지를 앱 뷰보다 먼저 로드 시작 (콜드 기동 무화면 구간 제거).
// ============================================================================

'use strict';

const { app, BrowserWindow, WebContentsView, screen, ipcMain, shell, dialog, clipboard, Tray, Menu, nativeImage, Notification } = require('electron');
const path = require('path');
const os = require('os');
const fs = require('fs');
const {
  REPO_ROOT,
  readJsonFile,
  writeJsonFile,
  windowAppKind,
  assertTrustedSender,
  logsDir,
  logEvent,
  recentLogLines,
} = require('./lib-shared');
const { registerMigrateIpc } = require('./migrate');
const { registerBackupIpc, startBackupScheduler, effectiveBackupFolder } = require('./backup');

// ── userData 오버라이드 훅 (app ready 이전에 확정해야 한다) ─────────────────
if (process.env.PETIT_USERDATA) {
  app.setPath('userData', path.resolve(process.env.PETIT_USERDATA));
}

// ── 단일 인스턴스 잠금 — 두 번째 실행은 기존 창을 앞으로 가져오고 종료 ──────
// (창은 항상 1개뿐이므로 그 창을 복원·전면화한다)
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
    }
  });

  main();
}

// ============================================================================
// 창 상태 기억 (셸 구현) — userData의 window-state.json에 bounds 저장·복원.
// 키: 'merged' 하나뿐 (단일 창 — 이름은 기존 저장 파일 호환을 위해 유지한다).
// 예전 버전이 남긴 'calendar'·'postit' 키는 더 이상 읽지도 쓰지도 않는다 — 있어도 무해.
// 앱 내부(HTML)의 resizeTo 기반 모듈은 try/catch로 감싸져 있어 공존 무해.
// ============================================================================

function stateFilePath() {
  return path.join(app.getPath('userData'), 'window-state.json');
}

// 저장 파일을 읽는다 — 손상되어 있어도 크래시 없이 기본값으로 강등 (아키텍처 원칙 5 준용)
function loadWindowState() {
  const data = readJsonFile(stateFilePath());
  return data && typeof data === 'object' ? data : {};
}

// 저장 실패는 치명적이지 않다 — 다음 실행은 기본 크기로 열린다.
function saveWindowState(state) {
  writeJsonFile(stateFilePath(), state);
}

// 저장된 bounds가 유효한 숫자이고 현재 어느 디스플레이와든 겹치는지 검증.
// 모니터 구성이 바뀌어 화면 밖으로 나간 창은 기본 위치로 되돌린다.
function sanitizeBounds(saved) {
  if (!saved || typeof saved !== 'object') return null;
  const { x, y, width, height } = saved;
  if (![x, y, width, height].every((n) => Number.isFinite(n))) return null;
  if (width < 320 || height < 240) return null;
  const visible = screen.getAllDisplays().some((d) => {
    const a = d.workArea;
    return (
      x < a.x + a.width - 40 &&
      x + width > a.x + 40 &&
      y < a.y + a.height - 40 &&
      y + height > a.y + 40
    );
  });
  return visible ? { x, y, width, height } : null;
}

// ============================================================================
// 셸 설정 — userData\shell-settings.json { defaultTab }
// 손상·부재 시 크래시 없이 기본값(postit)으로 강등 (아키텍처 원칙 5 준용).
// 예전 버전이 남긴 windowMode 필드는 읽지 않는다 (창 분리 폐지 — rev.8).
// ============================================================================

// alwaysOnTop: additive 필드 (발주 #30) — 부재 = false = 현행 동작(끄기). 재기동 시 복원.
// closeToTray: additive 필드 (발주 #33 ①) — 부재 = false = 현행 동작(X = 종료).
// closeAskAck: additive 필드 (발주 #33 ①) — 닫기 1회 선택 카드에 답했는가 (부재 = 아직).
const SHELL_SETTINGS_DEFAULTS = { defaultTab: 'postit', alwaysOnTop: false, closeToTray: false, closeAskAck: false };

function shellSettingsPath() {
  return path.join(app.getPath('userData'), 'shell-settings.json');
}

function loadShellSettings() {
  const raw = readJsonFile(shellSettingsPath());
  const s = { ...SHELL_SETTINGS_DEFAULTS };
  if (raw && typeof raw === 'object') {
    if (raw.defaultTab === 'postit' || raw.defaultTab === 'calendar') s.defaultTab = raw.defaultTab;
    s.alwaysOnTop = raw.alwaysOnTop === true; // 부재·비불리언 = 기본값(꺼짐)
    s.closeToTray = raw.closeToTray === true; // 부재·비불리언 = 기본값(X = 종료, 발주 #33)
    s.closeAskAck = raw.closeAskAck === true; // 부재·비불리언 = 기본값(아직 안 물음)
  }
  return s;
}

function saveShellSettings(settings) {
  writeJsonFile(shellSettingsPath(), settings);
}

// ============================================================================
// 시작 프로그램 — 윈도우 시작 시 자동 실행
// 단일 진실은 OS 다: Electron 의 app.setLoginItemSettings/getLoginItemSettings 가
// HKCU\…\Run 항목을 대신 관리한다. 셸은 이 상태를 파일에 이중 저장하지 않고,
// UI 초기값·동기화는 언제나 OS 실측값으로만 만든다.
// 등록되는 실행 파일은 process.execPath — 패키지에서는 앱 exe, 개발 트리
// (electron .)에서는 electron.exe 가 잡힌다(개발 기동의 정상 동작).
// 외부 프로세스(PowerShell·.lnk 조작) 실행 0건 — 내장 API 만 쓴다.
// ============================================================================

/** 현재 OS 상태 — API 실패 시에도 크래시 없이 "꺼짐"으로 강등 */
function getOpenAtLogin() {
  try {
    const s = app.getLoginItemSettings();
    return !!(s && s.openAtLogin);
  } catch (_err) {
    return false;
  }
}

/**
 * 자동 실행을 켜고 끈다 — 적용 뒤 OS 값을 다시 읽어 실제 반영 여부를 돌려준다.
 * (쓰기가 조용히 실패해도 호출측이 실패를 판정할 수 있게 하는 재판독 계약)
 * @param {boolean} on
 * @returns {boolean} 적용 후 실제 OS 상태
 */
function setOpenAtLogin(on) {
  try {
    app.setLoginItemSettings({ openAtLogin: on === true });
  } catch (_err) { /* 아래 재판독이 실패로 판정한다 */ }
  return getOpenAtLogin();
}

// ============================================================================
// 셸 런타임 상태 (main 프로세스 단일 정의처)
// ============================================================================

const runtime = {
  settings: null,        // 저장된 셸 설정 (defaultTab)
  state: null,           // window-state.json 전체 (참조 공유)
  win: null,             // 단 하나의 BrowserWindow (탭바 페이지 소유)
  views: null,           // { calendar, postit } WebContentsView
  layoutViews: null,     // 뷰 배치 함수 (드로어 개폐·리사이즈 시 재호출)
  activeTab: 'postit',   // 활성 탭
  drawerOpen: false,     // 탭바 설정 드로어 개폐 (열리면 앱 뷰를 아래로 밀어 공간 확보)
  pendingAlarms: 0,      // 캘린더가 백그라운드 탭일 때 쌓인 일정 알림 건수 (탭바 배지)
  lastAlarmText: '',     // 마지막 알림 텍스트 (탭바 미니 알림 스트립 표시용, ≤200자)
  tray: null,            // 트레이 아이콘 (발주 #33 ① — 기동 시 항상 생성, GC 방지 참조)
  isQuitting: false,     // 종료 경로 표식 — before-quit 에서 세워 닫기 인터셉트를 우회한다
  closeAskPending: false // 닫기 1회 선택 카드가 떠 있는 동안 true (X 재클릭 = 그냥 종료)
};

// ============================================================================
// 창 생성 공통부
// ============================================================================

// 이동·리사이즈 연타를 묶어 저장하는 디바운스 간격 (창 상태 기억 전용 — 앱 데이터 무관)
const WINDOW_STATE_SAVE_DEBOUNCE_MS = 400;

// 탭바 고정 높이(px) — tabbar.html 의 header 높이와 동기 유지 (수동 관리)
const TABBAR_HEIGHT = 40;

// 설정 드로어 높이(px) — tabbar.html 의 [data-shell-settings] 높이와 동기 유지.
// 드로어가 열리면 앱 뷰를 이만큼 아래로 밀어, 창의 기본 페이지(탭바)에 그린
// 드로어가 뷰에 가려지지 않게 한다 (뷰는 항상 기본 페이지 위에 그려진다).
// 발주 #33 으로 [닫기](트레이) 행이 늘어 186px → 216px.
const SETTINGS_DRAWER_HEIGHT = 216;

// 즉시 표시 배경 (발주 #33 ③) — 포스트잇 보드의 코르크 톤 (tabbar.html --cork 와 동일 계열).
// 창·앱 뷰의 첫 페인트 전 배경으로 써서 콜드 기동의 흰 플래시·무화면 구간을 없앤다.
const CORK_BG = '#B08968';

// A49 ② 정적 검사 대상 — 아래 보안 기본선은 절대 완화 금지.
// preload: A49③ 화이트리스트 브리지(window.petit) + 셸 전용 UI 레이어(A43 카드·A47 온보딩).
// 원본 HTML 은 무변형(A42) — 셸 UI 주입은 오직 preload 로만 한다.
const SECURE_WEB_PREFERENCES = {
  contextIsolation: true,
  nodeIntegration: false,
  sandbox: true,
  webviewTag: false,
  // 스펠체커 비활성 — 활성 시 Chromium이 구글 CDN에서 사전(ko-*.bdic)을 내려받아
  // A44(런타임 외부 요청 0) 위반. 메모 앱 특성상 맞춤법 밑줄도 불필요.
  spellcheck: false,
  preload: path.join(__dirname, 'preload.js')
};

/** A49: 새 창 열기 전면 거부 + 현재 문서 밖 항해 차단 — 모든 창·뷰·탭바 공통 적용 */
function hardenWebContents(wc) {
  wc.setWindowOpenHandler(() => ({ action: 'deny' }));
  wc.on('will-navigate', (event, url) => {
    if (url !== wc.getURL()) event.preventDefault();
  });
}

// ============================================================================
// 크래시·먹통 기록 (발주 #28④) — userData\logs\ 회전 로그 (lib-shared)
//
// 지금까지는 렌더러가 흰 화면으로 굳어도 남는 근거가 0이었다(uncaughtException·
// render-process-gone·로그 파일 전부 0건). 사용자에게 "무슨 일이 있었나요"를 물어볼
// 수단이 없으니 티켓이 진단으로 이어지지 않는다. 아래 훅이 그 근거를 만든다.
// 기록 내용은 사건 요약뿐 — 메모·일정 본문은 어떤 경로로도 들어가지 않는다.
// ============================================================================

/** 렌더러 크래시·응답 없음 로그 (+ 앱 페이지는 1회 자동 재로드로 복구 시도) */
function wireCrashLogging(wc, label, autoReload) {
  let reloaded = 0;
  wc.on('render-process-gone', (_event, details) => {
    const reason = (details && details.reason) || 'unknown';
    const code = details && Number.isFinite(details.exitCode) ? details.exitCode : '?';
    logEvent('renderer-gone', label + ' 렌더러 종료 — reason=' + reason + ', exitCode=' + code);
    // 복구 1회 한정: 크래시 → 재로드 → 또 크래시 무한루프를 만들지 않는다.
    if (autoReload && reason !== 'clean-exit' && reloaded < 1) {
      reloaded += 1;
      logEvent('renderer-reload', label + ' 화면을 다시 불러옵니다 (자동 복구 1회)');
      // 이벤트 핸들러 안에서 곧바로 reload 하지 않는다 — 크래시 처리 중인 webContents 를
      // 같은 틱에 다시 띄우면 Chromium 이 브라우저 프로세스째 죽는다(실측: exit 0x80000003).
      setTimeout(() => {
        if (wc.isDestroyed()) return;
        try { wc.reload(); } catch (err) { logEvent('renderer-reload-fail', String((err && err.message) || err)); }
      }, 300);
    }
  });
  wc.on('unresponsive', () => logEvent('unresponsive', label + ' 응답 없음 (사용자 대기 중)'));
  wc.on('responsive', () => logEvent('responsive', label + ' 응답 회복'));
}

/** main 프로세스 수준 예외 — 은폐하지 않고 기록한다 (콘솔 출력도 유지) */
function wireProcessLogging() {
  process.on('uncaughtException', (err) => {
    const msg = String((err && err.stack) || (err && err.message) || err);
    logEvent('uncaughtException', msg);
    console.error('[쁘띠캘린더] 처리되지 않은 예외:', msg);
  });
  process.on('unhandledRejection', (reason) => {
    const msg = String((reason && reason.stack) || (reason && reason.message) || reason);
    logEvent('unhandledRejection', msg);
    console.error('[쁘띠캘린더] 처리되지 않은 거부:', msg);
  });
  app.on('child-process-gone', (_event, details) => {
    logEvent('child-process-gone',
      '자식 프로세스 종료 — type=' + ((details && details.type) || '?') + ', reason=' + ((details && details.reason) || '?'));
  });
}

// ============================================================================
// 항상 위 (발주 #30) — 이 장르에서 가장 많이 요구되는 단일 행동.
// 상태는 shell-settings.json 의 additive 필드 alwaysOnTop (기본 꺼짐)에 영속된다.
// ============================================================================

/** 창에 항상 위를 적용 — 실패해도 크래시 없이 현재 실측값을 돌려준다 */
function applyAlwaysOnTop(win, on) {
  if (!win || win.isDestroyed()) return false;
  try {
    // 'floating' 레벨: 다른 앱 위에는 뜨되 전체화면 게임·시스템 UI 를 가리지 않는 무난한 층
    win.setAlwaysOnTop(on === true, 'floating');
  } catch (err) {
    logEvent('always-on-top', '적용 실패: ' + String((err && err.message) || err));
  }
  try {
    return win.isAlwaysOnTop() === true;
  } catch (_err) {
    return on === true;
  }
}

// ============================================================================
// 트레이 상주 + OS 알림 (발주 #33 ①②)
// 앱이 보이지 않는 동안(트레이·최소화·비포커스)에도 사용자에게 닿는 유일한 경로.
// Tray·Notification 은 로컬 OS UI 다 — 네트워크 요청 0 유지 (A44 무영향).
// 트레이는 기동 시 항상 생성한다 (closeToTray 설정과 무관 — [열기]·[항상 위]·[완전 종료]).
// ============================================================================

/** 트레이/알림/두 번째 실행에서 창 복귀 — 숨김·최소화 어느 상태에서도 show+focus */
function showFromTray() {
  const win = runtime.win;
  if (!win || win.isDestroyed()) return;
  try {
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  } catch (_err) { /* 파괴 경합 — 무해 */ }
}

/** 창을 트레이로 내린다 — hide 만 한다 (destroy 금지: 렌더러 타이머·알림 폴링 유지가 목적) */
function hideToTray() {
  const win = runtime.win;
  if (!win || win.isDestroyed()) return;
  try { win.hide(); } catch (_err) { /* 무해 */ }
}

/** 활성 앱 뷰의 webContents — 없으면 아무 앱 뷰라도 (닫기 1회 선택 카드 전달용) */
function activeViewWebContents() {
  if (!runtime.views) return null;
  const order = [runtime.activeTab, 'postit', 'calendar'];
  for (const key of order) {
    const view = runtime.views[key];
    if (view && view.webContents && !view.webContents.isDestroyed()) return view.webContents;
  }
  return null;
}

/**
 * 트레이 아이콘 이미지 — 개발 트리는 electron\build\icon.png (buildResources — 패키지
 * asar 에는 실리지 않는다). 부재 시 null 을 돌려주고 호출측이 exe 아이콘으로 폴백한다.
 */
function trayIconImage() {
  try {
    const devIcon = path.join(__dirname, 'build', 'icon.png');
    if (fs.existsSync(devIcon)) {
      const img = nativeImage.createFromPath(devIcon);
      if (img && !img.isEmpty()) return img;
    }
  } catch (_err) { /* 아래 폴백 */ }
  return null;
}

/** 트레이 생성 (기동 시 1회) — 아이콘 실패 시 트레이 없이 계속 (앱 무영향, 로그만) */
async function createTray() {
  if (runtime.tray) return;
  let icon = trayIconImage();
  if (!icon) {
    // 패키지(NSIS·포터블·MSIX)는 exe 자체에 아이콘이 박혀 있다 — OS 에서 그대로 가져온다
    try {
      icon = await app.getFileIcon(process.execPath, { size: 'normal' });
    } catch (_err) { icon = null; }
  }
  if (!icon || icon.isEmpty()) {
    logEvent('tray', '트레이 아이콘을 준비하지 못해 트레이 없이 계속합니다');
    return;
  }
  try {
    const tray = new Tray(icon);
    tray.setToolTip('쁘띠캘린더');
    tray.on('double-click', showFromTray);
    runtime.tray = tray;
    refreshTrayMenu();
  } catch (err) {
    logEvent('tray', '트레이 생성 실패: ' + String((err && err.message) || err));
  }
}

/** 트레이 컨텍스트 메뉴 재구성 — 항상 위 체크 상태(창 실측값)를 반영한다 */
function refreshTrayMenu() {
  if (!runtime.tray) return;
  let aot = false;
  try {
    aot = !!(runtime.win && !runtime.win.isDestroyed() && runtime.win.isAlwaysOnTop());
  } catch (_err) { aot = false; }
  try {
    runtime.tray.setContextMenu(Menu.buildFromTemplate([
      { label: '열기', click: () => showFromTray() },
      {
        label: '항상 위에 두기',
        type: 'checkbox',
        checked: aot,
        click: (item) => {
          // 탭바 드로어·앱 설정과 같은 적용 경로: 실측 성공 시에만 설정 영속 (발주 #30 관용구)
          const want = item.checked === true;
          const actual = applyAlwaysOnTop(runtime.win, want);
          if (actual === want && runtime.settings) {
            runtime.settings.alwaysOnTop = want;
            saveShellSettings(runtime.settings);
          }
          pushShellUi(); // 모든 표면 동기 (트레이 메뉴 자체도 재구성된다)
        }
      },
      { type: 'separator' },
      {
        label: '완전 종료',
        click: () => {
          runtime.isQuitting = true; // 닫기 인터셉트 우회 — 트레이의 종료는 언제나 진짜 종료
          try { app.quit(); } catch (_err) { /* 이미 종료 중 — 무해 */ }
        }
      }
    ]));
  } catch (err) {
    logEvent('tray', '트레이 메뉴 구성 실패: ' + String((err && err.message) || err));
  }
}

/**
 * 일정 알림의 OS 알림 승격 (발주 #33 ②) — 창이 사용자에게 보이지 않을 때만 호출된다.
 * 클릭 = 창 복귀 + 캘린더 탭 활성. 미지원 환경(Notification.isSupported false)은 조용히 스킵.
 * 알림 본문(일정 텍스트)은 OS 알림에만 실리고 로그에는 절대 남기지 않는다 (개인정보 원칙).
 */
function fireAlarmNotification(text) {
  try {
    if (typeof Notification !== 'function' || !Notification.isSupported()) return false;
    const n = new Notification({
      title: '쁘띠캘린더',
      body: typeof text === 'string' && text.trim() !== '' ? text : '일정 알림이 도착했어요.'
    });
    n.on('click', () => {
      showFromTray();
      setActiveTab('calendar');
    });
    n.show();
    return true;
  } catch (err) {
    logEvent('notify-fail', 'OS 알림 표시 실패: ' + String((err && err.message) || err));
    return false;
  }
}

// ============================================================================
// 진단 정보 (발주 #28①②) — 버전 정본은 electron\package.json 하나뿐이다.
// app.getVersion() 이 그 값을 그대로 돌려주고, 셸 UI 는 이 값만 표기한다
// (preload 의 수동 관리 상수·앱 HTML 의 rev 표기 같은 두 번째 정본을 만들지 않는다).
// ============================================================================

// 문의처 정본 — PRIVACY.md §6 과 동일한 주소 하나로 앱·방침·스토어 3곳을 통일한다
// (감사 잔여 조건 ① — 자리표시자 {CONTACT} 가 설정창에 리터럴로 렌더되던 문제 해소).
// 주소를 바꿀 일이 생기면 여기 한 곳 + PRIVACY.md + store-description.md 를 함께 바꾼다.
const CONTACT_PLACEHOLDER = 'uto2405@gmail.com';

/** 배포 형태 추정 — 티켓에서 "어느 판을 쓰세요?"를 다시 묻지 않기 위한 한 줄 */
function distributionKind() {
  try {
    if (!app.isPackaged) return '개발 트리 (electron .)';
    if (process.windowsStore === true) return 'MSIX (Microsoft Store)';
    const exe = String(process.execPath || '');
    if (/[\\/]WindowsApps[\\/]/i.test(exe)) return 'MSIX (Microsoft Store)';
    if (/[\\/]Programs[\\/]/i.test(exe)) return 'NSIS 설치본';
    return '포터블/기타';
  } catch (_err) {
    return '알 수 없음';
  }
}

/**
 * 저장 사용량 — 앱 페이지에서 localStorage 총 바이트·키 개수만 센다.
 * **키 이름도 값도 가져오지 않는다** (메모 본문 유출 차단 — 발주 #28② 필수 조건).
 * @returns {Promise<{bytes:number, keys:number}|null>}
 */
async function storageUsage() {
  const order = [runtime.activeTab, 'postit', 'calendar'];
  for (const key of order) {
    const view = runtime.views ? runtime.views[key] : null;
    if (!view || !view.webContents || view.webContents.isDestroyed()) continue;
    try {
      const r = await view.webContents.executeJavaScript(
        '(function(){try{var n=0,c=0;for(var i=0;i<localStorage.length;i++){' +
        'var k=localStorage.key(i);var v=localStorage.getItem(k);' +
        'n+=(k?k.length:0)+(v?v.length:0);c++;}' +
        'return {bytes:n*2,keys:c};}catch(e){return null;}})()',
        true
      );
      if (r && Number.isFinite(r.bytes)) return { bytes: r.bytes, keys: r.keys || 0 };
    } catch (_err) { /* 평가 실패 — 다음 뷰로 */ }
  }
  return null;
}

function formatBytes(n) {
  if (!Number.isFinite(n) || n < 0) return '알 수 없음';
  if (n < 1024) return n + 'B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + 'KB';
  return (n / (1024 * 1024)).toFixed(2) + 'MB';
}

/** 진단 정보 원본(구조체) — UI 표기와 클립보드 텍스트가 같은 값을 쓴다 */
async function diagnosticsInfo() {
  const displays = screen.getAllDisplays().map((d) => {
    const b = d.bounds || {};
    return b.width + '×' + b.height + '@' + (d.scaleFactor || 1) + 'x';
  });
  const usage = await storageUsage();
  let backupFolder = '(알 수 없음)';
  try { backupFolder = effectiveBackupFolder(); } catch (_err) { /* 조회 실패 — 표기만 생략 */ }
  return {
    ok: true,
    name: app.getName(),
    version: app.getVersion(),                       // 정본 = electron\package.json
    distribution: distributionKind(),
    electron: process.versions.electron || '?',
    chrome: process.versions.chrome || '?',
    node: process.versions.node || '?',
    os: os.platform() + ' ' + os.release() + ' (' + os.arch() + ')',
    displays,
    userData: app.getPath('userData'),
    logs: logsDir() || '(사용 불가)',
    backupFolder,
    storage: usage ? { bytes: usage.bytes, keys: usage.keys, text: formatBytes(usage.bytes) } : null,
    recent: recentLogLines(5),
    contact: CONTACT_PLACEHOLDER
  };
}

/** 진단 정보 텍스트 — 클립보드로 나가는 최종 문자열 (개인 메모 내용 0) */
function diagnosticsText(info) {
  const lines = [
    '쁘띠캘린더 진단 정보',
    '- 앱 버전: ' + info.version + ' (' + info.distribution + ')',
    '- 런타임: Electron ' + info.electron + ' · Chromium ' + info.chrome + ' · Node ' + info.node,
    '- 운영체제: ' + info.os,
    '- 화면: ' + (info.displays.length ? info.displays.join(', ') + ' (' + info.displays.length + '대)' : '알 수 없음'),
    '- 데이터 폴더: ' + info.userData,
    '- 백업 폴더: ' + info.backupFolder,
    '- 로그 폴더: ' + info.logs,
    '- 저장 사용량: ' + (info.storage ? info.storage.text + ' (키 ' + info.storage.keys + '개)' : '알 수 없음')
  ];
  lines.push('- 최근 기록: ' + (info.recent.length ? '' : '없음'));
  for (const line of info.recent) lines.push('    ' + line);
  lines.push('- 문의: ' + info.contact);
  lines.push('※ 메모·일정 내용은 이 진단 정보에 포함되지 않아요.');
  return lines.join('\r\n');
}

// ============================================================================
// 보드 자랑하기 (발주 #31) — 지금 보고 있는 앱 뷰만 그림으로 담는다.
// capturePage 대상이 앱 WebContentsView 하나뿐이라 탭바·설정 드로어는 애초에 프레임에
// 들어오지 않는다 (창 전체 캡처가 아니다). 처리는 전부 로컬 — 외부 전송 0 (A44 무영향).
// ============================================================================

function pad2(v) { return v < 10 ? '0' + v : '' + v; }

/** 파일명 타임스탬프 — YYYYMMDD-HHMMSS */
function captureStamp(d) {
  return '' + d.getFullYear() + pad2(d.getMonth() + 1) + pad2(d.getDate()) +
    '-' + pad2(d.getHours()) + pad2(d.getMinutes()) + pad2(d.getSeconds());
}

/** 저장 대화상자의 첫 위치 — 사진 폴더 → 문서 폴더 순 */
function pictureDir() {
  for (const key of ['pictures', 'documents']) {
    try { return app.getPath(key); } catch (_err) { /* 다음 후보 */ }
  }
  return app.getPath('userData');
}

/**
 * 활성 탭의 화면을 PNG 로 담아 클립보드에 넣거나 파일로 저장한다.
 * @param {'clipboard'|'file'} mode
 */
async function captureBoard(mode) {
  const view = runtime.views ? runtime.views[runtime.activeTab] : null;
  if (!view || !view.webContents || view.webContents.isDestroyed()) {
    return { ok: false, reason: '지금은 보드를 담을 수 없어요.' };
  }
  let image = null;
  try {
    image = await view.webContents.capturePage();
  } catch (err) {
    logEvent('capture-fail', String((err && err.message) || err));
    return { ok: false, reason: '보드를 그림으로 담지 못했어요.' };
  }
  if (!image || image.isEmpty()) {
    return { ok: false, reason: '보드를 그림으로 담지 못했어요 (빈 화면).' };
  }
  const size = image.getSize();
  if (mode === 'file') {
    const name = '쁘띠캘린더-보드-' + captureStamp(new Date()) + '.png';
    let res;
    try {
      res = await dialog.showSaveDialog(runtime.win, {
        title: '보드를 그림으로 저장',
        defaultPath: path.join(pictureDir(), name),
        buttonLabel: '저장',
        filters: [{ name: 'PNG 이미지', extensions: ['png'] }]
      });
    } catch (err) {
      logEvent('capture-fail', '저장 대화상자 실패: ' + String((err && err.message) || err));
      return { ok: false, reason: '저장 창을 열지 못했어요.' };
    }
    if (!res || res.canceled || !res.filePath) return { ok: true, canceled: true };
    try {
      fs.writeFileSync(res.filePath, image.toPNG());
    } catch (err) {
      logEvent('capture-fail', '파일 저장 실패: ' + String((err && err.code) || err));
      return { ok: false, reason: '그림을 저장하지 못했어요: ' + String((err && err.message) || err).slice(0, 160) };
    }
    return { ok: true, file: res.filePath, width: size.width, height: size.height };
  }
  try {
    clipboard.writeImage(image);
  } catch (err) {
    logEvent('capture-fail', '클립보드 복사 실패: ' + String((err && err.message) || err));
    return { ok: false, reason: '클립보드에 복사하지 못했어요.' };
  }
  return { ok: true, copied: true, width: size.width, height: size.height };
}

/**
 * 첫 실행(저장 상태 없음) 기본 배치 — 작업영역이 가장 큰 디스플레이의 중앙에 명시 배치.
 * Electron 기본 캐스케이드가 창을 화면 아래로 밀어 OS가 높이를 줄이는 문제
 * (A42 기본 크기 미달)를 피하고, 주 화면이 작은 노트북(예: 1280×680@150%)에서도
 * 계약 기본 크기 ≥1024×700 을 담을 수 있는 화면을 고른다.
 * @param {{width:number,height:number}} defaults 기본 크기
 */
function freshBounds(defaults) {
  const wa = screen.getAllDisplays().reduce((best, d) =>
    (d.workArea.width * d.workArea.height > best.workArea.width * best.workArea.height ? d : best)
  ).workArea;
  const w = Math.min(defaults.width, wa.width - 24);
  const h = Math.min(defaults.height, wa.height - 12);
  const y = wa.y + Math.max(6, Math.floor((wa.height - h) / 2) - 8);
  const x = wa.x + Math.max(12, Math.floor((wa.width - w) / 2));
  return { width: w, height: h, x, y };
}

/** 창 상태 기억 배선: 이동·리사이즈를 디바운스 저장, 닫을 때 확정 저장 */
function wireWindowStatePersistence(win, state, key) {
  let saveTimer = null;
  const captureBounds = () => {
    if (win.isDestroyed()) return;
    state[key] = { ...win.getNormalBounds(), maximized: win.isMaximized() };
  };
  const scheduleSave = () => {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      captureBounds();
      saveWindowState(state);
    }, WINDOW_STATE_SAVE_DEBOUNCE_MS);
  };
  win.on('resize', scheduleSave);
  win.on('move', scheduleSave);
  win.on('close', () => {
    if (saveTimer) clearTimeout(saveTimer);
    captureBounds();
    saveWindowState(state);
  });
}

// ============================================================================
// 단일 창 탭 모드 (유일한 창 구성) — BrowserWindow 1개:
// 탭바(기본 페이지) + 앱 WebContentsView 2개
//
// 두 앱 뷰는 시작 시 모두 생성·로드하고 이후 유지한다. 탭 전환은 contentView 의
// z순서 재배치(addChildView 재호출 = 맨 위로)뿐이다 — 리로드 금지 = 작성 상태 보존
// 계약(A42). 두 뷰 모두 항상 같은 bounds 로 attach 상태를 유지하므로(가려짐만 다름)
// 백그라운드 탭의 타이머·저장 경로도 계속 돈다.
// ============================================================================

/** 활성 탭 전환 — 해당 뷰를 z순서 맨 위로 (이미 자식이면 재정렬만) */
function setActiveTab(tab) {
  const win = runtime.win;
  if (!win || win.isDestroyed() || !runtime.views || !runtime.views[tab]) return false;
  runtime.activeTab = tab;
  win.contentView.addChildView(runtime.views[tab]);
  if (tab === 'calendar' && runtime.pendingAlarms > 0) {
    // 캘린더 탭이 전면으로 왔다 — 쌓인 알림 배지를 비운다 (사용자가 알림을 확인한 시점)
    runtime.pendingAlarms = 0;
    runtime.lastAlarmText = '';
  }
  pushShellUi();
  return true;
}

/**
 * 셸 상태를 탭바 + 두 앱 뷰에 밀어 넣는다 — 요청 없이 바뀐 상태(단축키 탭 전환, 알림
 * 배지, 시작 프로그램 토글)를 모든 표면이 즉시 따라가게 한다. 어느 쪽에서 자동 실행을
 * 바꿔도 반대쪽 UI 가 같은 값으로 갱신된다 (실패 시 실제 OS 값으로 되돌림 포함).
 */
function pushShellUi() {
  const payload = shellStatePayload();
  const targets = [];
  const win = runtime.win;
  if (win && !win.isDestroyed()) targets.push(win.webContents);
  if (runtime.views) {
    for (const key of ['calendar', 'postit']) {
      const view = runtime.views[key];
      if (view && view.webContents && !view.webContents.isDestroyed()) targets.push(view.webContents);
    }
  }
  for (const wc of targets) {
    try { wc.send('petit:shell:ui-push', payload); } catch (_err) { /* 로드 전/파괴 중 — 무해 (각 표면이 초기 조회로 동기화) */ }
  }
  refreshTrayMenu(); // 트레이 메뉴의 [항상 위] 체크도 같은 상태를 따라간다 (발주 #33 ①)
}

/** 활성 탭 뷰에 키보드 포커스 — 탭 전환 직후 바로 타이핑할 수 있게 */
function focusActiveView() {
  try {
    if (runtime.views && runtime.views[runtime.activeTab]) {
      runtime.views[runtime.activeTab].webContents.focus();
    }
  } catch (_err) { /* 파괴 중 — 무해 */ }
}

/**
 * 앱의 유일한 창을 만든다 — 탭바(기본 페이지) + 두 앱 뷰.
 * @param {object} state    window-state.json 전체 (bounds 키 'merged' — 저장 파일 호환 유지)
 * @param {{defaultTab:string}} settings 셸 설정
 */
function createShellWindow(state, settings) {
  // 기본 크기 (발주 #29): 1024×740 → 1280×860. 비겹침 수용량이 노트 18장 → 30장대로
  // 늘어 "빈 캔버스 + 좁은 벽" 첫인상을 줄인다. A42 계약(≥1024×700)은 그대로 충족하고,
  // 작업영역보다 크면 freshBounds 가 화면에 맞춰 클램프한다 (작은 노트북 안전).
  const saved = sanitizeBounds(state.merged);
  const fresh = saved ? null : freshBounds({ width: 1280, height: 860 });

  const win = new BrowserWindow({
    width: saved ? saved.width : fresh.width,
    height: saved ? saved.height : fresh.height,
    ...(saved ? { x: saved.x, y: saved.y } : { x: fresh.x, y: fresh.y }),
    minWidth: 480,
    minHeight: 360,
    title: '쁘띠캘린더',
    show: false,
    // 즉시 표시(발주 #33 ③)의 첫 페인트 배경 — 흰 플래시 차단 (코르크 톤)
    backgroundColor: CORK_BG,
    // 탭바 페이지는 보안 기본선 동일 + 전용 preload(셸 탭바 브리지)만 다르다
    webPreferences: { ...SECURE_WEB_PREFERENCES, preload: path.join(__dirname, 'tabbar-preload.js') }
  });

  win.removeMenu(); // Edge 앱 모드와 동일한 무메뉴 창

  // 믹스드 DPI 보정: 배율이 다른 모니터(예: 150% 노트북 + 100% 외장)의 음수 좌표로
  // 생성자 x/y 를 주면 크기가 배율 오염되는 Electron/Chromium 이슈가 있어,
  // 생성 직후 목표 사각형을 한 번 더 확정 적용한다. 저장 bounds 복원 경로도 동일하게
  // 재확정한다 — saved 미보정 시 혼성 DPI(150%+100%)에서 재기동마다 생성자 크기가
  // 1/배율로 오염돼 창이 점점 줄어드는 붕괴가 발생한다(3차 점검 실증).
  win.setBounds(fresh || saved);
  if (state.merged && state.merged.maximized) win.maximize();

  // 항상 위 (발주 #30) — 저장된 설정을 그대로 복원한다 (기본 꺼짐).
  // 다꾸를 해 놓고도 다른 창에 덮여 안 보이는 자기모순을 없애는 한 줄.
  applyAlwaysOnTop(win, settings.alwaysOnTop === true);

  // ── 제목 고정: 탭바 페이지가 document.title 을 바꿔도 셸 제목 유지 ──
  // (주의: preventDefault 로 네이티브 제목 변경을 막는 계약은 BrowserWindow 이벤트 쪽이다.
  //  webContents 의 동명 이벤트는 통지용이라 preventDefault 가 무효.)
  win.on('page-title-updated', (event) => {
    event.preventDefault();
  });

  hardenWebContents(win.webContents);
  wireCrashLogging(win.webContents, '탭바', false); // 탭바는 자동 재로드하지 않는다 (뷰가 붙어 있다)
  wireWindowStatePersistence(win, state, 'merged');

  // ── 닫기 인터셉트 (발주 #33 ①): X = 트레이로 내리기(설정 시) 또는 1회 선택 카드 ──
  // app.quit() 경로(before-quit → runtime.isQuitting)는 절대 가로채지 않는다 —
  // Playwright electronApp.close()·OS 종료·트레이 [완전 종료]가 여기 걸리면
  // 채점 게이트 전체(A42·A43·A44·A45·A47·A49)가 행걸린다.
  win.on('close', (event) => {
    if (runtime.isQuitting) return;                       // 종료 경로 — 인터셉트 우회 (필수)
    const s = runtime.settings || {};
    if (s.closeToTray === true) {
      event.preventDefault();
      hideToTray();
      return;
    }
    if (s.closeAskAck !== true && !runtime.closeAskPending) {
      // 1회 선택 카드 — 활성 앱 뷰 preload 에 요청. 전달이 안 되면 현행대로 종료한다.
      const wc = activeViewWebContents();
      if (wc) {
        let sent = false;
        try {
          wc.send('petit:shell:close-ask', {});
          sent = true;
        } catch (_err) { /* 전달 실패 — 현행 종료 경로로 */ }
        if (sent) {
          event.preventDefault();
          runtime.closeAskPending = true;
          return;
        }
      }
    }
    // closeAskAck 완료(종료 선택 유지) 또는 카드 표시 중 X 재클릭 → 현행 종료 경로
    // (카드를 무시하고 다시 X 를 누른 사용자를 가두지 않는다)
  });

  // ── 즉시 표시 (발주 #33 ③) ──
  // 예전에는 show:false → ready-to-show 에서 표시였는데, 패키지 콜드 기동에서 11.8초
  // 무화면이 관찰됐다 (I1·I12 공통 원인). 이제 배치 확정 직후 곧바로 보여 준다 —
  // backgroundColor(코르크 톤)가 첫 페인트라 흰 플래시가 없고, 탭바(작고 빠른 셸 페이지)를
  // 앱 뷰보다 먼저 로드 시작해 "뜨는 중" 인상을 준다. ready-to-show 는 이제 표시가 아니라
  // 제목 확정·포커스만 맡는다 (아래).
  win.show();
  win.loadFile(path.join(__dirname, 'tabbar.html')); // 창의 기본 페이지 = 셸 탭바 (앱 원본 아님 — A42 무변형 계약 무관)

  // ── 두 앱 뷰 생성·로드 (모두 유지 — 탭 전환 시 리로드 금지 계약) ──
  const makeAppView = (htmlFile) => {
    const view = new WebContentsView({
      webPreferences: { ...SECURE_WEB_PREFERENCES } // 기존 preload.js 그대로 (A43 카드·A47 온보딩·백업 UI)
    });
    try { view.setBackgroundColor(CORK_BG); } catch (_err) { /* 구버전 View API — 무해 */ }
    hardenWebContents(view.webContents);
    wireCrashLogging(view.webContents, path.basename(htmlFile), true); // 앱 화면은 1회 자동 복구
    // A42: 저장소 원본을 그대로 로드 — 경로 외 어떤 변형도 없다.
    view.webContents.loadFile(htmlFile);
    return view;
  };
  const views = {
    calendar: makeAppView(path.join(REPO_ROOT, 'calendar.html')),
    postit: makeAppView(path.join(REPO_ROOT, 'postit.html'))
  };
  win.contentView.addChildView(views.calendar);
  win.contentView.addChildView(views.postit);

  runtime.win = win;
  runtime.views = views;
  runtime.drawerOpen = false;
  runtime.pendingAlarms = 0;   // 배지 누적은 창 수명 단위
  runtime.lastAlarmText = '';

  // ── 탭 단축키 (Ctrl+Tab 순환 / Ctrl+1 포스트잇 / Ctrl+2 캘린더) ──
  // before-input-event 는 렌더러가 키를 받기 전에 main 이 가로챈다 — 앱 입력 필드에
  // 포커스가 있어도 안전하다: Ctrl+Tab·Ctrl+숫자는 텍스트를 만들지 않는 조합이고,
  // 양 앱 모두 이 조합을 쓰지 않는다 (preventDefault 로 렌더러 전달도 차단).
  // 탭바 호스트·두 앱 뷰 모두에 배선 — 포커스가 어디 있든 동작한다.
  const wireTabShortcuts = (wc) => {
    wc.on('before-input-event', (event, input) => {
      if (runtime.win !== win || win.isDestroyed()) return;
      // 텍스트 없는 키(Tab·수식 조합 숫자)는 keyDown 이 아니라 rawKeyDown 으로 온다 (실측)
      if (input.type !== 'keyDown' && input.type !== 'rawKeyDown') return;
      if (!input.control || input.alt || input.meta) return;
      let want = null;
      if (input.key === 'Tab') {
        want = runtime.activeTab === 'postit' ? 'calendar' : 'postit'; // 2탭 — Shift 유무 무관 순환
      } else if (!input.shift && input.key === '1') {
        want = 'postit';   // 탭 순서와 동일 (1 = 포스트잇)
      } else if (!input.shift && input.key === '2') {
        want = 'calendar'; // 2 = 캘린더
      }
      if (!want) return;
      event.preventDefault();
      if (setActiveTab(want)) focusActiveView();
    });
  };
  wireTabShortcuts(win.webContents);
  wireTabShortcuts(views.calendar.webContents);
  wireTabShortcuts(views.postit.webContents);

  // ── 뷰 배치: 탭바 아래 전체 영역 (드로어가 열리면 그 높이만큼 더 아래로) ──
  const layoutViews = () => {
    if (win.isDestroyed()) return;
    const cb = win.getContentBounds();
    const top = TABBAR_HEIGHT + (runtime.drawerOpen ? SETTINGS_DRAWER_HEIGHT : 0);
    const bounds = { x: 0, y: top, width: Math.max(0, cb.width), height: Math.max(0, cb.height - top) };
    views.calendar.setBounds(bounds);
    views.postit.setBounds(bounds);
  };
  runtime.layoutViews = layoutViews;
  for (const ev of ['resize', 'maximize', 'unmaximize', 'restore', 'enter-full-screen', 'leave-full-screen']) {
    win.on(ev, layoutViews);
  }
  layoutViews();

  // 기본 활성 탭 — 셸 설정 defaultTab (기본 postit)
  setActiveTab(settings.defaultTab === 'calendar' ? 'calendar' : 'postit');

  win.on('closed', () => {
    if (runtime.win === win) {
      runtime.win = null;
      runtime.views = null;
      runtime.layoutViews = null;
      runtime.closeAskPending = false;
    }
  });

  // 즉시 표시(위)로 전환한 뒤에도 ready-to-show 의 제목 확정·포커스는 유지한다 (발주 #33 ③)
  win.once('ready-to-show', () => {
    if (win.isDestroyed()) return;
    win.setTitle('쁘띠캘린더'); // 로드 과정에서의 제목 변동 방지 — 최종 확정
    focusActiveView();
  });

  return win;
}

// ============================================================================
// 셸 IPC — preload 화이트리스트 채널의 main 측 종단
// ============================================================================

function shellStatePayload() {
  return {
    ok: true,
    activeTab: runtime.activeTab,
    defaultTab: runtime.settings ? runtime.settings.defaultTab : SHELL_SETTINGS_DEFAULTS.defaultTab,
    // 윈도우 시작 시 자동 실행 — 저장하지 않고 매번 OS 에서 읽는다 (단일 진실 = OS)
    openAtLogin: getOpenAtLogin(),
    // 항상 위 — 실측값(창 상태)을 그대로 싣는다 (설정 파일과 어긋나면 창이 정답)
    alwaysOnTop: runtime.win && !runtime.win.isDestroyed()
      ? (function () { try { return runtime.win.isAlwaysOnTop() === true; } catch (_err) { return false; } })()
      : !!(runtime.settings && runtime.settings.alwaysOnTop),
    // 셸 버전 정본 — electron\package.json 하나 (탭바·앱 정보 표기가 같은 값을 쓴다)
    version: app.getVersion(),
    // 닫을 때 트레이로 보내기 (발주 #33 ① — additive 필드, 부재=false=X 종료)
    closeToTray: !!(runtime.settings && runtime.settings.closeToTray === true),
    // 백그라운드 캘린더 탭의 일정 알림 누적 (탭바 배지·미니 스트립용 — additive 필드)
    alarms: { count: runtime.pendingAlarms, text: runtime.lastAlarmText }
  };
}

function registerShellIpc() {
  ipcMain.handle('petit:shell:state', (event) => {
    assertTrustedSender(event);
    return shellStatePayload();
  });

  ipcMain.handle('petit:shell:switch-tab', (event, tab) => {
    assertTrustedSender(event);
    const want = tab === 'calendar' ? 'calendar' : 'postit';
    if (!setActiveTab(want)) return { ok: false, reason: '탭을 전환하지 못했어요.' };
    focusActiveView();
    return shellStatePayload();
  });

  // 설정 즉시 저장 (기본 탭). panelOpen 은 비영속 필드 — 탭바 설정 드로어의
  // 개폐를 전달해 앱 뷰 배치를 갱신한다 (드로어는 창 기본 페이지에 그려지므로
  // 열려 있는 동안 뷰를 그 높이만큼 내려 가려지지 않게 한다).
  ipcMain.handle('petit:shell:set-settings', (event, patch) => {
    assertTrustedSender(event);
    const p = patch && typeof patch === 'object' ? patch : {};
    if (p.defaultTab === 'postit' || p.defaultTab === 'calendar') {
      runtime.settings.defaultTab = p.defaultTab;
    }
    saveShellSettings(runtime.settings);
    if (typeof p.panelOpen === 'boolean') {
      runtime.drawerOpen = p.panelOpen;
      if (runtime.layoutViews) runtime.layoutViews();
    }
    return shellStatePayload();
  });

  // 시작 프로그램 토글 — 탭바 드로어와 앱 설정 모달이 같은 채널을 쓴다.
  // 적용 후 실제 OS 값을 다시 읽어 반영 여부를 판정하고, 성패와 무관하게 모든 표면에
  // 실측 상태를 push 한다 (실패한 쪽의 UI 도 실제 값으로 되돌아간다).
  ipcMain.handle('petit:shell:set-startup', (event, on) => {
    assertTrustedSender(event);
    const want = on === true;
    const actual = setOpenAtLogin(want);
    pushShellUi();
    if (actual !== want) {
      return { ok: false, openAtLogin: actual, reason: '윈도우 시작 설정을 바꾸지 못했어요.' };
    }
    return shellStatePayload();
  });

  // 알림 릴레이 — 캘린더 preload 가 [data-toast][data-toast-kind="alarm"] 표출을 감지해
  // 보낸다. 두 경로는 독립이다 (발주 #33 ②):
  //   ① OS 알림 승격: 창이 미표시(트레이)·최소화·비포커스면 Notification 발화 —
  //      활성 탭이 캘린더여도 사용자가 못 보는 상태면 알린다. 클릭 = 복귀+캘린더 탭.
  //   ② 탭바 배지: 활성 탭이 캘린더가 아닐 때만 누적·push (보고 있는 탭의 알림은 화면에 있다).
  ipcMain.handle('petit:shell:alarm-relay', (event, text) => {
    assertTrustedSender(event);
    if (!runtime.win || runtime.win.isDestroyed()) {
      return { ok: true, relayed: false };
    }
    if (windowAppKind({ webContents: event.sender }) !== 'calendar') return { ok: true, relayed: false };
    const t = typeof text === 'string' ? text.slice(0, 200) : '';
    let notified = false;
    try {
      const win = runtime.win;
      if (!win.isVisible() || win.isMinimized() || !win.isFocused()) {
        notified = fireAlarmNotification(t);
      }
    } catch (_err) { /* 창 상태 조회 실패 — 배지 경로만 계속 */ }
    if (runtime.activeTab === 'calendar') return { ok: true, relayed: notified }; // 배지 불요 — 캘린더 탭이 이미 전면
    runtime.pendingAlarms += 1;
    runtime.lastAlarmText = t;
    pushShellUi();
    return { ok: true, relayed: true };
  });

  // 닫을 때 트레이로 보내기 (발주 #33 ①) — 탭바 드로어·앱 설정 [창] 섹션이 같은 채널을 쓴다.
  // 직접 설정한 것도 "닫기 질문에 답했다"로 본다 — 1회 선택 카드를 다시 띄우지 않는다.
  ipcMain.handle('petit:shell:set-close-to-tray', (event, on) => {
    assertTrustedSender(event);
    runtime.settings.closeToTray = on === true;
    runtime.settings.closeAskAck = true;
    saveShellSettings(runtime.settings);
    pushShellUi();
    return shellStatePayload();
  });

  // 닫기 1회 선택 카드의 응답 (발주 #33 ①) — { tray, remember } 또는 { dismiss:true }.
  //   dismiss: 답 없이 접힘 — 대기만 풀고 아무것도 저장하지 않는다 (다음 X 때 다시 묻는다).
  //   tray:true → closeToTray:true 저장 후 트레이로 / tray:false → 완전 종료.
  //   remember(기본 true) = "다시 묻지 않음" — closeAskAck 영속.
  ipcMain.handle('petit:shell:close-choice', (event, choice) => {
    assertTrustedSender(event);
    runtime.closeAskPending = false;
    const c = choice && typeof choice === 'object' ? choice : {};
    if (c.dismiss === true) return { ok: true };
    const remember = c.remember !== false;
    if (c.tray === true) {
      runtime.settings.closeToTray = true;
      if (remember) runtime.settings.closeAskAck = true;
      saveShellSettings(runtime.settings);
      pushShellUi();
      hideToTray();
      return shellStatePayload();
    }
    if (remember) {
      runtime.settings.closeAskAck = true;
      saveShellSettings(runtime.settings);
    }
    runtime.isQuitting = true; // 종료 선택 — 닫기 인터셉트 우회로 즉시 종료
    setImmediate(() => {
      try { app.quit(); } catch (_err) { /* 이미 종료 중 — 무해 */ }
    });
    return { ok: true, quitting: true };
  });

  // 항상 위 토글 (발주 #30) — 적용 뒤 창 실측값을 다시 읽어 성패를 판정하고, 성공 시에만
  // 설정에 영속한다. 모든 표면(탭바 드로어·앱 설정 모달)에 실측 상태를 push 한다.
  ipcMain.handle('petit:shell:set-always-on-top', (event, on) => {
    assertTrustedSender(event);
    const want = on === true;
    const actual = applyAlwaysOnTop(runtime.win, want);
    if (actual === want) {
      runtime.settings.alwaysOnTop = want;
      saveShellSettings(runtime.settings);
    }
    pushShellUi();
    if (actual !== want) {
      return { ok: false, alwaysOnTop: actual, reason: '항상 위 설정을 바꾸지 못했어요.' };
    }
    return shellStatePayload();
  });

  // 앱 정보·진단 (발주 #28①②) — 조회 전용. 개인 메모 내용은 어떤 필드에도 담기지 않는다.
  ipcMain.handle('petit:shell:info', async (event) => {
    assertTrustedSender(event);
    return diagnosticsInfo();
  });

  // 진단 정보 복사 — main 이 문자열을 만들어 클립보드에 넣는다(렌더러 클립보드 권한 불요).
  // 외부 전송 0: 나가는 곳은 사용자의 클립보드뿐이다.
  ipcMain.handle('petit:shell:copy-diagnostics', async (event) => {
    assertTrustedSender(event);
    const info = await diagnosticsInfo();
    const text = diagnosticsText(info);
    try {
      clipboard.writeText(text);
    } catch (err) {
      logEvent('diagnostics', '클립보드 복사 실패: ' + String((err && err.message) || err));
      return { ok: false, reason: '클립보드에 복사하지 못했어요.', text };
    }
    return { ok: true, text };
  });

  // 로그 폴더 열기 (발주 #28④) — 경로 인자를 받지 않는다: 여는 대상은 userData\logs 하나다.
  ipcMain.handle('petit:shell:open-logs', async (event) => {
    assertTrustedSender(event);
    const dir = logsDir();
    if (!dir) return { ok: false, reason: '로그 폴더를 찾지 못했어요.' };
    try {
      fs.mkdirSync(dir, { recursive: true });
    } catch (_err) {
      return { ok: false, folder: dir, reason: '로그 폴더를 만들 수 없어요.' };
    }
    let failure = '';
    try {
      failure = await shell.openPath(dir);
    } catch (err) {
      failure = String((err && err.message) || err);
    }
    if (failure) return { ok: false, folder: dir, reason: '폴더를 열지 못했어요: ' + failure.slice(0, 200) };
    return { ok: true, folder: dir };
  });

  // 보드 자랑하기 (발주 #31) — 'clipboard' | 'file'. 그 외 값은 클립보드로 정규화한다.
  ipcMain.handle('petit:shell:capture-board', async (event, mode) => {
    assertTrustedSender(event);
    return captureBoard(mode === 'file' ? 'file' : 'clipboard');
  });

  // 온보딩 완료 통지(A47) — 완료 플래그의 정본은 렌더러 localStorage(postit-onboarded),
  // main 은 상태를 갖지 않는다 (수신 확인만 반환).
  ipcMain.handle('petit:onboarding:set-done', () => ({ ok: true }));
}

// ============================================================================
// 앱 수명주기
// ============================================================================

// (사어 스텁 정리 — 2026-08-20: petit:license:import(앱 내 A45 경로와 중복, 호출 0건)·
//  petit:onboarding:get(호출 0건) 스텁과 registerStubIpc 를 제거. 실사용이 남은
//  petit:onboarding:set-done 은 registerShellIpc 로 이동 — grep 실증 후 정리.)

function main() {
  // Windows 알림(발주 #33 ②)의 AppUserModelId — electron-builder appId 와 동일 값.
  // MSIX(스토어) 패키지는 OS 가 패키지 identity 로 자동 부여하므로 그 외(개발 트리·
  // NSIS·포터블)에서만 명시한다. 미설정 시 Windows 가 알림을 표시하지 않는다.
  if (process.platform === 'win32' && process.windowsStore !== true) {
    try { app.setAppUserModelId('com.petitcalendar.app'); } catch (_err) { /* 미지원 환경 — 무해 */ }
  }

  // 종료 경로 표식 (발주 #33 ① — 필수): app.quit()(Playwright electronApp.close() 포함)·
  // OS 종료·트레이 [완전 종료]가 닫기 인터셉트에 걸리지 않게 한다.
  // 이 플래그가 없으면 채점기의 정상 종료가 트레이 인터셉트에 막혀 게이트 전체가 행걸린다.
  app.on('before-quit', () => { runtime.isQuitting = true; });

  wireProcessLogging(); // uncaughtException·unhandledRejection·child-process-gone → userData\logs
  registerMigrateIpc(); // 'petit:migrate:detect' / ':run' / ':status'
  registerBackupIpc();  // 'petit:backup:status' / ':choose-folder' / ':open-folder' / ':ack-notice' / ':run-now' / ':set-auto' / ':set-include-images' / ':ack-auto-prompt' / ':pick-restore'
  registerShellIpc();   // 'petit:shell:state' / ':switch-tab' / ':set-settings' / ':set-startup' / ':set-always-on-top' / ':set-close-to-tray' / ':close-choice' / ':info' / ':copy-diagnostics' / ':open-logs' / ':capture-board' / ':alarm-relay' + 'petit:onboarding:set-done'

  app.whenReady().then(() => {
    // A44: 세션 수준 스펠체커 완전 차단 — webPreferences.spellcheck:false 만으로는
    // 세션이 OS 로케일(ko) 사전을 구글 CDN에서 내려받는 경로가 남는다 (netstat 실측).
    try {
      const { session } = require('electron');
      const killSpell = (ses) => {
        try { ses.setSpellCheckerLanguages([]); } catch (e) {}
        try { ses.spellCheckerEnabled = false; } catch (e) {}
      };
      killSpell(session.defaultSession);
      app.on('session-created', killSpell);
    } catch (e) { /* 세션 API 부재 시에도 창 생성은 계속 */ }

    // 세션 시작 한 줄 — 로그 파일이 항상 존재하게 만들고(진단 첫 질문 = "로그 주세요"),
    // 어느 빌드가 언제 떴는지 기록한다. 개인정보 없음.
    logEvent('start', '앱 시작 — v' + app.getVersion() + ' · ' + distributionKind() +
      ' · Electron ' + (process.versions.electron || '?'));

    runtime.state = loadWindowState();
    runtime.settings = loadShellSettings();

    // 창 구성은 하나뿐이다 — 단일 창 탭 모드 (rev.8: 분리 경로 폐지)
    createShellWindow(runtime.state, runtime.settings);

    // 트레이 상주 (발주 #33 ①) — 기동 시 항상. 실패해도 앱은 계속 (내부에서 로그만)
    createTray().catch(() => { /* createTray 내부가 전 경로 로그 처리 — 여기는 unhandledRejection 방지 */ });

    // 예약 자동 백업 체커 기동 — Pro(postit-license 검증) + 설정 auto 일 때만 실행된다.
    // 창 생성 뒤에 시작해야 첫 체크가 저장소를 읽을 앱 페이지를 찾을 수 있다 (backup.js).
    startBackupScheduler();
  });

  // 창을 닫으면 앱 종료 (창은 하나뿐 — 그 창 닫기 = 앱 종료 계약).
  // closeToTray 상태에서는 close 가 인터셉트되어 창이 닫히지 않으므로 여기 오지 않는다 —
  // 여기 도달 = 진짜 닫힘(종료 선택·인터셉트 우회) = 종료가 맞다 (발주 #33 ①).
  app.on('window-all-closed', () => {
    app.quit();
  });
}
