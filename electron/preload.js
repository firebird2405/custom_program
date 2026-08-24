// ============================================================================
// 쁘띠캘린더 — Electron 셸 preload (렌더러 격리 브리지 + 셸 전용 UI 레이어)
//
// 계약 (protocol/SCORECARD.md rev.6):
//   A43 발견성 — 기존 Edge 프로필 감지 시 대표 창(캘린더)에 이전 제안 카드
//     ([data-migrate], 실행 버튼 [data-migrate-run](별칭 -accept), 상태
//     [data-migrate-status])를 주입한다. "나중에"([data-migrate-later]) 거절은
//     기억되어 다음 실행부터는 카드 대신 재진입 칩([data-migrate-open], 별칭
//     -reopen)만 표시된다 — 미이전 상태면 칩은 항상 visible, 클릭 시 카드 재표시.
//     ※ 재진입점이 앱 "설정 패널"이 아니라 셸 칩인 이유: 설정 패널은 저장소 원본
//       calendar.html 내부이고, 원본 HTML 은 바이트 동일 계약(A42)으로 수정 금지다.
//       따라서 셸 UI 는 전부 preload 주입 오버레이 레이어에만 산다.
//   A47 온보딩 — fresh 프로필의 포스트잇 창에 온보딩 오버레이([data-onboarding])와
//     기계 구동 스텝 엔진을 주입한다. 각 사용자 액션 단계는 엄격 가시
//     [data-onboarding-target] 정확히 1개가 "지금 조작할 실제 앱 UI"를 지목하고,
//     속성값이 액션을 선언한다 (click/fill/press:<Key>/drag:<CSS셀렉터>).
//     여정(최소화 후 4단계 — 전부 "직접 해 보는" 단계): ＋ 새 포스트잇 클릭 →
//     노트 실제 타이핑(fill) → 꾸미기 열기 → 스티커 실제 드래그 부착(drag:#board).
//     읽기만 하는 자동 슬라이드(환영·축하)는 제거하고 각각 첫 단계 문구·완료 토스트로
//     흡수했다 — 사용자 액션은 그대로 4회 (≤8 계약).
//     [data-onboarding-skip] 상시 표시 + 설정 패널에 [data-onboarding-replay] 주입.
//     스텝 전진은 "사용자 발행 입력 액션"(isTrusted)만 계수한다 (자동 전진 계수 금지).
//     지목은 스포트라이트 오버레이([data-shell-spotlight] — 딤·맥동 링·삼각 포인터·
//     드래그 도착지 힌트)가 맡는다. rAF 로 대상 rect 를 실시간 추종하고, 단계 전환·종료
//     시 rAF 와 노드를 함께 정리한다. 전부 pointerEvents:none 이라 채점기가 그 대상을
//     실제로 클릭·드래그하는 경로를 가로채지 않는다.
//     대체 장치(셸 레이어): 완료·건너뛰기 토스트와 "첫 우클릭" 힌트 칩 — 전부
//     pointerEvents:none 비상호작용 오버레이라 앱 조작 경로를 건드리지 않는다.
//   A42 rev.8 — 창은 항상 1개(단일 창 탭 모드)다. 창 구성 UI(탭바·설정 드로어)는
//     전부 tabbar.html 소관이고, 이 파일은 앱 페이지에 창 구성 관련 UI·브리지를
//     일절 주입하지 않는다 (창 분리·재병합 진입점은 rev.8 에서 폐지 — 재도입 금지).
//   시작 프로그램 — 앱 설정 패널에 [시작 프로그램] 셸 섹션([data-startup-section],
//     토글 [data-startup-toggle], 상태 [data-startup-status])을 주입한다. 탭바 설정
//     드로어의 같은 항목과 채널 하나를 공유하고 main 의 상태 push 로 양방향 동기화된다.
//     상태의 단일 진실은 OS(로그인 항목) — 셸도 앱도 따로 저장하지 않는다.
//   A49③ — contextBridge 로 이름 붙은 채널 화이트리스트 API(window.petit)만 노출.
//     ipcRenderer 원본·require·Node 모듈 노출 0건, 채널 인자는 전부 문자열 리터럴.
//
// 주의:
//   - sandbox:true 프리로드 — 사용 가능한 모듈은 electron(contextBridge·ipcRenderer)뿐.
//     무거운 작업(프로필 덤프·병합)은 전부 main(migrate.js)이 수행한다.
//   - DOM 은 createElement/textContent 로만 만든다 (금지 조항 — innerHTML 계열 전면 금지).
//   - 셸이 쓰는 저장 키는 additive 접두 키뿐: cal-migrated / cal-migrate-declined /
//     postit-onboarded — 앱 기존 키는 읽지도 쓰지도 않는다 (fresh 기본값 계약 무영향).
// ============================================================================

'use strict';

const { contextBridge, ipcRenderer } = require('electron');

// (버전 상수 폐지 — 발주 #28①: '0.9.0' 을 여기 한 번 더 적어 두면 릴리스마다 어긋난다.
//  버전 정본은 electron/package.json 하나이고, main 이 app.getVersion() 으로 내려 준다:
//  petit.shell.info().version · petit.startup.status().version)

// ── A49③: window.petit — 이름 붙은 채널 화이트리스트 래퍼만 노출 ────────────
// A43 계약(정본: grader a43 spec 상단 주석):
//   window.petit.migrate = { detect(), run(), status() } — 각각 Promise.
const migrateDetect = function () { return ipcRenderer.invoke('petit:migrate:detect'); };
const migrateRun = function () { return ipcRenderer.invoke('petit:migrate:run'); };
const migrateStatus = function () { return ipcRenderer.invoke('petit:migrate:status'); };

const petitApi = {
  migrate: {
    detect: migrateDetect,
    run: migrateRun,
    status: migrateStatus
  },
  // (사어 스텁 정리 2026-08-20: license.import — 라이선스 적용의 실경로는 앱 내 A45
  //  (postit.html verifyLicenseText)라 셸 스텁은 호출 0건 — 제거. onboarding.getState 도
  //  호출 0건 제거 — 완료 플래그의 정본은 렌더러 localStorage(postit-onboarded).)
  onboarding: {
    // 완료 통지만 유지 — finish() 가 호출한다 (정본은 localStorage)
    setDone: function () { return ipcRenderer.invoke('petit:onboarding:set-done'); }
  },
  backup: {
    // 백업 엔진(main: backup.js) — 폴더 지정·지금 백업(Free) + 예약 자동 백업(Pro 게이트)
    status: function () { return ipcRenderer.invoke('petit:backup:status'); },
    chooseFolder: function () { return ipcRenderer.invoke('petit:backup:choose-folder'); },
    runNow: function () { return ipcRenderer.invoke('petit:backup:run-now'); },
    setAuto: function (on) { return ipcRenderer.invoke('petit:backup:set-auto', on === true); },
    setIncludeImages: function (on) { return ipcRenderer.invoke('petit:backup:set-include-images', on === true); },
    // 폴더 열기 — 경로 인자가 없다: main 이 "현재 백업 폴더" 하나만 연다 (임의 경로 열기 불가)
    openFolder: function () { return ipcRenderer.invoke('petit:backup:open-folder'); },
    // 기본 폴더 1회 안내 확인 (발주 #24)
    ackNotice: function () { return ipcRenderer.invoke('petit:backup:ack-notice'); },
    // 첫 실행 자동 백업 선택 카드의 "나중에" — 답만 기록 (감사 잔여 조건 ③)
    ackAutoPrompt: function () { return ipcRenderer.invoke('petit:backup:ack-auto-prompt'); },
    // [복원] 파일 선택 (발주 #33 ④) — main dialog 로 백업 .json 을 골라 원문을 돌려받는다:
    // { ok, canceled? , name?, text?, reason? }. 적용은 앱 수신부 몫 (아래 복원 계약 주석).
    pickRestore: function () { return ipcRenderer.invoke('petit:backup:pick-restore'); }
  },
  // 셸 정보·진단·창 조작 (발주 #28·#30·#31) — 전부 로컬 처리, 외부 전송 0.
  shell: {
    /** 앱 정보·진단 원본 — { version, distribution, electron, chrome, os, displays, … } */
    info: function () { return ipcRenderer.invoke('petit:shell:info'); },
    /** 진단 정보를 클립보드로 (메모·일정 본문 미포함) — { ok, text } */
    copyDiagnostics: function () { return ipcRenderer.invoke('petit:shell:copy-diagnostics'); },
    /** 로그 폴더 열기 (userData\logs — 경로 인자 없음) */
    openLogs: function () { return ipcRenderer.invoke('petit:shell:open-logs'); },
    /** 항상 위 토글 — 적용 후 실측 상태를 되돌려준다 */
    setAlwaysOnTop: function (on) { return ipcRenderer.invoke('petit:shell:set-always-on-top', on === true); },
    /** 보드를 그림으로 — 'clipboard'(기본) 또는 'file' */
    captureBoard: function (mode) { return ipcRenderer.invoke('petit:shell:capture-board', mode === 'file' ? 'file' : 'clipboard'); },
    /** 닫을 때 트레이로 보내기 (발주 #33 ①) — shell-settings.json additive 필드에 영속 */
    setCloseToTray: function (on) { return ipcRenderer.invoke('petit:shell:set-close-to-tray', on === true); },
    /** 닫기 1회 선택 카드의 응답 (발주 #33 ①) — { tray, remember } 또는 { dismiss:true } */
    closeChoice: function (choice) {
      const c = choice && typeof choice === 'object' ? choice : {};
      return ipcRenderer.invoke('petit:shell:close-choice', {
        tray: c.tray === true,
        remember: c.remember !== false,
        dismiss: c.dismiss === true
      });
    }
  },
  startup: {
    // 윈도우 시작 시 자동 실행 — main 이 app.getLoginItemSettings/setLoginItemSettings 로
    // OS 로그인 항목을 직접 읽고 쓴다 (셸·앱 어디에도 이중 저장하지 않는다).
    // status(): 셸 상태 페이로드({ ok, …, openAtLogin }) / set(on): 적용 결과
    // ({ ok:true, openAtLogin } 또는 { ok:false, openAtLogin(실측), reason }).
    status: function () { return ipcRenderer.invoke('petit:shell:state'); },
    set: function (on) { return ipcRenderer.invoke('petit:shell:set-startup', on === true); },
    // main → 렌더러 상태 push 구독 (수신 전용 — 채널은 문자열 리터럴, A49③):
    // 탭바 드로어에서 바꾼 값이 앱 설정 모달에도 즉시 반영된다.
    onChange: function (handler) {
      if (typeof handler !== 'function') return;
      ipcRenderer.on('petit:shell:ui-push', function (_event, payload) {
        handler(payload && typeof payload === 'object' ? payload : null);
      });
    }
  }
  // (창 구성 브리지 정리 — 2026-08-20 rev.8: 창 분리 폐지로 셸 상태 조회·재병합 채널은
  //  앱 페이지에서 쓸 일이 없어 제거. 탭바 페이지의 브리지는 tabbar-preload.js 소관.)
};
contextBridge.exposeInMainWorld('petit', petitApi);

// ============================================================================
// 셸 UI 레이어 (isolated world 에서 DOM 주입 — 페이지 스크립트와 JS 격리, DOM 공유)
// ============================================================================

// 어느 앱 창인가 (loadFile 경로 기준)
const PAGE = (function () {
  const p = String(location.pathname || '').toLowerCase();
  if (p.endsWith('/calendar.html')) return 'calendar';
  if (p.endsWith('/postit.html')) return 'postit';
  return null;
})();

// createElement + style + textContent 헬퍼 (innerHTML 금지 조항 준수)
function el(tag, styles, text) {
  const node = document.createElement(tag);
  if (styles) Object.assign(node.style, styles);
  if (text !== undefined) node.textContent = text;
  return node;
}

/** el() + type="button" — 셸이 만드는 모든 버튼의 공통 생성기 (폼 submit 오동작 방지) */
function btnEl(styles, text) {
  const b = el('button', styles, text);
  b.type = 'button';
  return b;
}

// ── 셸 공통 스킨 (마이그레이션 카드·온보딩 카드·버튼이 같은 시각 언어를 쓴다) ──

// 오버레이 카드 공통 스킨
const CARD_SKIN = {
  boxSizing: 'border-box',
  background: '#fffdf5',
  border: '1px solid #e6d9bf',
  borderRadius: '14px',
  boxShadow: '0 8px 24px rgba(80, 60, 20, 0.22)',
  color: '#4a3f33',
  fontSize: '14px',
  lineHeight: '1.5',
  fontFamily: 'inherit'
};

// 담백한(고스트) 보조 버튼 공통 스킨 — "나중에"·"건너뛰기" 류 (padding 은 자리별 지정)
const GHOST_BTN = {
  font: 'inherit',
  fontSize: '13px',
  borderRadius: '10px',
  border: '1px solid #d8cbb0',
  background: 'transparent',
  color: '#6b5d49',
  cursor: 'pointer'
};

function lsGet(key) {
  try { return localStorage.getItem(key); } catch (_err) { return null; }
}
function lsSet(key, value) {
  try { localStorage.setItem(key, value); } catch (_err) { /* 저장 불가 시 UI만 유지 */ }
}

// ── 셸 비상호작용 힌트 오버레이 (토스트·칩) ─────────────────────────────────
// 온보딩을 4단계로 줄이면서 "읽기 전용 슬라이드"가 하던 일을 넘겨받은 대체 장치.
// 규칙: (1) pointerEvents:none — 앱의 클릭·드래그 경로를 절대 가로채지 않는다,
//       (2) 모션은 transform/opacity 뿐, (3) prefers-reduced-motion 과 앱의
//       [효과] 설정(body.fx-calm / body.fx-off)을 존중해 즉시 표시로 강등,
//       (4) 채점 훅과 겹치지 않는 자체 속성([data-shell-hint])만 쓴다.

