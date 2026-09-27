@echo off
"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-controller.ps1"
set "controllerExit=%ERRORLEVEL%"
if not "%controllerExit%"=="0" pause
exit /b %controllerExit%
