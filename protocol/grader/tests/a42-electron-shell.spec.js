'use strict';
/**
 * A42 — Electron 셸 (SCORECARD rev.8: 단일 창 탭 모드 — 창 분리 폐지)
 * "(rev.8) Playwright `_electron.launch`(개발 트리, 패키지 exe는 EnableNodeCliInspectArguments
 *  fuse 유지)로 기동하면: 항상 BrowserWindow 정확히 1개(단일 창 탭 모드) — 제목에 앱 이름
 *  포함, 기본 크기 ≥1024×700, 리사이즈·이동 가능, 셸 탭바([data-shell-tabbar], 탭
 *  [data-tab="postit"]·[data-tab="calendar"]) + 기본 활성 탭 = 포스트잇(보드 visible).
 *  탭 전환: [data-tab="calendar"] → 날짜 셀 ≥28 visible, 포스트잇 탭 복귀 시 작성 상태가
 *  리로드 없이 보존(webContents 유지). 분리 모드 부재 단언: [data-split]·[data-merge] 훅이
 *  어디에도 존재하지 않고, 어떤 조작으로도 BrowserWindow 가 2개가 되지 않는다. 설정 영속:
 *  셸 설정([data-shell-settings])에서 기본 탭(calendar) 변경 후 재기동 시 캘린더 탭 활성.
 *  출시-소스 동일성: 패키지 리소스의 calendar.html·postit.html이 저장소 원본과
 *  SHA256 동일(빌드 변형·인젝션 금지). 임계 서브셋 실검증: A5·A6·A8·A9·A25·A26 시나리오를
 *  Electron 컨텍스트(고정 userData, 환경변수 오버라이드 훅 격리)에서 재실행 —
 *  완전 종료 후 재기동 보존 포함"
 *
 * ── REQUIRED CONTRACT (rev.8 — 이 주석이 셸 계약의 정본, rev.5 관례) ──
 *  - 기동: `electron.exe d:\custom_program\electron` (개발 트리). main.js 는 app ready 이전에
 *    환경변수 PETIT_USERDATA 가 있으면 userData 로 사용한다 (채점 격리 훅 — 실사용 데이터 불가침).
 *  - 단일 창 탭 모드(유일한 모드): BrowserWindow 정확히 1개, 제목에 브랜드(쁘띠캘린더 또는
 *    PetitCalendar) 포함, fresh 기동 기본 크기 ≥ 1024×700, isResizable/isMovable 참 +
 *    setBounds 실효(±8px — rev.6 창 계약을 단일 창에 그대로 적용).
 *    · 탭바 = 셸 소유 페이지가 로드한 electron\tabbar.html (단일 창의 기본 페이지 또는
 *      별도 WebContentsView — 채점은 페이지 URL 로 획득하므로 양쪽 모두 허용).
 *      상시 visible 훅: [data-shell-tabbar] · [data-tab="postit"] · [data-tab="calendar"] ·
 *      [data-shell-settings-open](설정 드로어 토글). 설정 드로어
 *      [data-shell-settings] 는 존재 필수(기본 닫힘 허용 — hidden 토글), 내부에
 *      [data-default-tab="calendar"] 세그 존재(클릭 = shell-settings.json 즉시 저장).
 *      (폴백 셀렉터 없음 — 훅 부재 = 즉시 FAIL, fail-closed)
 *    · 앱 2뷰(calendar.html·postit.html)는 WebContentsView 로 모두 로드 유지, 활성 탭만
 *      사용자에게 보인다. 허용되는 숨김 방식: setVisible(false)·0 크기 bounds, 또는 동일
 *      bounds 스택의 z순서 아래(맨 위 뷰 = 활성 — addChildView 재호출 의미론). 활성 판정은
 *      main 프로세스 뷰 정보(getVisible/getBounds/부착 순서)로만 가능하다 (숨김/가려진
 *      뷰의 DOM 은 페이지 내부 관점에서 여전히 '보임'이라 DOM 단독 판정 불가 —
 *      실측 2026-08-20, electron-helpers rev.7 주석).
 *    · 기본 활성 탭 = 포스트잇 (보드 visible). [data-tab] 클릭으로 전환, 전환은 리로드 없이
 *      (window 전역 마커 잔존 = 무리로드 증명 — reload 시 소거되는 것 실측 확인).
 *    · 단일 창 호스트 webContents 는 최소 문서라도 로드해야 한다 — 무로드 시 Playwright
 *      _electron.launch 자체가 타임아웃한다 (실측).
 *  - 분리 모드 부재 (rev.8 신규 — 폐지 확정 기능의 잔존 금지):
 *    · DOM: 탭바·설정 드로어·양 앱 뷰(캘린더/포스트잇, 각 앱 설정 패널 #settingsPanel 개방
 *      상태 포함) 어디에도 [data-split]·[data-merge] 가 0개여야 한다. preload 의 지연 주입을
 *      잡기 위해 설정 패널 개방 후 안정화 구간까지 0개 유지를 확인한다.
 *    · 소스: electron\ 의 셸 소스(main.js·preload.js·tabbar-preload.js·tabbar.html 등
 *      node_modules·dist 제외)와 calendar.html·postit.html 에 data-split/data-merge 훅의
 *      코드 형태(따옴표 문자열 또는 HTML 태그 속성)가 남아 있지 않아야 한다. 주석 언급은
 *      무해하므로 JS 주석·HTML 주석 제거 후 판정한다 (휴면 분리 코드 잔존 차단).
 *    · 구조: 정상 조작 전수(탭 왕복 전환, 설정 드로어 개폐, [data-default-tab] 클릭, 양 앱
 *      설정 패널 개방) 후에도 BrowserWindow 는 계속 정확히 1개이고, 두 앱 뷰가 모두 그 한
 *      창에 속한다(windowIdForApp 동일). 안정화 폴링으로 뒤늦은 창 생성도 배제한다.
 *  - 셸 설정 영속: userData\shell-settings.json {defaultTab:"postit"|"calendar", …}.
 *    설정 드로어의 [data-default-tab="calendar"] 클릭 = defaultTab="calendar" 즉시 저장 →
 *    재기동의 활성 탭 = 캘린더(날짜 셀 ≥28 visible), 재기동도 BrowserWindow 1개.
 *    (rev.7 의 windowMode/separate 계약은 창 분리 폐지로 삭제 — 재도입 금지)
 *  - 출시-소스 동일성: 셸이 실제 로드한 file:// 문서가 저장소 원본과 SHA256 동일 (항상 수행).
 *    electron\dist\win-unpacked 존재 시(조건부): resources\calendar.html·postit.html 동일 +
 *    패키지 exe 의 EnableNodeCliInspectArguments fuse = ENABLE. dist 부재 시 개발 트리
 *    기준으로만 판정하고 annotation 으로 명시한다 (skip-pass 아님).
 *  - 임계 서브셋: A5·A6·A8·A9·A25·A26 핵심 관찰을 단일 창 탭 모드의 각 앱 페이지
 *    (WebContentsView — Playwright windows() 에 Page 로 노출, 실측)에서 재실행. 조작 전
 *    해당 앱 탭을 활성화한다. 각 시나리오의 정밀·확장 검사 정본은 원 스펙(a05~a26)이며,
 *    여기서는 "같은 HTML 이 Electron 셸에서도 같은 관찰을 낸다"를 판정한다.
 *    두 뷰는 같은 file:// 오리진 localStorage 를 공유하므로 cal-*·postit-* 키 접두 규약 유지.
 *  - 온보딩(A47)·이전 제안(A43) 오버레이가 뜨면 각각 skip/나중에 경로로 닫고 진행한다
 *    (훅 부재 시 fail-closed FAIL — 해당 헬퍼가 판정).
 *  - fail-closed: 셸 미구축 = "electron 셸 미구축 (2단계 진행 중)" FAIL(기존 문구 유지).
 *    셸이 구계약(분리 2창·탭바 없음)이거나 분리 훅이 남아 있으면 "단일 창 탭 모드 미구현
 *    (rev.8 진행 중)" 류 한국어 FAIL. SKIP 은 비 Windows 뿐.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { test, expect } = require('@playwright/test');
const {
  CALENDAR_PATH,
  POSTIT_PATH,
  requirePostit,
  removeDirWithRetry,
  pollLocalStorage,
  pollPage,
  sleep,
  POSTIT_SEL,
  assertNoDialogs,
  requireHook,
  addNote,
  setNoteText,
  pollVisibleNoteCount,
  hasVisibleNoteText,
  noteTopLeft,
  dragNoteTo,
  parseRgb,
  openContextMenuOn,
} = require('../lib/helpers');
const {
  ELECTRON_DIR,
  ELECTRON_TABBAR_HTML,
  WIN_UNPACKED_DIR,
  requireElectronShell,
  freshUserDataDir,
  launchShellChecked,
  closeElectronShell,
  dismissOnboardingIfPresent,
  dismissMigrateIfPresent,
  mainWindowsInfo,
  openExtraWindow,
  sha256File,
  urlToLocalPath,
  poll,
  readNotesWithBg,
  applyAnyColor,
  calDayCell,
  calViewedMonthKey,
  calAddViaForm,
  countCalText,
  countVisibleStrict,
  pollVisibleStrict,
  requireHook6,
  BRAND_RE,
  pageByUrl,
  browserWindowCount,
  pollBrowserWindowCount,
  shellViewsInfo,
  judgeActiveAppView,
  windowIdForApp,
  stripJsComments,
} = require('../lib/electron-helpers');

/* 탭바 상시 visible 훅 (rev.8 DOM 계약 — 폴백 없음).
 * [data-shell-settings](설정 드로어)는 기본 닫힘 허용 — 존재만 fail-closed 확인.
 * rev.8: [data-split] 은 폐지 — 상시 훅에서 제외되고 "부재" 단언 대상이 된다. */
