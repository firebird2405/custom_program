<#
  make_dist.ps1 — 쁘띠캘린더(PetitCalendar) 지인 배포판 생성기
  ---------------------------------------------------------------------------
  목적: G0 지인 검증용 포터블 배포 패키지를 한 명령으로 만든다.
        제품의 정본은 Electron 패키지(electron\dist\win-unpacked)이므로
        그 폴더를 "읽어주세요.txt"와 함께 ZIP 한 개로 포장한다.

  산출물: dist_out\PetitCalendar-<버전>-portable.zip
          (ZIP 최상위는 PetitCalendar-<버전>\ 폴더 하나 — 풀어도 흩어지지 않는다)

  절차:
    1) electron\dist\win-unpacked 존재 확인 (없으면 빌드 명령 안내 후 중단)
    2) 개인 데이터 블랙리스트 검사 (하나라도 있으면 중단)
    3) 스테이징 -> 읽어주세요.txt 동봉
    4) Compress-Archive 로 ZIP 생성
    5) 생성된 ZIP 안을 다시 검사(엔트리 경로 블랙리스트 + 실행 파일 존재)
    6) 크기 - SHA256 출력

  블랙리스트 기준은 채점기 A46(protocol\grader\tests\a46-artifact.spec.js)의
  계약 주석과 동일하게 맞췄다 — backups / .edge / protocol / .git /
  Local Storage / IndexedDB / Session Storage / *.log / *.ldb / *.sqlite /
  window-state.json (+ 배포판 전용으로 shell-settings.json 추가).
  ※ *.asar 내부 경로 검사는 채점기 A46이 담당한다(이 스크립트는 파일 트리 + ZIP 엔트리).

  실행:
    powershell -ExecutionPolicy Bypass -File D:\custom_program\make_dist.ps1
  옵션:
    -Contact "이메일 또는 오픈채팅 링크"   읽어주세요.txt 문의처 자리를 채운다
    -OutDir  "D:\어딘가"                   산출 폴더 변경 (기본 .\dist_out)
    -KeepStage                             스테이징 폴더를 지우지 않는다(디버그)

  PowerShell 5.1 호환 (&&, 삼항, ?? 미사용). 파일 인코딩 UTF-8 BOM.
#>
[CmdletBinding()]
param(
    [string]$OutDir  = '',
    [string]$Contact = '',
    [switch]$KeepStage
)

$ErrorActionPreference = 'Stop'
$ProgressPreference    = 'SilentlyContinue'   # Compress-Archive 진행률 오버헤드 제거

# ── 출력 헬퍼 ───────────────────────────────────────────────────────────────
function Write-Step { param([string]$Text) Write-Host ''; Write-Host ('> ' + $Text) -ForegroundColor Cyan }
function Write-Ok   { param([string]$Text) Write-Host ('  OK   ' + $Text) -ForegroundColor Green }
function Write-Warn { param([string]$Text) Write-Host ('  주의 ' + $Text) -ForegroundColor Yellow }
function Write-Info { param([string]$Text) Write-Host ('       ' + $Text) -ForegroundColor Gray }

function Stop-WithMessage {
    param([string[]]$Lines)
    Write-Host ''
    Write-Host '============================================================' -ForegroundColor Red
    foreach ($l in $Lines) { Write-Host $l -ForegroundColor Red }
    Write-Host '============================================================' -ForegroundColor Red
    exit 1
}

# ── 개인 데이터 블랙리스트 (A46 계약과 동일 + shell-settings.json) ──────────
$BlacklistDirNames  = @('backups', '.edge', 'protocol', '.git',
                        'local storage', 'indexeddb', 'session storage')
$BlacklistFileNames = @('window-state.json', 'shell-settings.json')
$BlacklistPatterns  = @('*.log', '*.ldb', '*.sqlite')

