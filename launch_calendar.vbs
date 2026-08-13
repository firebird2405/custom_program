' launch_calendar.vbs
' Opens calendar.html as a Microsoft Edge app window (no browser UI, no console flash).
' This file is ASCII-only; the Korean error message is built with ChrW() codes
' so it displays correctly regardless of the file's text encoding.
Option Explicit

Dim fso, sh, edgePath, cmd
Set fso = CreateObject("Scripting.FileSystemObject")
Set sh  = CreateObject("WScript.Shell")

' Resolve Edge path: x86 install location first, then 64-bit, then per-user install.
edgePath = "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
If Not fso.FileExists(edgePath) Then
    edgePath = "C:\Program Files\Microsoft\Edge\Application\msedge.exe"
End If
If Not fso.FileExists(edgePath) Then
    edgePath = sh.ExpandEnvironmentStrings("%LOCALAPPDATA%") & "\Microsoft\Edge\Application\msedge.exe"
End If

If Not fso.FileExists(edgePath) Then
    ' Korean message: "Microsoft Edge cannot be found. Please install Edge and run again."
    MsgBox MissingEdgeMessage(), vbCritical, "Edge"
    WScript.Quit 1
End If

cmd = """" & edgePath & """" _
    & " --app=file:///D:/custom_program/calendar.html" _
    & " --user-data-dir=""D:\custom_program\.edge\calendar""" _
    & " --window-size=1000,780" _
    & " --window-position=90,70" _
    & " --no-first-run" _
    & " --no-default-browser-check"

sh.Run cmd, 1, False

Function MissingEdgeMessage()
    Dim s
    s = "Microsoft Edge" & FromCodes(Array(47484, 32, 52286, 51012, 32, 49688, 32, 50630, 49845, 45768, 45796, 46))
    s = s & vbCrLf & "Edge " & FromCodes(Array(49444, 52824, 32, 54980, 32, 45796, 49884, 32, 49892, 54665, 54644, 32, 51452, 49464, 50836, 46))
    MissingEdgeMessage = s
End Function

Function FromCodes(codes)
    Dim i, s
    s = ""
    For i = 0 To UBound(codes)
        s = s & ChrW(codes(i))
    Next
    FromCodes = s
End Function
