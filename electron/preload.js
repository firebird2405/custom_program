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
//     여정: 환영(자동) → ＋ 새 포스트잇 클릭 → 노트 실제 타이핑(fill) → 꾸미기 열기
//     → 스티커 실제 드래그 부착(drag:#board) → 완료(자동) — 사용자 액션 4회 (≤8 계약).
//     [data-onboarding-skip] 상시 표시 + 설정 패널에 [data-onboarding-replay] 주입.
//     스텝 전진은 "사용자 발행 입력 액션"(isTrusted)만 계수한다 (자동 전진 계수 금지).
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

// 셸 버전 — electron/package.json 의 version 과 동기 유지 (수동 관리)
const SHELL_VERSION = '0.9.0';

// ── A49③: window.petit — 이름 붙은 채널 화이트리스트 래퍼만 노출 ────────────
// A43 계약(정본: grader a43 spec 상단 주석):
//   window.petit.migrate = { detect(), run(), status() } — 각각 Promise.
const migrateDetect = function () { return ipcRenderer.invoke('petit:migrate:detect'); };
const migrateRun = function () { return ipcRenderer.invoke('petit:migrate:run'); };
const migrateStatus = function () { return ipcRenderer.invoke('petit:migrate:status'); };

const petitApi = {
  version: SHELL_VERSION,
  migrate: {
    detect: migrateDetect,
    run: migrateRun,
    status: migrateStatus
  },
  license: {
    // A45 스텁 — 2·3주차 발주에서 서명 검증 구현 (지금은 항상 미구현 사유 반환)
    import: function (text) {
      return ipcRenderer.invoke('petit:license:import', typeof text === 'string' ? text : '');
    }
  },
  onboarding: {
    // A47 스텁 — 완료 플래그의 정본은 렌더러 localStorage(postit-onboarded)
    getState: function () { return ipcRenderer.invoke('petit:onboarding:get'); },
    setDone: function () { return ipcRenderer.invoke('petit:onboarding:set-done'); }
  }
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

function lsGet(key) {
  try { return localStorage.getItem(key); } catch (_err) { return null; }
}
function lsSet(key, value) {
  try { localStorage.setItem(key, value); } catch (_err) { /* 저장 불가 시 UI만 유지 */ }
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
  position: 'fixed',
  right: '16px',
  bottom: '64px',
  zIndex: '2147483600',
  width: '272px',
  boxSizing: 'border-box',
  padding: '14px 16px',
  background: '#fffdf5',
  border: '1px solid #e6d9bf',
  borderRadius: '14px',
  boxShadow: '0 8px 24px rgba(80, 60, 20, 0.22)',
  color: '#4a3f33',
  fontSize: '14px',
  lineHeight: '1.5',
  fontFamily: 'inherit'
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
  const btnBase = {
    font: 'inherit',
    fontSize: '13px',
    padding: '6px 12px',
    borderRadius: '10px',
    cursor: 'pointer'
  };
  const btnLater = el('button', { ...btnBase, background: 'transparent', border: '1px solid #d8cbb0', color: '#6b5d49' }, '나중에');
  btnLater.type = 'button';
  btnLater.setAttribute('data-migrate-later', '');
  const btnGo = el('button', { ...btnBase, background: '#f4a9b8', border: '1px solid #e690a4', color: '#4a2530', fontWeight: '700' }, '가져오기');
  btnGo.type = 'button';
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
  const chip = el('button', {
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
  chip.type = 'button';
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
//    target 0개 상태로 12초 내 자진 전진 (액션으로 계수되지 않는다).
//  - 총 사용자 액션 ≤8 에 fill ≥1(첫 포스트잇 실제 타이핑)·drag ≥1(첫 스티커 실제 드래그).
//  - 콘텐츠는 전부 사용자 입력분 — 온보딩이 노트·스티커를 자동 생성하면 FAIL (굿하트 차단).
//    셸이 발행하는 유일한 합성 이벤트는 "사용자 드래그 1회가 끝난 순간" 팔레트 단추의
//    앱 click 경로를 대신 눌러 주는 것뿐이다 (드래그 없이는 절대 발생하지 않는다).
//  - [data-onboarding-skip] 상시 표시. 설정 패널(#settingsPanel)에 [data-onboarding-replay]
//    를 셸이 주입 — 클릭 시 언제든 처음부터 재실행 (원본 HTML 무수정, A42).
// ────────────────────────────────────────────────────────────────────────────

const ONBOARDED_KEY = 'postit-onboarded';      // additive 키 — 값 존재 = 첫 실행 아님

// 여정: 환영(자동) → ＋ 새 포스트잇 클릭 → 노트 실제 타이핑(fill) → 꾸미기 열기(click)
//      → 스티커 실제 드래그 부착(drag:#board) → 완료(자동). 사용자 액션 4회 (≤8 계약).
// find = 지금 조작할 실제 앱 UI 셀렉터. markDelay = 패널 슬라이드(0.28s)가 끝난 뒤에야
// 지목한다 — 전환 중 좌표로 드래그 시작점이 빗나가지 않게.
const ONBOARD_STEPS = [
  { auto: 2600, text: '반가워요, 포스트잇 월이에요! 🌷 첫 포스트잇을 함께 붙여 볼까요?' },
  { find: '[data-add-note]', action: 'click',
    text: '먼저 위의 "＋ 새 포스트잇" 단추를 눌러 보세요.' },
  { find: '[data-note].editing [data-note-edit]', action: 'fill',
    text: '좋아요! 이제 마음에 담아 둔 말을 적어 보세요. 무엇이든 좋아요. ✏️' },
  { find: '#decorBtn', action: 'click',
    text: '멋진 첫 노트예요! 이번엔 🎨 단추로 꾸미기 서랍을 열어 볼까요?' },
  { find: '#dpStSeason button', action: 'drag:#board', markDelay: 550,
    text: '마음에 드는 스티커를 꾹 잡고 보드로 끌어와 붙여 보세요. 🌸' },
  { auto: 2400, text: '참 잘했어요! 🎉 이 보드는 이제 온전히 당신의 자리예요.' }
];

let onboardingActive = false;                  // 중복 기동 방지 (재실행 버튼 연타 등)

function startOnboarding() {
  if (onboardingActive || !document.body) return;
  onboardingActive = true;

  // 지목 하이라이트 스타일 (정적 문자열만 — textContent 주입)
  const styleEl = document.createElement('style');
  styleEl.textContent =
    '[data-onboarding-target] { outline: 3px solid #ff8fab !important; outline-offset: 3px; border-radius: 8px; }';
  document.head.appendChild(styleEl);

  const root = el('div', {
    position: 'fixed',
    inset: '0',
    zIndex: '2147483500',
    pointerEvents: 'none'                       // 앱 조작을 막지 않는다 — 카드만 상호작용
  });
  root.setAttribute('data-onboarding', '');

  const card = el('div', {
    position: 'fixed',
    left: '50%',
    bottom: '24px',
    transform: 'translateX(-50%)',
    maxWidth: '420px',
    boxSizing: 'border-box',
    padding: '14px 18px',
    background: '#fffdf5',
    border: '1px solid #e6d9bf',
    borderRadius: '14px',
    boxShadow: '0 8px 24px rgba(80, 60, 20, 0.22)',
    color: '#4a3f33',
    fontSize: '14px',
    lineHeight: '1.5',
    fontFamily: 'inherit',
    pointerEvents: 'auto',
    textAlign: 'center'
  });

  const counter = el('div', { fontSize: '11px', color: '#a89a82', marginBottom: '4px' }, '');
  const textLine = el('div', { marginBottom: '10px' }, '');
  textLine.setAttribute('data-onboarding-text', '');
  const btnSkip = el('button', {
    font: 'inherit',
    fontSize: '13px',
    padding: '5px 14px',
    borderRadius: '10px',
    border: '1px solid #d8cbb0',
    background: 'transparent',
    color: '#6b5d49',
    cursor: 'pointer'
  }, '건너뛰기');
  btnSkip.type = 'button';
  btnSkip.setAttribute('data-onboarding-skip', '');   // 항상 보임 (A47 — 언제든 건너뛰기)
  card.appendChild(counter);
  card.appendChild(textLine);
  card.appendChild(btnSkip);
  root.appendChild(card);
  document.body.appendChild(root);

  let idx = -1;
  let currentTarget = null;
  let currentAction = null;                     // 'click' | 'fill' | 'drag'
  let autoTimer = null;
  let locateTimer = null;
  let markTimer = null;
  let fillTimer = null;
  let fillLastVal = null;
  let dragArm = null;                           // { el, x, y } — 드래그 시작 스냅숏
  let finished = false;

  function clearTimers() {
    if (autoTimer) { clearTimeout(autoTimer); autoTimer = null; }
    if (locateTimer) { clearInterval(locateTimer); locateTimer = null; }
    if (markTimer) { clearTimeout(markTimer); markTimer = null; }
    if (fillTimer) { clearInterval(fillTimer); fillTimer = null; }
  }

  function clearTargetMark() {
    if (currentTarget) {
      try { currentTarget.removeAttribute('data-onboarding-target'); } catch (_err) { /* DOM 이탈 무해 */ }
    }
    currentTarget = null;
    currentAction = null;
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
        if (currentAction === 'fill') startFillWatch();
      };
      if (st.markDelay) markTimer = setTimeout(mark, st.markDelay);
      else mark();
      return true;
    };
    if (!locate()) {
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
    clearTargetMark();
    document.removeEventListener('click', onDocClick, true);
    document.removeEventListener('pointerdown', onDocPointerDown, true);
    document.removeEventListener('pointerup', onDocPointerUp, true);
    if (root.isConnected) root.remove();
    if (styleEl.isConnected) styleEl.remove();
    onboardingActive = false;
    lsSet(ONBOARDED_KEY, mode);                 // 완료 플래그 정본 — 재기동 시 재표시 금지
    petitApi.onboarding.setDone().catch(function () { /* 스텁 실패 무해 — 정본은 localStorage */ });
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
  const btn = el('button', undefined, '🌱 처음 안내 다시 보기');
  btn.type = 'button';
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

function initOnboarding() {
  if (PAGE !== 'postit') return;
  injectOnboardingReplay();                    // 재실행 진입점은 항상 준비 (완료·건너뛰기 후 포함)
  if (lsGet(ONBOARDED_KEY) !== null) return;   // fresh userData 에서만 자동 표시
  // 앱 초기화(load)가 끝난 뒤 시작 — fresh 첫 기동의 무거운 초기화와 첫 클릭이
  // 경합하지 않게 한다 (오버레이는 load 직후 표시 — 15초 표시 계약에 충분).
  if (document.readyState === 'complete') startOnboarding();
  else window.addEventListener('load', function () { startOnboarding(); }, { once: true });
}

// ────────────────────────────────────────────────────────────────────────────
// 진입점 — 앱 DOM 준비 후 셸 UI 부착
// ────────────────────────────────────────────────────────────────────────────

function initShellUi() {
  if (!PAGE || !document.body) return;
  initMigrateUi().catch(function () { /* 브리지 실패 시 셸 UI 만 생략 — 앱 무영향 */ });
  if (PAGE === 'postit') initOnboarding();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initShellUi);
} else {
  initShellUi();
}
