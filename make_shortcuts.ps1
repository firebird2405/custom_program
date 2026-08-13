# make_shortcuts.ps1
# 바탕화면에 "캘린더" / "포스트잇 월" 바로가기 2개를 만듭니다.
# 이미 있으면 덮어쓰므로 여러 번 실행해도 안전합니다.
# 예전 "메모장" 바로가기가 남아 있으면 함께 삭제합니다.
#
# 실행 방법 (둘 중 하나):
#   1) 파일 우클릭 -> "PowerShell에서 실행"
#   2) powershell -ExecutionPolicy Bypass -File D:\custom_program\make_shortcuts.ps1

$ErrorActionPreference = "Stop"

$desktop = [Environment]::GetFolderPath("Desktop")
$wscript = Join-Path $env:SystemRoot "System32\wscript.exe"
$wsh = New-Object -ComObject WScript.Shell

# 예전 메모장 바로가기 정리 (없으면 아무 일도 하지 않음 — idempotent)
$staleLnk = Join-Path $desktop "메모장.lnk"
if (Test-Path -LiteralPath $staleLnk) {
    Remove-Item -LiteralPath $staleLnk -Force -Confirm:$false
    Write-Host "예전 바로가기 삭제: $staleLnk"
}

$shortcuts = @(
    @{ Name = "캘린더.lnk";     Vbs = "D:\custom_program\launch_calendar.vbs"; Icon = "%SystemRoot%\System32\imageres.dll,272" },
    @{ Name = "포스트잇 월.lnk"; Vbs = "D:\custom_program\launch_postit.vbs";   Icon = "%SystemRoot%\System32\imageres.dll,97" }
)

foreach ($s in $shortcuts) {
    $lnkPath = Join-Path $desktop $s.Name
    $lnk = $wsh.CreateShortcut($lnkPath)   # 기존 .lnk가 있으면 덮어씀 (idempotent)
    $lnk.TargetPath       = $wscript
    $lnk.Arguments        = '"' + $s.Vbs + '"'
    $lnk.WorkingDirectory = "D:\custom_program"
    $lnk.IconLocation     = $s.Icon
    $lnk.Save()
    Write-Host "바로가기 생성: $lnkPath"
}

Write-Host "완료되었습니다."
