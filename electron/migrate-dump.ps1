# migrate-dump.ps1 - 쁘띠캘린더 마이그레이션용 레거시 Edge 프로필 덤프 (읽기 전용)
#
# 역할:
#   - 예전 Edge 앱 프로필(예: D:\custom_program\.edge\calendar)을 헤드리스 Edge 로 열어
#     file:// 오리진의 localStorage 전 키 + IndexedDB(postit-decor / cal-decor) 전수를
#     JSON 한 파일로 덤프한다. (electron\migrate.js 가 이 파일을 임시 폴더로 복사해 실행)
#   - 검증된 backup_snapshot.ps1 의 메커니즘(헤드리스 --dump-dom + base64 마커)을
#     복사·확장한 파일이다. 원본 backup_snapshot.ps1 은 수정하지 않는다.
#
# 읽기 전용 계약 (SCORECARD rev.6 B — "마이그레이션 원본(.edge) 삭제·변형 금지"):
#   - 덤프 페이지는 localStorage/IndexedDB 를 읽기만 한다. 키 생성·삭제·변경 없음.
#   - IndexedDB 는 indexedDB.databases() 로 "이미 존재하는" DB 만 연다
#     (없는 DB 를 open 하면 빈 DB 가 새로 생겨 원본이 변형되므로, 존재 확인 후에만 연다.
#      혹시 열던 중 upgradeneeded 가 오면 즉시 abort 해 생성 자체를 취소한다).
#   - Edge 실행 플래그로 동기화·확장·백그라운드 네트워킹을 전부 끈다 (외부 요청 0 원칙).
#
# 비동기 IndexedDB 를 --dump-dom 으로 붙잡는 방법:
#   --virtual-time-budget 사용. 덤프 페이지가 20ms 인터벌(가상 시간 앵커)을 돌려
#   가상 시간이 실제 태스크 처리와 함께 조금씩 전진하게 만들고, IndexedDB 읽기가
#   끝나면 인터벌을 해제해 예산이 즉시 소진(=즉시 덤프)되게 한다.
#   가상 시간이 지원되지 않는 환경이면 동기 마커(localStorage 몫)만 잡히므로
#   idb-not-captured 경고와 함께 localStorage 만이라도 이전한다 (우아한 강등).
#
# 실행 (migrate.js 가 호출):
#   powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File migrate-dump.ps1 `
#     -ProfileDir "D:\custom_program\.edge\calendar" -OutFile "...\cal-dump.json"
#
# 출력(OutFile): {"ls":{키:값,...},"idb":{"cal-decor":{"키":{"t":"s|j","v":...}},...},"warnings":[...]}
# 종료 코드: 0 = 성공, 1 = 실패 (실패 사유는 표준 출력에 한국어로)

param(
    [Parameter(Mandatory = $true)][string]$ProfileDir,
    [Parameter(Mandatory = $true)][string]$OutFile
)

$ErrorActionPreference = "Stop"

# ---------- Edge 실행 파일 찾기 (launch_*.vbs / backup_snapshot.ps1 과 동일한 순서) ----------
$edge = $null
$candidates = @(
    "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
    "C:\Program Files\Microsoft\Edge\Application\msedge.exe",
    (Join-Path $env:LOCALAPPDATA "Microsoft\Edge\Application\msedge.exe")
)
foreach ($c in $candidates) {
    if (Test-Path -LiteralPath $c) { $edge = $c; break }
}

