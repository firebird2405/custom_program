'use strict';
/**
 * A39 — 자동 파일 백업 (rev.5 설계서 §1 A39 / §2 A39)
 * "앱 고정 프로필(.edge\calendar·.edge\postit)에 채점기가 마커 데이터를 심은 뒤
 *  backup_snapshot.ps1 실행(exit 0, 120초 내) → `D:\custom_program\backups\` 에 두 앱 몫의
 *  타임스탬프 파일명 `.json` 이 새로 생성되고 각각 유효 JSON 이며 심은 마커 값을 포함,
 *  재실행 시 새 타임스탬프 파일이 추가된다(기존 파일 미덮어쓰기)"
 *
 * ── 파일/스크립트 계약 (설계서 §2 A39 — 그대로 기록) ──
 * backup_snapshot.ps1 → backups\calendar-YYYYMMDD-HHMMSS.json · backups\postit-YYYYMMDD-HHMMSS.json
 * (파일명 판정: calendar|cal / postit + \d{8}[-_]?\d{6} 타임스탬프 패턴), 내용 = 해당 프로필
 * localStorage 전 키 JSON 오브젝트. 기존 파일 삭제·덮어쓰기 금지 (B 조항).
 * 마커는 기존 키를 건드리지 않는 별도 키 `__a39_marker` 로 주입.
 * teardown: 채점기가 만든 백업 파일과 마커 키만 제거 (사용자 기존 백업·데이터 불가침).
 * SKIP: Edge 미탐지 시 (A13 동일 조건) / 비 Windows.
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { test, expect } = require('@playwright/test');
const { APP_ROOT, CALENDAR_PATH, launchApp, closeApp, sleep } = require('../lib/helpers');

const BACKUP_PS1 = path.join(APP_ROOT, 'backup_snapshot.ps1');
const BACKUP_DIR = path.join(APP_ROOT, 'backups');
const PROFILE_CAL = path.join(APP_ROOT, '.edge', 'calendar');
const PROFILE_POST = path.join(APP_ROOT, '.edge', 'postit');
const MARKER_KEY = '__a39_marker';
const TS_RE = /\d{8}[-_]?\d{6}/;
// PATH 섀도잉 차단 — powershell 은 항상 System32 절대 경로로 실행 (SCORECARD B 실행 환경 후킹 금지)
const POWERSHELL_EXE = path.join(
  process.env.SystemRoot || 'C:\\Windows',
  'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'
);

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

// "우리" msedge 프로세스만 조회·정리 (a13 동형 — 사용자의 일반 Edge 세션은 불가침)
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
    out = runPowerShell(['-Command', PS_LIST_OURS]);
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

/** 매치된 PID 에 WM_CLOSE(우아한 종료) 요청 — 강제 종료는 LevelDB 로그 꼬리를 손상시킬 수 있다 */
function requestCloseOurEdge(procs) {
  if (!procs.length) return;
  const ids = procs.map((p) => p.pid).join(',');
  try {
    runPowerShell([
      '-Command',
      `foreach ($id in @(${ids})) { try { $p = Get-Process -Id $id -ErrorAction Stop; $null = $p.CloseMainWindow() } catch {} }`,
    ]);
  } catch (e) {
    /* 이미 종료된 PID 등 무시 */
  }
}

function killOurEdgeProcesses() {
  const procs = listOurEdgeProcesses();
  if (procs.length === 0) return;
  const ids = procs.map((p) => p.pid).join(',');
  try {
    runPowerShell(['-Command', `foreach ($id in @(${ids})) { try { Stop-Process -Id $id -Force -ErrorAction Stop } catch {} }`]);
  } catch (e) {
    /* 이미 종료된 PID 등 무시 */
  }
}

/** 우리 msedge 가 전부 내려갈 때까지 대기.
 *  graceMs 동안 우아한 종료(WM_CLOSE·자연 종료)를 기다린다 — 곧바로 강제 종료하면
 *  localStorage(LevelDB) 플러시 유실·로그 꼬리 손상이 생길 수 있다. grace 초과분만 kill. */
async function ensureOurEdgeClosed(timeoutMs = 60000, graceMs = 6000) {
  const start = Date.now();
  for (;;) {
    const procs = listOurEdgeProcesses();
    if (procs.length === 0) {
      await sleep(500);
      return;
    }
    requestCloseOurEdge(procs);
    if (Date.now() - start > graceMs) killOurEdgeProcesses();
    if (Date.now() - start > timeoutMs) {
      throw new Error('기존 msedge(.edge 프로필/--app 창) 종료 실패 — 프로필 잠금으로 A39 검사를 진행할 수 없습니다');
    }
    await sleep(600);
  }
}

