'use strict';
/**
 * A40 — 항상 위 (rev.5 설계서 §1 A40 / §2 A40)
 * "두 앱 창(launch_all.vbs)과 디코이 Edge 앱 창(별도 임시 프로필·custom_program 외 HTML)이 떠 있는
 *  상태에서 pin_top.ps1 실행 → 두 앱 창의 GWL_EXSTYLE 에 WS_EX_TOPMOST(0x8) 비트가 set 되고
 *  디코이 창은 unset → unpin.ps1 실행 → 두 앱 창의 비트가 clear 된다.
 *  (Edge/대화형 데스크톱 부재 시 명시적 SKIP)"
 *
 * ── 스크립트 계약 (설계서 §2 A40 — 그대로 기록) ──
 * pin_top.ps1/unpin.ps1 — 대상 선정: "프로세스 CommandLine 에 D:/custom_program 과 --app 이 모두
 * 포함된 msedge 창"만. 그 외 어떤 창도 건드리지 않는다 (디코이 단언이 이를 채점 — 설계서 §6).
 * 창 미검출은 SKIP 이 아닌 FAIL (창이 떠야 성립하는 항목 — 대화형 데스크톱 확인 후).
 * teardown: CommandLine 매치분 + 디코이 PID 만 종료, 임시 프로필 삭제.
 *
 * 주의: 본 테스트는 실제 창을 띄우는 유일한 항목(비 headless)으로, 실행 중 사용자의 열린 앱 창을
 * 잠시 닫았다가 다시 열 수 있다 (발주 승인된 부작용).
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawn } = require('child_process');
const { test, expect } = require('@playwright/test');
const { APP_ROOT, sleep, removeDirWithRetry } = require('../lib/helpers');

const LAUNCH_ALL_VBS = path.join(APP_ROOT, 'launch_all.vbs');
const PIN_PS1 = path.join(APP_ROOT, 'pin_top.ps1');
const UNPIN_PS1 = path.join(APP_ROOT, 'unpin.ps1');
const WSCRIPT_EXE = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'wscript.exe');
// PATH 섀도잉 차단 — powershell 은 항상 System32 절대 경로로 실행 (SCORECARD B 실행 환경 후킹 금지)
const POWERSHELL_EXE = path.join(
  process.env.SystemRoot || 'C:\\Windows',
  'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'
);
const WS_EX_TOPMOST = 0x0008;
const CAL_APP_ARG = '--app=file:///d:/custom_program/calendar.html';
const POSTIT_APP_ARG = '--app=file:///d:/custom_program/postit.html';

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

function runPowerShell(args, timeoutMs = 60000) {
  return execFileSync(POWERSHELL_EXE, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass'].concat(args), {
    encoding: 'utf8',
    timeout: timeoutMs,
    windowsHide: true,
  });
}

function runPs1OrThrow(script, label) {
  try {
    runPowerShell(['-File', script], 60000);
  } catch (e) {
    throw new Error(
      `${label} 실행 실패 (exit code ${e && e.status}): ` +
        String((e && e.stderr) || (e && e.stdout) || (e && e.message) || '').slice(0, 500)
    );
  }
}

/** 전체 msedge 프로세스 목록 (읽기 전용 — 종료는 매치된 PID 만) */
function listEdgeProcesses() {
  let out = '';
  try {
    out = runPowerShell([
      '-Command',
      String.raw`[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; ConvertTo-Json -Compress -InputObject @(Get-CimInstance Win32_Process -Filter "Name='msedge.exe'" | Select-Object ProcessId, CommandLine)`,
    ]);
  } catch (e) {
    throw new Error('msedge 프로세스 조회(PowerShell) 실패: ' + (e && e.message));
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

/** 우리 앱/디코이 창의 "브라우저 프로세스"(--type= 자식 제외)만 선별 */
function browserProcs(procs) {
  return procs.filter((p) => !/--type=/i.test(p.cmd));
}

function ourAppProcs(procs) {
  return procs.filter((p) => {
    const norm = p.cmd.replace(/\\/g, '/').toLowerCase();
    return norm.includes('d:/custom_program') && norm.includes('--app');
  });
}

function killPids(pids) {
  if (!pids.length) return;
  try {
    runPowerShell(['-Command', `foreach ($id in @(${pids.join(',')})) { try { Stop-Process -Id $id -Force -ErrorAction Stop } catch {} }`]);
  } catch (e) {
    /* 이미 종료된 PID 등 무시 */
  }
}

/** 우아한 종료(WM_CLOSE) 우선 → 유예 후 잔존분만 강제 종료.
 *  강제 종료는 프로필 localStorage(LevelDB) 로그 꼬리를 손상시킬 수 있어 마지막 수단으로만 쓴다. */
async function closePidsGracefully(pids, graceMs = 4000) {
  if (!pids.length) return;
  try {
    runPowerShell([
      '-Command',
      `foreach ($id in @(${pids.join(',')})) { try { $p = Get-Process -Id $id -ErrorAction Stop; $null = $p.CloseMainWindow() } catch {} }`,
    ]);
  } catch (e) {
    /* 무시 */
  }
  const deadline = Date.now() + graceMs;
  for (;;) {
    const alive = listEdgeProcesses().filter((p) => pids.includes(p.pid));
    if (alive.length === 0) return;
    if (Date.now() > deadline) {
      killPids(alive.map((p) => p.pid));
      return;
    }
    await sleep(500);
  }
}

/** 지정 PID 들의 보이는 최상위 창 HWND + GWL_EXSTYLE 덤프 (EnumWindows P/Invoke) */
function dumpWindows(pids) {
  if (!pids.length) return [];
  const script = [
    "$ErrorActionPreference='Stop'",
    "Add-Type -TypeDefinition @'",
    'using System;',
    'using System.Collections.Generic;',
    'using System.Runtime.InteropServices;',
    'public static class GraderA40 {',
    '  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);',
    '  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc cb, IntPtr lParam);',
    '  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);',
    '  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);',
    '  [DllImport("user32.dll")] public static extern int GetWindowLong(IntPtr hWnd, int nIndex);',
    '  public static List<string> Dump(uint[] pids) {',
    '    List<uint> set = new List<uint>(pids);',
    '    List<string> res = new List<string>();',
    '    EnumWindows(delegate(IntPtr h, IntPtr l) {',
    '      if (IsWindowVisible(h)) {',
    '        uint pid;',
    '        GetWindowThreadProcessId(h, out pid);',
    '        if (set.Contains(pid)) { int ex = GetWindowLong(h, -20); res.Add(pid + "|" + h.ToInt64() + "|" + ex); }',
    '      }',
    '      return true;',
    '    }, IntPtr.Zero);',
    '    return res;',
    '  }',
    '}',
    "'@",
    `$r = [GraderA40]::Dump([uint32[]]@(${pids.join(',')}))`,
    '$r -join [Environment]::NewLine',
  ].join('\n');
  let out = '';
  try {
    out = runPowerShell(['-Command', script]);
  } catch (e) {
    throw new Error('창 열람(PowerShell EnumWindows P/Invoke) 실패: ' + (e && e.message));
  }
  return String(out)
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const [pid, hwnd, ex] = l.split('|');
      return { pid: Number(pid), hwnd, ex: Number(ex) };
    });
}

