'use strict';
/**
 * A38 — 자동 시작 (rev.5 설계서 §1 A38 / §2 A38)
 * "install_startup.ps1 실행(exit 0) → 시작프로그램 폴더([Environment]::GetFolderPath('Startup'))에
 *  `캘린더.lnk` 와 `포스트잇 월.lnk` 가 존재하고 각각 WScript.Shell 해석 결과가 실존하는 launch
 *  스크립트를 가리킴 → uninstall_startup.ps1 실행 → 정확히 그 두 .lnk 만 제거된다
 *  (전후 스냅샷 차집합 = 두 파일, 타 .lnk 불변)"
 *
 * ── 파일 계약 (설계서 §2 A38 — 그대로 기록) ──
 * .lnk 이름 고정: "캘린더.lnk", "포스트잇 월.lnk". uninstall 은 그 두 이름만 제거.
 * a16 의 PowerShell 패턴 재사용: System32 절대 경로 powershell(-NoProfile -NonInteractive
 * -ExecutionPolicy Bypass), WScript.Shell COM 해석. Startup 폴더 접근 불가/비 Windows → 명시적 SKIP.
 *
 * 부작용·원상복구 (설계서 §7-2 + 발주 지시): 본 테스트는 사용자 시작프로그램 폴더를 실제로
 * 변경한다. 시작 전 폴더 상태(두 .lnk 의 사전 존재 여부 포함)를 스냅샷하고,
 * install→검증→uninstall→검증 왕복 후 사전에 설치되어 있던 경우 install 을 재실행해 원상복구한다.
 * finally 블록에서도 "사전 상태와 동일" 을 목표로 복구를 시도한다 (사용자 자동 시작 설정 보존).
 * 브라우저를 열지 않으므로 dialog 0건은 자명하게 충족.
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { test, expect } = require('@playwright/test');
const { APP_ROOT } = require('../lib/helpers');

const INSTALL_PS1 = path.join(APP_ROOT, 'install_startup.ps1');
const UNINSTALL_PS1 = path.join(APP_ROOT, 'uninstall_startup.ps1');
const LNK_NAMES = ['캘린더.lnk', '포스트잇 월.lnk'];
const SCRIPT_EXT_RE = /\.(vbs|cmd|bat|ps1|js|wsf)$/i;
// PATH 섀도잉 차단 — powershell 은 항상 System32 절대 경로로 실행 (SCORECARD B 실행 환경 후킹 금지)
const POWERSHELL_EXE = path.join(
  process.env.SystemRoot || 'C:\\Windows',
  'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'
);

function runPowerShell(args, timeoutMs = 60000) {
  return execFileSync(POWERSHELL_EXE, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass'].concat(args), {
    encoding: 'utf8',
    timeout: timeoutMs,
    windowsHide: true,
  });
}

function runPs1OrThrow(script, label) {
  try {
    runPowerShell(['-File', script], 90000);
  } catch (e) {
    throw new Error(
      `${label} 실행 실패 (exit code ${e && e.status}): ` +
        String((e && e.stderr) || (e && e.stdout) || (e && e.message) || '').slice(0, 500)
    );
  }
}

// 시작프로그램 폴더 전체 파일명 스냅샷 + 두 .lnk 의 WScript.Shell 해석 결과
const PS_SNAPSHOT = String.raw`
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$startup = [Environment]::GetFolderPath('Startup')
$exists = (-not [string]::IsNullOrEmpty($startup)) -and (Test-Path -LiteralPath $startup)
$files = @()
$links = @()
if ($exists) {
  $files = @(Get-ChildItem -LiteralPath $startup -File -ErrorAction SilentlyContinue | ForEach-Object { $_.Name })
  $wsh = New-Object -ComObject WScript.Shell
  foreach ($name in @('캘린더.lnk', '포스트잇 월.lnk')) {
    $p = Join-Path $startup $name
    if (Test-Path -LiteralPath $p) {
      $s = $wsh.CreateShortcut($p)
      $links += [pscustomobject]@{ Name = $name; TargetPath = $s.TargetPath; Arguments = $s.Arguments }
    }
  }
}
ConvertTo-Json -InputObject ([pscustomobject]@{ startup = $startup; exists = [bool]$exists; files = $files; links = $links }) -Depth 4 -Compress
`;

function snapshot() {
  let out = '';
  try {
    out = runPowerShell(['-Command', PS_SNAPSHOT]);
  } catch (e) {
    throw new Error('시작프로그램 폴더 스냅샷(PowerShell) 실패: ' + (e && e.message));
  }
  const text = String(out).replace(/^\uFEFF/, '').trim();
  let j;
  try {
    j = JSON.parse(text);
  } catch (e) {
    throw new Error('시작프로그램 스냅샷 JSON 파싱 실패: ' + text.slice(0, 300));
  }
  let files = j.files || [];
  if (!Array.isArray(files)) files = [files];
  let links = j.links || [];
  if (!Array.isArray(links)) links = [links];
  return { startup: j.startup, exists: !!j.exists, files, links };
}

/** Arguments(따옴표 경로 우선) 또는 TargetPath 에서 스크립트 파일 경로 추출 (a16 동형) */
function extractScriptPath(link) {
  const args = String(link.Arguments || '');
  const target = String(link.TargetPath || '');
  const quoted = args.match(/"([^"]+)"/g) || [];
  for (const q of quoted) {
    const p = q.slice(1, -1);
    if (SCRIPT_EXT_RE.test(p)) return p;
  }
  for (const tok of args.split(/\s+/)) {
    const p = tok.replace(/^"+|"+$/g, '');
    if (p && SCRIPT_EXT_RE.test(p)) return p;
  }
  if (SCRIPT_EXT_RE.test(target)) return target;
  return null;
}