const TABBAR_HOOKS_VISIBLE = [
  '[data-shell-tabbar]',
  '[data-tab="postit"]',
  '[data-tab="calendar"]',
  '[data-shell-settings-open]',
];

/* rev.8 폐지 훅 — 어떤 문서에도 존재해서는 안 된다 (분리 모드 부재 단언) */
const ABOLISHED_HOOKS = ['[data-split]', '[data-merge]'];

/* 캘린더 이번 달 날짜 셀 (calDayCell 과 동일 셀렉터 축 — 이번 달만) */
const CAL_CELL_SEL = '#grid .cell:not(.other)';

/* localStorage 전체 스냅샷(JSON 문자열) / 스냅샷 대비 변화 감지 — a05 동형(하트비트 정밀 제외는 원 스펙 담당) */
const SNAPSHOT_JSON_FN = () => {
  const o = {};
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    o[k] = localStorage.getItem(k);
  }
  return JSON.stringify(o);
};
const CHANGED_FN = (prev) => {
  const p = JSON.parse(prev);
  const keys = new Set(Object.keys(p));
  for (let i = 0; i < localStorage.length; i++) keys.add(localStorage.key(i));
  for (const k of keys) {
    const before = Object.prototype.hasOwnProperty.call(p, k) ? p[k] : null;
    if (localStorage.getItem(k) !== before) return true;
  }
  return false;
};
const CONTAINS_FN = (m) => Object.keys(localStorage).some((k) => (localStorage.getItem(k) || '').includes(m));

function skipUnlessWin32() {
  test.skip(process.platform !== 'win32', 'Windows 전용 항목 — A42 를 명시적으로 SKIP 합니다 (rev.5 관례)');
}

/** userData\shell-settings.json 경로/판독 (rev.7 셸 설정 영속 계약) */
function shellSettingsPath(dir) {
  return path.join(dir, 'shell-settings.json');
}
function readShellSettings(dir, label) {
  const p = shellSettingsPath(dir);
  if (!fs.existsSync(p)) {
    throw new Error(
      `${label}: 셸 설정 파일이 없습니다 (${p}) — userData\\shell-settings.json {defaultTab, …} ` +
        '영속 계약 미구현 (rev.8, fail-closed)'
    );
  }
  const raw = fs.readFileSync(p, 'utf8');
  try {
    const o = JSON.parse(raw);
    if (!o || typeof o !== 'object') throw new Error('객체가 아님');
    return o;
  } catch (e) {
    throw new Error(
      `${label}: shell-settings.json 이 유효 JSON 객체가 아닙니다 (${e.message}) — 내용 앞부분: ${raw.slice(0, 80)}`
    );
  }
}

/** 활성 앱 뷰가 which 가 될 때까지 폴링 — 실패 시 현재 판정·사유 포함 한국어 FAIL */
async function pollActiveApp(app, which, timeoutMs, labelPrefix) {
  const deadline = Date.now() + timeoutMs;
  let j = { active: null, problem: '뷰 정보 미조회' };
  for (;;) {
    try {
      j = judgeActiveAppView(await shellViewsInfo(app));
    } catch (e) {
      j = { active: null, problem: '뷰 트리 조회 실패: ' + String((e && e.message) || e) };
    }
    if (j.active === which) return;
    if (Date.now() > deadline) {
      throw new Error(
        `${labelPrefix} ${timeoutMs}ms 내 활성 앱 뷰가 "${which}" 가 되지 않았습니다 ` +
          `(현재 활성: ${j.active || '판정 불가'}${j.problem ? ' — ' + j.problem : ''})`
      );
    }
    await sleep(150);
  }
}

/** 탭바에서 [data-tab=which] 클릭 → 해당 뷰 활성 확인 (임계 서브셋 조작 전 공용) */
async function activateTab(launched, which, label) {
  const tab = launched.tabbarPage.locator(`[data-tab="${which}"]`);
  let n = 0;
  try {
    n = await tab.count();
  } catch (e) {
    n = 0;
  }
  if (n === 0) {
    throw new Error(`${label}: 필수 훅 [data-tab="${which}"] 이(가) 탭바에 없습니다 — rev.7 DOM 계약 (fail-closed)`);
  }
  await tab.first().click({ timeout: 5000 });
  await pollActiveApp(launched.shell.app, which, 8000, `${label}: [data-tab="${which}"] 클릭 후`);
}

/**
 * 앱 설정 패널(#settingsBtn → #settingsPanel)을 연다 (rev.8: 폐지된 [data-merge] 주입
 * 지점을 실제로 노출시켜 "부재"를 관찰하기 위한 준비 동작). 열 수 없으면 한국어 FAIL.
 */
async function openAppSettingsPanel(page, appLabel, itemLabel) {
  const btn = page.locator('#settingsBtn');
  if ((await btn.count()) === 0) {
    throw new Error(
      `${itemLabel}: ${appLabel} 설정 버튼(#settingsBtn)이 없습니다 — 분리 훅 부재를 확인할 설정 패널을 열 수 없습니다 (fail-closed)`
    );
  }
  await btn.first().click({ timeout: 5000 });
  await pollVisibleStrict(
    page,
    '#settingsPanel',
    true,
    5000,
    `${itemLabel}: ${appLabel} 설정 버튼(#settingsBtn) 클릭 후 5초 내 설정 패널(#settingsPanel)이 보이지 않습니다 (fail-closed)`
  );
}

/** 폐지 훅([data-split]·[data-merge]) 발견 목록 — 조회 실패는 "확인 불가" 로 FAIL(fail-closed) */
async function findAbolishedHooks(pages, itemLabel) {
  const found = [];
  for (const { label, page } of pages) {
    for (const sel of ABOLISHED_HOOKS) {
      let n = 0;
      try {
        n = await page.locator(sel).count();
      } catch (e) {
        throw new Error(
          `${itemLabel}: ${label} 문서에서 ${sel} 존재 여부를 조회할 수 없습니다 (${String((e && e.message) || e)}) — ` +
            '분리 훅 부재를 증명할 수 없으므로 FAIL 처리합니다 (fail-closed)'
        );
      }
      if (n > 0) found.push(`${label} → ${sel} ${n}개`);
    }
  }
  return found;
}

/** 지정 문서들에 폐지 훅이 0개이며, 안정화 구간(holdMs) 동안 지연 주입도 없음을 단언 */
async function assertNoAbolishedHooks(pages, itemLabel, holdMs = 1500) {
  const now = await findAbolishedHooks(pages, itemLabel);
  if (now.length > 0) {
    throw new Error(
      `${itemLabel}: 폐지된 분리 훅이 DOM 에 남아 있습니다 — ${now.join(' / ')} ` +
        '(rev.8 계약: 창 분리 폐지 — [data-split]·[data-merge] 는 탭바·설정 드로어·양 앱 어디에도 존재하면 안 됩니다)'
    );
  }
  const deadline = Date.now() + holdMs;
  while (Date.now() < deadline) {
    await sleep(250);
    const late = await findAbolishedHooks(pages, itemLabel);
    if (late.length > 0) {
      throw new Error(
        `${itemLabel}: 분리 훅이 지연 주입되었습니다 — ${late.join(' / ')} ` +
          '(preload 등이 뒤늦게 [data-merge]/[data-split] 를 주입 — rev.8 폐지 계약 위반)'
      );
    }
  }
}

/* rev.8 분리 훅의 "코드 형태" 탐지 (주석 언급은 무해 — 주석 제거 후 판정).
 *  ① 따옴표 문자열 안: '[data-merge]' · "data-split" · `data-merge`
 *  ② HTML 여는 태그 속성: <button data-split …> */
