' launch_all.vbs
' Launches both app windows (calendar + post-it wall) by running the two launcher
' scripts through wscript.exe, which is a GUI host - no console window flashes.
Option Explicit

Dim sh, base
Set sh = CreateObject("WScript.Shell")
base = "D:\custom_program\"

sh.Run "wscript.exe """ & base & "launch_calendar.vbs""", 0, False
WScript.Sleep 500
sh.Run "wscript.exe """ & base & "launch_postit.vbs""", 0, False