# ---------- 덤프용 임시 페이지 (ASCII 전용 — Set-Content -Encoding Ascii 로 기록되므로
#            내부 주석도 ASCII 로 유지한다. 한글 설명은 본 파일 상단 주석 참조) ----------
$dumperHtml = @'
<!doctype html>
<html><head><meta charset="utf-8"><title>petit migrate dump</title></head>
<body><pre id="ls"></pre><pre id="all"></pre>
<script>
(function () {
  function b64(s) { return btoa(unescape(encodeURIComponent(s))); }

  /* read-only: localStorage snapshot (same proven path as backup_snapshot.ps1) */
  var ls = {};
  try {
    for (var i = 0; i < localStorage.length; i++) {
      var k = localStorage.key(i);
      ls[k] = localStorage.getItem(k);
    }
  } catch (e) {}
  /* sync marker: available even if async IDB capture never completes */
  document.getElementById("ls").textContent = "@@LSSTART@@" + b64(JSON.stringify(ls)) + "@@LSEND@@";

  var warnings = [];
  var out = { ls: ls, idb: {}, warnings: warnings };
  var emitted = false;
  var spin = null;
  function emit() {
    if (emitted) return;
    emitted = true;
    try {
      document.getElementById("all").textContent = "@@ALLSTART@@" + b64(JSON.stringify(out)) + "@@ALLEND@@";
    } catch (e) {}
    if (spin) { clearInterval(spin); spin = null; }
  }

  /* virtual-time anchor: keeps --virtual-time-budget advancing in small steps that
     interleave with real task processing, so async IndexedDB completions arrive.
     When done, clearing the interval exhausts the budget instantly (= dump now).
     Guard: after 6000 ticks emit partial result instead of hanging. */
  var ticks = 0;
  spin = setInterval(function () {
    ticks += 1;
    if (ticks > 6000) { warnings.push("idb-timeout"); emit(); }
  }, 20);

  /* app contract: postit.html -> DB "postit-decor" store "images",
                   calendar.html -> DB "cal-decor" store "img" */
  var STORES = { "postit-decor": "images", "cal-decor": "img" };

  function dumpDb(name) {
    return new Promise(function (resolve) {
      var store = STORES[name];
      var req;
      try { req = indexedDB.open(name); } catch (e) { warnings.push("idb-open-throw:" + name); resolve(); return; }
      req.onerror = function () { warnings.push("idb-open-error:" + name); resolve(); };
      req.onupgradeneeded = function () {
        /* DB did not actually exist -- abort so nothing is created in the source profile */
        warnings.push("idb-unexpected-upgrade:" + name);
        try { req.transaction.abort(); } catch (e) {}
        resolve();
      };
      req.onsuccess = function () {
        var db = req.result;
        var entries = {};
        out.idb[name] = entries;
        try {
          var names = Array.prototype.slice.call(db.objectStoreNames);
          if (names.indexOf(store) === -1) { db.close(); resolve(); return; }
          var tx = db.transaction(store, "readonly");
          var cur = tx.objectStore(store).openCursor();
          cur.onsuccess = function () {
            var c = cur.result;
            if (!c) { db.close(); resolve(); return; }
            try {
              var v = c.value;
              if (typeof v === "string") entries[String(c.key)] = { t: "s", v: v };
              else entries[String(c.key)] = { t: "j", v: JSON.stringify(v) };
            } catch (e) { warnings.push("idb-value:" + name); }
            c["continue"]();
          };
          cur.onerror = function () { warnings.push("idb-cursor:" + name); db.close(); resolve(); };
        } catch (e) {
          warnings.push("idb-read:" + name);
          try { db.close(); } catch (e2) {}
          resolve();
        }
      };
    });
  }

  var lister;
  try {
    lister = (indexedDB && indexedDB.databases) ? indexedDB.databases() : Promise.resolve(null);
  } catch (e) { lister = Promise.resolve(null); }
  lister.then(function (dbs) {
    var wanted = [];
    if (dbs === null) { warnings.push("idb-databases-unsupported"); }
    else {
      for (var i = 0; i < dbs.length; i++) {
        var n = dbs[i] && dbs[i].name;
        if (n && Object.prototype.hasOwnProperty.call(STORES, n)) wanted.push(n);
      }
    }
    var chain = Promise.resolve();
    wanted.forEach(function (n) { chain = chain.then(function () { return dumpDb(n); }); });
    return chain;
  }).then(emit, function (e) { warnings.push("idb-list"); emit(); });
})();
</script>
</body></html>
'@

# Edge 자식 프로세스(crashpad 등)가 리다이렉트 파일 핸들을 계속 쥐고 있어도
# 읽을 수 있도록 FileShare.ReadWrite 로 연다 (backup_snapshot.ps1 동형).
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