/** 모션을 써도 되는가 — reduced-motion·앱 [효과] 설정 존중 */
function motionOk() {
  try {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return false;
  } catch (_err) { /* matchMedia 불가 환경 — 모션 허용 판단만 계속 */ }
  try {
    const cl = document.body && document.body.classList;
    if (cl && (cl.contains('fx-off') || cl.contains('fx-calm'))) return false;
  } catch (_err) { /* 무해 */ }
  return true;
}

const HINT_BASE = {
  ...CARD_SKIN,
  position: 'fixed',
  zIndex: '2147483400',            // 온보딩 카드(…500)보다 아래
  maxWidth: '360px',
  padding: '10px 16px',
  pointerEvents: 'none',           // 비상호작용 — 앱 조작 무간섭 (계약)
  textAlign: 'center'
};

const hintTimers = new Map();      // place → { node, hide, kill } — 자리별 1개만 유지

/**
 * 짧은 안내 오버레이 1개를 띄운다 (자동 소멸).
 * @param {string} text  안내 문구 (textContent 로만 주입)
 * @param {number} ms    표시 시간
 * @param {'bottom'|'bottomLeft'} place  자리 (자리마다 최신 1개만 산다)
 */
function shellHint(text, ms, place) {
  if (!document.body) return null;
  const spot = place || 'bottom';
  const prev = hintTimers.get(spot);
  if (prev) prev.kill();

  const node = el('div', HINT_BASE, text);
  node.setAttribute('data-shell-hint', spot);
  node.setAttribute('role', 'status');
  node.setAttribute('aria-live', 'polite');
  if (spot === 'bottomLeft') {
    Object.assign(node.style, { left: '16px', bottom: '16px', textAlign: 'left', fontSize: '13px' });
  } else {
    Object.assign(node.style, { left: '50%', bottom: '24px', transform: 'translateX(-50%)' });
  }
  const shift = spot === 'bottomLeft' ? 'translateY(8px)' : 'translateX(-50%) translateY(8px)';
  const rest = spot === 'bottomLeft' ? 'none' : 'translateX(-50%)';

  const anim = motionOk();
  if (anim) {
    node.style.opacity = '0';
    node.style.transform = shift;
    node.style.transition = 'opacity .22s ease, transform .22s ease';
  }
  document.body.appendChild(node);
  if (anim) {
    // 다음 프레임에 목표값 — 첫 페인트 전 전환이 삼켜지지 않게
    requestAnimationFrame(function () {
      node.style.opacity = '1';
      node.style.transform = rest;
    });
  }

  let hideTimer = null;
  let dropTimer = null;
  const kill = function () {
    if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
    if (dropTimer) { clearTimeout(dropTimer); dropTimer = null; }
    if (node.isConnected) node.remove();
    if (hintTimers.get(spot) && hintTimers.get(spot).node === node) hintTimers.delete(spot);
  };
  const hide = function () {
    if (!node.isConnected) return;
    if (!motionOk()) { kill(); return; }
    node.style.opacity = '0';
    node.style.transform = shift;
    dropTimer = setTimeout(kill, 260);
  };
  hideTimer = setTimeout(hide, Math.max(600, ms || 2600));
  hintTimers.set(spot, { node: node, hide: hide, kill: kill });
  return node;
}

// ────────────────────────────────────────────────────────────────────────────
// 마이그레이션 UI (대표 창인 캘린더 창 전용 — A43 발견성)
// 훅 계약(정본: grader a43 spec): [data-migrate] 카드 / [data-migrate-run] 실행 /
// [data-migrate-later] 거절(기억) / [data-migrate-open] 재진입 칩 /
// [data-migrate-status] 진행·결과 상태 (별칭 -accept·-reopen 병기 — 채점기 수용)
// ────────────────────────────────────────────────────────────────────────────

const MIGRATED_KEY = 'cal-migrated';            // additive 키 — 이전 완료 플래그
const DECLINED_KEY = 'cal-migrate-declined';    // additive 키 — "나중에" 기억(카드 대신 칩만)

let migCardEl = null;
let migChipEl = null;

const CARD_BASE = {
  ...CARD_SKIN,
  position: 'fixed',
  right: '16px',
  bottom: '64px',
  zIndex: '2147483600',
  width: '272px',
  padding: '14px 16px'
};

function removeMigCard() {
  if (migCardEl && migCardEl.isConnected) migCardEl.remove();
  migCardEl = null;
}

function removeMigChip() {
  if (migChipEl && migChipEl.isConnected) migChipEl.remove();
  migChipEl = null;
}

function buildMigCard() {
  if (migCardEl && migCardEl.isConnected) return;

  const card = el('div', CARD_BASE);
  card.setAttribute('data-migrate', '');

  card.appendChild(el('div', { fontWeight: '700', marginBottom: '6px' },
    '기존 Edge 버전 데이터를 가져올까요?'));
  card.appendChild(el('div', { fontSize: '12px', color: '#867a66', marginBottom: '10px' },
    '예전 캘린더·포스트잇 월(Edge)의 일정·노트·꾸미기를 이쪽으로 복사해 와요. 원본 데이터는 그대로 남아요.'));

  const statusLine = el('div', { fontSize: '12px', color: '#6b5d49', margin: '0 0 8px', minHeight: '0' }, '');
  statusLine.setAttribute('data-migrate-status', '');
  card.appendChild(statusLine);

  const row = el('div', { display: 'flex', gap: '8px', justifyContent: 'flex-end' });
  const btnLater = btnEl({ ...GHOST_BTN, padding: '6px 12px' }, '나중에');
  btnLater.setAttribute('data-migrate-later', '');
  const btnGo = btnEl(
    { ...GHOST_BTN, padding: '6px 12px', background: '#f4a9b8', border: '1px solid #e690a4', color: '#4a2530', fontWeight: '700' },
    '가져오기'
  );
  btnGo.setAttribute('data-migrate-run', '');    // A43 실행 훅 (정본 명칭)
  btnGo.setAttribute('data-migrate-accept', ''); // 동의어 별칭 병기
  row.appendChild(btnLater);
  row.appendChild(btnGo);
  card.appendChild(row);

  btnLater.addEventListener('click', function () {
    // 거절: 다음 실행부터는 카드 대신 재진입 칩만 (A43 — 거절 후에도 재진입 가능)
    lsSet(DECLINED_KEY, '1');
    removeMigCard();
  });

  btnGo.addEventListener('click', async function () {
    btnGo.disabled = true;
    btnLater.disabled = true;
    btnGo.style.opacity = '0.6';
    statusLine.textContent = '가져오는 중… (예전 Edge 프로필에서 데이터를 읽고 있어요)';
    let res = null;
    try {
      res = await migrateRun();
    } catch (err) {
      res = { ok: false, reason: String(err && err.message || err) };
    }
    if (res && res.ok) {
      lsSet(MIGRATED_KEY, '1');
      try { localStorage.removeItem(DECLINED_KEY); } catch (_err) { /* 없어도 무해 */ }
      statusLine.textContent = '가져오기 완료! ' + String(res.summary || '');
      removeMigChip();
      // 카드는 짧게 결과를 보여주고 닫는다. 새로 고침은 "이 창만, 충분히 지연 후":
      //  - 다른 창 자동 reload 금지 — reload 는 pagehide 로 창 상태 키(cal-window 등)를
      //    재기록해 방금 이전한 값을 덮고, 진행 중인 외부 스크립트 실행 컨텍스트도
      //    파괴할 수 있다 (a43 판정·병합 주입과 경합). 포스트잇 창은 재기동 시 반영.
      //  - 자기 창 reload 도 8초 지연 — 이전 직후의 저장소 관찰(판정·백업)이 끝날
      //    여유를 준 뒤 화면만 새로 고친다.
      setTimeout(removeMigCard, 1500);
      setTimeout(function () {
        try { location.reload(); } catch (_err) { /* 창이 닫히는 중 */ }
      }, 8000);
    } else {
      statusLine.textContent = '가져오기 실패: ' + String((res && res.reason) || '알 수 없는 오류') + ' — 다시 시도할 수 있어요.';
      btnGo.disabled = false;
      btnLater.disabled = false;
      btnGo.style.opacity = '';
    }
  });

  document.body.appendChild(card);
  migCardEl = card;
}

function buildMigChip() {
  if (migChipEl && migChipEl.isConnected) return;
  const chip = btnEl({
    position: 'fixed',
    right: '16px',
    bottom: '16px',
    zIndex: '2147483590',
    width: '36px',
    height: '36px',
    borderRadius: '50%',
    border: '1px solid #e6d9bf',
    background: '#fffdf5',
    boxShadow: '0 4px 12px rgba(80, 60, 20, 0.2)',
    fontSize: '17px',
    lineHeight: '1',
    cursor: 'pointer',
    padding: '0'
  }, '📦');
  chip.title = '기존 Edge 데이터 가져오기';
  chip.setAttribute('aria-label', '기존 Edge 데이터 가져오기');
  chip.setAttribute('data-migrate-open', '');   // A43 재진입 훅 (정본 명칭)
  chip.setAttribute('data-migrate-reopen', ''); // 동의어 별칭 병기 (채점기 둘 다 수용)
  chip.addEventListener('click', function () { buildMigCard(); });
  document.body.appendChild(chip);
  migChipEl = chip;
}

async function initMigrateUi() {
  if (PAGE !== 'calendar') return;             // 대표 창(캘린더)에만 표시 (a43 spec 정본)
  if (lsGet(MIGRATED_KEY) === '1') return;     // 이미 완료 — 어떤 UI 도 띄우지 않는다
  let det = null;
  try { det = await migrateDetect(); } catch (_err) { return; }
  if (!det || !det.any) return;                // 레거시 프로필 없음

  buildMigChip();                              // 재진입 칩은 항상 접근 가능
  if (lsGet(DECLINED_KEY) !== '1') buildMigCard();  // 첫 실행(미거절)엔 카드 표시

  // Escape 로도 닫을 수 있게 (electron-helpers dismiss 관례의 마지막 후보)
  document.addEventListener('keydown', function (ev) {
    if (ev.key === 'Escape' && migCardEl && migCardEl.isConnected) {
      lsSet(DECLINED_KEY, '1');
      removeMigCard();
    }
  }, true);
}

// ────────────────────────────────────────────────────────────────────────────
// 온보딩 (포스트잇 창 전용 — A47)
// 계약(정본: grader a47 spec 상단 REQUIRED CONTRACT):
//  - fresh 첫 실행에만 오버레이([data-onboarding]) 표시 — postit-onboarded 존재 시 미표시.
//  - 사용자 액션 단계 = 엄격 가시 [data-onboarding-target] "정확히 1개", 속성값이 액션을
//    선언 (click=빈 값 / fill / press:<Key> / drag:<CSS셀렉터>). 자동 안내 슬라이드는
//    target 0개 상태로 12초 내 자진 전진 (액션으로 계수되지 않는다) — 최소화 이후
//    이 엔진 기능은 남겨 두되 실제 여정에는 자동 슬라이드가 0개다 (ONBOARD_STEPS 참조).
//  - 총 사용자 액션 ≤8 에 fill ≥1(첫 포스트잇 실제 타이핑)·drag ≥1(첫 스티커 실제 드래그).
//  - 콘텐츠는 전부 사용자 입력분 — 온보딩이 노트·스티커를 자동 생성하면 FAIL (굿하트 차단).
//    셸이 발행하는 유일한 합성 이벤트는 "사용자 드래그 1회가 끝난 순간" 팔레트 단추의
//    앱 click 경로를 대신 눌러 주는 것뿐이다 (드래그 없이는 절대 발생하지 않는다).
//  - [data-onboarding-skip] 상시 표시. 설정 패널(#settingsPanel)에 [data-onboarding-replay]
//    를 셸이 주입 — 클릭 시 언제든 처음부터 재실행 (원본 HTML 무수정, A42).
// ────────────────────────────────────────────────────────────────────────────

const ONBOARDED_KEY = 'postit-onboarded';      // additive 키 — 값 존재 = 첫 실행 아님

// 여정(최소화): ＋ 새 포스트잇 클릭 → 노트 실제 타이핑(fill) → 꾸미기 열기(click)
//      → 스티커 실제 드래그 부착(drag:#board). 4단계 = 사용자 액션 4회 (≤8 계약).
//
// 최소화 원칙 — "읽기만 하는 단계는 단계가 아니다":
//   · 환영 슬라이드(자동 2.6s) 삭제 → 인사말을 1단계 문구에 흡수. 앱의 첫 화면 안내
//     카드(#welcome)가 이미 같은 말을 하고 있어 슬라이드는 순수 중복이었다.
//   · 축하 슬라이드(자동 2.4s) 삭제 → 완료 토스트(비상호작용)로 흡수. 끝난 뒤의 칭찬은
//     화면을 붙잡을 이유가 없다.
//   → 첫 실행에서 가만히 기다리는 시간 5.0s 제거, 단계 표시 6 → 4.
//   ※ 액션 단계 4개는 서로가 서로의 전제라 더 줄일 수 없다 (타이핑하려면 노트가,
//     스티커를 끌려면 꾸미기 서랍이 있어야 한다). A47 은 fill ≥1·drag ≥1 을 요구한다.
//
// 문구 규칙: 한 단계 한 문장, 지금 누를 것의 이름을 그대로 부른다.
// find = 지금 조작할 실제 앱 UI 셀렉터. markDelay = 전환(앱 렌더·패널 슬라이드 0.28s)이
// 끝난 뒤에야 지목한다 — 전환 중 좌표로 클릭·드래그 시작점이 빗나가지 않게.
// hint = 지목 대상을 못 찾는 상태가 이어질 때(대상이 닫히거나 지워졌을 때) 카드에 대신
// 띄우는 회복 문구. 안내가 "아무것도 가리키지 않은 채" 멈춰 보이지 않게 하는 장치다.
const ONBOARD_STEPS = [
  { find: '[data-add-note]', action: 'click', markDelay: 400,
    text: '반가워요! 🌷 "＋ 새 포스트잇"을 눌러 첫 장을 붙여 보세요.' },
  { find: '[data-note].editing [data-note-edit]', action: 'fill',
    text: '마음에 담아 둔 말을 적어 보세요. ✏️',
    hint: '포스트잇을 한 번 눌러 편집 상태로 만든 뒤 적어 보세요. ✏️ (＋ 로 새로 붙여도 돼요)' },
  { find: '#decorBtn', action: 'click',
    text: '이번엔 🎨 를 눌러 꾸미기 서랍을 열어요.' },
  { find: '#dpStSeason button', action: 'drag:#board', markDelay: 550,
    text: '스티커를 잡고 보드로 끌어와 붙여요. 🌸',
    hint: '🎨 꾸미기 서랍을 다시 열면 스티커를 붙일 수 있어요. 🌸' }
];

