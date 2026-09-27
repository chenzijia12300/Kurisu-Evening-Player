@echo off
"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-controller.ps1" -Foreground
set "controllerExit=%ERRORLEVEL%"
pause
exit /b %controllerExit%
