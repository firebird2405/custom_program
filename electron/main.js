// ============================================================================
// 쁘띠캘린더 — Electron 셸 (main 프로세스)
//
// 계약 (protocol/SCORECARD.md rev.7):
//   A42 — 병합 1창 탭 모드(기본): BrowserWindow 1개(제목 "쁘띠캘린더") 안에
//         탭바(tabbar.html, 창의 기본 페이지) + 두 앱 WebContentsView(calendar·postit)를
//         모두 생성·로드해 유지하고, 탭 전환은 z순서 재배치만 한다(리로드 금지 —
//         webContents 유지 = 작성 상태 보존). [data-split] → 기존 2창 경로(rev.6 계약),
//         분리 상태의 [data-merge] → 병합 복귀. 셸 설정(모드·기본 탭)은
//         userData\shell-settings.json 에 영속. 저장소 원본 calendar.html·postit.html 은
//         바이트 동일하게 loadFile — 빌드 변형·주입 금지 (주입이 필요하면 preload로만).
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
const { REPO_ROOT, readJsonFile, writeJsonFile, assertTrustedSender } = require('./lib-shared');
const { registerMigrateIpc } = require('./migrate');
const { registerBackupIpc, startBackupScheduler } = require('./backup');

// ── userData 오버라이드 훅 (app ready 이전에 확정해야 한다) ─────────────────
if (process.env.PETIT_USERDATA) {
  app.setPath('userData', path.resolve(process.env.PETIT_USERDATA));
}

// ── 단일 인스턴스 잠금 — 두 번째 실행은 기존 창을 앞으로 가져오고 종료 ──────
// (모드 무관: 병합 모드면 병합 창 1개, 분리 모드면 앱 창 2개가 전면으로 온다)
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
// 키: 'calendar'·'postit'(분리 모드) + 'merged'(병합 모드 전용 — 서로 침범하지 않는다).
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
// 셸 설정 — userData\shell-settings.json { windowMode, defaultTab }
// 손상·부재 시 크래시 없이 기본값(merged·postit)으로 강등 (아키텍처 원칙 5 준용).
// ============================================================================

const SHELL_SETTINGS_DEFAULTS = { windowMode: 'merged', defaultTab: 'postit' };

function shellSettingsPath() {
  return path.join(app.getPath('userData'), 'shell-settings.json');
}

function loadShellSettings() {
  const raw = readJsonFile(shellSettingsPath());
  const s = { ...SHELL_SETTINGS_DEFAULTS };
  if (raw && typeof raw === 'object') {
    if (raw.windowMode === 'merged' || raw.windowMode === 'separate') s.windowMode = raw.windowMode;
    if (raw.defaultTab === 'postit' || raw.defaultTab === 'calendar') s.defaultTab = raw.defaultTab;
  }
  return s;
}

function saveShellSettings(settings) {
  writeJsonFile(shellSettingsPath(), settings);
}

// ============================================================================
// 셸 런타임 상태 (main 프로세스 단일 정의처)
// ============================================================================