// 온보딩이 끝난 뒤의 대체 장치 문구 (읽기 전용 슬라이드를 대신한다)
const OB_DONE_TEXT = '다 됐어요! 🎉 이 보드는 이제 온전히 당신의 자리예요.';
const OB_SKIP_TEXT = '안내를 접었어요. ⚙️ 설정 → "처음 안내 다시 보기"로 언제든 다시 볼 수 있어요.';

let onboardingActive = false;                  // 중복 기동 방지 (재실행 버튼 연타 등)

function startOnboarding() {
  if (onboardingActive || !document.body) return;
  onboardingActive = true;

  // 지목 하이라이트 스타일 (정적 문자열만 — textContent 주입)
  // · 대상 요소 자체의 아웃라인 = 최후의 정적 강조 (스포트라이트가 못 뜨는 프레임에도 남는다)
  // · @keyframes = 링의 은은한 맥동 (transform/opacity 전용 — 레이아웃 무유발)
  // · reduced-motion 에서는 맥동을 CSS 로도 끈다 (JS 판정 motionOk() 와 이중 안전)
  const styleEl = document.createElement('style');
  styleEl.textContent =
    '[data-onboarding-target] { outline: 2px solid #ff8fab !important; outline-offset: 2px; border-radius: 8px; }' +
    '@keyframes petit-ob-pulse { 0%, 100% { transform: scale(1); opacity: .82 } 50% { transform: scale(1.045); opacity: 1 } }' +
    '@media (prefers-reduced-motion: reduce) { [data-shell-spotlight="ring"] { animation: none !important; transform: none !important } }';
  document.head.appendChild(styleEl);

  const root = el('div', {
    position: 'fixed',
    inset: '0',
    zIndex: '2147483500',
    pointerEvents: 'none'                       // 앱 조작을 막지 않는다 — 카드만 상호작용
  });
  root.setAttribute('data-onboarding', '');

  const card = el('div', {
    ...CARD_SKIN,
    position: 'fixed',
    left: '50%',
    bottom: '24px',
    transform: 'translateX(-50%)',
    maxWidth: '420px',
    padding: '14px 18px',
    pointerEvents: 'auto',
    textAlign: 'center'
  });

  const counter = el('div', { fontSize: '11px', color: '#a89a82', marginBottom: '4px' }, '');
  const textLine = el('div', { marginBottom: '10px' }, '');
  textLine.setAttribute('data-onboarding-text', '');
  const btnSkip = btnEl({ ...GHOST_BTN, padding: '5px 14px' }, '건너뛰기');
  btnSkip.setAttribute('data-onboarding-skip', '');   // 항상 보임 (A47 — 언제든 건너뛰기)
  card.appendChild(counter);
  card.appendChild(textLine);
  card.appendChild(btnSkip);

  // ── 스포트라이트 레이어 ("지금 눌러야 할 것"을 눈으로 찾게 해 주는 강조) ──
  // 구성: 딤(주변만 옅게) + 링(대상 사각형 + 여백, 맥동) + 삼각 포인터 +
  //       드래그 단계의 도착지 테두리·점선 경로.
  // 절대 규칙: 전부 [data-onboarding] 루트(pointerEvents:none) 안쪽의 비상호작용
  //   장식이다 — 각 노드도 pointerEvents:none 을 명시한다. 대상 위를 덮되 클릭·드래그를
  //   가로채면 안 된다 (채점기가 지목된 그 요소를 실제로 클릭·드래그한다).
  // 모션 규칙: transform/opacity 전용. reduced-motion·앱 [효과](fx-calm/fx-off)에서는
  //   맥동을 끄고 테두리를 두껍게·대비를 키운 정적 강조로 강등한다 (위치 표시는 유지).
  const SPOT_PAD = 8;                           // 대상 사각형 여백 (6~10px)
  const SPOT_HUE = '#ff8fab';                   // 셸 공통 지목색 (아웃라인과 동일 계열)
  const SPOT_BASE = { position: 'fixed', left: '0', top: '0', pointerEvents: 'none', display: 'none' };

  const spotDim = el('div', {
    ...SPOT_BASE,
    width: '0', height: '0', borderRadius: '12px',
    boxShadow: '0 0 0 9999px rgba(58, 44, 26, 0.18)',   // 대상만 뚫린 옅은 딤 (알파 ≤0.25)
    transform: 'translate3d(0px, 0px, 0)'
  });
  const spotRing = el('div', {
    ...SPOT_BASE, width: '0', height: '0', transform: 'translate3d(0px, 0px, 0)', willChange: 'transform'
  });
  const spotRingIn = el('div', {
    width: '100%', height: '100%', boxSizing: 'border-box',
    border: '3px solid ' + SPOT_HUE, borderRadius: '12px',
    boxShadow: '0 0 0 1px rgba(255, 255, 255, .6), 0 0 16px rgba(255, 143, 171, .5)',
    transformOrigin: '50% 50%'
  });
  spotRingIn.setAttribute('data-shell-spotlight', 'ring');
  spotRing.appendChild(spotRingIn);
  const spotArrow = el('div', {                 // 위를 가리키는 삼각형 (배치에 따라 rotate)
    ...SPOT_BASE, width: '0', height: '0',
    borderLeft: '9px solid transparent', borderRight: '9px solid transparent',
    borderBottom: '12px solid ' + SPOT_HUE,
    filter: 'drop-shadow(0 1px 2px rgba(80, 60, 20, .35))',
    transform: 'translate3d(0px, 0px, 0)', transformOrigin: '50% 50%'
  });
  const spotDrop = el('div', {                  // 드래그 도착지 영역
    ...SPOT_BASE, width: '0', height: '0', boxSizing: 'border-box',
    border: '2px dashed rgba(255, 143, 171, .8)', borderRadius: '16px',
    boxShadow: 'inset 0 0 40px rgba(255, 143, 171, .10)',
    transform: 'translate3d(0px, 0px, 0)'
  });
  const spotPath = el('div', {                  // 출발 → 도착 점선 경로
    ...SPOT_BASE, width: '0', height: '3px', borderRadius: '2px', opacity: '.72',
    background: 'repeating-linear-gradient(90deg, rgba(255,143,171,.95) 0 7px, rgba(255,143,171,0) 7px 15px)',
    transform: 'translate3d(0px, 0px, 0)', transformOrigin: '0 50%'
  });
  const spotNodes = [spotDim, spotDrop, spotPath, spotRing, spotArrow];
  spotDim.setAttribute('data-shell-spotlight', 'dim');
  spotRing.setAttribute('data-shell-spotlight', 'ringbox');
  spotArrow.setAttribute('data-shell-spotlight', 'arrow');
  spotDrop.setAttribute('data-shell-spotlight', 'drop');
  spotPath.setAttribute('data-shell-spotlight', 'path');
  spotNodes.forEach(function (n) {
    n.setAttribute('aria-hidden', 'true');      // 장식 — 보조기술에는 카드 문구만 남긴다
    root.appendChild(n);                        // 카드보다 먼저 = 카드가 항상 위에 그려진다
  });

  root.appendChild(card);
  document.body.appendChild(root);

  let idx = -1;
  let currentTarget = null;
  let currentAction = null;                     // 'click' | 'fill' | 'drag'
  let autoTimer = null;
  let locateTimer = null;
  let markTimer = null;
  let fillTimer = null;
  let guardTimer = null;                        // 지목한 대상이 사라졌는지 감시 (정지 자가 복구)
  let hintTimer = null;                         // 대상을 못 찾는 상태가 길어지면 회복 문구로 교체
  let fillLastVal = null;
  let dragArm = null;                           // { el, x, y } — 드래그 시작 스냅숏
  let finished = false;
  let spotRaf = null;                           // 스포트라이트 추적 rAF 핸들 (단계 종료 시 취소)
  let spotDest = null;                          // 드래그 도착지 요소 (drag 단계에서만)
  let spotMotion = null;                        // 현재 적용된 모션 모드 (true=맥동 / false=정적)
  let spotSig = '';                             // 마지막 배치 서명 — 변화 없는 프레임은 무기록
  let spotFrame = 0;

  function clearTimers() {
    if (autoTimer) { clearTimeout(autoTimer); autoTimer = null; }
    if (locateTimer) { clearInterval(locateTimer); locateTimer = null; }
    if (markTimer) { clearTimeout(markTimer); markTimer = null; }
    if (fillTimer) { clearInterval(fillTimer); fillTimer = null; }
    if (guardTimer) { clearInterval(guardTimer); guardTimer = null; }
    if (hintTimer) { clearTimeout(hintTimer); hintTimer = null; }
  }

  // 지목 대상이 아직 "조작 가능한가" — DOM 이탈·display:none·0크기를 한 번에 본다.
  // 2단계(노트 편집창)는 blur 로 .editing 이 벗겨지면 textarea 가 display:none 이 되는데,
  // 그때 currentTarget 은 그 숨은 노드를 계속 가리켜 fill 감시가 영원히 전진하지 않았다.
  function targetUsable(el) {
    if (!el || !el.isConnected) return false;
    try {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    } catch (_err) { return false; }
  }

  // 대상이 사라지면 그 단계를 다시 "탐색 중" 으로 되돌린다 — 사용자가 편집창을 다시 열거나
  // 패널을 다시 열면 스스로 이어진다. (건너뛰기 말고도 빠져나올 길을 만드는 것이 목적)
  function startTargetGuard(stepIndex) {
    if (guardTimer) { clearInterval(guardTimer); guardTimer = null; }
    guardTimer = setInterval(function () {
      if (finished || idx !== stepIndex) return;
      if (!currentTarget) return;               // 아직 지목 전 — locate 가 담당
      if (targetUsable(currentTarget)) return;
      showStep(stepIndex);                      // 같은 단계를 재무장 (문구·카운터 그대로)
    }, 400);
  }

  function clearTargetMark() {
    if (currentTarget) {
      try { currentTarget.removeAttribute('data-onboarding-target'); } catch (_err) { /* DOM 이탈 무해 */ }
    }
    currentTarget = null;
    currentAction = null;
    spotStop();                                 // 강조 오버레이·추적 rAF 도 함께 내린다
  }

  // 안내 카드가 지목 대상을 덮으면 카드를 위쪽으로 옮긴다 — 단일 창 탭 모드(A42 rev.8)
  // 에서는 뷰 높이가 탭바(40px)만큼 줄어 하단 고정 카드가 꾸미기 팔레트와 겹칠 수 있다.
  // 카드는 pointerEvents:auto 라 겹치면 드래그 pointerdown 을 가로챈다 (실측 회귀).
  function repositionCardAwayFromTarget() {
    try {
      if (!currentTarget || !card.isConnected) return;
      const cr = card.getBoundingClientRect();
      const tr = currentTarget.getBoundingClientRect();
      const overlap = !(
        tr.right < cr.left - 8 || tr.left > cr.right + 8 ||
        tr.bottom < cr.top - 8 || tr.top > cr.bottom + 8
      );
      if (overlap) {
        card.style.bottom = 'auto';
        card.style.top = '24px';
      }
    } catch (_err) { /* 측정 실패 시 기본 위치 유지 */ }
  }

  // ── 스포트라이트 추적 엔진 ────────────────────────────────────────────────
  // 대상은 스크롤·리사이즈·패널 개폐(슬라이드 0.28s)·노트 드래그로 계속 움직인다.
  // 이벤트를 하나씩 듣는 대신 단계가 살아 있는 동안만 rAF 로 실측 rect 를 따라간다
  // (transform 애니메이션 중인 요소도 프레임 단위로 정확히 따라잡는다). 배치 서명이
  // 같은 프레임은 스타일을 쓰지 않아 불필요한 페인트를 만들지 않는다.

  /** 맥동 ↔ 정적 강등 전환 (reduced-motion·앱 [효과] 설정 존중) */
  function spotSetMotion(on) {
    if (spotMotion === on) return;
    spotMotion = on;
    if (on) {
      spotRingIn.style.animation = 'petit-ob-pulse 1.6s ease-in-out infinite';
      spotRingIn.style.transform = '';
      spotRingIn.style.borderWidth = '3px';
      spotRingIn.style.opacity = '';
      spotRingIn.style.boxShadow = '0 0 0 1px rgba(255, 255, 255, .6), 0 0 16px rgba(255, 143, 171, .5)';
      spotDim.style.boxShadow = '0 0 0 9999px rgba(58, 44, 26, 0.18)';
    } else {
      // 강등: 움직임 없이 테두리·대비만으로 지목한다 (위치 표시는 그대로 유지)
      spotRingIn.style.animation = 'none';
      spotRingIn.style.transform = 'none';
      spotRingIn.style.borderWidth = '4px';
      spotRingIn.style.opacity = '1';
      spotRingIn.style.boxShadow = '0 0 0 2px rgba(255, 255, 255, .85), 0 0 0 5px rgba(255, 143, 171, .3)';
      spotDim.style.boxShadow = '0 0 0 9999px rgba(58, 44, 26, 0.22)';   // 대비만 조금 더 (≤0.25)
    }
  }

  function spotHideAll() {
    spotNodes.forEach(function (n) { n.style.display = 'none'; });
    spotSig = '';
  }

  /** 단계 종료·온보딩 종료 공용 정리 — rAF 취소 + 전 노드 숨김 (누수 금지) */
  function spotStop() {
    if (spotRaf) { cancelAnimationFrame(spotRaf); spotRaf = null; }
    spotDest = null;
    spotHideAll();
  }

  /** 현재 단계의 대상 추적 시작 (destSel = drag 단계의 도착지 셀렉터, 없으면 null) */
  function spotStart(destSel) {
    spotDest = null;
    if (destSel) {
      try { spotDest = document.querySelector(destSel); } catch (_err) { spotDest = null; }
    }
    spotSig = '';
    spotFrame = 0;
    spotSetMotion(motionOk());
    if (!spotRaf) spotRaf = requestAnimationFrame(spotLoop);
  }

  function spotLoop() {
    spotRaf = requestAnimationFrame(spotLoop);
    try {
      if (finished || !currentTarget || !currentTarget.isConnected) {
        if (spotSig) spotHideAll();
        return;
      }
      if ((spotFrame++ % 30) === 0) spotSetMotion(motionOk());   // 설정·미디어 변경 추종 (약 0.5s)
      const r = currentTarget.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) {                       // 접힌 패널 안 등 — 표시할 자리 없음
        if (spotSig) spotHideAll();
        return;
      }
      spotPlace(r);
    } catch (_err) { /* 한 프레임 측정 실패는 다음 프레임에 회복 */ }
  }

  function spotPlace(r) {
    const vw = window.innerWidth || 0;
    const vh = window.innerHeight || 0;
    const x = Math.round(r.left - SPOT_PAD);
    const y = Math.round(r.top - SPOT_PAD);
    const w = Math.round(r.width + SPOT_PAD * 2);
    const h = Math.round(r.height + SPOT_PAD * 2);
    const rad = Math.max(8, Math.min(16, Math.round(Math.min(w, h) / 3)));
    let dr = null;
    if (currentAction === 'drag' && spotDest && spotDest.isConnected) {
      const d = spotDest.getBoundingClientRect();
      if (d.width > 24 && d.height > 24) dr = d;
    }
    const sig = [x, y, w, h, vw, vh, dr ? Math.round(dr.left) : -1, dr ? Math.round(dr.top) : -1,
      dr ? Math.round(dr.width) : -1, dr ? Math.round(dr.height) : -1].join(',');
    if (sig === spotSig) return;                 // 움직임 없음 — 이 프레임은 아무것도 쓰지 않는다
    spotSig = sig;

    const tx = 'translate3d(' + x + 'px, ' + y + 'px, 0)';
    spotDim.style.width = w + 'px';
    spotDim.style.height = h + 'px';
    spotDim.style.borderRadius = rad + 'px';
    spotDim.style.transform = tx;
    spotDim.style.display = 'block';
    spotRing.style.width = w + 'px';
    spotRing.style.height = h + 'px';
    spotRing.style.transform = tx;
    spotRing.style.display = 'block';
    spotRingIn.style.borderRadius = rad + 'px';

    // 삼각 포인터: 화면 안이면서 안내 카드와 겹치지 않는 첫 자리 (아래→위→오른쪽→왼쪽)
    const cr = card.isConnected ? card.getBoundingClientRect() : null;
    const usable = function (px, py) {
      if (px < 16 || py < 16 || px > vw - 16 || py > vh - 16) return false;
      if (cr && px > cr.left - 10 && px < cr.right + 10 && py > cr.top - 10 && py < cr.bottom + 10) return false;
      return true;
    };
    const gap = 12;
    const spots = [
      { x: x + w / 2, y: y + h + gap, deg: 0 },   // 아래에 두고 위(대상)를 가리킨다
      { x: x + w / 2, y: y - gap, deg: 180 },
      { x: x + w + gap, y: y + h / 2, deg: 270 },
      { x: x - gap, y: y + h / 2, deg: 90 }
    ];
    let put = null;
    for (let i = 0; i < spots.length && !put; i++) {
      if (usable(spots[i].x, spots[i].y)) put = spots[i];
    }
    if (put) {
      spotArrow.style.transform =
        'translate3d(' + Math.round(put.x - 9) + 'px, ' + Math.round(put.y - 6) + 'px, 0) rotate(' + put.deg + 'deg)';
      spotArrow.style.display = 'block';
    } else {
      spotArrow.style.display = 'none';
    }

    // 드래그 단계: 도착지 테두리 + 출발→도착 점선 경로 (링 바깥에서 시작해 겹치지 않게)
    if (dr) {
      spotDrop.style.width = Math.max(0, Math.round(dr.width - 20)) + 'px';
      spotDrop.style.height = Math.max(0, Math.round(dr.height - 20)) + 'px';
      spotDrop.style.transform =
        'translate3d(' + Math.round(dr.left + 10) + 'px, ' + Math.round(dr.top + 10) + 'px, 0)';
      spotDrop.style.display = 'block';
      const ax = r.left + r.width / 2;
      const ay = r.top + r.height / 2;
      const bx = dr.left + dr.width / 2;
      const by = dr.top + dr.height / 2;
      const len = Math.hypot(bx - ax, by - ay);
      const off = Math.min(len * 0.4, Math.hypot(w, h) / 2 + 8);
      const plen = Math.round(len - off - 16);
      if (plen > 24) {
        const ux = (bx - ax) / len;
        const uy = (by - ay) / len;
        const deg = (Math.atan2(by - ay, bx - ax) * 180) / Math.PI;
        spotPath.style.width = plen + 'px';
        spotPath.style.transform =
          'translate3d(' + Math.round(ax + ux * off) + 'px, ' + Math.round(ay + uy * off - 1.5) + 'px, 0) ' +
          'rotate(' + deg.toFixed(2) + 'deg)';
        spotPath.style.display = 'block';
      } else {
        spotPath.style.display = 'none';
      }
    } else {
      spotDrop.style.display = 'none';
      spotPath.style.display = 'none';
    }
  }

  function showStep(i) {
    clearTimers();
    clearTargetMark();                          // 이전 target 제거 — "정확히 1개" 계약
    dragArm = null;
    fillLastVal = null;
    idx = i;
    const st = ONBOARD_STEPS[i];
    counter.textContent = (i + 1) + ' / ' + ONBOARD_STEPS.length;
    textLine.textContent = st.text;
    card.style.top = 'auto';                    // 단계마다 기본 위치(하단 중앙)로 복귀
    card.style.bottom = '24px';

    if (st.auto) {                              // 자동 안내 슬라이드 — target 0개, 자진 전진
      autoTimer = setTimeout(function () {
        if (!finished && idx === i) advance();
      }, st.auto);
      return;
    }

    // 대상 탐색: 앱 렌더 직후 잠깐 없을 수 있어 단계가 살아 있는 동안 재시도
    // (못 찾는 동안에도 [data-onboarding-skip] 으로 언제든 건너뛸 수 있다)
    const locate = function () {
      if (finished || idx !== i) return true;   // 단계 이탈 — 탐색 종료
      let t = null;
      try { t = document.querySelector(st.find); } catch (_err) { t = null; }
      if (!t) return false;
      const mark = function () {
        if (finished || idx !== i || currentTarget) return;
        currentTarget = t;
        currentAction = st.action === 'fill' ? 'fill' : (st.action.indexOf('drag:') === 0 ? 'drag' : 'click');
        try { t.setAttribute('data-onboarding-target', st.action === 'click' ? '' : st.action); } catch (_err) { /* 무해 */ }
        repositionCardAwayFromTarget();         // 카드가 대상을 덮지 않게 (드래그 가로채기 방지)
        // 지목과 동시에 스포트라이트 추적 시작 (drag 단계는 도착지까지 함께 표시)
        spotStart(currentAction === 'drag' ? st.action.slice(5).trim() : null);
        if (currentAction === 'fill') startFillWatch();
        if (hintTimer) { clearTimeout(hintTimer); hintTimer = null; }
        textLine.textContent = st.text;         // 회복 문구가 떠 있었다면 원래 문구로 되돌린다
        startTargetGuard(i);                    // 이 대상이 사라지면 스스로 재무장
      };
      if (st.markDelay) markTimer = setTimeout(mark, st.markDelay);
      else mark();
      return true;
    };
    if (!locate()) {
      // 대상이 곧 나타나는 것이 정상(앱 렌더 직후)이므로 조용히 기다리되, 오래 못 찾으면
      // "무엇을 해야 대상이 돌아오는지" 를 말해 준다 — 지목 없이 멈춘 것처럼 보이지 않게.
      if (st.hint) {
        hintTimer = setTimeout(function () {
          if (!finished && idx === i && !currentTarget) textLine.textContent = st.hint;
        }, 2500);
      }
      locateTimer = setInterval(function () {
        if (locate() && locateTimer) { clearInterval(locateTimer); locateTimer = null; }
      }, 180);
    }
  }

  // fill 단계: 값이 비어 있지 않고 ~1초간 그대로면 "타이핑을 마쳤다"로 보고 전진.
  // 텍스트는 앱의 원래 input→저장 흐름에 그대로 남는다 (셸은 값을 만들지도 바꾸지도 않는다).
  function startFillWatch() {
    fillTimer = setInterval(function () {
      try {
        if (finished || currentAction !== 'fill' || !currentTarget) return;
        const v = 'value' in currentTarget ? currentTarget.value : currentTarget.textContent;
        if (v && String(v).trim() !== '' && v === fillLastVal) { advance(); return; }
        fillLastVal = v;
      } catch (_err) { /* 무해 */ }
    }, 500);
  }

  function advance() {
    if (finished) return;
    const next = idx + 1;
    if (next >= ONBOARD_STEPS.length) finish('done');
    else showStep(next);
  }

  function finish(mode) {
    if (finished) return;
    finished = true;
    clearTimers();
    clearTargetMark();                          // 내부에서 spotStop() — rAF·오버레이 정리
    spotStop();                                 // 대상 없이 끝난 경로(자동 슬라이드 중 skip)도 확실히
    document.removeEventListener('click', onDocClick, true);
    document.removeEventListener('pointerdown', onDocPointerDown, true);
    document.removeEventListener('pointerup', onDocPointerUp, true);
    if (root.isConnected) root.remove();
    if (styleEl.isConnected) styleEl.remove();
    onboardingActive = false;
    lsSet(ONBOARDED_KEY, mode);                 // 완료 플래그 정본 — 재기동 시 재표시 금지
    petitApi.onboarding.setDone().catch(function () { /* 스텁 실패 무해 — 정본은 localStorage */ });
    // 삭제한 자동 슬라이드의 대체 장치 — 화면을 붙잡지 않는 비상호작용 토스트.
    // 건너뛰기 쪽은 "되돌아오는 길"을 알려 준다 (단계를 줄인 만큼 재진입이 중요하다).
    try {
      shellHint(mode === 'skip' ? OB_SKIP_TEXT : OB_DONE_TEXT, mode === 'skip' ? 4200 : 2800, 'bottom');
    } catch (_err) { /* 힌트 실패는 앱 무영향 */ }
    armCtxHint();                               // 이제부터 "첫 우클릭" 힌트를 지켜본다
    maybeShowAutoBackupPrompt();                // 안내가 걷힌 뒤 자동 백업을 1회 묻는다 (③)
  }

  // ── 전진 판정: 사용자 발행(isTrusted) 입력만 계수 (합성 이벤트·자동 전진 계수 금지) ──

  function onDocClick(ev) {
    try {
      if (!ev.isTrusted || finished || !currentTarget) return;
      if (currentAction !== 'click' && currentAction !== 'drag') return;
      const t = ev.target;
      if (t !== currentTarget && !(currentTarget.contains && currentTarget.contains(t))) return;
      // click 단계 완료. drag 단계에서 "이동 없는 클릭"이었다면 앱 팔레트의 원래 click
      // 경로가 그대로 부착하므로 — 사용자 입력 1회에 의한 부착 — 역시 완료로 본다.
      advance();
    } catch (_err) { /* 무해 */ }
  }

  function onDocPointerDown(ev) {
    try {
      if (!ev.isTrusted || finished) return;
      if (currentAction !== 'drag' || !currentTarget) return;
      const t = ev.target;
      if (t === currentTarget || (currentTarget.contains && currentTarget.contains(t))) {
        dragArm = { el: currentTarget, x: ev.clientX || 0, y: ev.clientY || 0 };
      }
    } catch (_err) { /* 무해 */ }
  }

  function onDocPointerUp(ev) {
    try {
      if (!ev.isTrusted || finished) return;
      const arm = dragArm;
      dragArm = null;
      if (!arm || currentAction !== 'drag' || currentTarget !== arm.el) return;
      const t = ev.target;
      if (t === arm.el || (arm.el.contains && arm.el.contains(t))) return;  // 클릭 — onDocClick 경로
      const dx = (ev.clientX || 0) - arm.x;
      const dy = (ev.clientY || 0) - arm.y;
      if (Math.hypot(dx, dy) < 24) return;      // 짧은 흔들림 — 드래그로 보지 않는다 (재시도 가능)
      // 사용자 드래그 1회 완료 — 팔레트 단추의 앱 click 경로로 부착시킨다.
      // 이 합성 click 은 isTrusted=false 라 위 판정들이 무시한다 (이중 계수 없음).
      try {
        arm.el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
      } catch (_err) { /* 무해 */ }
      advance();
    } catch (_err) { /* 무해 */ }
  }

  btnSkip.addEventListener('click', function () { finish('skip'); });
  document.addEventListener('click', onDocClick, true);
  document.addEventListener('pointerdown', onDocPointerDown, true);
  document.addEventListener('pointerup', onDocPointerUp, true);
  showStep(0);
}

