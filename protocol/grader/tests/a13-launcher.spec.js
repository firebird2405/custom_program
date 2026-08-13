'use strict';
/**
 * A13 — 실행 스크립트(launch_all.vbs) 검증 (SCORECARD A13)
 *
 * 절차:
 *  0) msedge.exe 미탐지 시 명시적 SKIP (Edge 미설치 환경). Windows 외 플랫폼도 SKIP.
 *  1) 사전 정리: CommandLine 에 D:\custom_program\.edge\ (또는 우리 --app=file:///D:/custom_program/ 창)를
 *     포함한 msedge PID "만" Stop-Process — 사용자의 일반 Edge 브라우징 세션은 건드리지 않는다.
 *  2) wscript.exe 로 launch_all.vbs 실행 → 15초 폴링(Get-CimInstance Win32_Process):
 *     msedge CommandLine 에 --app=file:///D:/custom_program/calendar.html 과
 *     --app=file:///D:/custom_program/postit.html 이 각각 존재하고,
 *     서로 다른 고정 --user-data-dir 2개를 가져야 한다.
 *     ※ 현재 launch_all.vbs 는 memo.html 을 열므로 postit --app 줄 부재로 FAIL 이 정상 —
 *        3단계에서 런처가 postit.html 을 열도록 갱신될 때까지 red 유지 (실패 메시지에 명시).
 *  3) Edge 창을 모두 닫은 상태에서, vbs 가 쓰는 것과 동일한 프로필 디렉터리로 Playwright
 *     persistent context 를 띄워 localStorage 마커를 심는다.
 *     (file:// 오리진은 프로필당 localStorage 를 공유하므로 calendar.html 로 심은 마커가
 *      같은 프로필의 postit.html 에서도 보인다 — postit 프로필 마커도 calendar.html 로 기록/판독)
 *  4) launch_all.vbs 2회차 실행 → --user-data-dir 경로가 1회차와 동일한지 확인 (경로 안정성).
 *  5) Edge 종료 후 같은 프로필을 다시 열어 마커 유지 확인 (임시 프로필 증발 차단).
 *  6) 정리: 위 패턴에 매치된 PID 만 종료. .edge 프로필 디렉터리는 실사용 데이터이므로 절대 삭제하지 않는다.
 *
 * 공통 규정: 본 테스트가 여는 Playwright 페이지도 dialog 0건을 단언한다.
 * 외부 프로세스 기동(런처 2회 + 프로필 열람 4회)이 포함되어 per-test 타임아웃을 150초로 연장한다
 * (playwright.config.js 의 기본 90초는 유지).
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { test, expect } = require('@playwright/test');
const { APP_ROOT, CALENDAR_PATH, POSTIT_PATH, launchApp, closeApp, sleep } = require('../lib/helpers');

const LAUNCH_ALL_VBS = path.join(APP_ROOT, 'launch_all.vbs');
const WSCRIPT_EXE = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'wscript.exe');
// PATH 섀도잉 차단 — powershell 은 항상 System32 절대 경로로 실행 (SCORECARD B 실행 환경 후킹 금지)
const POWERSHELL_EXE = path.join(
  process.env.SystemRoot || 'C:\\Windows',
  'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'
);

// 비교는 소문자 정규화 후 수행
const CAL_APP_ARG = '--app=file:///d:/custom_program/calendar.html';
const POSTIT_APP_ARG = '--app=file:///d:/custom_program/postit.html';

const MARKER_KEY = 'grader-a13-marker';

function findEdgeExe() {
  const candidates = [
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    process.env.LOCALAPPDATA
      ? path.join(process.env.LOCALAPPDATA, 'Microsoft', 'Edge', 'Application', 'msedge.exe')
      : null,
  ];
  return candidates.find((p) => p && fs.existsSync(p)) || null;
}

function runPowerShell(script, timeoutMs = 30000) {
  return execFileSync(
    POWERSHELL_EXE,
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
    { encoding: 'utf8', timeout: timeoutMs, windowsHide: true }
  );
}

// "우리" msedge 프로세스만 조회: .edge 프로필 사용 또는 우리 앱의 --app 창.
// (Playwright 자체가 띄우는 Edge 는 os.tmpdir() 프로필 + CDP 내비게이션이라 이 패턴에 걸리지 않는다)
const PS_LIST_OURS = String.raw`
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$p = @(Get-CimInstance Win32_Process -Filter "Name='msedge.exe'" |
  Where-Object { $_.CommandLine -like '*D:\custom_program\.edge\*' -or $_.CommandLine -like '*--app=file:///D:/custom_program/*' } |
  Select-Object ProcessId, CommandLine)
ConvertTo-Json -InputObject $p -Compress
`;

function listOurEdgeProcesses() {
  let out = '';
  try {
    out = runPowerShell(PS_LIST_OURS);
  } catch (e) {
    throw new Error('msedge 프로세스 조회(PowerShell Get-CimInstance Win32_Process) 실패: ' + (e && e.message));
  }
  const text = String(out).replace(/^\uFEFF/, '').trim();
  if (!text) return [];
  let arr;
  try {
    arr = JSON.parse(text);
  } catch (e) {
    return [];
  }
  if (!Array.isArray(arr)) arr = [arr];
  return arr
    .filter((x) => x && x.ProcessId && x.CommandLine)
    .map((x) => ({ pid: Number(x.ProcessId), cmd: String(x.CommandLine) }));
}

/** 매치된 PID 만 종료 (패턴 밖의 msedge 는 절대 종료하지 않음) */
function killOurEdgeProcesses() {
  const procs = listOurEdgeProcesses();
  if (procs.length === 0) return 0;
  const ids = procs.map((p) => p.pid).join(',');
  try {
    runPowerShell(
      `foreach ($id in @(${ids})) { try { Stop-Process -Id $id -Force -ErrorAction Stop } catch {} }`
    );
  } catch (e) {
    /* 이미 종료된 PID 등은 무시 — 아래 재확인 폴링이 최종 판정 */
  }
  return procs.length;
}