/** 실사용 프로필에 마커 기록/제거 — 프로필 디렉터리는 사용자 데이터: 절대 삭제하지 않는다 */
async function withProfile(profileDir, fn, dialogSink) {
  const app = await launchApp(profileDir, CALENDAR_PATH);
  try {
    return await fn(app.page);
  } finally {
    if (dialogSink) dialogSink.push(...app.state.dialogs);
    await closeApp(app);
  }
}

/**
 * 마커 주입 + 재개방 판독으로 디스크 반영 확인 (최대 3회).
 * 3회 모두 유실되면 프로필 localStorage 저장 자체가 재기동을 살아남지 못하는 상태 —
 * 전형적 원인은 과거 msedge 강제 종료로 손상된 LevelDB 재활용 로그(손상 지점 이후의 모든
 * 새 기록이 복구 단계에서 폐기됨)이며, 이 경우 백업 판정 이전에 환경 문제로 명확히 FAIL 한다.
 * (Default\Local Storage\leveldb\LOG 의 "Corruption" 여부로 확인 가능 — 메시지에 안내)
 */
async function plantMarkerVerified(profileDir, value, dialogs, label) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    await withProfile(profileDir, (p) => p.evaluate(([k, v]) => localStorage.setItem(k, v), [MARKER_KEY, value]), dialogs);
    await ensureOurEdgeClosed();
    const got = await withProfile(profileDir, (p) => p.evaluate((k) => localStorage.getItem(k), MARKER_KEY), dialogs);
    await ensureOurEdgeClosed();
    if (got === value) return;
  }
  throw new Error(
    `${label} 프로필(${profileDir})에 마커 키 ${MARKER_KEY} 를 지속 저장하지 못했습니다 (3회 시도) — ` +
      '프로필 localStorage 저장이 재기동을 살아남지 못하는 상태입니다. ' +
      `${profileDir}\\Default\\Local Storage\\leveldb\\LOG 에 "Corruption" 기록이 있으면 ` +
      '과거 강제 종료로 손상된 재활용 로그가 원인입니다 (환경 문제 — 백업 스크립트 결함 아님)'
  );
}

function listBackupFiles() {
  if (!fs.existsSync(BACKUP_DIR)) return [];
  return fs.readdirSync(BACKUP_DIR).filter((n) => /\.json$/i.test(n));
}

function runBackupOrThrow(label) {
  try {
    execFileSync(
      POWERSHELL_EXE,
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', BACKUP_PS1],
      { encoding: 'utf8', timeout: 120000, windowsHide: true }
    );
  } catch (e) {
    throw new Error(
      `backup_snapshot.ps1 ${label} 실행 실패 (exit 0·120초 내 종료 필요, exit code ${e && e.status}): ` +
        String((e && e.stdout) || (e && e.stderr) || (e && e.message) || '').slice(0, 500)
    );
  }
}

/** 새 파일 중 앱 몫(calendar|cal / postit) + 타임스탬프 패턴 파일 분류 */
function classifyNew(newFiles) {
  const cal = newFiles.filter((n) => /(calendar|cal)/i.test(n) && !/postit/i.test(n) && TS_RE.test(n));
  const post = newFiles.filter((n) => /postit/i.test(n) && TS_RE.test(n));
  return { cal, post };
}

