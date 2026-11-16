' 双击本文件 = 无窗口启动 Claude 状态球。
' 想开机自启：右键本文件 → 创建快捷方式 → 把快捷方式放进
' “启动”文件夹（Win+R 输入 shell:startup）。
Set fso = CreateObject("Scripting.FileSystemObject")
Set sh = CreateObject("WScript.Shell")
sh.CurrentDirectory = fso.GetParentFolderName(WScript.ScriptFullName)
sh.Run "cmd /c npm start", 0, False