/** 우리 msedge 가 전부 내려갈 때까지 대기 (프로필 잠금 해제 확보) */
async function ensureOurEdgeClosed(timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    killOurEdgeProcesses();
    if (listOurEdgeProcesses().length === 0) {
      await sleep(500); // 프로필 파일 잠금 해제 여유
      return;
    }
    if (Date.now() > deadline) {
      throw new Error(
        '기존 msedge(.edge 프로필/--app 창) 종료 실패 — 프로필 잠금으로 A13 검사를 진행할 수 없습니다'
      );
    }
    await sleep(400);
  }
}

function runLaunchAll() {
  try {
    execFileSync(WSCRIPT_EXE, ['//B', LAUNCH_ALL_VBS], { timeout: 30000, windowsHide: true });
  } catch (e) {
    throw new Error('launch_all.vbs 실행(wscript.exe) 실패: ' + (e && e.message));
  }
}

/** 15초 내 calendar/postit --app 명령줄 폴링 (SCORECARD A13) */
async function pollForAppWindows(timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  let procs = [];
  for (;;) {
    procs = listOurEdgeProcesses();
    const cal = procs.find((p) => p.cmd.toLowerCase().includes(CAL_APP_ARG));
    const postit = procs.find((p) => p.cmd.toLowerCase().includes(POSTIT_APP_ARG));
    if ((cal && postit) || Date.now() > deadline) return { cal, postit, procs };
    await sleep(1000);
  }
}

function extractUserDataDir(cmd) {
  const m = String(cmd).match(/--user-data-dir=(?:"([^"]+)"|([^\s"]+))/i);
  return m ? m[1] || m[2] : null;
}

function normPath(p) {
  return String(p || '').replace(/[/\\]+$/, '').toLowerCase();
}

function appArgsSummary(procs) {
  const args = procs
    .map((p) => {
      const m = p.cmd.match(/--app=\S+/i);
      return m ? m[0] : null;
    })
    .filter(Boolean);
  return args.length ? args.join(', ') : '(발견된 --app 명령줄 없음)';
}

/**
 * vbs 가 쓰는 실사용 프로필 디렉터리로 Playwright persistent context 를 열어 fn(page) 실행.
 * 주의: 이 디렉터리는 사용자 데이터 — 절대 삭제하지 않는다 (teardown 은 close 만).
 */
async function withVbsProfile(profileDir, fn, dialogSink) {
  const app = await launchApp(profileDir, CALENDAR_PATH);
  try {
    return await fn(app.page);
  } finally {
    if (dialogSink) dialogSink.push(...app.state.dialogs);
    await closeApp(app);
  }
}