const runtime = {
  mode: 'merged',        // 현재 가동 중인 창 구성 ('merged' | 'separate')
  settings: null,        // 저장된 셸 설정 (windowMode·defaultTab)
  state: null,           // window-state.json 전체 (참조 공유)
  mergedWin: null,       // 병합 모드의 BrowserWindow (탭바 페이지 소유)
  views: null,           // 병합 모드의 { calendar, postit } WebContentsView
  layoutViews: null,     // 병합 모드의 뷰 배치 함수 (드로어 개폐·리사이즈 시 재호출)
  activeTab: 'postit',   // 병합 모드의 활성 탭
  drawerOpen: false,     // 탭바 설정 드로어 개폐 (열리면 앱 뷰를 아래로 밀어 공간 확보)
  transitioning: false   // 분리↔병합 전환 중 (일시적 0창 상태에서 종료 방지)
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
const SETTINGS_DRAWER_HEIGHT = 148;

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
 * 첫 실행(저장 상태 없음) 기본 배치 — 작업영역이 가장 큰 디스플레이에 명시 배치.
 * Electron 기본 캐스케이드가 두 번째 창을 화면 아래로 밀어 OS가 높이를 줄이는 문제
 * (A42 기본 크기 미달)를 피하고, 주 화면이 작은 노트북(예: 1280×680@150%)에서도
 * 계약 기본 크기 ≥1024×700 을 담을 수 있는 화면을 고른다.
 * @param {'calendar'|'postit'|'merged'} key 창 종류 (캘린더 좌측 / 포스트잇 우측 / 병합 중앙)
 * @param {{width:number,height:number}} defaults 기본 크기
 */
function freshBoundsFor(key, defaults) {
  const wa = screen.getAllDisplays().reduce((best, d) =>
    (d.workArea.width * d.workArea.height > best.workArea.width * best.workArea.height ? d : best)
  ).workArea;
  const w = Math.min(defaults.width, wa.width - 24);
  const h = Math.min(defaults.height, wa.height - 12);
  const y = wa.y + Math.max(6, Math.floor((wa.height - h) / 2) - 8);
  let x;
  if (key === 'postit') x = wa.x + Math.max(12, wa.width - w - 24);
  else if (key === 'calendar') x = wa.x + 24;
  else x = wa.x + Math.max(12, Math.floor((wa.width - w) / 2)); // merged — 중앙
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
// 분리 모드 — 앱 창 2개 (rev.6 계약 경로 그대로: 제목·기본 크기·독립 종료)
// ============================================================================

/**
 * @param {object} state        window-state.json에서 읽은 전체 상태 객체 (참조 공유)
 * @param {string} key          상태 저장 키 ('calendar' | 'postit')
 * @param {string} htmlFile     로드할 저장소 원본 HTML 절대 경로
 * @param {string} windowTitle  고정 창 제목 (page-title-updated는 preventDefault)
 * @param {{width:number,height:number}} defaults 기본 크기
 */
function createAppWindow(state, key, htmlFile, windowTitle, defaults) {
  const saved = sanitizeBounds(state[key]);
  const fresh = saved ? null : freshBoundsFor(key, defaults);

  const win = new BrowserWindow({
    width: saved ? saved.width : fresh.width,
    height: saved ? saved.height : fresh.height,
    ...(saved ? { x: saved.x, y: saved.y } : { x: fresh.x, y: fresh.y }),
    minWidth: 480,
    minHeight: 360,
    title: windowTitle,
    show: false,
    webPreferences: { ...SECURE_WEB_PREFERENCES }
  });

  win.removeMenu(); // Edge 앱 모드와 동일한 무메뉴 창

  // 믹스드 DPI 보정: 배율이 다른 모니터(예: 150% 노트북 + 100% 외장)의 음수 좌표로
  // 생성자 x/y 를 주면 크기가 배율 오염되는 Electron/Chromium 이슈가 있어,
  // 생성 직후 목표 사각형을 한 번 더 확정 적용한다.
  if (fresh) win.setBounds(fresh);

  if (state[key] && state[key].maximized) win.maximize();

  // ── 제목 고정: HTML이 document.title을 바꿔도 셸 제목 유지 ──
  // (주의: preventDefault로 네이티브 제목 변경을 막는 계약은 BrowserWindow 이벤트 쪽이다.
  //  webContents의 동명 이벤트는 통지용이라 preventDefault가 무효.)
  win.on('page-title-updated', (event) => {
    event.preventDefault();
  });

  hardenWebContents(win.webContents);
  wireWindowStatePersistence(win, state, key);

  win.once('ready-to-show', () => {
    win.show();
    win.setTitle(windowTitle); // 로드 과정에서의 제목 변동 방지 — 최종 확정
  });

  // A42: 저장소 원본을 그대로 로드 — 경로 외 어떤 변형도 없다.
  win.loadFile(htmlFile);

  return win;
}

/** 분리 모드 진입: 앱 창 2개 (캘린더 좌 / 포스트잇 우) */
function openSeparateWindows() {
  createAppWindow(
    runtime.state,
    'calendar',
    path.join(REPO_ROOT, 'calendar.html'),
    '쁘띠캘린더 — 캘린더',
    { width: 1024, height: 740 }
  );
  createAppWindow(
    runtime.state,
    'postit',
    path.join(REPO_ROOT, 'postit.html'),
    '쁘띠캘린더 — 포스트잇 월',
    { width: 1024, height: 740 }
  );
}

// ============================================================================
// 병합 모드 (기본) — BrowserWindow 1개: 탭바(기본 페이지) + 앱 WebContentsView 2개
//
// 두 앱 뷰는 시작 시 모두 생성·로드하고 이후 유지한다. 탭 전환은 contentView 의
// z순서 재배치(addChildView 재호출 = 맨 위로)뿐이다 — 리로드 금지 = 작성 상태 보존
// 계약(A42). 두 뷰 모두 항상 같은 bounds 로 attach 상태를 유지하므로(가려짐만 다름)
// 백그라운드 탭의 타이머·저장 경로도 계속 돈다.
// ============================================================================

/** 병합 창의 활성 탭 전환 — 해당 뷰를 z순서 맨 위로 (이미 자식이면 재정렬만) */
function setActiveTab(tab) {
  const win = runtime.mergedWin;
  if (!win || win.isDestroyed() || !runtime.views || !runtime.views[tab]) return false;
  runtime.activeTab = tab;
  win.contentView.addChildView(runtime.views[tab]);
  return true;
}

/** 활성 탭 뷰에 키보드 포커스 — 탭 전환 직후 바로 타이핑할 수 있게 */
function focusActiveView() {
  try {
    if (runtime.views && runtime.views[runtime.activeTab]) {
      runtime.views[runtime.activeTab].webContents.focus();
    }
  } catch (_err) { /* 파괴 중 — 무해 */ }
}

function createMergedWindow(state, settings) {
  const saved = sanitizeBounds(state.merged);
  const fresh = saved ? null : freshBoundsFor('merged', { width: 1024, height: 740 });

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

  win.removeMenu();
  if (fresh) win.setBounds(fresh); // 믹스드 DPI 보정 (createAppWindow 와 동일 사유)
  if (state.merged && state.merged.maximized) win.maximize();

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

  runtime.mergedWin = win;
  runtime.views = views;
  runtime.drawerOpen = false;

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
    if (runtime.mergedWin === win) {
      runtime.mergedWin = null;
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
// 분리 ↔ 병합 전환
//
// 미저장 상태 유실 방지: 전환 전 웹콘텐츠 포커스를 해제(blur 유도)해 앱의 기존
// 저장 경로(편집 확정·blur 저장)가 돌게 하고, 앱의 저장 디바운스(≤400ms)가
// 비워질 여유를 준 뒤 웹콘텐츠를 정상 종료(unload/pagehide 발화)한다.
// 전환은 창/뷰 재구성(재로드)으로 한다 — 병합 모드 "탭 전환"만은 무리로드 계약.
// ============================================================================

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// 앱 저장 디바운스(포스트잇 250ms·창 상태 400ms)가 비워질 유예
const TRANSITION_FLUSH_MS = 700;

async function runTransition(targetMode) {
  try {
    runtime.settings.windowMode = targetMode;
    saveShellSettings(runtime.settings);

    if (targetMode === 'separate') {
      // ── 병합 → 분리 ──
      const win = runtime.mergedWin;
      const views = runtime.views;
      runtime.mergedWin = null;
      runtime.views = null;
      runtime.layoutViews = null;
      if (win && !win.isDestroyed()) {
        try { win.webContents.focus(); } catch (_err) { /* blur 유도 실패 무해 */ }
        await delay(TRANSITION_FLUSH_MS);
        if (views) {
          for (const v of [views.postit, views.calendar]) {
            try { win.contentView.removeChildView(v); } catch (_err) { /* 이미 분리됨 */ }
            try { v.webContents.close(); } catch (_err) { /* 이미 종료됨 */ }
          }
        }
        await delay(150);
        try { win.close(); } catch (_err) { /* 이미 닫힘 */ }
      }
      runtime.mode = 'separate';
      openSeparateWindows();
    } else {
      // ── 분리 → 병합 ──
      const wins = BrowserWindow.getAllWindows().filter((w) => !w.isDestroyed());
      for (const w of wins) {
        try { w.blur(); } catch (_err) { /* 무해 */ }
      }
      await delay(TRANSITION_FLUSH_MS);
      for (const w of wins) {
        try { w.close(); } catch (_err) { /* 이미 닫힘 */ }
      }
      await delay(150);
      runtime.mode = 'merged';
      createMergedWindow(runtime.state, runtime.settings);
    }
  } finally {
    runtime.transitioning = false;
  }
}

/** IPC 핸들러에서 즉시 응답을 돌려준 뒤 전환을 비동기로 수행한다 (호출 창이 곧 닫히므로) */
function scheduleTransition(targetMode) {
  runtime.transitioning = true; // 응답 전에 세워 이중 전환·조기 종료를 막는다
  setImmediate(() => {
    runTransition(targetMode).catch(() => {
      runtime.transitioning = false; // 전환 실패 시에도 종료 가드가 풀리게
    });
  });
}

// ============================================================================
// 셸 IPC — preload 화이트리스트 채널의 main 측 종단
// ============================================================================

function shellStatePayload() {
  return {
    ok: true,
    mode: runtime.mode,
    activeTab: runtime.activeTab,
    windowMode: runtime.settings ? runtime.settings.windowMode : SHELL_SETTINGS_DEFAULTS.windowMode,
    defaultTab: runtime.settings ? runtime.settings.defaultTab : SHELL_SETTINGS_DEFAULTS.defaultTab
  };
}

function registerShellIpc() {
  ipcMain.handle('petit:shell:state', (event) => {
    assertTrustedSender(event);
    return shellStatePayload();
  });

  ipcMain.handle('petit:shell:switch-tab', (event, tab) => {
    assertTrustedSender(event);
    if (runtime.mode !== 'merged') return { ok: false, reason: '분리 모드에서는 탭 전환이 없어요.' };
    const want = tab === 'calendar' ? 'calendar' : 'postit';
    if (!setActiveTab(want)) return { ok: false, reason: '탭을 전환하지 못했어요.' };
    focusActiveView();
    return shellStatePayload();
  });

  // 설정 즉시 저장 (모드·기본 탭). panelOpen 은 비영속 필드 — 탭바 설정 드로어의
  // 개폐를 전달해 앱 뷰 배치를 갱신한다 (드로어는 창 기본 페이지에 그려지므로
  // 열려 있는 동안 뷰를 그 높이만큼 내려 가려지지 않게 한다).
  ipcMain.handle('petit:shell:set-settings', (event, patch) => {
    assertTrustedSender(event);
    const p = patch && typeof patch === 'object' ? patch : {};
    if (p.windowMode === 'merged' || p.windowMode === 'separate') {
      runtime.settings.windowMode = p.windowMode;
    }
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

  ipcMain.handle('petit:shell:split', (event) => {
    assertTrustedSender(event);
    if (runtime.transitioning) return { ok: false, reason: '창 구성을 바꾸는 중이에요.' };
    if (runtime.mode !== 'merged') return { ok: false, reason: '이미 두 창으로 나뉘어 있어요.' };
    scheduleTransition('separate');
    return { ok: true };
  });

  ipcMain.handle('petit:shell:merge', (event) => {
    assertTrustedSender(event);
    if (runtime.transitioning) return { ok: false, reason: '창 구성을 바꾸는 중이에요.' };
    if (runtime.mode !== 'separate') return { ok: false, reason: '이미 한 창이에요.' };
    scheduleTransition('merged');
    return { ok: true };
  });
}

// ============================================================================
// 앱 수명주기
// ============================================================================

// preload 화이트리스트 채널의 main 측 스텁 종단 (마이그레이션 채널은 migrate.js 담당).
function registerStubIpc() {
  ipcMain.handle('petit:license:import', () => ({ ok: false, reason: '미구현' }));
  // 온보딩 완료 플래그의 정본은 렌더러 localStorage(postit-onboarded) — main 은 상태를 갖지 않는다
  ipcMain.handle('petit:onboarding:get', () => ({ stub: true, source: 'localStorage:postit-onboarded' }));
  ipcMain.handle('petit:onboarding:set-done', () => ({ ok: true, stub: true }));
}

function main() {
  registerMigrateIpc(); // 'petit:migrate:detect' / ':run' / ':status'
  registerBackupIpc();  // 'petit:backup:status' / ':choose-folder' / ':run-now' / ':set-auto' / ':set-include-images'
  registerShellIpc();   // 'petit:shell:state' / ':switch-tab' / ':set-settings' / ':split' / ':merge'
  registerStubIpc();

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
    runtime.mode = runtime.settings.windowMode === 'separate' ? 'separate' : 'merged';

    if (runtime.mode === 'merged') {
      createMergedWindow(runtime.state, runtime.settings);
    } else {
      openSeparateWindows();
    }

    // 예약 자동 백업 체커 기동 — Pro(postit-license 검증) + 설정 auto 일 때만 실행된다.
    // 창 생성 뒤에 시작해야 첫 체크가 저장소를 읽을 앱 페이지를 찾을 수 있다 (backup.js).
    startBackupScheduler();
  });

  // 모든 창이 닫히면 종료 (병합 창 닫기 = 앱 종료 계약). 분리↔병합 전환 중의
  // 일시적 0창 상태는 종료가 아니다 — transitioning 가드.
  app.on('window-all-closed', () => {
    if (runtime.transitioning) return;
    app.quit();
  });
}