function setDiff(a, b) {
  const sb = new Set(b);
  return a.filter((x) => !sb.has(x));
}

test.describe('A38 자동 시작', () => {
  test('A38: install → 두 .lnk 검증 → uninstall → 차집합 = 정확히 두 파일 + 원상복구', async () => {
    test.setTimeout(120 * 1000);
    test.skip(process.platform !== 'win32', 'Windows 전용 항목 — A38 을 명시적으로 SKIP 합니다');
    expect(fs.existsSync(INSTALL_PS1), 'install_startup.ps1 이 없습니다: ' + INSTALL_PS1).toBe(true);
    expect(fs.existsSync(UNINSTALL_PS1), 'uninstall_startup.ps1 이 없습니다: ' + UNINSTALL_PS1).toBe(true);

    const pre = snapshot();
    test.skip(
      !pre.exists,
      `시작프로그램 폴더 접근 불가(GetFolderPath 결과: "${pre.startup}") — A38 을 명시적으로 SKIP 합니다`
    );
    const preHadOurs = LNK_NAMES.some((n) => pre.files.includes(n));

    try {
      // ── 1) install 실행 (exit 0) ──
      runPs1OrThrow(INSTALL_PS1, 'install_startup.ps1');

      // ── 2) 두 .lnk 존재 + WScript.Shell 해석 → 실존 launch 스크립트 ──
      const postInstall = snapshot();
      for (const name of LNK_NAMES) {
        expect(
          postInstall.files.includes(name),
          `install_startup.ps1 실행 후 시작프로그램 폴더(${postInstall.startup})에 "${name}" 가 없습니다`
        ).toBe(true);
        const link = postInstall.links.find((l) => l.Name === name);
        expect(link, `"${name}" 의 WScript.Shell 해석 결과를 얻지 못했습니다`).toBeTruthy();
        expect(
          Boolean(link.TargetPath && fs.existsSync(link.TargetPath)),
          `"${name}" 의 TargetPath 가 실존하지 않습니다: "${link.TargetPath}"`
        ).toBe(true);
        const script = extractScriptPath(link);
        expect(
          script,
          `"${name}" 의 TargetPath/Arguments 에서 launch 스크립트 경로를 찾지 못했습니다 ` +
            `(TargetPath="${link.TargetPath}", Arguments="${link.Arguments}")`
        ).toBeTruthy();
        expect(
          Boolean(script && fs.existsSync(script)),
          `"${name}" 가 실존하지 않는 스크립트를 가리킵니다: "${script}"`
        ).toBe(true);
        expect(
          /launch/i.test(path.basename(String(script))),
          `"${name}" 대상이 launch 스크립트가 아닙니다: "${script}"`
        ).toBe(true);
      }

      // install 이 두 .lnk 외 다른 파일을 만들거나 지우지 않았는지 (범위 제한 — 설계서 §4-4)
      const created = setDiff(postInstall.files, pre.files);
      expect(
        created.every((n) => LNK_NAMES.includes(n)),
        `install_startup.ps1 이 계약 밖 파일을 생성했습니다: ${created.filter((n) => !LNK_NAMES.includes(n)).join(', ')}`
      ).toBe(true);
      const removedByInstall = setDiff(pre.files, postInstall.files);
      expect(
        removedByInstall.length === 0,
        `install_startup.ps1 이 기존 파일을 제거했습니다: ${removedByInstall.join(', ')}`
      ).toBe(true);

      // ── 3) uninstall 실행 (exit 0) → 정확히 그 두 .lnk 만 제거 ──
      runPs1OrThrow(UNINSTALL_PS1, 'uninstall_startup.ps1');
      const postUninstall = snapshot();
      const removed = setDiff(postInstall.files, postUninstall.files).sort();
      expect(
        removed.join('|'),
        `uninstall_startup.ps1 전후 스냅샷 차집합이 정확히 두 파일("${LNK_NAMES.join('", "')}")이 아닙니다 ` +
          `(실제 제거된 파일: ${removed.join(', ') || '(없음)'}) — 타 .lnk 불변 계약 위반 또는 미제거`
      ).toBe(LNK_NAMES.slice().sort().join('|'));
      const appeared = setDiff(postUninstall.files, postInstall.files);
      expect(
        appeared.length === 0,
        `uninstall_startup.ps1 실행 후 새 파일이 생겼습니다: ${appeared.join(', ')}`
      ).toBe(true);

      // ── 4) 원상복구: 사전에 자동 시작이 설치돼 있었으면 install 재실행 ──
      if (preHadOurs) {
        runPs1OrThrow(INSTALL_PS1, 'install_startup.ps1(원상복구)');
        const restored = snapshot();
        for (const name of LNK_NAMES) {
          expect(
            restored.files.includes(name),
            `원상복구 install 재실행 후 "${name}" 가 시작프로그램 폴더에 없습니다`
          ).toBe(true);
        }
      }
    } finally {
      // 사전 상태와 동일하게 복구 시도 (베스트에포트 — 사용자 자동 시작 설정 보존)
      try {
        const now = snapshot();
        const hasOurs = LNK_NAMES.some((n) => now.files.includes(n));
        if (preHadOurs && !hasOurs) runPowerShell(['-File', INSTALL_PS1], 90000);
        else if (!preHadOurs && hasOurs) runPowerShell(['-File', UNINSTALL_PS1], 90000);
      } catch (e) {
        /* 복구 실패는 테스트 판정에 영향 없음 — 다음 실행에서 재정렬 */
      }
    }
  });
});