// 설정 패널에 재실행 컨트롤 주입 ([data-onboarding-replay] — rev.6 신설 훅, 원본 HTML 무수정).
// 패널(#settingsPanel)은 닫힘 시 visibility:hidden 이므로 주입 버튼도 함께 숨는다
// — "설정을 연 뒤에만 보인다"는 채점기 엄격 가시성 관찰과 자연스럽게 일치한다.
function injectOnboardingReplay() {
  const panel = document.getElementById('settingsPanel');
  if (!panel || panel.querySelector('[data-onboarding-replay]')) return;
  const sec = el('div');
  sec.className = 'sp-sec';                    // 앱 패널 관용 스타일 재사용 (DOM 공유)
  const head = el('h3', undefined, '처음 안내');
  const row = el('div');
  row.className = 'sp-row';
  const btn = btnEl(undefined, '🌱 처음 안내 다시 보기');
  btn.className = 'tool-btn';
  btn.setAttribute('data-onboarding-replay', '');
  btn.addEventListener('click', function () {
    try { startOnboarding(); } catch (_err) { /* 무해 */ }
  });
  const small = el('p', undefined, '첫 만남 때의 안내를 처음부터 다시 진행해요. 언제든 건너뛸 수 있어요.');
  small.className = 'sp-small';
  row.appendChild(btn);
  sec.appendChild(head);
  sec.appendChild(row);
  sec.appendChild(small);
  panel.appendChild(sec);
}