test.describe('A13 실행 스크립트(launch_all.vbs)', () => {
  test('A13: 두 앱 창 --app 기동 + 고정 프로필 2개 + 경로 안정성 + 마커 유지', async () => {
    test.setTimeout(150 * 1000); // 외부 프로세스 기동 다수 — config 기본 90초로는 부족할 수 있음
    test.skip(process.platform !== 'win32', 'Windows 전용 항목 — A13 을 명시적으로 SKIP 합니다');
    const edge = findEdgeExe();
    test.skip(!edge, 'msedge.exe 미탐지 — Edge 미설치 환경이므로 A13 을 명시적으로 SKIP 합니다');

    expect(fs.existsSync(WSCRIPT_EXE), 'wscript.exe 를 찾을 수 없습니다: ' + WSCRIPT_EXE).toBe(true);
    expect(fs.existsSync(LAUNCH_ALL_VBS), 'launch_all.vbs 가 없습니다: ' + LAUNCH_ALL_VBS).toBe(true);

    const dialogs = [];
    try {
      // (사전) .edge 프로필을 쓰는 기존 msedge 만 정리
      await ensureOurEdgeClosed();

      // ── 1회차 실행 ──
      runLaunchAll();
      const run1 = await pollForAppWindows();

      expect(
        run1.cal,
        'launch_all.vbs 실행 후 15초 내 msedge CommandLine 에서 ' +
          '"--app=file:///D:/custom_program/calendar.html" 을 찾지 못했습니다. ' +
          '관찰된 명령줄: ' + appArgsSummary(run1.procs)
      ).toBeTruthy();

      let postitMsg =
        'launch_all.vbs 실행 후 15초 내 msedge CommandLine 에서 ' +
        '"--app=file:///D:/custom_program/postit.html" 을 찾지 못했습니다. ' +
        '관찰된 명령줄: ' + appArgsSummary(run1.procs);
      if (!fs.existsSync(POSTIT_PATH)) {
        postitMsg +=
          ' — postit.html 미구현 (3단계 예정): 현재 launch_all.vbs 는 memo.html 을 열고 있으며, ' +
          '3단계에서 런처가 postit.html 을 열도록 갱신될 때까지 본 항목의 FAIL 이 정상입니다';
      }
      expect(run1.postit, postitMsg).toBeTruthy();

      const udd1cal = extractUserDataDir(run1.cal.cmd);
      const udd1post = extractUserDataDir(run1.postit.cmd);
      expect(udd1cal, '캘린더 창 명령줄에 --user-data-dir 이 없습니다: ' + run1.cal.cmd).toBeTruthy();
      expect(udd1post, '포스트잇 창 명령줄에 --user-data-dir 이 없습니다: ' + run1.postit.cmd).toBeTruthy();
      expect(
        normPath(udd1cal) !== normPath(udd1post),
        '두 앱이 동일한 --user-data-dir 을 공유합니다 (서로 다른 고정 프로필 2개 필요): ' + udd1cal
      ).toBe(true);

      // ── Edge 종료 후, vbs 와 동일한 프로필에 localStorage 마커 심기 ──
      await ensureOurEdgeClosed();
      const markerValue = 'a13-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
      for (const dir of [udd1cal, udd1post]) {
        await withVbsProfile(
          dir,
          (page) => page.evaluate(([k, v]) => localStorage.setItem(k, v), [MARKER_KEY, markerValue]),
          dialogs
        );
      }

      // ── 2회차 실행: 경로 안정성 (고정 프로필) ──
      runLaunchAll();
      const run2 = await pollForAppWindows();
      expect(
        run2.cal,
        '2회차 실행: 15초 내 캘린더 --app 명령줄을 찾지 못했습니다. 관찰: ' + appArgsSummary(run2.procs)
      ).toBeTruthy();
      expect(
        run2.postit,
        '2회차 실행: 15초 내 포스트잇 --app 명령줄을 찾지 못했습니다. 관찰: ' + appArgsSummary(run2.procs)
      ).toBeTruthy();

      const udd2cal = extractUserDataDir(run2.cal.cmd);
      const udd2post = extractUserDataDir(run2.postit.cmd);
      expect(
        normPath(udd2cal),
        `캘린더 --user-data-dir 이 실행마다 다릅니다 (1회차: ${udd1cal}, 2회차: ${udd2cal}) — 고정 경로여야 합니다`
      ).toBe(normPath(udd1cal));
      expect(
        normPath(udd2post),
        `포스트잇 --user-data-dir 이 실행마다 다릅니다 (1회차: ${udd1post}, 2회차: ${udd2post}) — 고정 경로여야 합니다`
      ).toBe(normPath(udd1post));

      // ── Edge 종료 후 마커 유지 확인 (임시 프로필 증발 차단) ──
      await ensureOurEdgeClosed();
      for (const [label, dir] of [['캘린더', udd1cal], ['포스트잇', udd1post]]) {
        const got = await withVbsProfile(
          dir,
          (page) =>
            page.evaluate((k) => {
              const v = localStorage.getItem(k);
              localStorage.removeItem(k); // 검사 후 마커 제거 (사용자 프로필 오염 최소화)
              return v;
            }, MARKER_KEY),
          dialogs
        );
        expect(
          got,
          `${label} 프로필(${dir})에 심은 localStorage 마커가 재실행 후 사라졌습니다 — ` +
            '실행마다 임시/신규 프로필을 쓰는 것으로 보입니다 (고정 프로필 필요)'
        ).toBe(markerValue);
      }

      expect(
        dialogs,
        `A13 검사 중 dialog ${dialogs.length}건 발생 (0건이어야 함): ` +
          dialogs.map((d) => d.type + ':' + d.message).join(' | ')
      ).toHaveLength(0);
    } finally {
      // 정리: 패턴에 매치된 PID 만 종료. .edge 프로필 디렉터리(사용자 데이터)는 삭제하지 않는다.
      try {
        killOurEdgeProcesses();
      } catch (e) {
        /* 정리 실패는 테스트 결과에 영향 없음 */
      }
    }
  });
});
