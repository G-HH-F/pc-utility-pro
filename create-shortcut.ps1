# PC Utility Pro - Create Desktop Shortcut
# Run this script to create a desktop shortcut for the application

$AppName = "PC Utility Pro"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$DesktopPath = [Environment]::GetFolderPath("Desktop")

$WshShell = New-Object -ComObject WScript.Shell
$Shortcut = $WshShell.CreateShortcut("$DesktopPath\$AppName.lnk")
$Shortcut.TargetPath = "$ScriptDir\node_modules\electron\dist\electron.exe"
$Shortcut.Arguments = "."
$Shortcut.WorkingDirectory = $ScriptDir
$Shortcut.IconLocation = "$ScriptDir\node_modules\electron\dist\electron.exe,0"
$Shortcut.Save()

Write-Host "Shortcut created on your desktop: $AppName" -ForegroundColor Green