// ── 대체 장치: "첫 우클릭" 힌트 (온보딩 밖에서 딱 한 번) ────────────────────
// 온보딩을 4단계로 줄이면서 "우클릭 메뉴"는 아예 가르치지 않기로 했다. 대신 온보딩이
// 끝난 뒤(또는 이미 끝낸 프로필에서) 첫 메모가 생겼을 때 한 번만, 화면을 붙잡지 않는
// 칩으로 알린다. 사용자가 먼저 우클릭했다면 가르칠 것이 없으므로 조용히 물러난다.
// 앱 첫 화면의 빈 상태 안내는 앱이 이미 담당한다(postit.html #welcome — 붙이기·옮기기·
// 고치기·색·떼어내기 5줄). 셸이 같은 말을 겹쳐 쓰지 않는다 (원본 무수정·중복 금지).
const CTX_HINT_KEY = 'postit-hint-ctx';        // additive 키 — 1회성 표시 플래그
const CTX_HINT_TEXT = '메모를 마우스 오른쪽 단추로 눌러 보세요 — 색·크기·사진·날짜·삭제가 거기 다 있어요.';

let ctxHintTimer = null;                       // 표시 조건 감시 (조건 충족·5분 경과 시 해제)
let ctxHintBound = false;                      // contextmenu 관찰자 1회 등록

function markCtxHintSeen() {
  lsSet(CTX_HINT_KEY, '1');
  if (ctxHintTimer) { clearInterval(ctxHintTimer); ctxHintTimer = null; }
}

function armCtxHint() {
  if (PAGE !== 'postit' || ctxHintTimer) return;
  if (lsGet(CTX_HINT_KEY) !== null) return;    // 이미 본 프로필 — 두 번 말하지 않는다
  if (!ctxHintBound) {
    ctxHintBound = true;
    document.addEventListener('contextmenu', function () {
      markCtxHintSeen();                       // 스스로 찾아냈다 — 힌트 불요
      const h = hintTimers.get('bottomLeft');
      if (h) h.hide();
    }, true);
  }
  const started = Date.now();
  ctxHintTimer = setInterval(function () {
    try {
      if (lsGet(CTX_HINT_KEY) !== null) { markCtxHintSeen(); return; }
      if (Date.now() - started > 300000) {     // 5분간 메모가 없으면 지켜보기를 그만둔다
        clearInterval(ctxHintTimer);
        ctxHintTimer = null;
        return;
      }
      if (onboardingActive) return;            // 온보딩 중에는 말을 겹치지 않는다
      if (hintTimers.get('bottom')) return;    // 완료·건너뛰기 토스트가 물러난 뒤에 (한 번에 한 마디)
      if (!document.querySelector('[data-note]')) return;  // 붙일 메모가 생긴 뒤에만 의미가 있다
      markCtxHintSeen();                       // 플래그 먼저 — 중복 표시 차단
      shellHint(CTX_HINT_TEXT, 9000, 'bottomLeft');
    } catch (_err) { /* 무해 */ }
  }, 1200);
}

// ── 온보딩 반복 차단 (발주 #29) ─────────────────────────────────────────────
// 결함: 완료 플래그는 finish() 에서만 기록된다. 2단계까지 하고 창을 닫는 "가장 흔한
// 첫날 패턴"에서는 플래그가 안 써져, **메모가 이미 붙어 있는데도** 재실행마다
// "1 / 4 — 첫 장을 붙여 보세요"가 처음부터 다시 뜬다 (실측 재현).
//
// 선택한 해법: "노트가 1장 이상이면 자동 종료". 근거 —
//   ① 온보딩이 가르치는 것은 "첫 장을 붙이는 법"인데, 이미 붙인 사람에게는 가르칠 것이
//      남아 있지 않다. 화면에 보이는 사실(노트 존재)이 어떤 진행 플래그보다 정확하다.
//   ② 진행 상태를 따로 적으려면 저장 키·필드를 새로 만들어야 하는데, 완료 플래그
//      (postit-onboarded) 하나로 끝나는 편이 스키마를 넓히지 않는다 (additive 값만 사용).
//   ③ A47 계약 무영향: fresh 프로필은 노트 0장이라 첫 표시는 그대로다. 재기동 시
//      재표시 금지 조항도 같은 방향이다.
// 노트가 0장인 채로 이탈했다면 아무것도 배우지 못한 것이므로 처음부터 다시 안내한다
// (그 프로필의 보드는 여전히 비어 있다 — 반복이 아니라 정상적인 첫 안내다).

/** 이 보드에 이미 메모가 있는가 — 앱이 localStorage 에서 동기 렌더한 결과를 그대로 읽는다 */
function boardHasNotes() {
  try {
    return !!document.querySelector('[data-note]');
  } catch (_err) {
    return false;
  }
}

const OB_AUTO_TEXT = '메모가 이미 있어서 처음 안내는 접어 뒀어요. ⚙️ 설정 → "처음 안내 다시 보기"에서 언제든 볼 수 있어요.';

// ── 첫 실행 자동 백업 선택 카드 (감사 잔여 조건 ③ — "기본 ON 또는 1회 명시 선택") ──
// 기본값 ON 은 A45 fresh 계약(끔 → 토글 → auto:true 실증)과 충돌하므로 명시 선택 안.
// 온보딩이 끝난 프로필에서 1회만 묻고, 켜기/나중에 어느 쪽이든 답하면 다시 묻지 않는다
// (답 없이 종료하면 다음 실행에 다시). 설정에서 직접 토글해도 main 이 답으로 기록한다.
// 좌하단·z 99990 — 앱 모달(z 100000+)이 항상 위에 오고, 이관 칩(우하단)과 겹치지 않는다.
let autoPromptShown = false;                   // 세션당 1회 (finish 경로·기동 경로 중복 방지)

function maybeShowAutoBackupPrompt() {
  if (PAGE !== 'postit' || autoPromptShown) return;
  setTimeout(function () {
    if (autoPromptShown || onboardingActive) return;
    petitApi.backup.status().then(function (st) {
      if (!st || !st.ok || st.auto === true || st.autoPromptAck === true) return;
      if (autoPromptShown || onboardingActive || !document.body) return;
      autoPromptShown = true;

      const card = el('div', {
        ...CARD_SKIN,
        position: 'fixed',
        left: '16px',
        bottom: '16px',
        zIndex: '99990',                       // 앱 모달(100000+) 아래 — 설정 창이 열리면 덮인다
        maxWidth: '300px',
        padding: '12px 14px',
        pointerEvents: 'auto'
      });
      card.setAttribute('data-backup-auto-prompt', '');
      card.setAttribute('role', 'dialog');
      card.setAttribute('aria-label', '자동 백업 켜기 선택');

      const msg = el('p', { margin: '0 0 10px', fontSize: '13.5px' },
        '💾 매일 자동 백업을 켜 둘까요? 메모를 문서 폴더에 안전하게 보관해요.');
      card.appendChild(msg);

      const row = el('div', { display: 'flex', gap: '8px', justifyContent: 'flex-end' });
      const btnLater = btnEl({
        ...GHOST_BTN, padding: '6px 12px', borderRadius: '9px', cursor: 'pointer', fontSize: '13px'
      }, '나중에');
      const btnOn = btnEl({
        font: 'inherit', fontSize: '13px', padding: '6px 14px', borderRadius: '9px',
        border: '1px solid #d8b24a', background: '#ffd977', color: '#4a3a10',
        cursor: 'pointer', fontWeight: '600'
      }, '켜 둘게요');
      row.appendChild(btnLater);
      row.appendChild(btnOn);
      card.appendChild(row);

      const close = function () { try { card.remove(); } catch (_err) { /* 무해 */ } };
      // 답 없이 두면 조용히 접는다 — ack 를 남기지 않으므로 다음 실행에 다시 묻는다
      // (화면을 붙잡는 시간을 짧게 — 앱 조작과의 간섭 창 최소화)
      const idleTimer = setTimeout(close, 25000);
      btnLater.addEventListener('click', function () {
        clearTimeout(idleTimer);
        petitApi.backup.ackAutoPrompt().catch(function () { /* 실패 시 다음 실행에 다시 묻는다 */ });
        close();
      });
      btnOn.addEventListener('click', function () {
        clearTimeout(idleTimer);
        btnOn.disabled = true;
        petitApi.backup.setAuto(true).then(function (res) {
          msg.textContent = res && res.ok
            ? '✅ 켜 뒀어요! 백업 폴더는 ⚙️ 설정 → [데이터]에서 볼 수 있어요.'
            : '설정에 실패했어요. ⚙️ 설정 → [데이터]에서 다시 시도해 주세요.';
          row.remove();
          setTimeout(close, 4200);
        }).catch(function () {
          msg.textContent = '설정에 실패했어요. ⚙️ 설정 → [데이터]에서 다시 시도해 주세요.';
          row.remove();
          setTimeout(close, 4200);
        });
      });
      document.body.appendChild(card);
    }).catch(function () { /* 브리지 실패 — 다음 실행에 다시 */ });
  }, 4800);                                    // 온보딩 종료 토스트(≤4.2s)가 걷힌 뒤에 묻는다
}

function initOnboarding() {
  if (PAGE !== 'postit') return;
  injectOnboardingReplay();                    // 재실행 진입점은 항상 준비 (완료·건너뛰기 후 포함)
  if (lsGet(ONBOARDED_KEY) !== null) {         // fresh userData 에서만 자동 표시
    armCtxHint();                              // 이미 끝낸 프로필 — 우클릭 힌트만 지켜본다
    maybeShowAutoBackupPrompt();               // 온보딩을 이미 마친 프로필에도 1회는 묻는다
    return;
  }
  // 앱 초기화(load)가 끝난 뒤 시작 — fresh 첫 기동의 무거운 초기화와 첫 클릭이
  // 경합하지 않게 한다 (오버레이는 load 직후 표시 — 15초 표시 계약에 충분).
  const begin = function () {
    if (boardHasNotes()) {
      // 중도 이탈 프로필 — 완료로 표시하고 물러난다 (재실행 진입점은 설정에 남아 있다)
      lsSet(ONBOARDED_KEY, 'auto');
      try { shellHint(OB_AUTO_TEXT, 4200, 'bottomLeft'); } catch (_err) { /* 힌트 실패는 앱 무영향 */ }
      armCtxHint();
      maybeShowAutoBackupPrompt();             // 좌하단 힌트(4.2s)가 걷힌 뒤라 자리 충돌 없음
      return;
    }
    startOnboarding();
  };
  if (document.readyState === 'complete') begin();
  else window.addEventListener('load', begin, { once: true });
}

// ────────────────────────────────────────────────────────────────────────────
// 닫기 1회 선택 카드 (발주 #33 ①)
// main 의 닫기 인터셉트가 'petit:shell:close-ask' 로 요청한다: X 를 눌렀고
// closeToTray=false·closeAskAck=false 인 첫 회에만 온다 (활성 앱 뷰 1곳).
// [트레이에 두기] = closeToTray:true 저장 후 창 hide / [완전히 종료] = quit.
// "다시 묻지 않음"(기본 체크)을 끄면 답을 기록하지 않아 다음 X 때 다시 묻는다.
// 비모달 카드 — window.confirm 금지 조항 준수 (자동 백업 선택 카드 관용구 재사용).
// 답 없이 30초가 지나면 접고 main 의 대기만 푼다 (다음 X 때 다시 묻는다).
// ────────────────────────────────────────────────────────────────────────────

let closeAskCard = null;

function showCloseAskCard() {
  if (!document.body) {
    // 아직 카드 띄울 DOM 이 없다 — main 대기만 풀어 다음 X 가 기본 경로로 가게 한다
    petitApi.shell.closeChoice({ dismiss: true }).catch(function () { /* 무해 */ });
    return;
  }
  if (closeAskCard && closeAskCard.isConnected) return; // 이미 떠 있다

  const card = el('div', {
    ...CARD_SKIN,
    position: 'fixed',
    left: '50%',
    bottom: '24px',
    transform: 'translateX(-50%)',
    zIndex: '2147483450',              // 온보딩 카드(…500)보다 아래, 힌트(…400)보다 위
    maxWidth: '340px',
    padding: '12px 14px',
    pointerEvents: 'auto'
  });
  card.setAttribute('data-close-ask', '');
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-label', '닫기 동작 선택');
  closeAskCard = card;

  card.appendChild(el('p', { margin: '0 0 8px', fontSize: '13.5px' },
    '닫아도 일정 알림을 받으려면 트레이에 내려 둘 수 있어요.'));

  const rememberLabel = el('label', {
    display: 'flex', alignItems: 'center', gap: '6px', margin: '0 0 10px',
    fontSize: '12.5px', cursor: 'pointer', color: '#6b5d49'
  });
  const rememberChk = document.createElement('input');
  rememberChk.type = 'checkbox';
  rememberChk.checked = true;          // 기본: 다시 묻지 않음 (1회 선택 계약)
  rememberLabel.appendChild(rememberChk);
  rememberLabel.appendChild(el('span', undefined, '다시 묻지 않음'));
  card.appendChild(rememberLabel);

  const row = el('div', { display: 'flex', gap: '8px', justifyContent: 'flex-end' });
  const btnQuit = btnEl({ ...GHOST_BTN, padding: '6px 12px', borderRadius: '9px', fontSize: '13px' }, '완전히 종료');
  const btnTray = btnEl({
    font: 'inherit', fontSize: '13px', padding: '6px 14px', borderRadius: '9px',
    border: '1px solid #d8b24a', background: '#ffd977', color: '#4a3a10',
    cursor: 'pointer', fontWeight: '600'
  }, '트레이에 두기');
  row.appendChild(btnQuit);
  row.appendChild(btnTray);
  card.appendChild(row);

  let idleTimer = null;
  const close = function () {
    if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; }
    try { if (card.isConnected) card.remove(); } catch (_err) { /* 무해 */ }
    if (closeAskCard === card) closeAskCard = null;
  };
  idleTimer = setTimeout(function () {
    close();
    petitApi.shell.closeChoice({ dismiss: true }).catch(function () { /* 무해 */ });
  }, 30000);

  const answer = function (tray) {
    close();
    petitApi.shell.closeChoice({ tray: tray === true, remember: rememberChk.checked === true })
      .catch(function () { /* 브리지 실패 — 다음 X 는 기본 경로 */ });
  };
  btnTray.addEventListener('click', function () { answer(true); });
  btnQuit.addEventListener('click', function () { answer(false); });

  document.body.appendChild(card);
}