# 헤드리스 Edge 1회 실행 → 마커 회수. All(전체)·Ls(localStorage 만) 두 마커를 반환.
function Invoke-DumpOnce {
    param([string]$EdgePath, [string]$Profile, [string]$DumpUrl)
    $token   = [Guid]::NewGuid().ToString("N")
    $outFile = Join-Path $env:TEMP ("petit-migrate-out-" + $token + ".txt")
    $errFile = Join-Path $env:TEMP ("petit-migrate-err-" + $token + ".txt")
    # 플래그 메모: 동기화/확장/백그라운드 네트워킹/컴포넌트 업데이트 전부 차단(외부 요청 0),
    #             --virtual-time-budget 은 위 헤더 주석의 비동기 IDB 포집 메커니즘.
    $argLine = "--headless --disable-gpu --no-first-run --no-default-browser-check " +
               "--disable-extensions --disable-sync --disable-background-networking " +
               "--disable-component-update --virtual-time-budget=240000 " +
               "--user-data-dir=""$Profile"" --dump-dom ""$DumpUrl"""
    $proc = Start-Process -FilePath $EdgePath -ArgumentList $argLine `
        -RedirectStandardOutput $outFile -RedirectStandardError $errFile `
        -WindowStyle Hidden -PassThru
    try {
        Wait-Process -Id $proc.Id -Timeout 90 -ErrorAction Stop
    } catch {
        try { Stop-Process -Id $proc.Id -Force -ErrorAction Stop } catch {}
        try { Remove-Item -LiteralPath $outFile, $errFile -Force -ErrorAction Stop } catch {}
        throw "프로필 덤프가 90초 안에 끝나지 않았습니다. 예전 앱(Edge) 창을 모두 닫고 다시 시도하세요."
    }
    # 본 프로세스 종료 후에도 출력 플러시가 늦을 수 있어 최대 10초까지 재시도한다.
    $all = $null
    $ls  = $null
    for ($try = 0; $try -lt 20; $try++) {
        $dom = ""
        try { $dom = Read-AllTextShared -Path $outFile } catch {}
        $mAll = [regex]::Match([string]$dom, "@@ALLSTART@@([A-Za-z0-9+/=]*)@@ALLEND@@")
        $mLs  = [regex]::Match([string]$dom, "@@LSSTART@@([A-Za-z0-9+/=]*)@@LSEND@@")
        if ($mLs.Success) { $ls = $mLs.Groups[1].Value }
        if ($mAll.Success) { $all = $mAll.Groups[1].Value; break }
        Start-Sleep -Milliseconds 500
    }
    try { Remove-Item -LiteralPath $outFile, $errFile -Force -ErrorAction Stop } catch {}
    return @{ All = $all; Ls = $ls }
}

# base64 → JSON 문자열 (유효 JSON 검증 포함 — 실패 시 예외)
function ConvertFrom-B64Json {
    param([string]$B64)
    $json = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($B64))
    $null = ConvertFrom-Json $json
    return $json
}

$dumperPath = $null
try {
    if (-not (Test-Path -LiteralPath $ProfileDir)) {
        throw "원본 프로필 폴더가 없습니다: $ProfileDir"
    }
    if ($null -eq $edge) {
        throw "Microsoft Edge 를 찾을 수 없어 기존 데이터를 읽을 수 없습니다."
    }

    # 임시 덤프 페이지 생성 (ASCII 전용 내용 — 위 here-string)
    $dumperPath = Join-Path $env:TEMP ("petit-migrate-dumper-" + [Guid]::NewGuid().ToString("N") + ".html")
    Set-Content -LiteralPath $dumperPath -Value $dumperHtml -Encoding Ascii
    $dumpUrl = "file:///" + $dumperPath.Replace("\", "/")

    # 최대 2회 시도: 전체 마커(All) 우선, 마지막엔 localStorage 마커(Ls)만이라도 사용
    $json = $null
    $lastLs = $null
    for ($attempt = 1; $attempt -le 2; $attempt++) {
        $r = Invoke-DumpOnce -EdgePath $edge -Profile $ProfileDir -DumpUrl $dumpUrl
        if ($r.Ls) { $lastLs = $r.Ls }
        if ($r.All) { $json = ConvertFrom-B64Json -B64 $r.All; break }
    }
    if (($null -eq $json) -and $lastLs) {
        # 우아한 강등: IndexedDB 몫을 붙잡지 못한 환경 — localStorage 만이라도 이전
        $lsJson = ConvertFrom-B64Json -B64 $lastLs
        $json = '{"ls":' + $lsJson + ',"idb":{},"warnings":["idb-not-captured"]}'
        $null = ConvertFrom-Json $json   # 최종 유효성 검증
    }
    if ($null -eq $json) {
        throw "프로필에서 데이터를 읽지 못했습니다. 예전 앱(Edge) 창을 모두 닫고 다시 시도하세요."
    }

    # BOM 없는 UTF-8 로 저장 (Node JSON.parse 호환)
    $outDir = Split-Path -Parent $OutFile
    if ($outDir -and -not (Test-Path -LiteralPath $outDir)) {
        $null = New-Item -ItemType Directory -Path $outDir -Force
    }
    $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($OutFile, $json, $utf8NoBom)
    Write-Host "덤프 완료: $OutFile"
    exit 0
} catch {
    Write-Host "덤프 실패: $($_.Exception.Message)"
    exit 1
} finally {
    if ($dumperPath -and (Test-Path -LiteralPath $dumperPath)) {
        try { Remove-Item -LiteralPath $dumperPath -Force -ErrorAction Stop } catch {}
    }
}
