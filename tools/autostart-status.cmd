@echo off
"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "%~dp0manage-autostart.ps1" -Action Status
set "controllerExit=%ERRORLEVEL%"
pause
exit /b %controllerExit%
