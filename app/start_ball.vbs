' 双击本文件 = 无窗口启动 Claude 状态球。
' 想开机自启：右键本文件 → 创建快捷方式 → 把快捷方式放进
' “启动”文件夹（Win+R 输入 shell:startup）。
'
' 不使用 Scripting.FileSystemObject，避免部分 Windows 环境
' 禁用 FSO 后报“缺少对象: fso”。

Option Explicit

Dim sh, scriptPath, scriptDir
Set sh = CreateObject("WScript.Shell")

scriptPath = WScript.ScriptFullName
scriptDir = Left(scriptPath, InStrRev(scriptPath, "\"))
sh.CurrentDirectory = scriptDir
sh.Run "cmd /c npm start", 0, False
