# install_startup.ps1  (선택 사항 - 원할 때만 실행하세요)
# 이 스크립트는 윈도우 로그인 시 캘린더와 포스트잇 월이 자동으로 열리도록
# 사용자 "시작프로그램" 폴더에 바로가기 2개("캘린더.lnk", "포스트잇 월.lnk")를 만듭니다.
# 자동 시작을 해제하려면 uninstall_startup.ps1 을 실행하세요.
# 여러 번 실행해도 안전합니다 (기존 바로가기를 덮어씀).
# 이 두 바로가기 외의 다른 파일·바로가기는 절대 건드리지 않습니다.
#
# 실행 방법 (둘 중 하나):
#   1) 파일 우클릭 -> "PowerShell에서 실행"
#   2) powershell -ExecutionPolicy Bypass -File D:\custom_program\install_startup.ps1

$ErrorActionPreference = "Stop"

$startup = [Environment]::GetFolderPath("Startup")
$wscript = Join-Path $env:SystemRoot "System32\wscript.exe"
$wsh = New-Object -ComObject WScript.Shell

$shortcuts = @(
    @{ Name = "캘린더.lnk";      Vbs = "D:\custom_program\launch_calendar.vbs"; Icon = "%SystemRoot%\System32\imageres.dll,272" },
    @{ Name = "포스트잇 월.lnk"; Vbs = "D:\custom_program\launch_postit.vbs";   Icon = "%SystemRoot%\System32\imageres.dll,97" }
)

foreach ($s in $shortcuts) {
    if (-not (Test-Path -LiteralPath $s.Vbs)) {
        Write-Host "실행 스크립트를 찾을 수 없습니다: $($s.Vbs)"
        exit 1
    }
    $lnkPath = Join-Path $startup $s.Name
    $lnk = $wsh.CreateShortcut($lnkPath)   # 기존 .lnk가 있으면 덮어씀 (idempotent)
    $lnk.TargetPath       = $wscript
    $lnk.Arguments        = '"' + $s.Vbs + '"'
    $lnk.WorkingDirectory = "D:\custom_program"
    $lnk.IconLocation     = $s.Icon
    $lnk.Save()
    Write-Host "시작프로그램 등록: $lnkPath"
}

Write-Host "완료되었습니다. 다음 로그인부터 자동으로 실행됩니다."
exit 0
