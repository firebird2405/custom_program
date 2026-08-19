// ============================================================================
// 쁘띠캘린더 — Electron 셸 (main 프로세스)
//
// 계약 (protocol/SCORECARD-rev6-draft.md):
//   A42 — 저장소 원본 calendar.html·postit.html을 바이트 동일하게 loadFile.
//         빌드 변형·주입 금지 (주입이 필요하면 preload로만).
//   A44 — 외부 네트워크 요청 0. 이 파일은 http/https/net/dns/dgram/tls를
//         일절 require하지 않는다. 텔레메트리·autoUpdater 금지.
//   A49 — 렌더러 격리: contextIsolation·sandbox 활성, nodeIntegration·webview 비활성,
//         setWindowOpenHandler deny-all, will-navigate 외부 차단.
//
// 채점 격리 훅: 환경변수 PETIT_USERDATA가 설정되면 해당 경로를 userData로 사용
// (채점기가 fresh 프로필로 격리 기동할 수 있게 하는 계약 — rev.6 초안 A42).
//
// A43 배선: preload.js(브리지·셸 UI) + migrate.js(마이그레이션 엔진·IPC 종단) —
// 소스 프로필 인자는 --source-cal=/--source-postit= 또는 PETIT_SOURCE_CAL/POSTIT env.
// ============================================================================

'use strict';

const { app, BrowserWindow, screen, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const { registerMigrateIpc } = require('./migrate');
const { registerBackupIpc, startBackupScheduler } = require('./backup');

// ── userData 오버라이드 훅 (app ready 이전에 확정해야 한다) ─────────────────
if (process.env.PETIT_USERDATA) {
  app.setPath('userData', path.resolve(process.env.PETIT_USERDATA));
}

// ── 단일 인스턴스 잠금 — 두 번째 실행은 기존 창을 앞으로 가져오고 종료 ──────
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
// 앱 내부(HTML)의 resizeTo 기반 모듈은 try/catch로 감싸져 있어 공존 무해.
// ============================================================================

function stateFilePath() {
  return path.join(app.getPath('userData'), 'window-state.json');
}

// 저장 파일을 읽는다 — 손상되어 있어도 크래시 없이 기본값으로 강등 (아키텍처 원칙 5 준용)
function loadWindowState() {
  try {
    const raw = fs.readFileSync(stateFilePath(), 'utf8');
    const data = JSON.parse(raw);
    return data && typeof data === 'object' ? data : {};
  } catch (_err) {
    return {};
  }
}

function saveWindowState(state) {
  try {
    fs.mkdirSync(app.getPath('userData'), { recursive: true });
    fs.writeFileSync(stateFilePath(), JSON.stringify(state, null, 2), 'utf8');
  } catch (_err) {
    // 저장 실패는 치명적이지 않다 — 다음 실행은 기본 크기로 열린다.
  }
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
// 창 생성
// ============================================================================

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

/**
 * @param {object} state        window-state.json에서 읽은 전체 상태 객체 (참조 공유)
 * @param {string} key          상태 저장 키 ('calendar' | 'postit')
 * @param {string} htmlFile     로드할 저장소 원본 HTML 절대 경로
 * @param {string} windowTitle  고정 창 제목 (page-title-updated는 preventDefault)
 * @param {{width:number,height:number}} defaults 기본 크기
 */
function createAppWindow(state, key, htmlFile, windowTitle, defaults) {
  const saved = sanitizeBounds(state[key]);

  // 첫 실행(저장 상태 없음): Electron 기본 캐스케이드 배치가 두 번째 창을 화면
  // 아래로 밀어 OS가 높이를 줄이는 문제(A42 기본 크기 미달)가 있어, 작업영역 안에
  // 명시 배치한다 — 캘린더 좌측 / 포스트잇 우측, 높이는 작업영역에 맞게 클램프.
  let fresh = null;
  if (!saved) {
    // 다중 모니터: 작업영역이 가장 큰 디스플레이에 첫 배치 (주 화면이 작은
    // 노트북(예: 1280×680@150%)이면 계약 기본 크기 ≥1024×700 을 못 담는다)
    const wa = screen.getAllDisplays().reduce((best, d) =>
      (d.workArea.width * d.workArea.height > best.workArea.width * best.workArea.height ? d : best)
    ).workArea;
    const w = Math.min(defaults.width, wa.width - 24);
    const h = Math.min(defaults.height, wa.height - 12);
    const y = wa.y + Math.max(6, Math.floor((wa.height - h) / 2) - 8);
    const x = key === 'postit'
      ? wa.x + Math.max(12, wa.width - w - 24)
      : wa.x + 24;
    fresh = { width: w, height: h, x, y };
  }

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

  // ── A49: 새 창 열기 전면 거부 ──
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  // ── A49: 현재 문서 밖으로의 항해 차단 (같은 URL 재로드만 허용) ──
  win.webContents.on('will-navigate', (event, url) => {
    if (url !== win.webContents.getURL()) event.preventDefault();
  });

  // ── 창 상태 기억: 이동·리사이즈를 디바운스 저장, 닫을 때 확정 저장 ──
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
    }, 400);
  };
  win.on('resize', scheduleSave);
  win.on('move', scheduleSave);
  win.on('close', () => {
    if (saveTimer) clearTimeout(saveTimer);
    captureBounds();
    saveWindowState(state);
  });

  win.once('ready-to-show', () => {
    win.show();
    win.setTitle(windowTitle); // 로드 과정에서의 제목 변동 방지 — 최종 확정
  });

  // A42: 저장소 원본을 그대로 로드 — 경로 외 어떤 변형도 없다.
  win.loadFile(htmlFile);

  return win;
}

// ============================================================================
// 앱 수명주기
// ============================================================================

// preload 화이트리스트 채널의 main 측 스텁 종단 (마이그레이션 채널은 migrate.js 담당).
// A45(라이선스)·A47(온보딩 상태)의 실구현은 2·3주차 발주 — 지금은 정직한 스텁만.
function registerStubIpc() {
  ipcMain.handle('petit:license:import', () => ({ ok: false, reason: '미구현' }));
  // 온보딩 완료 플래그의 정본은 렌더러 localStorage(postit-onboarded) — main 은 상태를 갖지 않는다
  ipcMain.handle('petit:onboarding:get', () => ({ stub: true, source: 'localStorage:postit-onboarded' }));
  ipcMain.handle('petit:onboarding:set-done', () => ({ ok: true, stub: true }));
}

function main() {
  registerMigrateIpc(); // 'petit:migrate:detect' / ':run' / ':status'
  registerBackupIpc();  // 'petit:backup:status' / ':choose-folder' / ':run-now' / ':set-auto' / ':set-include-images'
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

    const repoRoot = path.resolve(__dirname, '..');
    const state = loadWindowState();

    createAppWindow(
      state,
      'calendar',
      path.join(repoRoot, 'calendar.html'),
      '쁘띠캘린더 — 캘린더',
      { width: 1024, height: 740 }
    );

    createAppWindow(
      state,
      'postit',
      path.join(repoRoot, 'postit.html'),
      '쁘띠캘린더 — 포스트잇 월',
      { width: 1024, height: 740 }
    );

    // 예약 자동 백업 체커 기동 — Pro(postit-license 검증) + 설정 auto 일 때만 실행된다.
    // 창 생성 뒤에 시작해야 첫 체크가 저장소를 읽을 창을 찾을 수 있다 (backup.js).
    startBackupScheduler();
  });

  // 두 창이 모두 닫히면 종료 (Windows 단일 플랫폼 — 예외 분기 없음)
  app.on('window-all-closed', () => {
    app.quit();
  });
}