ipcRenderer.on('petit:shell:close-ask', function () {
  try {
    showCloseAskCard();
  } catch (_err) {
    // 카드 실패 — main 대기를 풀어 다음 X 가 기본(종료) 경로로 가게 한다
    petitApi.shell.closeChoice({ dismiss: true }).catch(function () { /* 무해 */ });
  }
});

// ────────────────────────────────────────────────────────────────────────────
// 자동 백업 실패 기동 알림 (발주 #33 ④ — 재채점 I7)
// 마지막 "자동" 백업이 실패로 영속돼 있으면(backup-config.json lastAutoResult) 기동 시
// 1회, 활성 탭 페이지에서만 카드로 알린다. 자동 백업이 꺼져 있으면 말하지 않는다.
// 첫 실행 자동 백업 선택 카드(auto=false 일 때만)와 조건이 배타라 자리(좌하단)가 안 겹친다.
// ────────────────────────────────────────────────────────────────────────────

let backupFailNoticeShown = false;     // 세션당 1회

/** 타임스탬프 → "M월 D일 HH:MM" (실패 시 빈 문자열 — 표기만 생략) */
function fmtBackupWhen(t) {
  try {
    const d = new Date(t);
    if (!Number.isFinite(d.getTime())) return '';
    const p2 = function (n) { return n < 10 ? '0' + n : '' + n; };
    return (d.getMonth() + 1) + '월 ' + d.getDate() + '일 ' + p2(d.getHours()) + ':' + p2(d.getMinutes());
  } catch (_err) { return ''; }
}

function maybeShowBackupFailureNotice() {
  if (backupFailNoticeShown) return;
  setTimeout(function () {
    if (backupFailNoticeShown || onboardingActive || !document.body) return;
    Promise.all([petitApi.backup.status(), petitApi.startup.status()]).then(function (rs) {
      const st = rs[0];
      const sh = rs[1];
      if (!st || !st.ok || st.auto !== true) return;               // 자동 백업 꺼짐 — 말할 것 없음
      const r = st.lastAutoResult;
      if (!r || r.ok !== false) return;                            // 실패 상태가 아니다
      if (sh && sh.ok && sh.activeTab && sh.activeTab !== PAGE) return; // 활성 탭 페이지 1곳만
      if (backupFailNoticeShown || onboardingActive) return;
      backupFailNoticeShown = true;

      const card = el('div', {
        ...CARD_SKIN,
        position: 'fixed',
        left: '16px',
        bottom: '16px',
        zIndex: '99990',                 // 앱 모달(100000+) 아래
        maxWidth: '320px',
        padding: '12px 14px',
        pointerEvents: 'auto'
      });
      card.setAttribute('data-backup-fail-notice', '');
      card.setAttribute('role', 'alert');
      const when = fmtBackupWhen(r.at);
      card.appendChild(el('p', { margin: '0 0 10px', fontSize: '13.5px' },
        '⚠️ 자동 백업이 실패하고 있어요' + (when ? ' (마지막 시도 ' + when + ')' : '') +
        '. 백업 폴더를 확인해 주세요.'));

      const row = el('div', { display: 'flex', gap: '8px', justifyContent: 'flex-end' });
      const btnClose = btnEl({ ...GHOST_BTN, padding: '6px 12px', borderRadius: '9px', fontSize: '13px' }, '닫기');
      const btnOpen = btnEl({
        font: 'inherit', fontSize: '13px', padding: '6px 14px', borderRadius: '9px',
        border: '1px solid #d8b24a', background: '#ffd977', color: '#4a3a10',
        cursor: 'pointer', fontWeight: '600'
      }, '백업 설정 열기');
      row.appendChild(btnClose);
      row.appendChild(btnOpen);
      card.appendChild(row);

      const close = function () { try { if (card.isConnected) card.remove(); } catch (_err) { /* 무해 */ } };
      const idle = setTimeout(close, 30000);
      btnClose.addEventListener('click', function () { clearTimeout(idle); close(); });
      btnOpen.addEventListener('click', function () {
        clearTimeout(idle);
        close();
        // 앱 설정을 연다 (양 앱 공통 #settingsBtn) — [백업] 섹션 상태 줄에 실패 상세가 있다
        try {
          const b = document.getElementById('settingsBtn');
          if (b) b.click();
        } catch (_err) { /* 열기 실패 — 카드만 닫는다 */ }
      });
      document.body.appendChild(card);
    }).catch(function () { /* 브리지 실패 — 다음 기동에 다시 */ });
  }, 3200);                              // 앱 초기 렌더·다른 기동 카드가 자리 잡은 뒤에
}

// ────────────────────────────────────────────────────────────────────────────
// 백업 UI (양 창 설정 패널 — 발주: 클라우드 폴더 백업 + Pro 예약 자동 백업)
// 훅: [data-backup-section] 섹션 / [data-backup-folder] 폴더 표시 /
//     [data-backup-choose] 폴더 변경(네이티브 폴더 대화상자 — main dialog) /
//     [data-backup-now] 지금 백업 / [data-backup-images] 이미지 포함 옵션 /
//     [data-backup-auto] 예약 토글 / [data-backup-status] 상태 줄 /
//     [data-backup-restore] 복원 파일 선택 (발주 #33 ④).
//
// [복원] 계약 (발주 #33 ④ — 앱(postit.html·calendar.html) 수신부와의 문서화된 계약, 변경 금지):
//   요청: preload 가 document 에 CustomEvent 'petit:restore-request' dispatch,
//         detail = { text: string(백업 파일 원문), name: string(파일명) }
//   응답: 앱이 document 에 CustomEvent 'petit:restore-result' dispatch,
//         detail = { ok: boolean, message: string } — preload 가 상태 줄에 표시.
//   5초 무응답 = 수신부 없는 구버전 화면 → "이 화면에서는 복원을 지원하지 않아요" 강등.
//   (백업 파일은 앱 내보내기 v2 와 동형 — backup.js buildCollectScript 주석이 형식 정본.)
// rev.9(무료 단독 출시판): 예약 자동 백업의 Pro 게이트·잠금 마크는 폐지됐다 —
// 이 섹션의 모든 항목이 라이선스 없이 동작한다 (감사 권고 #24·#25, A45 ①②).
// 원본 HTML 은 무수정(A42) — 전부 preload 주입. 저장 키는 건드리지 않는다 (main 이
// userData\backup-config.json 에 보관).
// ────────────────────────────────────────────────────────────────────────────