const HOOK_IN_STRING_RE = /(['"`])[^'"`\r\n]*\bdata-(?:split|merge)\b/;
const HOOK_IN_TAG_RE = /<[A-Za-z][^>\r\n]*\bdata-(?:split|merge)\b/;

/** 스캔 대상 소스 파일 수집 (node_modules·dist·test-license 는 순회 자체를 건너뛴다) */
function collectShellSources() {
  const SKIP_DIR = /^(node_modules|dist|test-license|\.git)$/i;
  const out = [];
  const walk = (dir, relBase) => {
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (e) {
      return;
    }
    for (const ent of entries) {
      const abs = path.join(dir, ent.name);
      const rel = relBase ? `${relBase}/${ent.name}` : ent.name;
      if (ent.isDirectory()) {
        if (SKIP_DIR.test(ent.name)) continue;
        walk(abs, rel);
      } else if (/\.(js|cjs|mjs|html)$/i.test(ent.name)) {
        out.push({ abs, label: `electron/${rel}` });
      }
    }
  };
  if (fs.existsSync(ELECTRON_DIR)) walk(ELECTRON_DIR, '');
  out.push({ abs: CALENDAR_PATH, label: 'calendar.html' });
  out.push({ abs: POSTIT_PATH, label: 'postit.html' });
  return out;
}

/** 주석 제거 (JS 는 static-checks 토크나이저, HTML 은 HTML 주석 + 순수 주석 줄) */
function stripCommentsForScan(src, isHtml) {
  if (!isHtml) {
    try {
      return stripJsComments(src);
    } catch (e) {
      return src;
    }
  }
  return src
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .split(/\r?\n/)
    .map((line) => (/^\s*(\/\/|\*|\/\*)/.test(line) ? '' : line))
    .join('\n');
}

/** 소스에 남은 분리 훅 코드 (파일:줄 목록) — 없으면 빈 배열 */
function scanSourcesForAbolishedHooks() {
  const hits = [];
  for (const f of collectShellSources()) {
    let src = '';
    try {
      src = fs.readFileSync(f.abs, 'utf8');
    } catch (e) {
      continue;
    }
    const body = stripCommentsForScan(src, /\.html$/i.test(f.abs));
    const lines = body.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      if (HOOK_IN_STRING_RE.test(lines[i]) || HOOK_IN_TAG_RE.test(lines[i])) {
        hits.push(`${f.label}:${i + 1}`);
      }
    }
  }
  return hits;
}

/**
 * 단일 창 셸 기동 + 탭바·앱 2뷰 페이지 획득 + 온보딩/이전 제안 오버레이 처치 (공용 진입).
 * 실패 시 셸을 정리하고 던진다. 구계약(분리 2창·탭바 없음) 셸은 rev.8 미구현으로 명시 FAIL.
 */
async function launchMerged(dir, label, opts = {}) {
  const shell = await launchShellChecked(dir, Object.assign({ label }, opts));
  try {
    let tabbarPage;
    try {
      tabbarPage = await pageByUrl(shell.app, /\/tabbar\.html$/i, 30000, `${label} 탭바`);
    } catch (e) {
      const n = await browserWindowCount(shell.app).catch(() => -1);
      if (n >= 2) {
        throw new Error(
          `${label}: 탭바 페이지(electron\\tabbar.html)가 없고 BrowserWindow 가 ${n}개입니다 — ` +
            '구계약(분리 2창) 셸 감지: 단일 창 탭 모드 미구현 (rev.8 진행 중, fail-closed)'
        );
      }
      throw e;
    }
    const calPage = await pageByUrl(shell.app, /\/calendar\.html$/i, 30000, `${label} 캘린더 뷰`);
    const postitPage = await pageByUrl(shell.app, /\/postit\.html$/i, 30000, `${label} 포스트잇 뷰`);
    for (const p of [postitPage, calPage]) {
      await dismissOnboardingIfPresent(p, label);
      await dismissMigrateIfPresent(p, label);
    }
    return { shell, tabbarPage, calPage, postitPage };
  } catch (e) {
    await closeElectronShell(shell);
    throw e;
  }
}

/* ════════════════════════════════════════════════════════════════════ */

test.describe('A42 Electron 셸 (rev.8 단일 창 탭 모드 — 창 분리 폐지)', () => {
  test('A42: 단일 창 기동 — BrowserWindow 1개·제목 브랜드·크기 ≥1024×700·리사이즈/이동·탭바 훅·기본 활성 포스트잇', async () => {
    test.setTimeout(180 * 1000);
    skipUnlessWin32();
    requireElectronShell('A42');
    requirePostit();
    const dir = freshUserDataDir();
    let shell = null;
    try {
      const launched = await launchMerged(dir, 'A42');
      shell = launched.shell;

      // rev.8 핵심: 기동 = BrowserWindow 정확히 1개 (탭바·앱은 WebContentsView — 창이 아님)
      await pollBrowserWindowCount(
        shell.app,
        1,
        10000,
        'A42: fresh 기동이 단일 창이 아닙니다 — rev.8 계약: BrowserWindow 정확히 1개(탭바·앱 2뷰는 ' +
          'WebContentsView). 2개 이상이면 창 분리 잔존/단일 창 탭 모드 미구현 (rev.8 진행 중)'
      );

      const infos = await mainWindowsInfo(shell.app);
      expect(
        infos.length,
        `A42: BrowserWindow 가 ${infos.length}개입니다 (단일 창 탭 모드 = 정확히 1개): ` +
          infos.map((w) => `"${w.title}"(${w.url || 'url 없음'})`).join(', ')
      ).toBe(1);
      const w = infos[0];
      expect(
        BRAND_RE.test(w.title),
        `A42: 창 제목 "${w.title}" 에 앱 이름(쁘띠캘린더/PetitCalendar)이 없습니다`
      ).toBe(true);
      expect(
        w.bounds.width >= 1024 && w.bounds.height >= 700,
        `A42: 창 기본 크기 미달 — ${w.bounds.width}×${w.bounds.height} ` +
          '(fresh 기동 시 ≥ 1024×700, SCORECARD rev.8 A42)'
      ).toBe(true);

      // 창 조작 계약 (rev.6 창 계약을 rev.8 단일 창에 그대로 적용): 리사이즈·이동 가능 + setBounds 실효
      expect(w.resizable, `A42: 창 "${w.title}" 이 리사이즈 불가(isResizable=false)입니다`).toBe(true);
      expect(w.movable, `A42: 창 "${w.title}" 이 이동 불가(isMovable=false)입니다`).toBe(true);
      const rb = await shell.app.evaluate(({ BrowserWindow }, id) => {
        const win = BrowserWindow.getAllWindows().find((x) => x.id === id);
        if (!win) return null;
        const before = win.getBounds();
        win.setBounds({
          x: before.x + 24,
          y: before.y + 18,
          width: before.width + 64,
          height: before.height + 48,
        });
        return { before, after: win.getBounds() };
      }, w.id);
      expect(rb, 'A42: 단일 창을 main 프로세스에서 찾을 수 없습니다').not.toBeNull();
      expect(
        Math.abs(rb.after.width - (rb.before.width + 64)) <= 8 &&
          Math.abs(rb.after.height - (rb.before.height + 48)) <= 8,
        `A42: 리사이즈가 반영되지 않았습니다 (setBounds ${rb.before.width + 64}×${rb.before.height + 48} 요청 → 실제 ${rb.after.width}×${rb.after.height})`
      ).toBe(true);
      expect(
        Math.abs(rb.after.x - (rb.before.x + 24)) <= 8 && Math.abs(rb.after.y - (rb.before.y + 18)) <= 8,
        `A42: 이동이 반영되지 않았습니다 (setBounds (${rb.before.x + 24},${rb.before.y + 18}) 요청 → 실제 (${rb.after.x},${rb.after.y}))`
      ).toBe(true);

      // 탭바 문서 정합: electron\tabbar.html 을 그대로 로드해야 한다
      const tabbarLoaded = path.resolve(urlToLocalPath(launched.tabbarPage.url())).toLowerCase();
      expect(
        tabbarLoaded,
        `A42: 탭바가 electron\\tabbar.html 이 아닌 문서를 로드했습니다 (${tabbarLoaded})`
      ).toBe(path.resolve(ELECTRON_TABBAR_HTML).toLowerCase());

      // 탭바 상시 훅 — 존재 + 엄격 가시 (폴백 없음, fail-closed)
      for (const sel of TABBAR_HOOKS_VISIBLE) {
        await requireHook6(launched.tabbarPage, sel, 'A42 탭바');
        const vis = await countVisibleStrict(launched.tabbarPage, sel);
        expect(
          vis > 0,
          `A42: 탭바 훅 ${sel} 이(가) 존재하지만 보이지 않습니다 (엄격 가시성 0개 — 탭바는 상시 표시여야 함)`
        ).toBe(true);
      }
      // 설정 드로어는 기본 닫힘 허용 — 존재만 fail-closed 확인 (개폐·저장은 설정 영속 테스트가 판정)
      await requireHook6(launched.tabbarPage, '[data-shell-settings]', 'A42 탭바');

      // 앱 2뷰 모두 로드 유지 (페이지 획득 자체가 존재 증명 — 추가로 응답성 확인)
      for (const [label2, p] of [['캘린더', launched.calPage], ['포스트잇', launched.postitPage]]) {
        const alive = await p.evaluate(() => 1 + 1).catch(() => null);
        expect(alive, `A42: ${label2} 뷰(WebContentsView) 페이지가 응답하지 않습니다 (앱 2뷰 로드 유지 계약)`).toBe(2);
      }

      // 기본 활성 탭 = 포스트잇 (main 프로세스 뷰 표시 판정) + 보드 visible
      await pollActiveApp(shell.app, 'postit', 8000, 'A42: fresh 기동 기본 활성 탭 판정 —');
      const boardVis = await countVisibleStrict(launched.postitPage, POSTIT_SEL.BOARD);
      expect(
        boardVis > 0,
        `A42: 기본 활성(포스트잇) 상태에서 보드(${POSTIT_SEL.BOARD})가 visible 이 아닙니다`
      ).toBe(true);

      assertNoDialogs(shell.state, 'A42 단일 창 기동');
    } finally {
      await closeElectronShell(shell);
      await removeDirWithRetry(dir);
    }
  });

  test('A42: 탭 전환 — 캘린더 셀 ≥28 visible·포스트잇 복귀 시 리로드 없이 작성 상태 보존', async () => {
    test.setTimeout(240 * 1000);
    skipUnlessWin32();
    requireElectronShell('A42');
    requirePostit();
    const dir = freshUserDataDir();
    const T = 'A42-탭전환-보존-노트';
    const MARKER = 'rev7-무리로드-증명';
    let shell = null;
    try {
      const launched = await launchMerged(dir, 'A42 탭전환');
      shell = launched.shell;

      // 작성 상태 준비 (기본 활성 = 포스트잇이지만 결정적으로 활성화)
      await activateTab(launched, 'postit', 'A42 탭전환');
      await addNote(launched.postitPage);
      await pollVisibleNoteCount(launched.postitPage, 1, 5000, 'A42 탭전환');
      await setNoteText(launched.postitPage, launched.postitPage.locator(POSTIT_SEL.NOTE).first(), T);
      await pollPage(launched.postitPage, CONTAINS_FN, T, 5000, 'A42 탭전환: 노트 텍스트가 localStorage 에 저장되지 않았습니다');
      // 무리로드 증명 마커 (reload 시 소거됨 — 실측)
      await launched.postitPage.evaluate((m) => {
        window.__a42NoReloadMarker = m;
      }, MARKER);

      // 캘린더 탭 전환 → 이번 달 날짜 셀 ≥28 visible
      await activateTab(launched, 'calendar', 'A42 탭전환');
      const cells = await countVisibleStrict(launched.calPage, CAL_CELL_SEL);
      expect(
        cells >= 28,
        `A42 탭전환: 캘린더 탭 활성 후 이번 달 날짜 셀(${CAL_CELL_SEL})이 ${cells}개만 visible 입니다 (≥28 필요)`
      ).toBe(true);

      // 포스트잇 복귀 → 마커 잔존(webContents 유지) + 노트 표시 유지
      await activateTab(launched, 'postit', 'A42 탭전환 복귀');
      const marker = await launched.postitPage.evaluate(() => window.__a42NoReloadMarker).catch(() => null);
      expect(
        marker,
        'A42 탭전환: 포스트잇 복귀 후 window 마커가 사라졌습니다 — 탭 전환이 리로드/뷰 재생성을 유발합니다 ' +
          '(webContents 유지·리로드 없는 전환 계약 위반)'
      ).toBe(MARKER);
      expect(
        await hasVisibleNoteText(launched.postitPage, T),
        `A42 탭전환: 복귀한 포스트잇에서 "${T}" 노트가 보이지 않습니다 (작성 상태 보존 실패)`
      ).toBe(true);

      assertNoDialogs(shell.state, 'A42 탭전환');
    } finally {
      await closeElectronShell(shell);
      await removeDirWithRetry(dir);
    }
  });

  test('A42: 분리 모드 부재 — [data-split]·[data-merge] 훅 없음(DOM·소스) + 어떤 조작으로도 창 2개 불가', async () => {
    test.setTimeout(300 * 1000);
    skipUnlessWin32();
    requireElectronShell('A42');
    requirePostit();
    const dir = freshUserDataDir();
    let shell = null;
    try {
      const launched = await launchMerged(dir, 'A42 분리부재');
      shell = launched.shell;
      const docs = [
        { label: '탭바(tabbar.html)', page: launched.tabbarPage },
        { label: '캘린더 뷰(calendar.html)', page: launched.calPage },
        { label: '포스트잇 뷰(postit.html)', page: launched.postitPage },
      ];

      // ── ① 기동 직후: 세 문서 어디에도 폐지 훅 0개 ──
      await assertNoAbolishedHooks(docs, 'A42 분리부재(기동 직후)');

      // ── ② 정상 조작 전수 후에도 폐지 훅 0개 · 창 1개 유지 ──
      //     (탭 왕복 전환 → 설정 드로어 개폐 → [data-default-tab] 클릭 → 양 앱 설정 패널 개방)
      await activateTab(launched, 'calendar', 'A42 분리부재');
      await activateTab(launched, 'postit', 'A42 분리부재');
      await requireHook6(launched.tabbarPage, '[data-shell-settings-open]', 'A42 분리부재');
      await launched.tabbarPage.locator('[data-shell-settings-open]').first().click({ timeout: 5000 });
      await pollVisibleStrict(
        launched.tabbarPage,
        '[data-shell-settings]',
        true,
        5000,
        'A42 분리부재: [data-shell-settings-open] 클릭 후 5초 내 셸 설정 드로어([data-shell-settings])가 보이지 않습니다 (fail-closed)'
      );
      await assertNoAbolishedHooks(docs, 'A42 분리부재(설정 드로어 개방)');
      const segs = launched.tabbarPage.locator('[data-default-tab]');
      const segCount = await segs.count();
      expect(
        segCount >= 1,
        `A42 분리부재: 셸 설정 드로어에 [data-default-tab] 세그가 ${segCount}개입니다 (rev.8 DOM 계약: 최소 1개, fail-closed)`
      ).toBe(true);
      for (let i = 0; i < segCount; i++) {
        await segs.nth(i).click({ timeout: 5000 }).catch(() => {});
        await sleep(120);
      }
      await launched.tabbarPage.locator('[data-shell-settings-open]').first().click({ timeout: 5000 }).catch(() => {});
      await sleep(200);
      await openAppSettingsPanel(launched.postitPage, '포스트잇', 'A42 분리부재');
      await activateTab(launched, 'calendar', 'A42 분리부재');
      await openAppSettingsPanel(launched.calPage, '캘린더', 'A42 분리부재');
      // 설정 패널이 열린 상태 = 폐지된 [data-merge] 의 옛 주입 지점 — 지연 주입까지 관찰
      await assertNoAbolishedHooks(docs, 'A42 분리부재(양 앱 설정 패널 개방)', 3000);

      // ── ③ 창 개수 불변: 모든 조작 후에도 정확히 1개 (안정화 폴링으로 뒤늦은 창 생성 배제) ──
      const deadline = Date.now() + 3000;
      for (;;) {
        const n = await browserWindowCount(shell.app);
        if (n !== 1) {
          const infos = await mainWindowsInfo(shell.app).catch(() => []);
          throw new Error(
            `A42 분리부재: 조작 후 BrowserWindow 가 ${n}개가 되었습니다 — rev.8 계약: 어떤 조작으로도 창은 2개가 되지 않습니다 ` +
              `(현재 창: ${infos.map((w) => `"${w.title}"(${w.url || 'url 없음'})`).join(', ') || '조회 실패'})`
          );
        }
        if (Date.now() > deadline) break;
        await sleep(200);
      }

      // ── ④ 구조: 두 앱 뷰가 모두 같은 하나의 창에 속한다 ──
      const winId = (await mainWindowsInfo(shell.app))[0].id;
      for (const [appLabel, file] of [['캘린더', 'calendar.html'], ['포스트잇', 'postit.html']]) {
        const id = await windowIdForApp(shell.app, file);
        expect(
          id,
          `A42 분리부재: ${appLabel}(${file})을 호스팅하는 창 id 가 ${String(id)} 입니다 — 단일 창(id ${winId})에 두 앱 뷰가 모두 속해야 합니다`
        ).toBe(winId);
      }
      const views = await shellViewsInfo(shell.app);
      const appViews = views.filter((v) => /\/(calendar|postit)\.html$/i.test((v.url || '').split(/[?#]/)[0]));
      expect(
        appViews.length >= 2 && appViews.every((v) => v.winId === winId),
        `A42 분리부재: 앱 뷰 ${appViews.length}개가 서로 다른 창에 흩어져 있습니다 ` +
          `(창 id 목록: ${appViews.map((v) => v.winId).join(', ') || '없음'}) — 단일 창 탭 모드 위반`
      ).toBe(true);

      // ── ⑤ 소스 잔존 금지: 휴면 분리 코드(따옴표 문자열·HTML 속성) 0건 ──
      const srcHits = scanSourcesForAbolishedHooks();
      expect(
        srcHits.length,
        `A42 분리부재: 셸 소스에 폐지된 분리 훅(data-split/data-merge) 코드가 ${srcHits.length}곳 남아 있습니다 — ` +
          `${srcHits.slice(0, 12).join(', ')}${srcHits.length > 12 ? ' 외' : ''} ` +
          '(rev.8: 창 분리 완전 폐지 — 휴면 코드도 제거해야 합니다. 주석 언급은 검사 대상이 아닙니다)'
      ).toBe(0);

      assertNoDialogs(shell.state, 'A42 분리부재');
    } finally {
      await closeElectronShell(shell);
      await removeDirWithRetry(dir);
    }
  });

  test('A42: 셸 설정 영속 — defaultTab=calendar 즉시 저장 → 재기동 시 캘린더 탭 활성 (창은 계속 1개)', async () => {
    test.setTimeout(300 * 1000);
    skipUnlessWin32();
    requireElectronShell('A42');
    requirePostit();
    const dir = freshUserDataDir();
    let shell = null;
    try {
      // ── L1: fresh 기동(기본 탭 = 포스트잇) → 설정 드로어에서 defaultTab=calendar 저장 → 완전 종료 ──
      let launched = await launchMerged(dir, 'A42 설정영속');
      shell = launched.shell;
      await pollBrowserWindowCount(shell.app, 1, 10000, 'A42 설정영속: fresh 기동이 단일 창(BrowserWindow 1개)이 아닙니다');
      await pollActiveApp(shell.app, 'postit', 8000, 'A42 설정영속: fresh 기동 기본 활성 탭 —');

      // 셸 설정 드로어 개방([data-shell-settings-open]) → [data-default-tab="calendar"] 클릭 = 즉시 저장
      await requireHook6(launched.tabbarPage, '[data-shell-settings-open]', 'A42 설정영속');
      await launched.tabbarPage.locator('[data-shell-settings-open]').first().click({ timeout: 5000 });
      await pollVisibleStrict(
        launched.tabbarPage,
        '[data-shell-settings]',
        true,
        5000,
        'A42 설정영속: [data-shell-settings-open] 클릭 후 5초 내 셸 설정 드로어([data-shell-settings])가 보이지 않습니다 (fail-closed)'
      );
      await requireHook6(launched.tabbarPage, '[data-default-tab="calendar"]', 'A42 설정영속');
      await launched.tabbarPage.locator('[data-default-tab="calendar"]').first().click({ timeout: 5000 });
      await poll(
        async () => {
          try {
            return readShellSettings(dir, 'A42 설정영속').defaultTab === 'calendar';
          } catch (e) {
            return false;
          }
        },
        5000,
        'A42 설정영속: [data-default-tab="calendar"] 클릭 후 5초 내 shell-settings.json 에 defaultTab="calendar" 가 저장되지 않았습니다 (변경 즉시 저장 계약)'
      );
      assertNoDialogs(shell.state, 'A42 설정영속');
      await sleep(1000); // 설정 기록 여유
      await closeElectronShell(shell);
      shell = null;

      // 완전 종료 후에도 파일에 잔존해야 한다
      const cfg = readShellSettings(dir, 'A42 설정영속');
      expect(
        cfg.defaultTab === 'calendar',
        `A42 설정영속: 종료 후 defaultTab 이 "calendar" 로 남아 있지 않습니다 (실제: ${JSON.stringify(cfg.defaultTab)})`
      ).toBe(true);

      // ── L2: 같은 userData 재기동 → 여전히 단일 창 + 활성 탭 = 캘린더 ──
      launched = await launchMerged(dir, 'A42 설정영속 재기동');
      shell = launched.shell;
      await pollBrowserWindowCount(
        shell.app,
        1,
        15000,
        'A42 설정영속: defaultTab 저장 후 재기동이 단일 창(BrowserWindow 1개)이 아닙니다 — rev.8: 분리 모드는 폐지되었습니다'
      );
      await pollActiveApp(shell.app, 'calendar', 15000, 'A42 설정영속: defaultTab=calendar 저장 후 재기동 —');
      const cells = await countVisibleStrict(launched.calPage, CAL_CELL_SEL);
      expect(
        cells >= 28,
        `A42 설정영속: 기본 탭 캘린더 활성 상태에서 날짜 셀이 ${cells}개만 visible 입니다 (≥28 필요)`
      ).toBe(true);
      // 셸 설정 진입 훅 존재 (판정은 파일 계약이 담당 — 훅은 fail-closed 존재 확인)
      await requireHook6(launched.tabbarPage, '[data-shell-settings]', 'A42 설정영속');
      // 재기동 후에도 폐지된 분리 훅은 어디에도 없어야 한다
      await assertNoAbolishedHooks(
        [
          { label: '탭바(tabbar.html)', page: launched.tabbarPage },
          { label: '캘린더 뷰(calendar.html)', page: launched.calPage },
          { label: '포스트잇 뷰(postit.html)', page: launched.postitPage },
        ],
        'A42 설정영속(재기동)',
        800
      );
      // 저장값은 재기동 후에도 보존 (덮어쓰기·초기화 금지)
      const cfg2 = readShellSettings(dir, 'A42 설정영속 재기동');
      expect(
        cfg2.defaultTab === 'calendar',
        `A42 설정영속: 재기동 과정에서 defaultTab 이 "calendar" 에서 변경되었습니다 (실제: ${JSON.stringify(cfg2.defaultTab)})`
      ).toBe(true);

      assertNoDialogs(shell.state, 'A42 설정영속 재기동');
    } finally {
      await closeElectronShell(shell);
      await removeDirWithRetry(dir);
    }
  });

  test('A42: 출시-소스 SHA256 동일성 — 실행 셸 로드 문서 = 저장소 원본 (+ dist 존재 시 패키지 리소스·fuse)', async () => {
    test.setTimeout(180 * 1000);
    skipUnlessWin32();
    requireElectronShell('A42');
    requirePostit();
    const repoSha = {
      'calendar.html': sha256File(CALENDAR_PATH),
      'postit.html': sha256File(POSTIT_PATH),
    };

    // ① 실행 셸이 실제 로드한 문서의 SHA (개발 트리 기준 — 항상 수행.
    //    병합/분리 무관: 앱 페이지를 URL 로 획득해 로드 문서만 판정한다)
    const dir = freshUserDataDir();
    let shell = null;
    try {
      shell = await launchShellChecked(dir, { label: 'A42' });
      const calPage = await pageByUrl(shell.app, /\/calendar\.html$/i, 30000, 'A42 SHA 캘린더');
      const postitPage = await pageByUrl(shell.app, /\/postit\.html$/i, 30000, 'A42 SHA 포스트잇');
      for (const [page, name] of [
        [calPage, 'calendar.html'],
        [postitPage, 'postit.html'],
      ]) {
        const loadedUrl = page.url();
        expect(
          /^file:/i.test(loadedUrl),
          `A42: ${name} 페이지가 file:// 이 아닌 URL 을 로드했습니다 (${loadedUrl}) — 원격/변형 로드 금지 (B: HTML 빌드 변형 금지)`
        ).toBe(true);
        const loadedPath = urlToLocalPath(loadedUrl);
        expect(fs.existsSync(loadedPath), `A42: 셸이 로드한 경로가 실존하지 않습니다 (${loadedPath})`).toBe(true);
        const got = sha256File(loadedPath);
        expect(
          got,
          `A42: 셸이 로드한 ${name}(${loadedPath})이 저장소 원본과 SHA256 불일치 — ` +
            `빌드 변형·사본 주입 금지 (원본 ${repoSha[name].slice(0, 12)}… ≠ 로드본 ${got.slice(0, 12)}…)`
        ).toBe(repoSha[name]);
      }
    } finally {
      await closeElectronShell(shell);
      await removeDirWithRetry(dir);
    }

    // ② dist\win-unpacked 존재 시 조건부: 패키지 리소스 SHA + EnableNodeCliInspectArguments fuse
    if (!fs.existsSync(WIN_UNPACKED_DIR)) {
      test.info().annotations.push({
        type: 'A42-dist',
        description:
          'electron\\dist\\win-unpacked 미존재 — 개발 트리 기준으로 판정 (패키지 리소스·fuse 검사는 빌드 후 조건부 수행)',
      });
      return;
    }
    for (const name of ['calendar.html', 'postit.html']) {
      const packaged = path.join(WIN_UNPACKED_DIR, 'resources', name);
      expect(
        fs.existsSync(packaged),
        `A42: 패키지 리소스에 ${name} 이 없습니다 (${packaged}) — extraResources 로 원본을 resources\\ 루트에 복사해야 합니다`
      ).toBe(true);
      const got = sha256File(packaged);
      expect(
        got,
        `A42: 패키지 리소스 ${name} 이 저장소 원본과 SHA256 불일치 — 빌드 변형·인젝션 금지 ` +
          `(원본 ${repoSha[name].slice(0, 12)}… ≠ 패키지 ${got.slice(0, 12)}…)`
      ).toBe(repoSha[name]);
    }
    const exes = fs.readdirSync(WIN_UNPACKED_DIR).filter((n) => /\.exe$/i.test(n));
    expect(
      exes.length >= 1,
      `A42: dist\\win-unpacked 에 실행 파일(.exe)이 없습니다 (발견: ${exes.join(', ') || '없음'})`
    ).toBe(true);
    const exePath = path.join(WIN_UNPACKED_DIR, exes.find((n) => /petitcalendar/i.test(n)) || exes[0]);
    let fusesMod = null;
    try {
      fusesMod = require(path.join(ELECTRON_DIR, 'node_modules', '@electron', 'fuses'));
    } catch (e) {
      throw new Error(
        'A42: 패키지 fuse 검증 불가 — electron\\node_modules\\@electron\\fuses 를 로드할 수 없습니다 (devDependencies 설치 필요): ' +
          e.message
      );
    }
    const wire = await fusesMod.getCurrentFuseWire(exePath);
    const stateVal = wire[fusesMod.FuseV1Options.EnableNodeCliInspectArguments];
    // FuseState.ENABLE = 0x31 ('1') — @electron/fuses 가 상수를 최상위로 수출하지 않아 명세값으로 판정
    const FUSE_ENABLE = 0x31;
    expect(
      stateVal,
      `A42: 패키지 exe(${exePath})의 EnableNodeCliInspectArguments fuse 가 ENABLE(0x31)이 아닙니다 (현재: ${String(stateVal)}) — ` +
        '이 fuse 를 끄면 패키지 채점(_electron.launch)이 영구 불가능해집니다 (채점 가능성 계약)'
    ).toBe(FUSE_ENABLE);
  });

  /* ── 임계 서브셋 [A5] — 포스트잇 저장 2초 + 완전 종료 후 재기동 보존 (병합 모드) ── */
  test('A42: [A5] 포스트잇 — 텍스트·색·위치 각 2초 내 저장 + 완전 종료 후 재기동 보존 (Electron 병합)', async () => {
    test.setTimeout(300 * 1000);
    skipUnlessWin32();
    requireElectronShell('A42');
    requirePostit();
    const dir = freshUserDataDir();
    let shell = null;
    try {
      let launched = await launchMerged(dir, 'A42[A5]');
      shell = launched.shell;
      await activateTab(launched, 'postit', 'A42[A5]');
      let page = launched.postitPage;
      const T1 = 'A42-A5-노트-알파';

      // 텍스트 → 2초 내 저장
      await addNote(page);
      await pollVisibleNoteCount(page, 1, 5000, 'A42[A5]');
      await setNoteText(page, page.locator(POSTIT_SEL.NOTE).first(), T1);
      await pollPage(
        page,
        CONTAINS_FN,
        T1,
        2000,
        'A42[A5]: 텍스트 입력이 2초 내 localStorage 에서 확인되지 않았습니다 (Electron 병합 컨텍스트)'
      );

      // 색 → 2초 내 저장(스냅샷 변화)
      const s1 = await page.evaluate(SNAPSHOT_JSON_FN);
      await applyAnyColor(page, 0);
      await pollPage(page, CHANGED_FN, s1, 2000, 'A42[A5]: 색 변경이 2초 내 localStorage 에 반영되지 않았습니다 (Electron 병합 컨텍스트)');

      // 위치 → 2초 내 저장(스냅샷 변화)
      const s2 = await page.evaluate(SNAPSHOT_JSON_FN);
      const p = await noteTopLeft(page, 0);
      const target = Math.abs(p.x - 220) < 5 && Math.abs(p.y - 180) < 5 ? { x: 320, y: 260 } : { x: 220, y: 180 };
      await dragNoteTo(page, 0, target);
      await pollPage(page, CHANGED_FN, s2, 2000, 'A42[A5]: 위치 이동이 2초 내 localStorage 에 반영되지 않았습니다 (Electron 병합 컨텍스트)');

      // 재기동 전 상태 기록
      const before = (await readNotesWithBg(page))[0];
      const posBefore = await noteTopLeft(page, 0);
      assertNoDialogs(shell.state, 'A42[A5]');
      await sleep(1200);
      await closeElectronShell(shell); // 완전 종료 (앱 quit)
      shell = null;

      // 같은 userData 로 재기동 → 내용·색·위치 동일
      launched = await launchMerged(dir, 'A42[A5] 재기동');
      shell = launched.shell;
      await activateTab(launched, 'postit', 'A42[A5] 재기동');
      page = launched.postitPage;
      await pollVisibleNoteCount(page, 1, 8000, 'A42[A5] 재기동');
      const after = (await readNotesWithBg(page))[0];
      expect(
        after.text.includes(T1) && after.text === before.text,
        `A42[A5]: 완전 종료 후 재기동 시 노트 내용이 보존되지 않았습니다 ("${before.text}" → "${after.text}")`
      ).toBe(true);
      const cB = parseRgb(before.bg);
      const cA = parseRgb(after.bg);
      expect(!!cB && !!cA, `A42[A5]: 배경색을 해석할 수 없습니다 (${before.bg} / ${after.bg})`).toBe(true);
      expect(
        Math.abs(cA.r - cB.r) <= 2 && Math.abs(cA.g - cB.g) <= 2 && Math.abs(cA.b - cB.b) <= 2,
        `A42[A5]: 재기동 후 노트 색이 다릅니다 (${before.bg} → ${after.bg})`
      ).toBe(true);
      const posAfter = await noteTopLeft(page, 0);
      expect(
        Math.abs(posAfter.x - posBefore.x) <= 2 && Math.abs(posAfter.y - posBefore.y) <= 2,
        `A42[A5]: 재기동 후 노트 위치가 다릅니다 ((${posBefore.x.toFixed(1)},${posBefore.y.toFixed(1)}) → (${posAfter.x.toFixed(1)},${posAfter.y.toFixed(1)}), ±2px 허용)`
      ).toBe(true);
      assertNoDialogs(shell.state, 'A42[A5] 재기동');
    } finally {
      await closeElectronShell(shell);
      await removeDirWithRetry(dir);
    }
  });

  /* ── 임계 서브셋 [A6] — 캘린더 일정 완전 종료 후 재기동 보존 (병합 모드) ───────── */
  test('A42: [A6] 캘린더 — 일정 추가 → 완전 종료 후 재기동 → 같은 날짜에 관찰 (Electron 병합)', async () => {
    test.setTimeout(240 * 1000);
    skipUnlessWin32();
    requireElectronShell('A42');
    requirePostit();
    const dir = freshUserDataDir();
    const MSG = 'A42-A6-재기동-확인-일정';
    let shell = null;
    try {
      let launched = await launchMerged(dir, 'A42[A6]');
      shell = launched.shell;
      await activateTab(launched, 'calendar', 'A42[A6]');
      let page = launched.calPage;
      await calDayCell(page, 15).click();
      const key = await calViewedMonthKey(page, 15);
      await calAddViaForm(page, '13:45', MSG);
      await pollLocalStorage(page, 'cal-events', (raw) => {
        try {
          const o = JSON.parse(raw);
          return !!o && Array.isArray(o[key]) && o[key].some((e) => e && e.text === MSG && e.time === '13:45');
        } catch (e) {
          return false;
        }
      });
      assertNoDialogs(shell.state, 'A42[A6]');
      await sleep(1200);
      await closeElectronShell(shell);
      shell = null;

      launched = await launchMerged(dir, 'A42[A6] 재기동');
      shell = launched.shell;
      await activateTab(launched, 'calendar', 'A42[A6] 재기동');
      page = launched.calPage;
      await calDayCell(page, 15).click();
      const li = page.locator('#eventList li', { hasText: MSG });
      await expect(
        li,
        `A42[A6]: 완전 종료 후 재기동 시 같은 날짜(${key})에 "${MSG}" 이 보이지 않습니다 (Electron 병합 컨텍스트)`
      ).toBeVisible();
      await expect(li, 'A42[A6]: 재기동 후 일정의 시간(13:45)이 함께 표시되지 않습니다').toContainText('13:45');
      assertNoDialogs(shell.state, 'A42[A6] 재기동');
    } finally {
      await closeElectronShell(shell);
      await removeDirWithRetry(dir);
    }
  });

  /* ── 임계 서브셋 [A8] — 두 창(뷰+추가 창) 동시 입력 무손실 (포스트잇+캘린더) ────── */
  test('A42: [A8] 두 창 동시 입력 — 저장소 각 1건(중복 0) + 재로드 후 둘 다 표시 (Electron 병합)', async () => {
    test.setTimeout(300 * 1000);
    skipUnlessWin32();
    requireElectronShell('A42');
    requirePostit();
    const dir = freshUserDataDir();
    let shell = null;
    try {
      const launched = await launchMerged(dir, 'A42[A8]');
      shell = launched.shell;

      // ── 포스트잇 절반 (활성 뷰 + 같은 HTML 을 로드한 추가 창 — 같은 오리진 저장소 공유) ──
      await activateTab(launched, 'postit', 'A42[A8]');
      const MA = 'A42-A8-창A-노트';
      const MB = 'A42-A8-창B-노트';
      const pageA = launched.postitPage;
      const pageB = await openExtraWindow(shell.app, POSTIT_PATH);
      await dismissOnboardingIfPresent(pageB, 'A42[A8]');
      await dismissMigrateIfPresent(pageB, 'A42[A8]');

      await addNote(pageA);
      await setNoteText(pageA, pageA.locator(POSTIT_SEL.NOTE).last(), MA);
      await pollPage(pageA, CONTAINS_FN, MA, 5000, 'A42[A8]: 창A 노트가 localStorage 에 저장되지 않았습니다');
      await addNote(pageB);
      await setNoteText(pageB, pageB.locator(POSTIT_SEL.NOTE).last(), MB);
      await pollPage(
        pageB,
        ({ a, b }) => {
          const all = Object.keys(localStorage).map((k) => localStorage.getItem(k) || '').join(' ');
          return all.includes(a) && all.includes(b);
        },
        { a: MA, b: MB },
        5000,
        'A42[A8]: 창B 추가 후 저장소에 두 항목이 함께 존재하지 않습니다 (마지막 쓰기가 덮어씀 — 쓰기 전 저장소 재읽기/병합 필요, Electron 병합 컨텍스트)'
      );
      const occ = await pageB.evaluate(({ a, b }) => {
        const all = Object.keys(localStorage).map((k) => localStorage.getItem(k) || '').join(' ');
        return { a: all.split(a).length - 1, b: all.split(b).length - 1 };
      }, { a: MA, b: MB });
      expect(occ.a, `A42[A8]: 저장소 내 창A 노트가 ${occ.a}건입니다 (정확히 1건이어야 함)`).toBe(1);
      expect(occ.b, `A42[A8]: 저장소 내 창B 노트가 ${occ.b}건입니다 (정확히 1건이어야 함)`).toBe(1);
      await pageA.reload({ waitUntil: 'load' });
      await sleep(300);
      for (const m of [MA, MB]) {
        expect(
          await hasVisibleNoteText(pageA, m),
          `A42[A8]: 재로드한 포스트잇 뷰에서 "${m}" 노트가 보이지 않습니다 (다른 창 입력 유실)`
        ).toBe(true);
      }

      // ── 캘린더 절반 ──
      await activateTab(launched, 'calendar', 'A42[A8] 캘린더');
      const TA = 'A42-A8-창A-일정';
      const TB = 'A42-A8-창B-일정';
      const calA = launched.calPage;
      const calB = await openExtraWindow(shell.app, CALENDAR_PATH);
      await dismissOnboardingIfPresent(calB, 'A42[A8]');
      await dismissMigrateIfPresent(calB, 'A42[A8]');
      await calDayCell(calA, 20).click();
      await calAddViaForm(calA, '09:00', TA);
      await pollLocalStorage(calA, 'cal-events', (raw) => countCalText(raw, TA) === 1);
      await calDayCell(calB, 20).click();
      await calAddViaForm(calB, '10:00', TB);
      let finalRaw = null;
      try {
        finalRaw = await pollLocalStorage(
          calB,
          'cal-events',
          (raw) => countCalText(raw, TA) >= 1 && countCalText(raw, TB) >= 1,
          5000
        );
      } catch (e) {
        throw new Error(
          'A42[A8]: 캘린더 창B 추가 후 저장소에 두 일정이 함께 존재하지 않습니다 (마지막 쓰기가 덮어씀 — Electron 병합 컨텍스트): ' +
            e.message
        );
      }
      expect(countCalText(finalRaw, TA), `A42[A8]: 최종 저장소에 "${TA}" 이 ${countCalText(finalRaw, TA)}건 (정확히 1건)`).toBe(1);
      expect(countCalText(finalRaw, TB), `A42[A8]: 최종 저장소에 "${TB}" 이 ${countCalText(finalRaw, TB)}건 (정확히 1건)`).toBe(1);
      await calA.reload({ waitUntil: 'load' });
      await calDayCell(calA, 20).click();
      await expect(
        calA.locator('#eventList li', { hasText: TA }),
        `A42[A8]: 재로드한 캘린더 뷰에서 "${TA}" 이 보이지 않습니다`
      ).toBeVisible();
      await expect(
        calA.locator('#eventList li', { hasText: TB }),
        `A42[A8]: 재로드한 캘린더 뷰에서 "${TB}" 이 보이지 않습니다 (다른 창 입력 유실)`
      ).toBeVisible();

      assertNoDialogs(shell.state, 'A42[A8]');
    } finally {
      await closeElectronShell(shell);
      await removeDirWithRetry(dir);
    }
  });

  /* ── 임계 서브셋 [A9] — 손상 복구 + corrupt 백업 (포스트잇+캘린더, 병합 모드) ───── */
  test('A42: [A9] 저장 손상 → 크래시 없이 열림 + 신규 저장 성공 + corrupt 백업 보존 (Electron 병합)', async () => {
    test.setTimeout(300 * 1000);
    skipUnlessWin32();
    requireElectronShell('A42');
    requirePostit();
    const dir = freshUserDataDir();
    const CORRUPT = '{{{A42-A9-비JSON-손상::이 값은 JSON 이 아님';
    const OLD_VAL = 'A42-A9-기존-백업-원본';
    let shell = null;
    try {
      // ── 세션 1: 포스트잇 저장 키 탐지 + 손상 주입 (양앱) ──
      let launched = await launchMerged(dir, 'A42[A9]');
      shell = launched.shell;
      await activateTab(launched, 'postit', 'A42[A9]');
      const DISCOVER = 'A42-A9-키탐지-노트';
      await addNote(launched.postitPage);
      await setNoteText(launched.postitPage, launched.postitPage.locator(POSTIT_SEL.NOTE).last(), DISCOVER);
      await pollPage(
        launched.postitPage,
        CONTAINS_FN,
        DISCOVER,
        5000,
        'A42[A9]: 포스트잇 저장 키 탐지 실패 — 노트 내용이 localStorage 에서 확인되지 않습니다'
      );
      const postitKey = await launched.postitPage.evaluate((m) => {
        const ks = Object.keys(localStorage)
          .filter((k) => (localStorage.getItem(k) || '').includes(m))
          .sort();
        return ks[0] || null;
      }, DISCOVER);
      expect(postitKey, 'A42[A9]: 포스트잇 저장 키를 특정할 수 없습니다').not.toBeNull();
      const OLD_POSTIT = `${postitKey}-corrupt-1111111111111`;
      const OLD_CAL = 'cal-events-corrupt-1111111111111';
      await launched.postitPage.evaluate(
        ({ pk, corrupt, oldPostit, oldCal, oldVal }) => {
          localStorage.setItem(pk, corrupt);
          localStorage.setItem('cal-events', corrupt);
          localStorage.setItem(oldPostit, oldVal);
          localStorage.setItem(oldCal, oldVal);
        },
        { pk: postitKey, corrupt: CORRUPT, oldPostit: OLD_POSTIT, oldCal: OLD_CAL, oldVal: OLD_VAL }
      );
      await sleep(1200);
      await closeElectronShell(shell);
      shell = null;

      // ── 세션 2: 손상 상태로 기동 (dialog 자동 수락 — A9 예외 규정: 기록만) ──
      launched = await launchMerged(dir, 'A42[A9] 재기동', { autoAcceptDialogs: true });
      shell = launched.shell;
      const M2 = 'A42-A9-복구후-노트';
      const M3 = 'A42-A9-복구후-일정';

      // 포스트잇: 크래시 없음 + 신규 노트 저장 성공
      await activateTab(launched, 'postit', 'A42[A9] 재기동');
      const aliveP = await launched.postitPage.evaluate(() => 1 + 1).catch(() => null);
      expect(aliveP, 'A42[A9]: 손상 데이터 주입 후 포스트잇 뷰가 응답하지 않습니다 (크래시)').toBe(2);
      await addNote(launched.postitPage);
      await setNoteText(launched.postitPage, launched.postitPage.locator(POSTIT_SEL.NOTE).last(), M2);
      await pollPage(
        launched.postitPage,
        ({ k, m }) => {
          const v = localStorage.getItem(k);
          if (!v || !v.includes(m)) return false;
          try {
            JSON.parse(v);
            return true;
          } catch (e) {
            return false;
          }
        },
        { k: postitKey, m: M2 },
        5000,
        `A42[A9]: 손상 복구 후 저장 실패 — 키 "${postitKey}" 가 새 노트를 포함한 유효 JSON 이 되지 않았습니다`
      );

      // 캘린더: 크래시 없음 + 신규 일정 저장 성공
      await activateTab(launched, 'calendar', 'A42[A9] 재기동');
      const aliveC = await launched.calPage.evaluate(() => 1 + 1).catch(() => null);
      expect(aliveC, 'A42[A9]: 손상 데이터 주입 후 캘린더 뷰가 응답하지 않습니다 (크래시)').toBe(2);
      await calDayCell(launched.calPage, 12).click();
      await calAddViaForm(launched.calPage, '11:00', M3);
      await pollPage(
        launched.calPage,
        (m) => {
          const v = localStorage.getItem('cal-events');
          if (!v || !v.includes(m)) return false;
          try {
            JSON.parse(v);
            return true;
          } catch (e) {
            return false;
          }
        },
        M3,
        5000,
        'A42[A9]: 손상 복구 후 캘린더 저장 실패 — cal-events 가 새 일정을 포함한 유효 JSON 이 되지 않았습니다'
      );

      // corrupt 백업: 손상 원본 보존 + 기존 백업 미덮어쓰기 (양 키)
      for (const [baseKey, oldKey, label] of [
        [postitKey, OLD_POSTIT, '포스트잇'],
        ['cal-events', OLD_CAL, '캘린더'],
      ]) {
        const backups = await launched.postitPage.evaluate((k) => {
          const esc = k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          const re = new RegExp('^' + esc + '-corrupt-\\d+$');
          return Object.keys(localStorage)
            .filter((x) => re.test(x))
            .map((x) => ({ key: x, val: localStorage.getItem(x) }));
        }, baseKey);
        const oldB = backups.find((b) => b.key === oldKey);
        expect(
          !!oldB && oldB.val === OLD_VAL,
          `A42[A9] ${label}: 기존 백업 키(${oldKey})가 덮어써졌거나 사라졌습니다 — 백업은 새 타임스탬프 키로 쌓아야 합니다`
        ).toBe(true);
        const newB = backups.filter((b) => b.key !== oldKey && b.val === CORRUPT);
        expect(
          newB.length >= 1,
          `A42[A9] ${label}: 손상 원본이 "<원래키>-corrupt-<타임스탬프>" 키로 보존되지 않았습니다 (발견: ${backups.map((b) => b.key).join(', ') || '없음'})`
        ).toBe(true);
      }

      expect(
        shell.state.pageErrors,
        `A42[A9]: pageerror ${shell.state.pageErrors.length}건 발생 (0건이어야 함): ${shell.state.pageErrors.join(' | ')}`
      ).toHaveLength(0);
      test.info().annotations.push({ type: 'A42-A9-dialog-count', description: String(shell.state.dialogs.length) });
    } finally {
      await closeElectronShell(shell);
      await removeDirWithRetry(dir);
    }
  });

  /* ── 임계 서브셋 [A25] — 다중 보드 (키 분리·양방향 전환·재기동 유지, 병합 모드) ──── */
  test('A42: [A25] 다중 보드 — 키 분리 저장·양방향 전환·완전 종료 후 활성 보드/구성 유지 (Electron 병합)', async () => {
    test.setTimeout(300 * 1000);
    skipUnlessWin32();
    requireElectronShell('A42');
    requirePostit();
    const dir = freshUserDataDir();
    const NOTE_A = 'A42-A25-보드1-노트';
    const NOTE_B = 'A42-A25-보드2-노트';
    const pollNoteVis = async (page, text, want, timeoutMs, failMsg) => {
      const deadline = Date.now() + timeoutMs;
      for (;;) {
        if ((await hasVisibleNoteText(page, text)) === want) return;
        if (Date.now() > deadline) throw new Error(failMsg);
        await sleep(100);
      }
    };
    const clickTab = async (page, which, label) => {
      const tabs = page.locator('[data-board-tab]');
      const n = await tabs.count();
      if (n < 2) throw new Error(`${label}: [data-board-tab] 이 ${n}개입니다 (2개 이상이어야 함) — rev.5 DOM 계약 (fail-closed)`);
      await (which === 'first' ? tabs.first() : tabs.last()).click({ timeout: 3000 });
      await sleep(150);
    };
    let shell = null;
    try {
      let launched = await launchMerged(dir, 'A42[A25]');
      shell = launched.shell;
      await activateTab(launched, 'postit', 'A42[A25]');
      let page = launched.postitPage;

      await addNote(page);
      await pollVisibleNoteCount(page, 1, 5000, 'A42[A25]');
      await setNoteText(page, page.locator(POSTIT_SEL.NOTE).first(), NOTE_A);
      const rawBoard1 = await pollLocalStorage(page, 'postit-notes', (raw) => !!raw && raw.includes(NOTE_A), 5000);

      await requireHook(page, '[data-board-switcher]', 'A42[A25] 보드 전환기');
      const addBoard = await requireHook(page, '[data-add-board]', 'A42[A25] 새 보드');
      await addBoard.click();
      await pollPage(
        page,
        () => {
          const tabs = document.querySelectorAll('[data-board-tab]');
          const active = document.querySelectorAll('[data-board-tab][data-active="true"]');
          return tabs.length >= 2 && active.length === 1 && active[0] === tabs[tabs.length - 1];
        },
        null,
        3000,
        'A42[A25]: [data-add-board] 클릭 후 새 보드 탭 활성 전환이 관찰되지 않았습니다 (Electron 병합 컨텍스트)'
      );
      await pollNoteVis(page, NOTE_A, false, 3000, 'A42[A25]: 보드 2 전환 후에도 보드 1 노트가 계속 표시됩니다');
      await addNote(page);
      await setNoteText(page, page.locator(POSTIT_SEL.NOTE).last(), NOTE_B);
      await pollPage(
        page,
        (b) =>
          Object.keys(localStorage).some(
            (k) => /^postit-notes-/.test(k) && !/corrupt/.test(k) && (localStorage.getItem(k) || '').includes(b)
          ),
        NOTE_B,
        5000,
        `A42[A25]: 보드 2 노트("${NOTE_B}")가 "postit-notes-" 접두 신규 키에 저장되지 않았습니다 (키 분리 계약)`
      );
      const rawBoard1After = await page.evaluate(() => localStorage.getItem('postit-notes'));
      expect(
        (rawBoard1After || '').includes(NOTE_B),
        'A42[A25]: 보드 2 노트가 기존 postit-notes 키에 저장되었습니다 (별도 키여야 함)'
      ).toBe(false);
      expect(rawBoard1After, 'A42[A25]: 보드 2 작업 후 postit-notes(보드 1) 원문이 변경되었습니다 (하위호환)').toBe(rawBoard1);

      await clickTab(page, 'first', 'A42[A25] 보드 1 전환');
      await pollNoteVis(page, NOTE_A, true, 3000, `A42[A25]: 보드 1 전환 후 "${NOTE_A}" 가 표시되지 않습니다`);
      await pollNoteVis(page, NOTE_B, false, 3000, 'A42[A25]: 보드 1 전환 후 보드 2 노트가 여전히 표시됩니다');
      await clickTab(page, 'last', 'A42[A25] 보드 2 재전환');
      await pollNoteVis(page, NOTE_B, true, 3000, `A42[A25]: 보드 2 재전환 후 "${NOTE_B}" 가 표시되지 않습니다`);
      await pollNoteVis(page, NOTE_A, false, 3000, 'A42[A25]: 보드 2 재전환 후 보드 1 노트가 여전히 표시됩니다');
      assertNoDialogs(shell.state, 'A42[A25]');
      await sleep(1200);
      await closeElectronShell(shell); // 완전 종료
      shell = null;

      launched = await launchMerged(dir, 'A42[A25] 재기동');
      shell = launched.shell;
      await activateTab(launched, 'postit', 'A42[A25] 재기동');
      page = launched.postitPage;
      await pollNoteVis(page, NOTE_B, true, 8000, `A42[A25]: 완전 종료 후 재기동 시 활성 보드(보드 2)의 "${NOTE_B}" 가 표시되지 않습니다`);
      await pollNoteVis(page, NOTE_A, false, 3000, 'A42[A25]: 재기동 후 보드 1 노트가 보드 2에 표시됩니다');
      await clickTab(page, 'first', 'A42[A25] 재기동 보드 1');
      await pollNoteVis(page, NOTE_A, true, 3000, `A42[A25]: 재기동 후 보드 1 전환 시 "${NOTE_A}" 가 표시되지 않습니다`);
      const rawFinal = await page.evaluate(() => localStorage.getItem('postit-notes'));
      expect(
        (rawFinal || '').includes(NOTE_A) && !(rawFinal || '').includes(NOTE_B),
        'A42[A25]: 재기동 후 postit-notes(보드 1) 데이터가 하위호환으로 유지되지 않았습니다'
      ).toBe(true);
      assertNoDialogs(shell.state, 'A42[A25] 재기동');
    } finally {
      await closeElectronShell(shell);
      await removeDirWithRetry(dir);
    }
  });

  /* ── 임계 서브셋 [A26] — 사진 포스트잇 (다운스케일 저장·재기동 유지·비이미지 거부, 병합 모드) ── */
  test('A42: [A26] 사진 포스트잇 — data:image 렌더·저장 ≤300KB·완전 종료 후 유지·비이미지 거부 (Electron 병합)', async () => {
    test.setTimeout(300 * 1000);
    skipUnlessWin32();
    requireElectronShell('A42');
    requirePostit();
    const MAX_URI_LEN = 300 * 1024;
    const dir = freshUserDataDir();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'grader-a42-26-'));
    let shell = null;

    const attachViaMenu = async (page, noteLoc, filePath, label) => {
      await openContextMenuOn(page, noteLoc);
      await sleep(200);
      if ((await page.locator('[data-ctx-menu]').count()) === 0) {
        throw new Error(`${label}: 필수 훅 [data-ctx-menu] 이(가) 없습니다 (rev.5 DOM 계약, fail-closed)`);
      }
      const item = page.locator('[data-ctx-menu] [data-ctx-item]').filter({ hasText: /사진|이미지/ }).first();
      if ((await item.count()) === 0) {
        throw new Error(`${label}: 컨텍스트 메뉴에 "사진/이미지" [data-ctx-item] 항목이 없습니다 (fail-closed)`);
      }
      let chooser = null;
      try {
        [chooser] = await Promise.all([page.waitForEvent('filechooser', { timeout: 10000 }), item.click()]);
      } catch (e) {
        throw new Error(`${label}: 이미지 첨부 항목 클릭 후 파일 선택기(filechooser)가 열리지 않았습니다: ` + e.message);
      }
      await chooser.setFiles(filePath);
    };
    const noteImgInfo = async (page, idx) =>
      page.evaluate(
        ({ N, idx }) => {
          const note = document.querySelectorAll(N)[idx];
          if (!note) return { count: -1, srcLen: 0 };
          const imgs = Array.from(note.querySelectorAll('img'));
          const img = imgs[0] || null;
          return { count: imgs.length, srcLen: img ? img.src.length : 0 };
        },
        { N: POSTIT_SEL.NOTE, idx }
      );

    try {
      let launched = await launchMerged(dir, 'A42[A26]');
      shell = launched.shell;
      await activateTab(launched, 'postit', 'A42[A26]');
      let page = launched.postitPage;
      await addNote(page);
      await pollVisibleNoteCount(page, 1, 5000, 'A42[A26]');

      // 픽스처 런타임 생성 (canvas 1600×1200 JPEG — ≥1200×900 요건 충족)
      const dataUrl = await page.evaluate(() => {
        const c = document.createElement('canvas');
        c.width = 1600;
        c.height = 1200;
        const ctx = c.getContext('2d');
        const g = ctx.createLinearGradient(0, 0, 1600, 1200);
        g.addColorStop(0, '#ff8800');
        g.addColorStop(0.5, '#2266ff');
        g.addColorStop(1, '#22cc66');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, 1600, 1200);
        return c.toDataURL('image/jpeg', 0.95);
      });
      const imgPath = path.join(tmpDir, 'a42-26-big.jpg');
      fs.writeFileSync(imgPath, Buffer.from(dataUrl.split(',')[1], 'base64'));

      await attachViaMenu(page, page.locator(POSTIT_SEL.NOTE).first(), imgPath, 'A42[A26]');
      await pollPage(
        page,
        (N) => {
          const note = document.querySelector(N);
          if (!note) return false;
          const img = note.querySelector('img');
          return !!img && img.src.startsWith('data:image/') && img.naturalWidth > 0 && img.getBoundingClientRect().width > 0;
        },
        POSTIT_SEL.NOTE,
        5000,
        'A42[A26]: 첨부 후 5초 내 노트 내부에 data:image/ + naturalWidth > 0 인 img 가 표시되지 않았습니다 (Electron 병합 컨텍스트)'
      );
      let storedLen = null;
      await poll(
        async () => {
          storedLen = await page.evaluate(() => {
            for (const k of Object.keys(localStorage)) {
              const v = localStorage.getItem(k) || '';
              const m = /data:image\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=]+/.exec(v);
              if (m) return m[0].length;
            }
            return null;
          });
          return storedLen !== null;
        },
        5000,
        'A42[A26]: 첨부 후 5초 내 데이터 URI 가 localStorage 에 저장되지 않았습니다'
      );
      expect(
        storedLen <= MAX_URI_LEN,
        `A42[A26]: 저장된 데이터 URI 길이가 ${storedLen} 바이트입니다 (${MAX_URI_LEN} 바이트 이하 다운스케일 필요 — localStorage 포화 방지)`
      ).toBe(true);
      const info1 = await noteImgInfo(page, 0);
      assertNoDialogs(shell.state, 'A42[A26]');
      await sleep(1200);
      await closeElectronShell(shell); // 완전 종료
      shell = null;

      // 재기동: 동일 표시
      launched = await launchMerged(dir, 'A42[A26] 재기동');
      shell = launched.shell;
      await activateTab(launched, 'postit', 'A42[A26] 재기동');
      page = launched.postitPage;
      await pollVisibleNoteCount(page, 1, 8000, 'A42[A26] 재기동');
      await pollPage(
        page,
        ({ N, wantLen }) => {
          const note = document.querySelector(N);
          if (!note) return false;
          const img = note.querySelector('img');
          return !!img && img.src.startsWith('data:image/') && img.naturalWidth > 0 && img.src.length === wantLen;
        },
        { N: POSTIT_SEL.NOTE, wantLen: info1.srcLen },
        5000,
        `A42[A26]: 완전 종료 후 재기동 시 노트 이미지가 동일하게 표시되지 않았습니다 (기대 src 길이 ${info1.srcLen})`
      );

      // 비이미지 거부: img 미생성 + [data-toast] + pageerror 0건
      await addNote(page);
      await pollVisibleNoteCount(page, 2, 5000, 'A42[A26] 거부');
      const txtPath = path.join(tmpDir, 'a42-26-not-image.txt');
      fs.writeFileSync(txtPath, 'A42[A26] 비이미지 파일 — 첨부 거부 대상', 'utf8');
      await attachViaMenu(page, page.locator(POSTIT_SEL.NOTE).nth(1), txtPath, 'A42[A26] 거부');
      await sleep(1500);
      const info2 = await noteImgInfo(page, 1);
      expect(info2.count, `A42[A26]: 비이미지 첨부에 img 가 ${info2.count}개 생성되었습니다 (0개여야 함 — 파일 형식 검증 필요)`).toBe(0);
      const toastVisible = await page.evaluate(() => {
        const effOpacity = (el) => {
          let o = 1;
          for (let c = el; c && c.nodeType === 1; c = c.parentElement) o *= parseFloat(getComputedStyle(c).opacity) || 0;
          return o;
        };
        for (const t of document.querySelectorAll('[data-toast]')) {
          const r = t.getBoundingClientRect();
          const s = getComputedStyle(t);
          if (r.width > 0 && r.height > 0 && s.display !== 'none' && s.visibility !== 'hidden' && effOpacity(t) > 0.05) return true;
        }
        return false;
      });
      expect(toastVisible, 'A42[A26]: 비이미지 거부 시 비모달 안내([data-toast])가 표시되지 않았습니다').toBe(true);
      expect(
        shell.state.pageErrors,
        `A42[A26]: pageerror ${shell.state.pageErrors.length}건 발생 (0건이어야 함): ${shell.state.pageErrors.join(' | ')}`
      ).toHaveLength(0);
      assertNoDialogs(shell.state, 'A42[A26]');
    } finally {
      await closeElectronShell(shell);
      await removeDirWithRetry(dir);
      await removeDirWithRetry(tmpDir);
    }
  });
});
