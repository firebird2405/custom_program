# backup_snapshot.ps1
# 두 앱(캘린더·포스트잇 월)의 데이터(localStorage)를 파일로 백업합니다.
#
# 동작:
#   - 각 앱 전용 Edge 프로필(D:\custom_program\.edge\calendar, .edge\postit)을
#     헤드리스 Edge 로 열어 localStorage 전체를 JSON 으로 덤프합니다.
#   - 결과는 D:\custom_program\backups\ 아래에 타임스탬프 파일로 저장됩니다.
#       backups\calendar-YYYYMMDD-HHMMSS.json
#       backups\postit-YYYYMMDD-HHMMSS.json
#   - 기존 백업 파일은 절대 덮어쓰거나 삭제하지 않습니다 (항상 새 파일 추가).
#
# 주의: 앱 창이 열려 있으면 프로필이 잠겨 덤프가 실패할 수 있습니다.
#       백업은 앱을 닫은 상태에서 실행하세요.
#
# 실행 방법:
#   powershell -ExecutionPolicy Bypass -File D:\custom_program\backup_snapshot.ps1

$ErrorActionPreference = "Stop"

$base      = "D:\custom_program"
$backupDir = Join-Path $base "backups"

# ---------- Edge 실행 파일 찾기 (launch_*.vbs 와 동일한 순서) ----------
$edge = $null
$candidates = @(
    "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
    "C:\Program Files\Microsoft\Edge\Application\msedge.exe",
    (Join-Path $env:LOCALAPPDATA "Microsoft\Edge\Application\msedge.exe")
)
foreach ($c in $candidates) {
    if (Test-Path -LiteralPath $c) { $edge = $c; break }
}
if ($null -eq $edge) {
    Write-Host "Microsoft Edge 를 찾을 수 없어 백업할 수 없습니다."
    exit 1
}

# ---------- localStorage 덤프용 임시 페이지 ----------
# file:// 페이지는 같은 프로필 안에서 localStorage 를 공유하므로,
# 임시 HTML 을 headless --dump-dom 으로 열어 전체 키를 base64(JSON) 로 찍어낸다.
# (앱 파일이나 저장 데이터는 일절 수정하지 않는 읽기 전용 절차)
$dumperHtml = @'
<!doctype html>
<html><head><meta charset="utf-8"><title>backup dump</title></head>
<body><pre id="out"></pre>
<script>
(function () {
  var obj = {};
  try {
    for (var i = 0; i < localStorage.length; i++) {
      var k = localStorage.key(i);
      obj[k] = localStorage.getItem(k);
    }
  } catch (e) {}
  var json = JSON.stringify(obj);
  var b64 = btoa(unescape(encodeURIComponent(json)));
  document.getElementById("out").textContent = "@@B64START@@" + b64 + "@@B64END@@";
})();
</script>
</body></html>
'@