function injectBackupSection() {
  const panel = document.getElementById('settingsPanel');
  if (!panel || panel.querySelector('[data-backup-section]')) return;
  const isCal = PAGE === 'calendar';
  const host = isCal ? (panel.querySelector('.spBody') || panel) : panel;
  const smallCls = isCal ? 'spSmall' : 'sp-small'; // 앱별 안내문 관용 클래스

  const sec = el(isCal ? 'section' : 'div');
  sec.className = isCal ? 'spSec' : 'sp-sec';
  sec.setAttribute('data-backup-section', '');
  sec.appendChild(el('h3', undefined, '백업'));

  // 폴더 표시
  const folderWrap = el('div', { display: 'flex', flexDirection: 'column', gap: '3px', margin: '6px 0' });
  folderWrap.appendChild(el('span', { fontSize: '12.5px', opacity: '0.75' }, '저장 폴더'));
  const folderVal = el('span', { fontSize: '12.5px', wordBreak: 'break-all', lineHeight: '1.4' }, '확인 중…');
  folderVal.setAttribute('data-backup-folder', '');
  folderWrap.appendChild(folderVal);
  sec.appendChild(folderWrap);

  // 버튼 행 (폴더 변경 · 지금 백업)
  const btnRow = el('div', { display: 'flex', gap: '8px', flexWrap: 'wrap', margin: '6px 0' });
  const mkBtn = function (label) {
    const b = btnEl(undefined, label);
    if (!isCal) b.className = 'tool-btn'; // 포스트잇 패널 관용 버튼 스타일
    return b;
  };
  const btnChoose = mkBtn('📁 폴더 변경…');
  btnChoose.title = '백업을 저장할 폴더를 고르기 (OneDrive 등 동기화 폴더면 클라우드 백업)';
  btnChoose.setAttribute('data-backup-choose', '');
  const btnNow = mkBtn('💾 지금 백업');
  btnNow.title = '캘린더·포스트잇 데이터를 지금 바로 백업 파일로 저장';
  btnNow.setAttribute('data-backup-now', '');
  // 폴더 열기 (발주 #24) — 경로만 보여 주고 "그래서 어디로 가야 하나"를 안 알려 주던 결함.
  // 백업 파일을 실제로 눈으로 확인·복사할 수 있어야 백업이 안전망으로 체감된다.
  const btnOpen = mkBtn('📂 폴더 열기');
  btnOpen.title = '백업 파일이 쌓이는 폴더를 탐색기로 열어요';
  btnOpen.setAttribute('data-backup-open', '');
  // [복원] (발주 #33 ④) — 백업 파일을 골라 이 화면의 가져오기 경로로 원클릭 복원
  const btnRestore = mkBtn('♻️ 복원…');
  btnRestore.title = '백업 파일(.json)을 골라 데이터를 복원해요';
  btnRestore.setAttribute('data-backup-restore', '');
  btnRow.appendChild(btnChoose);
  btnRow.appendChild(btnNow);
  btnRow.appendChild(btnOpen);
  btnRow.appendChild(btnRestore);
  sec.appendChild(btnRow);

  // 이미지 포함 옵션 (기본 꺼짐 — 용량 안내)
  const imgLabel = el('label', { display: 'flex', alignItems: 'flex-start', gap: '6px', margin: '6px 0', fontSize: '13px', cursor: 'pointer' });
  const imgChk = document.createElement('input');
  imgChk.type = 'checkbox';
  imgChk.setAttribute('data-backup-images', '');
  imgLabel.appendChild(imgChk);
  imgLabel.appendChild(el('span', { lineHeight: '1.4' }, '백업에 이미지 포함 (배경·사진 스티커 — 파일이 커져서 기본은 꺼져 있어요)'));
  sec.appendChild(imgLabel);

  // 예약 자동 백업 — rev.9 무료 단독 출시판에서는 무료 기능이다 (감사 권고 #24·#25).
  // 잠금 마크·disabled 게이트를 전부 걷어냈다: 무료 사용자에게 자동 백업이 없는 것이
  // 지금 이 앱의 최대 데이터 유실 리스크였다.
  const autoRow = el('div', { display: 'flex', alignItems: 'center', gap: '6px', margin: '6px 0', flexWrap: 'wrap' });
  const autoLabel = el('label', { display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', cursor: 'pointer' });
  const autoChk = document.createElement('input');
  autoChk.type = 'checkbox';
  autoChk.setAttribute('data-backup-auto', '');
  autoLabel.appendChild(autoChk);
  autoLabel.appendChild(el('span', undefined, '매일 자동 백업 (앱이 켜져 있는 동안 하루 1번)'));
  autoRow.appendChild(autoLabel);
  sec.appendChild(autoRow);

  // 안내문 (클라우드 백업 안내 + 상태 줄)
  const hint = el('p', { fontSize: '12.5px', lineHeight: '1.45', opacity: '0.8', margin: '5px 0 0' },
    '저장 폴더를 OneDrive·구글 드라이브 같은 동기화 폴더로 지정하면, 백업이 자동으로 클라우드에도 올라가요.');
  hint.className = smallCls;
  sec.appendChild(hint);
  const statusLine = el('p', { fontSize: '12.5px', lineHeight: '1.45', margin: '5px 0 0', minHeight: '0' }, '');
  statusLine.className = smallCls;
  statusLine.setAttribute('data-backup-status', '');
  sec.appendChild(statusLine);

  host.appendChild(sec);

  // ── 상태 동기화 ──
  function setStatus(msg) { statusLine.textContent = msg || ''; }
  let refreshing = false;
  let noticeShown = false;      // 기본 폴더 1회 안내 — 이 세션에서 이미 띄웠는가
  async function refreshBackupUi() {
    if (refreshing) return;
    refreshing = true;
    try {
      const st = await petitApi.backup.status();
      if (st && st.ok) {
        folderVal.textContent = st.folder + (st.folderIsDefault ? ' (기본)' : '');
        imgChk.checked = st.includeImages === true;
        autoChk.checked = st.auto === true;
        // 기본 폴더가 문서 폴더로 정해졌다는 1회 안내 (발주 #24). 설정을 실제로 연
        // 순간에만 말하고, 그 즉시 확인 처리해 다음 실행부터는 조용하다.
        if (!noticeShown && st.notice && panel.classList.contains('open')) {
          noticeShown = true;
          setStatus(String(st.notice));
          try { await petitApi.backup.ackNotice(); } catch (_e) { /* 다음 기회에 다시 안내 */ }
        }
        // 마지막 자동 백업 결과 (발주 #33 ④ — 영속값 표시. 실패는 1회 안내보다 우선한다)
        const r = st.lastAutoResult;
        if (r && typeof r === 'object' && typeof r.ok === 'boolean') {
          const when = fmtBackupWhen(r.at);
          if (r.ok === false) {
            setStatus('⚠️ 마지막 자동 백업 실패' + (when ? ' (' + when + ')' : '') +
              (r.error ? ' — ' + String(r.error) : ''));
          } else if (!statusLine.textContent) {
            setStatus('마지막 자동 백업: ' + (when || '완료') + ' 성공');
          }
        }
      }
    } catch (_err) { /* 브리지 실패 — UI 만 유지 */ }
    refreshing = false;
  }

  btnChoose.addEventListener('click', async function () {
    btnChoose.disabled = true;
    try {
      const res = await petitApi.backup.chooseFolder();
      if (res && res.ok && !res.canceled) {
        folderVal.textContent = res.folder;
        setStatus('저장 폴더를 바꿨어요. 동기화 폴더라면 이제 클라우드로도 백업돼요.');
      } else if (res && !res.ok) {
        setStatus(String(res.reason || '폴더를 바꾸지 못했어요.'));
      }
    } catch (_err) { setStatus('폴더를 바꾸지 못했어요.'); }
    btnChoose.disabled = false;
  });

  btnNow.addEventListener('click', async function () {
    btnNow.disabled = true;
    setStatus('백업하는 중…');
    try {
      const res = await petitApi.backup.runNow();
      if (res && res.ok) setStatus('백업 완료! ' + String(res.summary || ''));
      else setStatus('백업 실패: ' + String((res && res.reason) || '알 수 없는 오류'));
    } catch (_err) { setStatus('백업 실패: 백업 엔진과 연결하지 못했어요.'); }
    btnNow.disabled = false;
  });

  btnOpen.addEventListener('click', async function () {
    btnOpen.disabled = true;
    try {
      const res = await petitApi.backup.openFolder();
      if (res && res.ok) setStatus('백업 폴더를 열었어요: ' + String(res.folder || ''));
      else setStatus(String((res && res.reason) || '폴더를 열지 못했어요.'));
    } catch (_err) { setStatus('폴더를 열지 못했어요.'); }
    btnOpen.disabled = false;
  });

  // ── [복원] (발주 #33 ④) — 파일 선택은 main, 적용은 앱 수신부 (위 복원 계약 주석) ──
  let restoreWait = null;   // { timer } — 응답 대기 (5초 무응답 = 미지원 화면 강등)

  document.addEventListener('petit:restore-result', function (ev) {
    if (!restoreWait) return;                    // 요청한 적 없는 응답 — 무시
    clearTimeout(restoreWait.timer);
    restoreWait = null;
    let d = null;
    try { d = ev && ev.detail && typeof ev.detail === 'object' ? ev.detail : null; } catch (_err) { d = null; }
    if (d && typeof d.message === 'string' && d.message !== '') setStatus(String(d.message));
    else setStatus(d && d.ok === true ? '복원했어요.' : '복원하지 못했어요.');
    btnRestore.disabled = false;
  });

  btnRestore.addEventListener('click', async function () {
    if (restoreWait) return;                     // 응답 대기 중 — 중복 요청 금지
    btnRestore.disabled = true;
    setStatus('복원할 백업 파일을 고르는 중…');
    try {
      const res = await petitApi.backup.pickRestore();
      if (!res || res.ok !== true) {
        setStatus(String((res && res.reason) || '파일을 열지 못했어요.'));
        btnRestore.disabled = false;
        return;
      }
      if (res.canceled) {
        setStatus('');
        btnRestore.disabled = false;
        return;
      }
      setStatus('"' + String(res.name || '') + '" 복원을 요청했어요…');
      restoreWait = {
        timer: setTimeout(function () {
          restoreWait = null;
          setStatus('이 화면에서는 복원을 지원하지 않아요');
          btnRestore.disabled = false;
        }, 5000)
      };
      document.dispatchEvent(new CustomEvent('petit:restore-request', {
        detail: { text: String(res.text || ''), name: String(res.name || '') }
      }));
    } catch (_err) {
      if (restoreWait) { clearTimeout(restoreWait.timer); restoreWait = null; }
      setStatus('복원을 시작하지 못했어요.');
      btnRestore.disabled = false;
    }
  });

  imgChk.addEventListener('change', async function () {
    try { await petitApi.backup.setIncludeImages(imgChk.checked); } catch (_err) { /* 다음 status 로 재동기화 */ }
  });

  autoChk.addEventListener('change', async function () {
    const want = autoChk.checked;
    try {
      const res = await petitApi.backup.setAuto(want);
      if (res && res.ok) {
        setStatus(want ? '매일 자동 백업을 켰어요. 앱이 켜져 있는 동안 하루 1번 저장돼요.' : '자동 백업을 껐어요.');
      } else {
        autoChk.checked = false;
        setStatus(String((res && res.reason) || '자동 백업을 켜지 못했어요.'));
      }
    } catch (_err) {
      autoChk.checked = !want;
      setStatus('자동 백업 설정을 바꾸지 못했어요.');
    }
  });

  // 패널이 열릴 때마다 최신 상태 재조회 (calendar: .open / postit: .spanel.open)
  const panelObserver = new MutationObserver(function () {
    if (panel.classList.contains('open')) refreshBackupUi();
  });
  panelObserver.observe(panel, { attributes: true, attributeFilter: ['class'] });

  refreshBackupUi();
}

function initBackupUi() {
  try { injectBackupSection(); } catch (_err) { /* 셸 UI 실패는 앱 무영향 */ }
}

// ────────────────────────────────────────────────────────────────────────────
// 시작 프로그램 UI (양 창 설정 패널 — 윈도우 시작 시 자동 실행)
// 훅: [data-startup-section] 섹션 / [data-startup-toggle] 토글 / [data-startup-status] 상태 줄.
// 탭바 설정 드로어의 같은 항목과 채널 하나(petit:shell:set-startup)를 공유하고, main 의
// 상태 push 로 양방향 동기화된다. 상태의 단일 진실은 OS 로그인 항목이라 초기값도 매번
// OS 실측값으로 만든다 (앱 저장 키·셸 설정 파일 어디에도 이중 저장하지 않는다).
// 원본 HTML 은 무수정(A42) — 전부 preload 주입. data-spcat 이 없고 백업 훅도 없으므로
// 앱의 spSecCat() 이 첫 카테고리(🖋 표시)로 배정한다 = 설정을 열자마자 보이는 자리.
// ────────────────────────────────────────────────────────────────────────────

function injectStartupSection() {
  const panel = document.getElementById('settingsPanel');
  if (!panel || panel.querySelector('[data-startup-section]')) return;
  const isCal = PAGE === 'calendar';
  const host = isCal ? (panel.querySelector('.spBody') || panel) : panel;
  const smallCls = isCal ? 'spSmall' : 'sp-small'; // 앱별 안내문 관용 클래스

  const sec = el(isCal ? 'section' : 'div');
  sec.className = isCal ? 'spSec' : 'sp-sec';
  sec.setAttribute('data-startup-section', '');
  sec.appendChild(el('h3', undefined, '시작 프로그램'));

  const row = el('label', { display: 'flex', alignItems: 'center', gap: '6px', margin: '6px 0', fontSize: '13px', cursor: 'pointer' });
  const chk = document.createElement('input');
  chk.type = 'checkbox';
  chk.setAttribute('data-startup-toggle', '');
  row.appendChild(chk);
  row.appendChild(el('span', undefined, '윈도우 시작 시 자동 실행'));
  sec.appendChild(row);

  const hint = el('p', { fontSize: '12.5px', lineHeight: '1.45', opacity: '0.8', margin: '5px 0 0' },
    '컴퓨터를 켜면 쁘띠캘린더가 함께 열려요.');
  hint.className = smallCls;
  sec.appendChild(hint);

  const statusLine = el('p', { fontSize: '12.5px', lineHeight: '1.45', margin: '5px 0 0' }, '');
  statusLine.className = smallCls;
  statusLine.setAttribute('data-startup-status', '');
  sec.appendChild(statusLine);

  // 자리: 셸 섹션 무리의 앞쪽 — 포스트잇에서는 [처음 안내](재실행 진입점) 바로 위에 둔다.
  // 첫 카테고리(🖋 표시) 안에서 한 번이라도 덜 스크롤하고 만나게 하는 배치다.
  const replayBtn = !isCal ? host.querySelector('[data-onboarding-replay]') : null;
  const anchor = replayBtn ? replayBtn.closest('.sp-sec') : null;
  if (anchor && anchor.parentElement === host) host.insertBefore(sec, anchor);
  else host.appendChild(sec);

  // ── 상태 동기화 (표시는 언제나 OS 실측값) ──
  function setStatus(msg) { statusLine.textContent = msg || ''; }
  function applyStartupState(st) {
    if (!st || typeof st.openAtLogin !== 'boolean') return;
    chk.checked = st.openAtLogin;
  }
  async function refreshStartupUi() {
    try {
      applyStartupState(await petitApi.startup.status());
    } catch (_err) { /* 브리지 실패 — 표시만 유지 */ }
  }

  chk.addEventListener('change', async function () {
    const want = chk.checked;
    chk.disabled = true;
    try {
      const res = await petitApi.startup.set(want);
      applyStartupState(res);
      if (res && res.ok === true) {
        setStatus(want ? '컴퓨터를 켜면 쁘띠캘린더가 함께 열려요.' : '윈도우 시작 시 자동 실행을 껐어요.');
      } else {
        const why = String((res && res.reason) || '윈도우 시작 설정을 바꾸지 못했어요.');
        setStatus(why);
        shellHint(why, 3200, 'bottom');           // 비모달 안내 (alert/confirm 금지)
        await refreshStartupUi();                 // 표시를 실제 OS 값으로 되돌린다
      }
    } catch (_err) {
      setStatus('윈도우 시작 설정을 바꾸지 못했어요.');
      shellHint('윈도우 시작 설정을 바꾸지 못했어요.', 3200, 'bottom');
      await refreshStartupUi();
    }
    chk.disabled = false;
  });

  // 다른 표면(탭바 드로어)에서 바뀐 값 즉시 반영 — main 이 모든 표면에 push 한다
  try { petitApi.startup.onChange(applyStartupState); } catch (_err) { /* 구독 실패 — 패널 개방 시 재조회로 강등 */ }

  // 패널이 열릴 때마다 최신 상태 재조회 (calendar: .open / postit: .spanel.open)
  const panelObserver = new MutationObserver(function () {
    if (panel.classList.contains('open')) refreshStartupUi();
  });
  panelObserver.observe(panel, { attributes: true, attributeFilter: ['class'] });

  refreshStartupUi();
}

function initStartupUi() {
  try { injectStartupSection(); } catch (_err) { /* 셸 UI 실패는 앱 무영향 */ }
}

// ────────────────────────────────────────────────────────────────────────────
// 항상 위 UI (양 창 설정 패널 — 발주 #30)
// 훅: [data-alwaystop-section] 섹션 / [data-alwaystop-toggle] 토글 / [data-alwaystop-status] 상태.
// 탭바 드로어의 같은 항목과 채널 하나(petit:shell:set-always-on-top)를 공유하고, main 의
// 상태 push 로 양방향 동기화된다. 상태의 정본은 창 실측값(win.isAlwaysOnTop)이고
// shell-settings.json 의 additive 필드에 영속된다 (기본 꺼짐 — 현행 동작 불변).
// 원본 HTML 은 무수정(A42) — 전부 preload 주입.
// ────────────────────────────────────────────────────────────────────────────

function injectAlwaysTopSection() {
  const panel = document.getElementById('settingsPanel');
  if (!panel || panel.querySelector('[data-alwaystop-section]')) return;
  const isCal = PAGE === 'calendar';
  const host = isCal ? (panel.querySelector('.spBody') || panel) : panel;
  const smallCls = isCal ? 'spSmall' : 'sp-small';

  const sec = el(isCal ? 'section' : 'div');
  sec.className = isCal ? 'spSec' : 'sp-sec';
  sec.setAttribute('data-alwaystop-section', '');
  sec.appendChild(el('h3', undefined, '창'));

  const row = el('label', { display: 'flex', alignItems: 'center', gap: '6px', margin: '6px 0', fontSize: '13px', cursor: 'pointer' });
  const chk = document.createElement('input');
  chk.type = 'checkbox';
  chk.setAttribute('data-alwaystop-toggle', '');
  row.appendChild(chk);
  row.appendChild(el('span', undefined, '항상 위에 두기'));
  sec.appendChild(row);

  // 닫을 때 트레이로 보내기 (발주 #33 ①) — 탭바 드로어의 같은 항목과 채널 하나를 공유
  const trayRow = el('label', { display: 'flex', alignItems: 'center', gap: '6px', margin: '6px 0', fontSize: '13px', cursor: 'pointer' });
  const trayChk = document.createElement('input');
  trayChk.type = 'checkbox';
  trayChk.setAttribute('data-tray-toggle', '');
  trayRow.appendChild(trayChk);
  trayRow.appendChild(el('span', undefined, '닫을 때 트레이로 보내기'));
  sec.appendChild(trayRow);

  const hint = el('p', { fontSize: '12.5px', lineHeight: '1.45', opacity: '0.8', margin: '5px 0 0' },
    '다른 창을 열어도 쁘띠캘린더가 위에 남아요. 꾸며 둔 보드를 계속 보고 싶을 때 켜요. ' +
    '트레이로 보내 두면 창을 닫아도 일정 알림이 계속 오고, 트레이 아이콘을 두 번 누르면 돌아와요.');
  hint.className = smallCls;
  sec.appendChild(hint);

  const statusLine = el('p', { fontSize: '12.5px', lineHeight: '1.45', margin: '5px 0 0' }, '');
  statusLine.className = smallCls;
  statusLine.setAttribute('data-alwaystop-status', '');
  sec.appendChild(statusLine);

  // 자리: [시작 프로그램] 바로 위 — 창 관련 항목이 먼저 오는 게 자연스럽다
  const startupSec = host.querySelector('[data-startup-section]');
  if (startupSec && startupSec.parentElement === host) host.insertBefore(sec, startupSec);
  else host.appendChild(sec);

  function setStatus(msg) { statusLine.textContent = msg || ''; }
  function applyState(st) {
    if (!st || typeof st !== 'object') return;
    if (typeof st.alwaysOnTop === 'boolean') chk.checked = st.alwaysOnTop;
    if (typeof st.closeToTray === 'boolean') trayChk.checked = st.closeToTray; // 발주 #33 ①
  }
  async function refreshUi() {
    // startup.status() = 셸 상태 채널(petit:shell:state) — 자동 실행·항상 위·트레이·버전이
    // 한 페이로드로 온다 (표면마다 채널을 늘리지 않는다 — A49③ 화이트리스트 최소화).
    try { applyState(await petitApi.startup.status()); } catch (_err) { /* 표시만 유지 */ }
  }

  chk.addEventListener('change', async function () {
    const want = chk.checked;
    chk.disabled = true;
    try {
      const res = await petitApi.shell.setAlwaysOnTop(want);
      applyState(res);
      if (res && res.ok === true) {
        setStatus(want ? '이제 다른 창 위에 떠 있어요.' : '항상 위를 껐어요.');
      } else {
        const why = String((res && res.reason) || '항상 위 설정을 바꾸지 못했어요.');
        setStatus(why);
        shellHint(why, 3200, 'bottom');       // 비모달 안내 (alert/confirm 금지)
        await refreshUi();
      }
    } catch (_err) {
      setStatus('항상 위 설정을 바꾸지 못했어요.');
      await refreshUi();
    }
    chk.disabled = false;
  });

  // 닫을 때 트레이로 보내기 (발주 #33 ①) — 항상 위 토글과 같은 관용구
  trayChk.addEventListener('change', async function () {
    const want = trayChk.checked;
    trayChk.disabled = true;
    try {
      const res = await petitApi.shell.setCloseToTray(want);
      applyState(res);
      if (res && res.ok === true) {
        setStatus(want ? '이제 X 를 눌러도 트레이에 남아 알림을 계속 받아요.' : '이제 X 를 누르면 완전히 종료돼요.');
      } else {
        setStatus('닫기 동작을 바꾸지 못했어요.');
        await refreshUi();
      }
    } catch (_err) {
      setStatus('닫기 동작을 바꾸지 못했어요.');
      await refreshUi();
    }
    trayChk.disabled = false;
  });

  // 다른 표면(탭바 드로어)에서 바뀐 값 즉시 반영 — main 이 모든 표면에 push 한다
  try { petitApi.startup.onChange(applyState); } catch (_err) { /* 패널 개방 시 재조회로 강등 */ }

  const panelObserver = new MutationObserver(function () {
    if (panel.classList.contains('open')) refreshUi();
  });
  panelObserver.observe(panel, { attributes: true, attributeFilter: ['class'] });

  refreshUi();
}

// ────────────────────────────────────────────────────────────────────────────
// 앱 정보 · 진단 UI (양 창 설정 패널 — 발주 #28①②③④)
// 훅: [data-shell-about] 섹션 / [data-shell-version] 버전 줄 /
//     [data-shell-diagnostics] 진단 정보 복사 / [data-shell-logs] 로그 폴더 열기 /
//     [data-shell-about-status] 상태 줄.
//
// 왜 셸이 주입하는가: 앱 HTML 의 정보 패널에는 'rev.5'·'(2026-08)' 같은 채점표 리비전이
// 박혀 있어 어느 빌드인지 특정할 수 없는데, 원본 HTML 은 바이트 동일 계약(A42)이라
// 고칠 수 없다. 그래서 "사용자가 읽을 수 있는 진짜 버전"을 셸이 옆에 붙인다.
// 버전 정본은 electron/package.json 하나 — main 의 app.getVersion() 값만 표기한다.
// data-spcat="about" 로 앱의 [정보] 카테고리에 들어간다 (앱 관용 속성 재사용).
// ────────────────────────────────────────────────────────────────────────────

// 문의처 — 정본은 main.js 의 CONTACT_PLACEHOLDER 다 (PRIVACY.md §6 과 동일 주소).
// 여기 값은 info() 응답이 오기 전(수십 ms)의 표시용이고, 응답이 오면 main 값으로 대체된다.
const CONTACT_PLACEHOLDER = 'uto2405@gmail.com';

function injectAboutSection() {
  const panel = document.getElementById('settingsPanel');
  if (!panel || panel.querySelector('[data-shell-about]')) return;
  const isCal = PAGE === 'calendar';
  const host = isCal ? (panel.querySelector('.spBody') || panel) : panel;
  const smallCls = isCal ? 'spSmall' : 'sp-small';

  const sec = el(isCal ? 'section' : 'div');
  sec.className = isCal ? 'spSec' : 'sp-sec';
  sec.setAttribute('data-shell-about', '');
  sec.setAttribute('data-spcat', 'about');   // 앱 [정보] 카테고리로 (앱 spSecCat 규약)
  sec.appendChild(el('h3', undefined, '앱 정보 · 문의'));

  const verLine = el('p', { fontSize: '13px', lineHeight: '1.45', margin: '4px 0 0' }, '버전을 확인하는 중…');
  verLine.setAttribute('data-shell-version', '');
  sec.appendChild(verLine);

  const envLine = el('p', { fontSize: '12.5px', lineHeight: '1.45', opacity: '0.8', margin: '3px 0 0' }, '');
  envLine.className = smallCls;
  sec.appendChild(envLine);

  const btnRow = el('div', { display: 'flex', gap: '8px', flexWrap: 'wrap', margin: '7px 0 0' });
  const mkBtn = function (label) {
    const b = btnEl(undefined, label);
    if (!isCal) b.className = 'tool-btn';
    return b;
  };
  const btnDiag = mkBtn('📋 진단 정보 복사');
  btnDiag.title = '버전·환경 정보를 클립보드로 복사해요 (메모 내용은 포함되지 않아요)';
  btnDiag.setAttribute('data-shell-diagnostics', '');
  const btnLogs = mkBtn('🗂 로그 폴더 열기');
  btnLogs.title = '오류 기록이 쌓이는 폴더를 탐색기로 열어요';
  btnLogs.setAttribute('data-shell-logs', '');
  btnRow.appendChild(btnDiag);
  btnRow.appendChild(btnLogs);
  sec.appendChild(btnRow);

  const contactLine = el('p', { fontSize: '12.5px', lineHeight: '1.45', margin: '6px 0 0' },
    '문의: ' + CONTACT_PLACEHOLDER);
  contactLine.className = smallCls;
  sec.appendChild(contactLine);

  const contactHint = el('p', { fontSize: '12.5px', lineHeight: '1.45', opacity: '0.8', margin: '3px 0 0' },
    '문제가 생기면 [진단 정보 복사]를 눌러 나온 내용을 함께 보내 주세요. 인터넷으로 전송되는 정보는 하나도 없어요.');
  contactHint.className = smallCls;
  sec.appendChild(contactHint);

  const statusLine = el('p', { fontSize: '12.5px', lineHeight: '1.45', margin: '5px 0 0' }, '');
  statusLine.className = smallCls;
  statusLine.setAttribute('data-shell-about-status', '');
  sec.appendChild(statusLine);

  host.appendChild(sec);   // 정보 카테고리 — 앱 정보 섹션과 나란히 (맨 뒤가 자연스러운 자리)

  function setStatus(msg) { statusLine.textContent = msg || ''; }

  let infoLoaded = false;
  async function refreshInfo() {
    if (infoLoaded) return;
    try {
      const info = await petitApi.shell.info();
      if (!info || !info.ok) return;
      infoLoaded = true;
      verLine.textContent = '🌷 쁘띠캘린더 ' + info.version + ' · ' + info.distribution;
      envLine.textContent = 'Electron ' + info.electron + ' · Chromium ' + info.chrome + ' · ' + info.os +
        (info.storage ? ' · 저장 사용량 ' + info.storage.text : '');
      if (info.contact && info.contact !== CONTACT_PLACEHOLDER) {
        contactLine.textContent = '문의: ' + info.contact;
      }
    } catch (_err) { /* 브리지 실패 — 표시만 유지 */ }
  }

  btnDiag.addEventListener('click', async function () {
    btnDiag.disabled = true;
    try {
      const res = await petitApi.shell.copyDiagnostics();
      if (res && res.ok) setStatus('진단 정보를 복사했어요. 문의 메일에 붙여넣기 해 주세요. (메모 내용은 들어 있지 않아요)');
      else setStatus(String((res && res.reason) || '진단 정보를 복사하지 못했어요.'));
    } catch (_err) { setStatus('진단 정보를 복사하지 못했어요.'); }
    btnDiag.disabled = false;
  });

  btnLogs.addEventListener('click', async function () {
    btnLogs.disabled = true;
    try {
      const res = await petitApi.shell.openLogs();
      if (res && res.ok) setStatus('로그 폴더를 열었어요: ' + String(res.folder || ''));
      else setStatus(String((res && res.reason) || '로그 폴더를 열지 못했어요.'));
    } catch (_err) { setStatus('로그 폴더를 열지 못했어요.'); }
    btnLogs.disabled = false;
  });

  // 정보는 자주 바뀌지 않는다 — 패널을 처음 열 때 한 번만 채운다 (저장 사용량 계산 포함)
  const panelObserver = new MutationObserver(function () {
    if (panel.classList.contains('open')) refreshInfo();
  });
  panelObserver.observe(panel, { attributes: true, attributeFilter: ['class'] });

  refreshInfo();
}

function initShellInfoUi() {
  try { injectAlwaysTopSection(); } catch (_err) { /* 셸 UI 실패는 앱 무영향 */ }
  try { injectAboutSection(); } catch (_err) { /* 셸 UI 실패는 앱 무영향 */ }
}

// ────────────────────────────────────────────────────────────────────────────
// 알림 릴레이 (캘린더 페이지 전용)
// 문제: 단일 창 탭 모드에서 캘린더가 백그라운드 탭이면 일정 알림 토스트(A32)가
// 다른 뷰에 가려져 유실된다. 캘린더 preload 가 [data-toast] 표출을 감지해 main 으로
// 릴레이하고, main 이 캘린더 탭 비활성일 때만 탭바 배지·미니 스트립으로 띄운다.
//
// "알림성 토스트만" 판정 휴리스틱 (명시 기준 — calendar.html showToastBase 계약):
//   ① [data-toast] 의 data-toast-kind 속성이 "alarm" 일 때만 (showAlarmToast — A32 일정
//      알림 전용 kind. 일반 안내는 "info", 실행 취소는 "undo" 로 구분된다).
//   ② 이중 방어: 실행 취소 버튼([data-undo])이 hidden 이 아니면 undo류 → 릴레이 제외.
// 앱 원본은 무수정(A42) — 감시는 MutationObserver(읽기 전용), DOM 조작 0건.
// ────────────────────────────────────────────────────────────────────────────

function initAlarmRelay() {
  if (PAGE !== 'calendar') return;
  const toast = document.querySelector('[data-toast]');
  if (!toast) return;

  let wasAlarmShowing = false;   // 같은 표출을 중복 릴레이하지 않기 위한 상태
  let lastRelayedText = null;    // 표출 중 텍스트가 바뀐 새 알림(연속 알림)은 다시 릴레이

  const check = function () {
    try {
      const showing = toast.classList.contains('show');
      if (!showing) {
        wasAlarmShowing = false;
        lastRelayedText = null;
        return;
      }
      const kind = toast.getAttribute('data-toast-kind') || '';
      const undoBtn = toast.querySelector('[data-undo]');
      const isUndoLike = !!(undoBtn && !undoBtn.hidden);
      if (kind !== 'alarm' || isUndoLike) return;   // 알림성 토스트만 — undo/info 제외
      const textEl = toast.querySelector('#toastText');
      const text = String((textEl ? textEl.textContent : toast.textContent) || '').slice(0, 200);
      if (wasAlarmShowing && text === lastRelayedText) return; // 같은 표출 — 중복 릴레이 없음
      wasAlarmShowing = true;
      lastRelayedText = text;
      // main 이 활성 탭을 판정한다 (캘린더 탭이 이미 활성이면 무시 — 현행 유지)
      ipcRenderer.invoke('petit:shell:alarm-relay', text).catch(function () { /* 브리지 실패 무해 */ });
    } catch (_err) { /* 감시 실패는 앱 무영향 */ }
  };

  try {
    const mo = new MutationObserver(check);
    mo.observe(toast, { attributes: true, attributeFilter: ['class', 'data-toast-kind'] });
  } catch (_err) { /* Observer 불가 시 릴레이만 생략 */ }
}

// ────────────────────────────────────────────────────────────────────────────
// 진입점 — 앱 DOM 준비 후 셸 UI 부착
// ────────────────────────────────────────────────────────────────────────────

function initShellUi() {
  if (!PAGE || !document.body) return;
  initMigrateUi().catch(function () { /* 브리지 실패 시 셸 UI 만 생략 — 앱 무영향 */ });
  if (PAGE === 'postit') initOnboarding();
  initBackupUi();   // 양 앱 설정 패널에 [백업] 섹션 주입 (+ [복원] — 발주 #33 ④)
  initStartupUi();  // 양 앱 설정 패널에 [시작 프로그램] 섹션 주입 (탭바 드로어와 동기)
  initShellInfoUi();// [창](항상 위·트레이) + [앱 정보·문의](버전·진단·로그) 섹션 주입
  initAlarmRelay(); // 캘린더 페이지 — 백그라운드 탭 알림 릴레이 (탭바 배지 + OS 알림 승격)
  maybeShowBackupFailureNotice(); // 자동 백업 실패 영속 상태의 기동 1회 알림 (발주 #33 ④)
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initShellUi);
} else {
  initShellUi();
}
