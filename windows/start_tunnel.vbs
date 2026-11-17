' Hidden launcher for start_tunnel.cmd.
' Tunnel settings live in %USERPROFILE%\.claude-ball\tunnel.conf.
' Log: %USERPROFILE%\claude-status-ball-tunnel.log

Option Explicit

Dim sh, scriptPath, scriptDir
Set sh = CreateObject("WScript.Shell")

scriptPath = WScript.ScriptFullName
scriptDir = Left(scriptPath, InStrRev(scriptPath, "\"))
sh.CurrentDirectory = scriptDir
sh.Run "cmd /c """ & scriptDir & "start_tunnel.cmd""", 0, False
