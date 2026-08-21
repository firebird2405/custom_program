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
// 공용 유틸(경로·안전 JSON IO·앱 페이지 식별·IPC 방어)은 lib-shared.js 가 단일 정의처다.
// ============================================================================

'use strict';

const { app, BrowserWindow, WebContentsView, screen, ipcMain } = require('electron');
const path = require('path');
const { REPO_ROOT, readJsonFile, writeJsonFile, windowAppKind, assertTrustedSender } = require('./lib-shared');
const { registerMigrateIpc } = require('./migrate');
const { registerBackupIpc, startBackupScheduler } = require('./backup');

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

const SHELL_SETTINGS_DEFAULTS = { defaultTab: 'postit' };

function shellSettingsPath() {
  return path.join(app.getPath('userData'), 'shell-settings.json');
}

function loadShellSettings() {
  const raw = readJsonFile(shellSettingsPath());
  const s = { ...SHELL_SETTINGS_DEFAULTS };
  if (raw && typeof raw === 'object') {
    if (raw.defaultTab === 'postit' || raw.defaultTab === 'calendar') s.defaultTab = raw.defaultTab;
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
  lastAlarmText: ''      // 마지막 알림 텍스트 (탭바 미니 알림 스트립 표시용, ≤200자)
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
const SETTINGS_DRAWER_HEIGHT = 138;

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
  const saved = sanitizeBounds(state.merged);
  const fresh = saved ? null : freshBounds({ width: 1024, height: 740 });

  const win = new BrowserWindow({
    width: saved ? saved.width : fresh.width,
    height: saved ? saved.height : fresh.height,
    ...(saved ? { x: saved.x, y: saved.y } : { x: fresh.x, y: fresh.y }),
    minWidth: 480,
    minHeight: 360,
    title: '쁘띠캘린더',
    show: false,
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

  // ── 제목 고정: 탭바 페이지가 document.title 을 바꿔도 셸 제목 유지 ──
  // (주의: preventDefault 로 네이티브 제목 변경을 막는 계약은 BrowserWindow 이벤트 쪽이다.
  //  webContents 의 동명 이벤트는 통지용이라 preventDefault 가 무효.)
  win.on('page-title-updated', (event) => {
    event.preventDefault();
  });

  hardenWebContents(win.webContents);
  wireWindowStatePersistence(win, state, 'merged');

  // ── 두 앱 뷰 생성·로드 (모두 유지 — 탭 전환 시 리로드 금지 계약) ──
  const makeAppView = (htmlFile) => {
    const view = new WebContentsView({
      webPreferences: { ...SECURE_WEB_PREFERENCES } // 기존 preload.js 그대로 (A43 카드·A47 온보딩·백업 UI)
    });
    hardenWebContents(view.webContents);
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
    }
  });

  win.once('ready-to-show', () => {
    win.show();
    win.setTitle('쁘띠캘린더'); // 로드 과정에서의 제목 변동 방지 — 최종 확정
    focusActiveView();
  });

  // 창의 기본 페이지 = 셸 탭바 (앱 원본이 아닌 셸 소유 페이지 — A42 무변형 계약 무관)
  win.loadFile(path.join(__dirname, 'tabbar.html'));

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
  // 보낸다. 발신자가 캘린더 페이지이고 활성 탭이 캘린더가 아닐 때만 배지에 누적하고
  // 탭바로 push 한다 (보고 있는 탭의 알림은 이미 화면에 있으므로 릴레이하지 않는다).
  ipcMain.handle('petit:shell:alarm-relay', (event, text) => {
    assertTrustedSender(event);
    if (!runtime.win || runtime.win.isDestroyed()) {
      return { ok: true, relayed: false };
    }
    if (windowAppKind({ webContents: event.sender }) !== 'calendar') return { ok: true, relayed: false };
    if (runtime.activeTab === 'calendar') return { ok: true, relayed: false }; // 이미 보고 있다 — 생략
    runtime.pendingAlarms += 1;
    runtime.lastAlarmText = typeof text === 'string' ? text.slice(0, 200) : '';
    pushShellUi();
    return { ok: true, relayed: true };
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
  registerMigrateIpc(); // 'petit:migrate:detect' / ':run' / ':status'
  registerBackupIpc();  // 'petit:backup:status' / ':choose-folder' / ':run-now' / ':set-auto' / ':set-include-images'
  registerShellIpc();   // 'petit:shell:state' / ':switch-tab' / ':set-settings' / ':set-startup' / ':alarm-relay' + 'petit:onboarding:set-done'

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

    runtime.state = loadWindowState();
    runtime.settings = loadShellSettings();

    // 창 구성은 하나뿐이다 — 단일 창 탭 모드 (rev.8: 분리 경로 폐지)
    createShellWindow(runtime.state, runtime.settings);

    // 예약 자동 백업 체커 기동 — Pro(postit-license 검증) + 설정 auto 일 때만 실행된다.
    // 창 생성 뒤에 시작해야 첫 체크가 저장소를 읽을 앱 페이지를 찾을 수 있다 (backup.js).
    startBackupScheduler();
  });

  // 창을 닫으면 앱 종료 (창은 하나뿐 — 그 창 닫기 = 앱 종료 계약)
  app.on('window-all-closed', () => {
    app.quit();
  });
}
