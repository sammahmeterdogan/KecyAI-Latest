Dim shell, scriptDir, repoRoot, ps1, cmd
Set shell = CreateObject("WScript.Shell")

scriptDir = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)
repoRoot  = CreateObject("Scripting.FileSystemObject").GetParentFolderName(scriptDir)
ps1       = Chr(34) & repoRoot & "\scripts\stop.ps1" & Chr(34)

cmd = "powershell.exe -NoProfile -ExecutionPolicy Bypass -File " & ps1
shell.Run cmd, 0, False