function Get-BlacklistViolation {
    param([string]$RelPath)
    $segs = @($RelPath -split '[\\/]+' | Where-Object { $_ -ne '' })
    if ($segs.Count -eq 0) { return $null }
    $base = $segs[$segs.Count - 1]
    if ($segs.Count -gt 1) {
        foreach ($seg in $segs[0..($segs.Count - 2)]) {
            if ($BlacklistDirNames -contains $seg) { return ('금지 디렉터리 세그먼트 "{0}"' -f $seg) }
        }
    }
    if ($BlacklistDirNames  -contains $base) { return ('금지 이름 "{0}"' -f $base) }
    if ($BlacklistFileNames -contains $base) { return ('실사용 저장 데이터 파일 "{0}"' -f $base) }
    foreach ($pat in $BlacklistPatterns) {
        if ($base -like $pat) { return ('금지 확장자 파일 "{0}" ({1})' -f $base, $pat) }
    }
    return $null
}

function Get-TreeViolations {
    param([string]$Root, [string]$Label)
    $rootFull = (Resolve-Path -LiteralPath $Root).ProviderPath.TrimEnd('\')
    $found    = @()
    $count    = 0
    foreach ($item in (Get-ChildItem -LiteralPath $rootFull -Recurse -Force)) {
        $count++
        $rel = $item.FullName.Substring($rootFull.Length).TrimStart('\')
        $v = Get-BlacklistViolation -RelPath $rel
        if ($v) { $found += ('{0}: {1} — {2}' -f $Label, $rel, $v) }
    }
    Write-Info ('{0} — 항목 {1}개 검사' -f $Label, $count)
    return $found
}

# ── 읽어주세요.txt 본문 (해요체) ────────────────────────────────────────────
$ReadmeTemplate = @'
쁘띠캘린더 (PetitCalendar) {VERSION} — 지인 검증판
만든 날짜: {DATE}
==============================================================

먼저 써 봐 주셔서 고마워요.
설치가 필요 없는 "포터블" 판이에요. 레지스트리에 아무것도 쓰지 않고,
시작프로그램에도 등록하지 않아요.


[ 실행 방법 ]
--------------------------------------------------------------
1. 이 ZIP을 원하는 곳(예: 바탕화면, 문서 폴더)에 먼저 "압축 풀기" 해 주세요.
   ※ 압축을 풀지 않고 ZIP 안에서 바로 실행하면 제대로 동작하지 않아요.
2. 풀린 폴더 안의  PetitCalendar.exe  를 더블클릭하면 열려요.
3. "Windows의 PC 보호" 파란 창이 뜰 수 있어요. 아직 코드 서명을 넣지 않아서
   그런 것이니, [추가 정보] -> [실행] 을 눌러 주세요.
4. 창 하나에 [캘린더] / [포스트잇 월] 두 탭이 있어요. 탭을 오가도 쓰던 내용은
   그대로 남아 있어요.


[ 이런 앱이에요 ]
--------------------------------------------------------------
- 무료예요. 광고도 없고, 결제 유도도 없어요.
- 회원가입도 로그인도 없어요.
- 인터넷을 아예 쓰지 않아요. 랜선을 뽑아도 똑같이 동작해요.
  (일정이나 메모가 밖으로 나가는 일이 없어요.)


[ 데이터는 어디에 저장되나요 ]
--------------------------------------------------------------
- 일정과 포스트잇은 이 PC 안에만 저장돼요. 저장 위치는 아래 폴더예요.

      %APPDATA%\쁘띠캘린더

  탐색기 주소창에 위 경로를 그대로 붙여넣고 Enter를 누르면 열려요.
- 프로그램 폴더를 다른 곳으로 옮겨도 저장된 내용은 그대로 남아 있어요.
- 중요한 내용은 앱 안의 [내보내기] 로 파일 백업을 해 두시면 안심이에요.
  다른 PC로 옮길 때도 [내보내기] -> [가져오기] 를 쓰시면 돼요.


[ 지우는 방법 ]
--------------------------------------------------------------
1. 앱을 완전히 닫아 주세요.
2. 압축을 푼 폴더(PetitCalendar-{VERSION})를 통째로 삭제하면 프로그램이 지워져요.
3. 저장된 일정과 포스트잇까지 남김없이 지우시려면
   %APPDATA%\쁘띠캘린더 폴더도 함께 삭제해 주세요.
   ※ 이 폴더를 지우면 되돌릴 수 없어요. 필요하면 먼저 [내보내기] 로
      백업해 두시길 권해요.


[ 문의 - 피드백 ]
--------------------------------------------------------------
- 불편한 점, 이상한 점, "이건 이랬으면 좋겠다" 무엇이든 알려주시면 큰 도움이 돼요.

      문의처: {CONTACT}

- 알려주실 때 아래를 함께 적어주시면 원인을 찾기 쉬워요.
  - 무엇을 하다가 생겼는지 (예: 포스트잇을 옮기다가)
  - Windows 버전 (설정 -> 시스템 -> 정보)
  - 버전: {VERSION}

편하게 써 보시고, 솔직하게 알려주세요. 고맙습니다.
'@

# ── 0) 경로 확정 ────────────────────────────────────────────────────────────
$RepoRoot = $PSScriptRoot
if (-not $RepoRoot) { $RepoRoot = (Get-Location).ProviderPath }
$Unpacked = Join-Path $RepoRoot 'electron\dist\win-unpacked'
$PkgJson  = Join-Path $RepoRoot 'electron\package.json'
if ([string]::IsNullOrWhiteSpace($OutDir))  { $OutDir  = Join-Path $RepoRoot 'dist_out' }
if ([string]::IsNullOrWhiteSpace($Contact)) { $Contact = '(여기에 이메일 또는 오픈채팅 링크를 적어주세요)' }

Write-Host ''
Write-Host '쁘띠캘린더 지인 배포판 생성 (make_dist.ps1)' -ForegroundColor White
Write-Host ('저장소: ' + $RepoRoot) -ForegroundColor Gray

# ── 1) Electron 패키지 존재 확인 ────────────────────────────────────────────
Write-Step '1/6  Electron 패키지 확인'
if (-not (Test-Path -LiteralPath $Unpacked -PathType Container)) {
    Stop-WithMessage @(
        '[중단] Electron 패키지 폴더가 없어요.',
        ('  없는 경로: ' + $Unpacked),
        '',
        '  먼저 아래 순서로 빌드해 주세요 (PowerShell 5.1 기준, 줄마다 따로 실행).',
        ('    cd ' + (Join-Path $RepoRoot 'electron')),
        '    npm ci          # 최초 1회 — electron\node_modules 가 없을 때만',
        '    npm run dist    # electron-builder --dir -> electron\dist\win-unpacked',
        '',
        '  빌드가 끝나면 이 스크립트를 다시 실행해 주세요.'
    )
}
$ExeSource = Join-Path $Unpacked 'PetitCalendar.exe'
if (-not (Test-Path -LiteralPath $ExeSource -PathType Leaf)) {
    Stop-WithMessage @(
        '[중단] 패키지 폴더는 있는데 실행 파일이 없어요 (빌드가 중간에 끊긴 상태).',
        ('  없는 파일: ' + $ExeSource),
        '',
        '  아래로 다시 빌드해 주세요.',
        ('    cd ' + (Join-Path $RepoRoot 'electron')),
        '    npm run dist'
    )
}
Write-Ok ('패키지 폴더 확인: ' + $Unpacked)

# 버전 읽기
if (-not (Test-Path -LiteralPath $PkgJson -PathType Leaf)) {
    Stop-WithMessage @('[중단] 버전을 읽을 electron\package.json 이 없어요.', ('  없는 파일: ' + $PkgJson))
}
$pkg = (Get-Content -LiteralPath $PkgJson -Raw -Encoding UTF8 | ConvertFrom-Json)
$Version = [string]$pkg.version
if ([string]::IsNullOrWhiteSpace($Version)) {
    Stop-WithMessage @('[중단] electron\package.json 에서 version 을 읽지 못했어요.')
}
Write-Ok ('버전: ' + $Version)

# 패키지 최신성 (경고만) — 저장소 원본 HTML과 패키지 안 HTML 비교
foreach ($name in @('calendar.html', 'postit.html')) {
    $srcHtml = Join-Path $RepoRoot $name
    $pkgHtml = Join-Path $Unpacked ('resources\' + $name)
    if ((Test-Path -LiteralPath $srcHtml -PathType Leaf) -and (Test-Path -LiteralPath $pkgHtml -PathType Leaf)) {
        $h1 = (Get-FileHash -LiteralPath $srcHtml -Algorithm SHA256).Hash
        $h2 = (Get-FileHash -LiteralPath $pkgHtml -Algorithm SHA256).Hash
        if ($h1 -ne $h2) {
            Write-Warn ($name + ' 이 패키지보다 새로워요 — 지금 포장하면 이전 빌드가 나가요.')
            Write-Info '최신 내용으로 배포하려면 electron 폴더에서 npm run dist 로 다시 빌드한 뒤 실행해 주세요.'
        }
    }
}

# ── 2) 개인 데이터 블랙리스트 검사 ──────────────────────────────────────────
Write-Step '2/6  개인 데이터 블랙리스트 검사 (패키지 트리)'
$violations = @(Get-TreeViolations -Root $Unpacked -Label 'win-unpacked')
if ($violations.Count -gt 0) {
    $lines = @('[중단] 배포하면 안 되는 개인 데이터가 패키지 안에서 발견됐어요.', '')
    foreach ($v in $violations) { $lines += ('  - ' + $v) }
    $lines += @(
        '',
        '  electron\electron-builder.yml 의 files/extraResources 화이트리스트를 확인하고,',
        '  electron\dist 를 지운 뒤 npm run dist 로 다시 빌드해 주세요.',
        '  (같은 기준을 채점기 A46이 검사해요 — 통과해야 배포 가능한 상태예요.)'
    )
    Stop-WithMessage $lines
}
Write-Ok '블랙리스트 위반 0건'
Write-Info ('검사 기준: ' + (($BlacklistDirNames + $BlacklistFileNames + $BlacklistPatterns) -join ' / '))

# ── 3) 스테이징 (패키지 복사 + 읽어주세요.txt) ──────────────────────────────
Write-Step '3/6  스테이징'
$BaseName = 'PetitCalendar-' + $Version
$ZipName  = 'PetitCalendar-' + $Version + '-portable.zip'
if (-not (Test-Path -LiteralPath $OutDir -PathType Container)) {
    New-Item -ItemType Directory -Path $OutDir -Force | Out-Null
}
$OutDirFull = (Resolve-Path -LiteralPath $OutDir).ProviderPath
$ZipPath    = Join-Path $OutDirFull $ZipName
$StageRoot  = Join-Path $OutDirFull '.stage'
$StageApp   = Join-Path $StageRoot $BaseName

if (Test-Path -LiteralPath $StageRoot) { Remove-Item -LiteralPath $StageRoot -Recurse -Force }
New-Item -ItemType Directory -Path $StageApp -Force | Out-Null

try {
    Copy-Item -Path (Join-Path $Unpacked '*') -Destination $StageApp -Recurse -Force
    Write-Ok ('패키지 복사 완료 -> ' + $StageApp)

    $readme = $ReadmeTemplate.Replace('{VERSION}', $Version).Replace('{DATE}', (Get-Date -Format 'yyyy-MM-dd')).Replace('{CONTACT}', $Contact)
    $readme = ($readme -replace "`r`n", "`n") -replace "`n", "`r`n"
    $ReadmePath = Join-Path $StageApp '읽어주세요.txt'
    [System.IO.File]::WriteAllText($ReadmePath, $readme, (New-Object System.Text.UTF8Encoding($true)))
    Write-Ok '읽어주세요.txt 동봉 (UTF-8 BOM, CRLF)'
    if ($Contact -like '(여기에*') {
        Write-Warn '문의처가 아직 자리표시자예요 — -Contact "..." 로 채워서 다시 만들 수 있어요.'
    }

    # ── 4) ZIP 생성 ─────────────────────────────────────────────────────────
    Write-Step '4/6  ZIP 생성 (Compress-Archive — 몇 분 걸릴 수 있어요)'
    if (Test-Path -LiteralPath $ZipPath) {
        Remove-Item -LiteralPath $ZipPath -Force
        Write-Info '기존 ZIP을 지우고 다시 만들어요.'
    }
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    Compress-Archive -Path $StageApp -DestinationPath $ZipPath -CompressionLevel Optimal -Force
    $sw.Stop()
    Write-Ok ('생성 완료 ({0:N0}초): {1}' -f $sw.Elapsed.TotalSeconds, $ZipPath)
}
finally {
    if ($KeepStage) {
        Write-Info ('스테이징 유지: ' + $StageRoot)
    } elseif (Test-Path -LiteralPath $StageRoot) {
        Remove-Item -LiteralPath $StageRoot -Recurse -Force -ErrorAction SilentlyContinue
    }
}

# ── 5) 생성된 ZIP 재검사 (엔트리 경로) ──────────────────────────────────────
Write-Step '5/6  ZIP 내용 재검사'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$entries = @()
$zip = [System.IO.Compression.ZipFile]::OpenRead($ZipPath)
try {
    foreach ($e in $zip.Entries) { $entries += $e.FullName }
}
finally {
    $zip.Dispose()
}
$zipViolations = @()
foreach ($rel in $entries) {
    $v = Get-BlacklistViolation -RelPath $rel
    if ($v) { $zipViolations += ('zip: {0} — {1}' -f $rel, $v) }
}
# Compress-Archive(5.1)는 엔트리 구분자로 역슬래시를 쓴다 — 비교 전에 슬래시로 통일한다.
$entryPaths = @($entries | ForEach-Object { $_ -replace '\\', '/' })
if ($zipViolations.Count -gt 0) {
    $lines = @('[중단] 생성된 ZIP 안에서 개인 데이터가 발견됐어요. 이 파일은 배포하면 안 돼요.', '')
    foreach ($v in $zipViolations) { $lines += ('  - ' + $v) }
    $lines += @('', ('  문제 파일: ' + $ZipPath), '  위 파일을 삭제하고 원인을 확인해 주세요.')
    Stop-WithMessage $lines
}
$hasExe    = @($entryPaths | Where-Object { ($_ -like '*/PetitCalendar.exe') -or ($_ -eq 'PetitCalendar.exe') }).Count -gt 0
$hasReadme = @($entryPaths | Where-Object { ($_ -like '*/읽어주세요.txt')    -or ($_ -eq '읽어주세요.txt')    }).Count -gt 0
if (-not $hasExe) {
    Stop-WithMessage @('[중단] ZIP 안에 PetitCalendar.exe 가 없어요.', ('  문제 파일: ' + $ZipPath))
}
if (-not $hasReadme) {
    Stop-WithMessage @('[중단] ZIP 안에 읽어주세요.txt 가 없어요.', ('  문제 파일: ' + $ZipPath))
}
Write-Ok ('엔트리 {0}개 — 블랙리스트 0건, PetitCalendar.exe 있음, 읽어주세요.txt 있음' -f $entries.Count)

# ── 6) 크기 - SHA256 ────────────────────────────────────────────────────────
Write-Step '6/6  결과'
$zipItem = Get-Item -LiteralPath $ZipPath
$sha     = (Get-FileHash -LiteralPath $ZipPath -Algorithm SHA256).Hash
$unpackedBytes = (Get-ChildItem -LiteralPath $Unpacked -Recurse -Force -File | Measure-Object -Property Length -Sum).Sum

Write-Host ''
Write-Host '------------------------------------------------------------' -ForegroundColor DarkGray
Write-Host ('  파일    : ' + $zipItem.FullName)
Write-Host ('  크기    : {0:N1} MB ({1:N0} 바이트)' -f ($zipItem.Length / 1MB), $zipItem.Length)
Write-Host ('  원본    : {0:N1} MB (win-unpacked 총합)' -f ($unpackedBytes / 1MB))
Write-Host ('  SHA256  : ' + $sha)
Write-Host ('  최상위  : ' + $BaseName + '\  (풀면 폴더 하나로 나와요)')
Write-Host '------------------------------------------------------------' -ForegroundColor DarkGray
Write-Host ''
Write-Host '보내기 전에 한 번만 확인해 주세요:' -ForegroundColor White
Write-Host '  - 다른 PC(또는 다른 계정)에서 압축을 풀고 PetitCalendar.exe 가 실행되는지'
Write-Host '  - 읽어주세요.txt 의 문의처가 채워져 있는지'
Write-Host ''
exit 0
