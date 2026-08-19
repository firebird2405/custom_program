'use strict';
/**
 * A42 — Electron 셸 (SCORECARD rev.6: 출시 트랙)
 * "Playwright `_electron.launch`(개발 트리, 패키지 exe는 EnableNodeCliInspectArguments fuse 유지)로
 *  기동하면: BrowserWindow 2개, 각 getTitle()에 앱 이름 포함, 기본 창 ≥1024×700, 각 창
 *  리사이즈·이동·독립 종료 가능. 출시-소스 동일성: 패키지 리소스의 calendar.html·postit.html이
 *  저장소 원본과 SHA256 동일(빌드 변형·인젝션 금지). 임계 서브셋 실검증: A5·A6·A8·A9·A25·A26
 *  시나리오를 Electron 컨텍스트(고정 userData, 환경변수 오버라이드 훅으로 격리)에서 재실행 —
 *  완전 종료 후 재기동 보존 포함"
 *
 * ── REQUIRED CONTRACT (rev.6 — 이 주석이 셸 계약의 정본, rev.5 관례) ──
 *  - 기동: `electron.exe d:\custom_program\electron` (개발 트리). main.js 는 app ready 이전에
 *    환경변수 PETIT_USERDATA 가 있으면 userData 로 사용한다 (채점 격리 훅 — 실사용 데이터 불가침).
 *  - 창: 캘린더·포스트잇 각 1개 = BrowserWindow 정확히 2개. 각 창 getTitle() 에 브랜드
 *    (쁘띠캘린더 또는 PetitCalendar) 포함. fresh userData 기동 시 각 창 기본 크기 ≥ 1024×700.
 *    각 창 isResizable()·isMovable() 참 + setBounds 실효(리사이즈·이동 반영, ±8px 허용) +
 *    한 창을 닫아도 다른 창은 살아 있다(독립 종료).
 *  - 출시-소스 동일성: 각 창이 실제 로드한 file:// 문서가 저장소 원본과 SHA256 동일 (항상 수행).
 *    electron\dist\win-unpacked 존재 시(조건부): resources\calendar.html·resources\postit.html 이
 *    저장소 원본과 SHA256 동일 + 패키지 exe 의 EnableNodeCliInspectArguments fuse = ENABLE.
 *    dist 부재 시 개발 트리 기준으로만 판정하고 annotation 으로 명시한다 (skip-pass 아님).
 *  - 임계 서브셋: A5(포스트잇 텍스트·색·위치 각 2초 내 저장 + 완전 종료 후 재기동 보존)·
 *    A6(캘린더 일정 재기동 보존)·A8(두 창 동시 입력 무손실 — 포스트잇·캘린더)·
 *    A9(손상 복구 + corrupt 백업 미덮어쓰기 — 포스트잇·캘린더)·A25(다중 보드)·A26(사진 포스트잇)
 *    시나리오의 핵심 관찰을 Electron 창에서 재실행한다. 각 시나리오의 정밀·확장 검사(하트비트
 *    키 제외, 30건 부하 등)의 정본은 원 스펙(a05~a26)이며, 여기서는 "같은 HTML 이 Electron
 *    컨텍스트에서도 같은 관찰을 낸다"를 판정한다. Electron 은 두 창이 같은 file:// 오리진
 *    localStorage 를 공유하므로 cal-*·postit-* 키 접두 규약이 그대로 유지되어야 한다.
 *  - 온보딩(A47 셸 레이어)이 표시되면 [data-onboarding-skip] 으로 건너뛴 뒤 진행한다
 *    (fresh 프로필 기본값 계약과의 공존 — 훅 부재 시 fail-closed FAIL).
 *  - fail-closed: 셸 미구축(electron\main.js·electron.exe 부재)·창 미생성 시 크래시 없이
 *    "electron 셸 미구축 (2단계 진행 중)" 류 한국어 메시지로 FAIL. SKIP 은 비 Windows 뿐.
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
  WIN_UNPACKED_DIR,
  requireElectronShell,
  freshUserDataDir,
  launchElectronShell,
  getAppWindow,
  getBothAppWindows,
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
} = require('../lib/electron-helpers');

const BRAND_RE = /쁘띠캘린더|PetitCalendar/i;

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

/** 기동 + 두 창 획득 + 온보딩/이전 제안 오버레이 처치 (임계 서브셋 공용 진입)
 *  — 실사용 .edge 프로필이 있는 기기에서는 A43 발견성 UI([data-migrate])가 뜨므로
 *    "나중에" 경로로 닫고 진행한다 (본 항목의 판정 대상 아님 — A43 이 판정). */