# Edge 자식 프로세스(crashpad 등)가 리다이렉트 파일 핸들을 계속 쥐고 있어도
# 읽을 수 있도록 FileShare.ReadWrite 로 연다.
function Read-AllTextShared {
    param([string]$Path)
    $fs = New-Object System.IO.FileStream($Path,
        [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::ReadWrite)
    try {
        $sr = New-Object System.IO.StreamReader($fs, [System.Text.Encoding]::UTF8)
        try { return $sr.ReadToEnd() } finally { $sr.Dispose() }
    } finally {
        $fs.Dispose()
    }
}

function Get-LocalStorageJson {
    param(
        [string]$EdgePath,
        [string]$ProfileDir,
        [string]$DumpUrl,
        [string]$AppLabel
    )
    $token   = [Guid]::NewGuid().ToString("N")
    $outFile = Join-Path $env:TEMP ("edge-dump-out-" + $token + ".txt")
    $errFile = Join-Path $env:TEMP ("edge-dump-err-" + $token + ".txt")
    $argLine = "--headless --disable-gpu --no-first-run --no-default-browser-check " +
               "--user-data-dir=""$ProfileDir"" --dump-dom ""$DumpUrl"""
    $proc = Start-Process -FilePath $EdgePath -ArgumentList $argLine `
        -RedirectStandardOutput $outFile -RedirectStandardError $errFile `
        -WindowStyle Hidden -PassThru
    try {
        Wait-Process -Id $proc.Id -Timeout 45 -ErrorAction Stop
    } catch {
        try { Stop-Process -Id $proc.Id -Force -ErrorAction Stop } catch {}
        try { Remove-Item -LiteralPath $outFile, $errFile -Force -ErrorAction Stop } catch {}
        throw "$AppLabel 프로필 덤프가 45초 안에 끝나지 않았습니다. 앱 창을 모두 닫고 다시 시도하세요."
    }
    # 본 프로세스 종료 후에도 출력 플러시가 늦을 수 있어 최대 10초까지 재시도한다.
    $m = $null
    for ($try = 0; $try -lt 20; $try++) {
        $dom = ""
        try { $dom = Read-AllTextShared -Path $outFile } catch {}
        $m = [regex]::Match([string]$dom, "@@B64START@@([A-Za-z0-9+/=]*)@@B64END@@")
        if ($m.Success) { break }
        Start-Sleep -Milliseconds 500
    }
    try { Remove-Item -LiteralPath $outFile, $errFile -Force -ErrorAction Stop } catch {}
    if (($null -eq $m) -or (-not $m.Success)) {
        throw "$AppLabel 프로필에서 데이터를 읽지 못했습니다. 앱 창을 모두 닫고 다시 시도하세요."
    }
    $json = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($m.Groups[1].Value))
    $null = ConvertFrom-Json $json   # 유효 JSON 검증 (실패 시 예외)
    return $json
}

$dumperPath = $null
try {
    # 백업 폴더 준비 (기존 파일은 손대지 않음)
    if (-not (Test-Path -LiteralPath $backupDir)) {
        $null = New-Item -ItemType Directory -Path $backupDir -Force
    }

    # 임시 덤프 페이지 생성 (ASCII 전용 내용)
    $dumperPath = Join-Path $env:TEMP ("backup-dumper-" + [Guid]::NewGuid().ToString("N") + ".html")
    Set-Content -LiteralPath $dumperPath -Value $dumperHtml -Encoding Ascii
    $dumpUrl = "file:///" + $dumperPath.Replace("\", "/")

    # 두 프로필 덤프
    $calJson  = Get-LocalStorageJson -EdgePath $edge -ProfileDir (Join-Path $base ".edge\calendar") -DumpUrl $dumpUrl -AppLabel "캘린더"
    $postJson = Get-LocalStorageJson -EdgePath $edge -ProfileDir (Join-Path $base ".edge\postit")   -DumpUrl $dumpUrl -AppLabel "포스트잇"

    # 타임스탬프 파일명 확정 — 이미 존재하면 1초 기다려 새 이름을 만든다 (덮어쓰기 금지)
    while ($true) {
        $ts       = Get-Date -Format "yyyyMMdd-HHmmss"
        $calDest  = Join-Path $backupDir ("calendar-" + $ts + ".json")
        $postDest = Join-Path $backupDir ("postit-"   + $ts + ".json")
        if ((Test-Path -LiteralPath $calDest) -or (Test-Path -LiteralPath $postDest)) {
            Start-Sleep -Seconds 1
        } else {
            break
        }
    }

    # BOM 없는 UTF-8 로 저장 (JSON 파서 호환)
    $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($calDest,  $calJson,  $utf8NoBom)
    [System.IO.File]::WriteAllText($postDest, $postJson, $utf8NoBom)

    Write-Host "백업 완료:"
    Write-Host "  $calDest"
    Write-Host "  $postDest"
    exit 0
} catch {
    Write-Host "백업 실패: $($_.Exception.Message)"
    exit 1
} finally {
    if ($dumperPath -and (Test-Path -LiteralPath $dumperPath)) {
        try { Remove-Item -LiteralPath $dumperPath -Force -ErrorAction Stop } catch {}
    }
}
