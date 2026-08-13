'use strict';
/**
 * A16 — 바탕화면 바로가기 검증 (SCORECARD A16)
 *
 * 절차:
 *  1) powershell -File 로 make_shortcuts.ps1 실행 (exit 0 이어야 함).
 *  2) [Environment]::GetFolderPath('Desktop') 의 *.lnk 전체를 WScript.Shell COM
 *     (PowerShell 경유)으로 해석해 TargetPath / Arguments / WorkingDirectory 를 수집.
 *  3) TargetPath 또는 Arguments 가 D:\custom_program 을 참조하는 바로가기가 1개 이상 존재하고,
 *     각각에 대해:
 *       - TargetPath 가 실존 파일 (wscript.exe 등)
 *       - Arguments(또는 TargetPath)에서 추출한 스크립트 경로가 실존하는 launch 스크립트
 *  4) 정리 없음 — 바탕화면 .lnk 는 제품 산출물이자 사용자 파일이므로 어떤 파일도 삭제하지 않는다.
 *
 * SKIP: Windows 외 플랫폼, 바탕화면 폴더 접근 불가 환경은 명시적 SKIP.
 * 브라우저를 열지 않으므로 dialog 감시 대상 페이지가 없다 (공통 규정의 dialog 0건은 자명하게 충족).
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { test, expect } = require('@playwright/test');
const { APP_ROOT } = require('../lib/helpers');

const MAKE_SHORTCUTS_PS1 = path.join(APP_ROOT, 'make_shortcuts.ps1');
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

// 바탕화면 경로 + 모든 .lnk 를 WScript.Shell COM 으로 해석해 JSON 으로 반환
const PS_RESOLVE_LINKS = String.raw`
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$desktop = [Environment]::GetFolderPath('Desktop')
$exists = (-not [string]::IsNullOrEmpty($desktop)) -and (Test-Path -LiteralPath $desktop)
$links = @()
if ($exists) {
  $wsh = New-Object -ComObject WScript.Shell
  $links = @(Get-ChildItem -LiteralPath $desktop -Filter *.lnk -File -ErrorAction SilentlyContinue | ForEach-Object {
    $s = $wsh.CreateShortcut($_.FullName)
    [pscustomobject]@{
      Path = $_.FullName
      TargetPath = $s.TargetPath
      Arguments = $s.Arguments
      WorkingDirectory = $s.WorkingDirectory
    }
  })
}
ConvertTo-Json -InputObject ([pscustomobject]@{ desktop = $desktop; exists = [bool]$exists; links = $links }) -Depth 4 -Compress
`;

function resolveDesktopLinks() {
  let out = '';
  try {
    out = runPowerShell(['-Command', PS_RESOLVE_LINKS]);
  } catch (e) {
    throw new Error('바탕화면 .lnk 해석(PowerShell WScript.Shell COM) 실패: ' + (e && e.message));
  }
  const text = String(out).replace(/^\uFEFF/, '').trim();
  let j;
  try {
    j = JSON.parse(text);
  } catch (e) {
    throw new Error('바탕화면 .lnk 해석 결과 JSON 파싱 실패: ' + text.slice(0, 300));
  }
  let links = j.links || [];
  if (!Array.isArray(links)) links = [links];
  return { desktop: j.desktop, exists: !!j.exists, links };
}

/** Arguments(따옴표 경로 우선) 또는 TargetPath 에서 스크립트 파일 경로 추출 */
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

test.describe('A16 바탕화면 바로가기', () => {
  test('A16: make_shortcuts.ps1 실행 후 .lnk 가 실존 launch 스크립트를 가리킴', async () => {
    test.skip(process.platform !== 'win32', 'Windows 전용 항목 — A16 을 명시적으로 SKIP 합니다');
    expect(fs.existsSync(MAKE_SHORTCUTS_PS1), 'make_shortcuts.ps1 이 없습니다: ' + MAKE_SHORTCUTS_PS1).toBe(true);

    const before = resolveDesktopLinks();
    test.skip(
      !before.exists,
      `바탕화면 폴더 접근 불가(GetFolderPath 결과: "${before.desktop}") — A16 을 명시적으로 SKIP 합니다`
    );

    // 1) make_shortcuts.ps1 실행 (실패 시 exit code + stderr 포함 한국어 메시지)
    try {
      runPowerShell(['-File', MAKE_SHORTCUTS_PS1]);
    } catch (e) {
      throw new Error(
        'make_shortcuts.ps1 실행 실패 (exit code ' +
          (e && e.status) +
          '): ' +
          String((e && e.stderr) || (e && e.message) || '').slice(0, 500)
      );
    }

    // 2) 바탕화면 .lnk 전수 해석
    const after = resolveDesktopLinks();
    const ours = after.links.filter((l) =>
      /custom_program/i.test(`${l.TargetPath || ''} ${l.Arguments || ''}`)
    );

    expect(
      ours.length,
      `make_shortcuts.ps1 실행 후 바탕화면(${after.desktop})에 D:\\custom_program 을 가리키는 .lnk 가 없습니다 ` +
        `(바탕화면 전체 .lnk ${after.links.length}개)`
    ).toBeGreaterThanOrEqual(1);

    // 3) 각 바로가기: TargetPath 실존 + Arguments/TargetPath 의 launch 스크립트 실존
    for (const l of ours) {
      const name = path.basename(String(l.Path || ''));

      expect(
        Boolean(l.TargetPath && fs.existsSync(l.TargetPath)),
        `바로가기 "${name}" 의 TargetPath 가 실존하지 않습니다: "${l.TargetPath}"`
      ).toBe(true);

      const script = extractScriptPath(l);
      expect(
        script,
        `바로가기 "${name}" 의 TargetPath/Arguments 에서 launch 스크립트 경로를 찾지 못했습니다 ` +
          `(TargetPath="${l.TargetPath}", Arguments="${l.Arguments}")`
      ).toBeTruthy();
      expect(
        Boolean(script && fs.existsSync(script)),
        `바로가기 "${name}" 가 실존하지 않는 스크립트를 가리킵니다: "${script}"`
      ).toBe(true);
      expect(
        /launch/i.test(path.basename(String(script))),
        `바로가기 "${name}" 대상이 launch 스크립트가 아닙니다: "${script}"`
      ).toBe(true);
    }

    // 4) 정리 없음: 바탕화면 .lnk 는 사용자 파일 — 삭제하지 않는다.
  });
});