async function launchAndGetWindows(dir, label, opts = {}) {
  const shell = await launchElectronShell(dir, Object.assign({ label }, opts));
  const { calPage, postitPage } = await getBothAppWindows(shell, label);
  for (const p of [postitPage, calPage]) {
    await dismissOnboardingIfPresent(p, label);
    await dismissMigrateIfPresent(p, label);
  }
  return { shell, calPage, postitPage };
}

/* ════════════════════════════════════════════════════════════════════ */

test.describe('A42 Electron 셸', () => {
  test('A42: 셸 기동 — BrowserWindow 2개·제목 브랜드·기본 크기 ≥1024×700·리사이즈·이동·독립 종료', async () => {
    test.setTimeout(180 * 1000);
    skipUnlessWin32();
    requireElectronShell('A42');
    const dir = freshUserDataDir();
    let shell = null;
    try {
      shell = await launchElectronShell(dir, { label: 'A42' });
      const calPage = await getAppWindow(shell, 'calendar.html', 30000, 'A42');
      await getAppWindow(shell, 'postit.html', 30000, 'A42');

      // BrowserWindow 정확히 2개
      const infos = await mainWindowsInfo(shell.app);
      expect(
        infos.length,
        `A42: BrowserWindow 가 ${infos.length}개입니다 (캘린더·포스트잇 각 1개 = 정확히 2개여야 함): ` +
          infos.map((w) => w.url).join(', ')
      ).toBe(2);

      // 각 창 제목에 브랜드 포함
      for (const w of infos) {
        expect(
          BRAND_RE.test(w.title),
          `A42: 창 제목 "${w.title}" 에 앱 이름(쁘띠캘린더/PetitCalendar)이 없습니다 (URL: ${w.url})`
        ).toBe(true);
      }

      // fresh userData 기동 → 각 창 기본 크기 ≥ 1024×700
      for (const w of infos) {
        expect(
          w.bounds.width >= 1024 && w.bounds.height >= 700,
          `A42: 기본 창 크기 미달 — "${w.title}" ${w.bounds.width}×${w.bounds.height} ` +
            '(fresh 기동 시 각 창 기본 크기 ≥ 1024×700, SCORECARD rev.6 A42)'
        ).toBe(true);
      }

      // 각 창 리사이즈·이동 가능 플래그
      for (const w of infos) {
        expect(w.resizable, `A42: 창 "${w.title}" 이 리사이즈 불가(isResizable=false)입니다`).toBe(true);
        expect(w.movable, `A42: 창 "${w.title}" 이 이동 불가(isMovable=false)입니다`).toBe(true);
      }

      // 리사이즈·이동 실효 검증 (캘린더 창 setBounds → getBounds 반영, ±8px 허용)
      const rb = await shell.app.evaluate(({ BrowserWindow }) => {
        const w = BrowserWindow.getAllWindows().find((x) =>
          x.webContents.getURL().toLowerCase().includes('calendar.html')
        );
        if (!w) return null;
        const before = w.getBounds();
        w.setBounds({ x: before.x + 24, y: before.y + 18, width: before.width + 64, height: before.height + 48 });
        return { before, after: w.getBounds() };
      });
      expect(rb, 'A42: 캘린더 창을 main 프로세스에서 찾을 수 없습니다').not.toBeNull();
      expect(
        Math.abs(rb.after.width - (rb.before.width + 64)) <= 8 && Math.abs(rb.after.height - (rb.before.height + 48)) <= 8,
        `A42: 리사이즈가 반영되지 않았습니다 (setBounds ${rb.before.width + 64}×${rb.before.height + 48} 요청 → 실제 ${rb.after.width}×${rb.after.height})`
      ).toBe(true);
      expect(
        Math.abs(rb.after.x - (rb.before.x + 24)) <= 8 && Math.abs(rb.after.y - (rb.before.y + 18)) <= 8,
        `A42: 이동이 반영되지 않았습니다 (setBounds (${rb.before.x + 24},${rb.before.y + 18}) 요청 → 실제 (${rb.after.x},${rb.after.y}))`
      ).toBe(true);

      // 독립 종료: 포스트잇 창을 닫아도 캘린더 창은 살아 있다
      await shell.app.evaluate(({ BrowserWindow }) => {
        const w = BrowserWindow.getAllWindows().find((x) =>
          x.webContents.getURL().toLowerCase().includes('postit.html')
        );
        if (w) w.close();
      });
      await poll(
        async () => (await shell.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)) === 1,
        10000,
        'A42: 포스트잇 창 close() 후 10초 내 BrowserWindow 가 1개로 줄지 않았습니다 (독립 종료 실패)'
      );
      const alive = await calPage.evaluate(() => 1 + 1).catch(() => null);
      expect(
        alive,
        'A42: 포스트잇 창을 닫자 캘린더 창도 응답하지 않습니다 (독립 종료 실패 — 한 창 닫힘이 다른 창을 죽임)'
      ).toBe(2);

      assertNoDialogs(shell.state, 'A42 셸 기동');
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

    // ① 실행 셸이 실제 로드한 문서의 SHA (개발 트리 기준 — 항상 수행)
    const dir = freshUserDataDir();
    let shell = null;
    try {
      shell = await launchElectronShell(dir, { label: 'A42' });
      const { calPage, postitPage } = await getBothAppWindows(shell, 'A42');
      for (const [page, name] of [
        [calPage, 'calendar.html'],
        [postitPage, 'postit.html'],
      ]) {
        const loadedUrl = page.url();
        expect(
          /^file:/i.test(loadedUrl),
          `A42: ${name} 창이 file:// 이 아닌 URL 을 로드했습니다 (${loadedUrl}) — 원격/변형 로드 금지 (B: HTML 빌드 변형 금지)`
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

  /* ── 임계 서브셋 [A5] — 포스트잇 저장 2초 + 완전 종료 후 재기동 보존 ───────── */
  test('A42: [A5] 포스트잇 — 텍스트·색·위치 각 2초 내 저장 + 완전 종료 후 재기동 보존 (Electron)', async () => {
    test.setTimeout(300 * 1000);
    skipUnlessWin32();
    requireElectronShell('A42');
    requirePostit();
    const dir = freshUserDataDir();
    let shell = null;
    try {
      let launched = await launchAndGetWindows(dir, 'A42[A5]');
      shell = launched.shell;
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
        'A42[A5]: 텍스트 입력이 2초 내 localStorage 에서 확인되지 않았습니다 (Electron 컨텍스트)'
      );

      // 색 → 2초 내 저장(스냅샷 변화)
      const s1 = await page.evaluate(SNAPSHOT_JSON_FN);
      await applyAnyColor(page, 0);
      await pollPage(page, CHANGED_FN, s1, 2000, 'A42[A5]: 색 변경이 2초 내 localStorage 에 반영되지 않았습니다 (Electron 컨텍스트)');

      // 위치 → 2초 내 저장(스냅샷 변화)
      const s2 = await page.evaluate(SNAPSHOT_JSON_FN);
      const p = await noteTopLeft(page, 0);
      const target = Math.abs(p.x - 220) < 5 && Math.abs(p.y - 180) < 5 ? { x: 320, y: 260 } : { x: 220, y: 180 };
      await dragNoteTo(page, 0, target);
      await pollPage(page, CHANGED_FN, s2, 2000, 'A42[A5]: 위치 이동이 2초 내 localStorage 에 반영되지 않았습니다 (Electron 컨텍스트)');

      // 재기동 전 상태 기록
      const before = (await readNotesWithBg(page))[0];
      const posBefore = await noteTopLeft(page, 0);
      assertNoDialogs(shell.state, 'A42[A5]');
      await sleep(1200);
      await closeElectronShell(shell); // 완전 종료 (앱 quit)
      shell = null;

      // 같은 userData 로 재기동 → 내용·색·위치 동일
      launched = await launchAndGetWindows(dir, 'A42[A5] 재기동');
      shell = launched.shell;
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

  /* ── 임계 서브셋 [A6] — 캘린더 일정 완전 종료 후 재기동 보존 ─────────────── */
  test('A42: [A6] 캘린더 — 일정 추가 → 완전 종료 후 재기동 → 같은 날짜에 관찰 (Electron)', async () => {
    test.setTimeout(240 * 1000);
    skipUnlessWin32();
    requireElectronShell('A42');
    const dir = freshUserDataDir();
    const MSG = 'A42-A6-재기동-확인-일정';
    let shell = null;
    try {
      let launched = await launchAndGetWindows(dir, 'A42[A6]');
      shell = launched.shell;
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

      launched = await launchAndGetWindows(dir, 'A42[A6] 재기동');
      shell = launched.shell;
      page = launched.calPage;
      await calDayCell(page, 15).click();
      const li = page.locator('#eventList li', { hasText: MSG });
      await expect(
        li,
        `A42[A6]: 완전 종료 후 재기동 시 같은 날짜(${key})에 "${MSG}" 이 보이지 않습니다 (Electron 컨텍스트)`
      ).toBeVisible();
      await expect(li, 'A42[A6]: 재기동 후 일정의 시간(13:45)이 함께 표시되지 않습니다').toContainText('13:45');
      assertNoDialogs(shell.state, 'A42[A6] 재기동');
    } finally {
      await closeElectronShell(shell);
      await removeDirWithRetry(dir);
    }
  });

  /* ── 임계 서브셋 [A8] — 두 창 동시 입력 무손실 (포스트잇+캘린더) ───────────── */
  test('A42: [A8] 두 창 동시 입력 — 저장소 각 1건(중복 0) + 재로드 후 둘 다 표시 (Electron)', async () => {
    test.setTimeout(300 * 1000);
    skipUnlessWin32();
    requireElectronShell('A42');
    requirePostit();
    const dir = freshUserDataDir();
    let shell = null;
    try {
      const launched = await launchAndGetWindows(dir, 'A42[A8]');
      shell = launched.shell;

      // ── 포스트잇 절반 ──
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
        'A42[A8]: 창B 추가 후 저장소에 두 항목이 함께 존재하지 않습니다 (마지막 쓰기가 덮어씀 — 쓰기 전 저장소 재읽기/병합 필요, Electron 컨텍스트)'
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
          `A42[A8]: 재로드한 포스트잇 창에서 "${m}" 노트가 보이지 않습니다 (다른 창 입력 유실)`
        ).toBe(true);
      }

      // ── 캘린더 절반 ──
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
          'A42[A8]: 캘린더 창B 추가 후 저장소에 두 일정이 함께 존재하지 않습니다 (마지막 쓰기가 덮어씀 — Electron 컨텍스트): ' +
            e.message
        );
      }
      expect(countCalText(finalRaw, TA), `A42[A8]: 최종 저장소에 "${TA}" 이 ${countCalText(finalRaw, TA)}건 (정확히 1건)`).toBe(1);
      expect(countCalText(finalRaw, TB), `A42[A8]: 최종 저장소에 "${TB}" 이 ${countCalText(finalRaw, TB)}건 (정확히 1건)`).toBe(1);
      await calA.reload({ waitUntil: 'load' });
      await calDayCell(calA, 20).click();
      await expect(
        calA.locator('#eventList li', { hasText: TA }),
        `A42[A8]: 재로드한 캘린더 창에서 "${TA}" 이 보이지 않습니다`
      ).toBeVisible();
      await expect(
        calA.locator('#eventList li', { hasText: TB }),
        `A42[A8]: 재로드한 캘린더 창에서 "${TB}" 이 보이지 않습니다 (다른 창 입력 유실)`
      ).toBeVisible();

      assertNoDialogs(shell.state, 'A42[A8]');
    } finally {
      await closeElectronShell(shell);
      await removeDirWithRetry(dir);
    }
  });

  /* ── 임계 서브셋 [A9] — 손상 복구 + corrupt 백업 (포스트잇+캘린더) ─────────── */
  test('A42: [A9] 저장 손상 → 크래시 없이 열림 + 신규 저장 성공 + corrupt 백업 보존 (Electron)', async () => {
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
      let launched = await launchAndGetWindows(dir, 'A42[A9]');
      shell = launched.shell;
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
      launched = await launchAndGetWindows(dir, 'A42[A9] 재기동', { autoAcceptDialogs: true });
      shell = launched.shell;
      const M2 = 'A42-A9-복구후-노트';
      const M3 = 'A42-A9-복구후-일정';

      // 포스트잇: 크래시 없음 + 신규 노트 저장 성공
      const aliveP = await launched.postitPage.evaluate(() => 1 + 1).catch(() => null);
      expect(aliveP, 'A42[A9]: 손상 데이터 주입 후 포스트잇 창이 응답하지 않습니다 (크래시)').toBe(2);
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
      const aliveC = await launched.calPage.evaluate(() => 1 + 1).catch(() => null);
      expect(aliveC, 'A42[A9]: 손상 데이터 주입 후 캘린더 창이 응답하지 않습니다 (크래시)').toBe(2);
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

  /* ── 임계 서브셋 [A25] — 다중 보드 (키 분리·양방향 전환·재기동 유지) ────────── */
  test('A42: [A25] 다중 보드 — 키 분리 저장·양방향 전환·완전 종료 후 활성 보드/구성 유지 (Electron)', async () => {
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
      let launched = await launchAndGetWindows(dir, 'A42[A25]');
      shell = launched.shell;
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
        'A42[A25]: [data-add-board] 클릭 후 새 보드 탭 활성 전환이 관찰되지 않았습니다 (Electron 컨텍스트)'
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

      launched = await launchAndGetWindows(dir, 'A42[A25] 재기동');
      shell = launched.shell;
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

  /* ── 임계 서브셋 [A26] — 사진 포스트잇 (다운스케일 저장·재기동 유지·비이미지 거부) ── */
  test('A42: [A26] 사진 포스트잇 — data:image 렌더·저장 ≤300KB·완전 종료 후 유지·비이미지 거부 (Electron)', async () => {
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
      let launched = await launchAndGetWindows(dir, 'A42[A26]');
      shell = launched.shell;
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
        'A42[A26]: 첨부 후 5초 내 노트 내부에 data:image/ + naturalWidth > 0 인 img 가 표시되지 않았습니다 (Electron 컨텍스트)'
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
      launched = await launchAndGetWindows(dir, 'A42[A26] 재기동');
      shell = launched.shell;
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