test.describe('A39 자동 파일 백업', () => {
  test('A39: 마커 주입 → backup_snapshot.ps1 → 두 앱 몫 타임스탬프 .json + 마커 포함 → 재실행 시 추가·미덮어쓰기', async () => {
    test.setTimeout(300 * 1000);
    test.skip(process.platform !== 'win32', 'Windows 전용 항목 — A39 를 명시적으로 SKIP 합니다');
    const edge = findEdgeExe();
    test.skip(!edge, 'msedge.exe 미탐지 — Edge 미설치 환경이므로 A39 를 명시적으로 SKIP 합니다');
    expect(fs.existsSync(BACKUP_PS1), 'backup_snapshot.ps1 이 없습니다: ' + BACKUP_PS1).toBe(true);

    const dialogs = [];
    const createdFiles = [];
    const markerCal = 'a39-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8) + '-calendar';
    const markerPost = markerCal.replace(/-calendar$/, '-postit');
    let markersPlanted = false;

    try {
      // ── 프로필 잠금 해제 후 마커 주입 + 디스크 반영 확인 (기존 키 불가침 — 별도 키 __a39_marker) ──
      await ensureOurEdgeClosed();
      markersPlanted = true;
      await plantMarkerVerified(PROFILE_CAL, markerCal, dialogs, '캘린더');
      await plantMarkerVerified(PROFILE_POST, markerPost, dialogs, '포스트잇');

      // ── 1회차 실행 ──
      const pre1 = listBackupFiles();
      runBackupOrThrow('1회차');
      const post1 = listBackupFiles();
      const new1 = post1.filter((n) => !pre1.includes(n));
      createdFiles.push(...new1);
      const c1 = classifyNew(new1);
      expect(
        c1.cal.length >= 1,
        `1회차 실행 후 backups\\ 에 캘린더 몫 타임스탬프 .json(calendar|cal + \\d{8}[-_]?\\d{6})이 새로 생기지 않았습니다 ` +
          `(신규 파일: ${new1.join(', ') || '(없음)'})`
      ).toBe(true);
      expect(
        c1.post.length >= 1,
        `1회차 실행 후 backups\\ 에 포스트잇 몫 타임스탬프 .json(postit + \\d{8}[-_]?\\d{6})이 새로 생기지 않았습니다 ` +
          `(신규 파일: ${new1.join(', ') || '(없음)'})`
      ).toBe(true);

      const contents1 = {};
      for (const [group, marker, label] of [[c1.cal, markerCal, '캘린더'], [c1.post, markerPost, '포스트잇']]) {
        let found = false;
        for (const name of group) {
          const raw = fs.readFileSync(path.join(BACKUP_DIR, name), 'utf8');
          contents1[name] = raw;
          let parsed = null;
          try {
            parsed = JSON.parse(raw);
          } catch (e) {
            throw new Error(`${label} 백업 파일 "${name}" 이 유효한 JSON 이 아닙니다: ` + e.message);
          }
          expect(
            parsed && typeof parsed === 'object',
            `${label} 백업 파일 "${name}" 의 최상위가 JSON 오브젝트가 아닙니다`
          ).toBe(true);
          if (raw.includes(marker)) found = true;
        }
        expect(
          found,
          `${label} 백업 파일(${group.join(', ')})에 사전 주입한 마커 값 "${marker}" 가 없습니다 — ` +
            '해당 프로필 localStorage 의 실제 덤프가 아닙니다 (빈/가짜 JSON 차단, 설계서 §6)'
        ).toBe(true);
      }

      // ── 2회차 실행: 새 파일 추가 + 1회차 파일 내용 불변 (미덮어쓰기) ──
      const pre2 = listBackupFiles();
      runBackupOrThrow('2회차');
      const post2 = listBackupFiles();
      const new2 = post2.filter((n) => !pre2.includes(n));
      createdFiles.push(...new2);
      const c2 = classifyNew(new2);
      expect(
        c2.cal.length >= 1 && c2.post.length >= 1,
        `2회차 실행에서 새 타임스탬프 파일이 추가되지 않았습니다 (신규: ${new2.join(', ') || '(없음)'}) — ` +
          '재실행은 기존 파일을 덮어쓰지 말고 새 파일을 추가해야 합니다'
      ).toBe(true);
      for (const name of Object.keys(contents1)) {
        const rawNow = fs.readFileSync(path.join(BACKUP_DIR, name), 'utf8');
        expect(
          rawNow === contents1[name],
          `2회차 실행이 1회차 백업 파일 "${name}" 의 내용을 변경했습니다 (기존 파일 미덮어쓰기 계약 위반)`
        ).toBe(true);
      }

      expect(
        dialogs,
        `A39 검사 중 dialog ${dialogs.length}건 발생 (0건이어야 함): ` + dialogs.map((d) => d.type + ':' + d.message).join(' | ')
      ).toHaveLength(0);
    } finally {
      // teardown: 채점기가 만든 백업 파일 + 마커 키만 제거 (사용자 기존 백업·프로필 데이터 불가침)
      for (const name of createdFiles) {
        try {
          fs.rmSync(path.join(BACKUP_DIR, name), { force: true });
        } catch (e) {
          /* 정리 실패는 판정에 영향 없음 */
        }
      }
      if (markersPlanted) {
        try {
          await ensureOurEdgeClosed();
          for (const dir of [PROFILE_CAL, PROFILE_POST]) {
            await withProfile(dir, (p) => p.evaluate((k) => localStorage.removeItem(k), MARKER_KEY), null);
          }
          await ensureOurEdgeClosed();
        } catch (e) {
          /* 마커 잔존은 앱 동작과 무관한 __a39_marker 키 — 다음 실행에서 재정리 */
        }
      }
    }
  });
});