function topmostSet(w) {
  return (w.ex & WS_EX_TOPMOST) !== 0;
}

test.describe('A40 항상 위', () => {
  test('A40: pin_top → 두 앱 창 WS_EX_TOPMOST set·디코이 unset → unpin → clear', async () => {
    test.setTimeout(180000);
    test.skip(process.platform !== 'win32', 'Windows 전용 항목 — A40 을 명시적으로 SKIP 합니다');
    const edge = findEdgeExe();
    test.skip(!edge, 'msedge.exe 미탐지 — Edge 미설치 환경이므로 A40 을 명시적으로 SKIP 합니다');
    expect(fs.existsSync(PIN_PS1), 'pin_top.ps1 이 없습니다: ' + PIN_PS1).toBe(true);
    expect(fs.existsSync(UNPIN_PS1), 'unpin.ps1 이 없습니다: ' + UNPIN_PS1).toBe(true);
    expect(fs.existsSync(LAUNCH_ALL_VBS), 'launch_all.vbs 가 없습니다: ' + LAUNCH_ALL_VBS).toBe(true);

    // 대화형 데스크톱 확인 — 서비스 세션(0)·비대화형이면 창이 뜰 수 없으므로 명시적 SKIP
    let interactive = false;
    try {
      const out = runPowerShell(['-Command', '"$([Environment]::UserInteractive)|$((Get-Process -Id $PID).SessionId)"']);
      const m = String(out).trim().split('|');
      interactive = /true/i.test(m[0] || '') && Number(m[1]) > 0;
    } catch (e) {
      interactive = false;
    }
    test.skip(!interactive, '대화형 데스크톱 부재(비대화형 세션/세션 0) — A40 을 명시적으로 SKIP 합니다');

    const decoyRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'grader-a40-'));
    const decoyProfile = path.join(decoyRoot, 'profile');
    fs.mkdirSync(decoyProfile, { recursive: true });
    const decoyHtml = path.join(decoyRoot, 'decoy.html');
    fs.writeFileSync(
      decoyHtml,
      '<!doctype html><html><head><meta charset="utf-8"><title>A40 decoy</title></head><body><p>decoy</p></body></html>',
      'utf8'
    );
    const decoyMark = path.basename(decoyRoot); // CommandLine 매칭용 고유 문자열

    const killedPids = new Set();
    try {
      // ── 사전 정리: 우리 앱 창만 우아하게 종료 (사용자 일반 Edge 세션 불가침) ──
      ourAppProcs(listEdgeProcesses()).forEach((p) => killedPids.add(p.pid));
      await closePidsGracefully([...killedPids]);
      await sleep(1000);

      // ── launch_all.vbs 로 두 앱 창 기동 ──
      try {
        execFileSync(WSCRIPT_EXE, ['//B', LAUNCH_ALL_VBS], { timeout: 30000, windowsHide: true });
      } catch (e) {
        throw new Error('launch_all.vbs 실행(wscript.exe) 실패: ' + (e && e.message));
      }

      // ── 디코이 앱 창 기동 (임시 프로필 · custom_program 외 HTML) ──
      const child = spawn(
        edge,
        [
          '--app=file:///' + decoyHtml.replace(/\\/g, '/'),
          '--user-data-dir=' + decoyProfile,
          '--no-first-run',
          '--no-default-browser-check',
          '--window-size=420,320',
          '--window-position=80,80',
        ],
        { detached: true, stdio: 'ignore' }
      );
      child.unref();

      // ── 세 창의 브라우저 PID 확보 (15초 폴링) ──
      let calPid = null;
      let postPid = null;
      let decoyPid = null;
      {
        const deadline = Date.now() + 15000;
        for (;;) {
          const procs = browserProcs(listEdgeProcesses());
          const low = (p) => p.cmd.replace(/\\/g, '/').toLowerCase();
          calPid = (procs.find((p) => low(p).includes(CAL_APP_ARG)) || {}).pid || null;
          postPid = (procs.find((p) => low(p).includes(POSTIT_APP_ARG)) || {}).pid || null;
          decoyPid = (procs.find((p) => p.cmd.includes(decoyMark) && /--app=/i.test(p.cmd)) || {}).pid || null;
          if ((calPid && postPid && decoyPid) || Date.now() > deadline) break;
          await sleep(1000);
        }
      }
      expect(
        calPid,
        'launch_all.vbs 실행 후 15초 내 캘린더 --app 브라우저 프로세스를 찾지 못했습니다'
      ).toBeTruthy();
      expect(
        postPid,
        'launch_all.vbs 실행 후 15초 내 포스트잇 --app 브라우저 프로세스를 찾지 못했습니다'
      ).toBeTruthy();
      expect(decoyPid, '디코이 Edge 앱 창 브라우저 프로세스를 찾지 못했습니다').toBeTruthy();
      [calPid, postPid, decoyPid].forEach((p) => killedPids.add(p));

      // ── 각 PID 의 보이는 최상위 창 확보 (창 미검출 = FAIL, SKIP 아님) ──
      const allPids = [calPid, postPid, decoyPid];
      let wins = [];
      {
        const deadline = Date.now() + 30000;
        for (;;) {
          wins = dumpWindows(allPids);
          const has = (pid) => wins.some((w) => w.pid === pid);
          if ((has(calPid) && has(postPid) && has(decoyPid)) || Date.now() > deadline) break;
          await sleep(1000);
        }
      }
      for (const [pid, name] of [[calPid, '캘린더'], [postPid, '포스트잇'], [decoyPid, '디코이']]) {
        expect(
          wins.some((w) => w.pid === pid),
          `${name} 창(PID ${pid})의 보이는 최상위 창을 30초 내 찾지 못했습니다 — 창이 떠야 성립하는 항목이므로 FAIL 입니다`
        ).toBe(true);
      }

      // ── pin_top.ps1: 두 앱 창 전부 topmost set, 디코이는 unset ──
      runPs1OrThrow(PIN_PS1, 'pin_top.ps1');
      {
        const deadline = Date.now() + 10000;
        let ok = false;
        for (;;) {
          wins = dumpWindows(allPids);
          const appWins = wins.filter((w) => w.pid === calPid || w.pid === postPid);
          ok = appWins.length > 0 && appWins.every(topmostSet);
          if (ok || Date.now() > deadline) break;
          await sleep(500);
        }
        const appWins = wins.filter((w) => w.pid === calPid || w.pid === postPid);
        expect(
          ok,
          'pin_top.ps1 실행 후 두 앱 창의 GWL_EXSTYLE 에 WS_EX_TOPMOST(0x8) 비트가 set 되지 않았습니다 ' +
            `(관찰: ${appWins.map((w) => `pid${w.pid}=0x${w.ex.toString(16)}`).join(', ') || '(창 없음)'})`
        ).toBe(true);
        const decoyWins = wins.filter((w) => w.pid === decoyPid);
        expect(
          decoyWins.length > 0 && decoyWins.every((w) => !topmostSet(w)),
          'pin_top.ps1 이 디코이 창까지 topmost 로 만들었습니다 — 대상 한정(D:/custom_program + --app) 계약 위반 ' +
            `(관찰: ${decoyWins.map((w) => `pid${w.pid}=0x${w.ex.toString(16)}`).join(', ') || '(창 없음)'})`
        ).toBe(true);
      }

      // ── unpin.ps1: 두 앱 창 비트 clear ──
      runPs1OrThrow(UNPIN_PS1, 'unpin.ps1');
      {
        const deadline = Date.now() + 10000;
        let ok = false;
        let appWins = [];
        for (;;) {
          wins = dumpWindows([calPid, postPid]);
          appWins = wins;
          ok = appWins.length > 0 && appWins.every((w) => !topmostSet(w));
          if (ok || Date.now() > deadline) break;
          await sleep(500);
        }
        expect(
          ok,
          'unpin.ps1 실행 후에도 두 앱 창의 WS_EX_TOPMOST 비트가 clear 되지 않았습니다 ' +
            `(관찰: ${appWins.map((w) => `pid${w.pid}=0x${w.ex.toString(16)}`).join(', ') || '(창 없음)'})`
        ).toBe(true);
      }
    } finally {
      // 정리: 확보한 PID(CommandLine 매치분 + 디코이)만 우아하게 종료(잔존분만 강제), 임시 프로필 삭제.
      try {
        ourAppProcs(listEdgeProcesses()).forEach((p) => killedPids.add(p.pid));
        const decoyNow = listEdgeProcesses().filter((p) => p.cmd.includes(decoyMark));
        decoyNow.forEach((p) => killedPids.add(p.pid));
        await closePidsGracefully([...killedPids]);
      } catch (e) {
        /* 정리 실패는 판정에 영향 없음 */
      }
      await sleep(1000);
      await removeDirWithRetry(decoyRoot, 10, 500);
    }
  });
});
