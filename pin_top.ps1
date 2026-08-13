# pin_top.ps1
# 캘린더·포스트잇 월 앱 창을 "항상 위(topmost)" 로 고정합니다.
#
# 대상 선정 규칙 (이 규칙 밖의 창은 어떤 것도 건드리지 않음):
#   프로세스 CommandLine 에 "D:/custom_program"(또는 D:\custom_program) 과 "--app" 이
#   모두 포함된 msedge 브라우저 프로세스(--type= 자식 프로세스 제외)의
#   보이는 최상위 창만 SetWindowPos(HWND_TOPMOST) 로 고정합니다.
#
# 해제는 unpin.ps1 을 실행하세요.
#
# 실행 방법:
#   powershell -ExecutionPolicy Bypass -File D:\custom_program\pin_top.ps1

$ErrorActionPreference = "Stop"

if (-not ([System.Management.Automation.PSTypeName]"PinTopNative").Type) {
    Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;

public static class PinTopNative
{
    public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

    [DllImport("user32.dll")]
    public static extern bool EnumWindows(EnumWindowsProc cb, IntPtr lParam);

    [DllImport("user32.dll")]
    public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);

    [DllImport("user32.dll")]
    public static extern bool IsWindowVisible(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern int GetWindowLong(IntPtr hWnd, int nIndex);

    [DllImport("user32.dll")]
    public static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter,
        int X, int Y, int cx, int cy, uint uFlags);

    public const int GWL_EXSTYLE = -20;
    public const int WS_EX_TOPMOST = 0x0008;
    public const uint SWP_NOSIZE = 0x0001;
    public const uint SWP_NOMOVE = 0x0002;
    public const uint SWP_NOACTIVATE = 0x0010;

    // 지정한 PID 들의 "보이는 최상위 창" HWND 목록
    public static List<IntPtr> FindWindows(uint[] pids)
    {
        List<uint> set = new List<uint>(pids);
        List<IntPtr> found = new List<IntPtr>();
        EnumWindows(delegate(IntPtr hWnd, IntPtr lParam)
        {
            if (IsWindowVisible(hWnd))
            {
                uint pid;
                GetWindowThreadProcessId(hWnd, out pid);
                if (set.Contains(pid)) { found.Add(hWnd); }
            }
            return true;
        }, IntPtr.Zero);
        return found;
    }

    // topmost = true 면 HWND_TOPMOST(-1), false 면 HWND_NOTOPMOST(-2)
    public static bool SetTopmost(IntPtr hWnd, bool topmost)
    {
        IntPtr insertAfter = topmost ? new IntPtr(-1) : new IntPtr(-2);
        return SetWindowPos(hWnd, insertAfter, 0, 0, 0, 0,
            SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE);
    }
}
'@
}

# ---------- 대상 프로세스 선정 ----------
$targetPids = @()
$procs = Get-CimInstance Win32_Process -Filter "Name = 'msedge.exe'"
foreach ($p in $procs) {
    $cl = $p.CommandLine
    if (-not $cl) { continue }
    $norm = $cl.Replace("\", "/").ToLowerInvariant()
    if ($norm.Contains("d:/custom_program") -and
        $norm.Contains("--app") -and
        (-not $norm.Contains("--type="))) {
        $targetPids += [uint32]$p.ProcessId
    }
}

if ($targetPids.Count -eq 0) {
    Write-Host "고정할 앱 창이 없습니다. (launch_all.vbs 로 앱을 먼저 실행하세요)"
    exit 0
}

$hwnds = [PinTopNative]::FindWindows([uint32[]]$targetPids)
$count = 0
foreach ($h in $hwnds) {
    if ([PinTopNative]::SetTopmost($h, $true)) { $count++ }
}

Write-Host "항상 위로 고정된 창: $count 개 (PID: $($targetPids -join ', '))"
exit 0
