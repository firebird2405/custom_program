# uninstall_startup.ps1  (선택 사항)
# install_startup.ps1 로 등록한 자동 시작을 해제합니다.
# 사용자 "시작프로그램" 폴더에서 "캘린더.lnk", "포스트잇 월.lnk" 두 개만 삭제합니다.
# 그 외의 어떤 바로가기·파일도 건드리지 않으며,
# 바탕화면 바로가기와 앱 데이터는 그대로 유지됩니다.
#
# 실행 방법 (둘 중 하나):
#   1) 파일 우클릭 -> "PowerShell에서 실행"
#   2) powershell -ExecutionPolicy Bypass -File D:\custom_program\uninstall_startup.ps1

$ErrorActionPreference = "Stop"

$startup = [Environment]::GetFolderPath("Startup")

foreach ($name in "캘린더.lnk", "포스트잇 월.lnk") {
    $lnkPath = Join-Path $startup $name
    if (Test-Path -LiteralPath $lnkPath) {
        Remove-Item -LiteralPath $lnkPath -Force -Confirm:$false
        Write-Host "삭제됨: $lnkPath"
    } else {
        Write-Host "이미 없음: $lnkPath"
    }
}

Write-Host "자동 시작이 해제되었습니다."
exit 0
