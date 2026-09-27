param(
    [ValidateSet('Install','Remove','Status')][string]$Action='Status',
    [string]$StartupDirectory=[Environment]::GetFolderPath('Startup')
)
$ErrorActionPreference='Stop'
try {
    $launcher=Join-Path $PSScriptRoot 'start-controller.ps1'
    $powershell=Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
    $folder=[System.IO.Path]::GetFullPath($StartupDirectory)
    if (-not (Test-Path -LiteralPath $folder -PathType Container)) { throw ('Startup directory does not exist: '+$folder) }
    $shortcutPath=Join-Path $folder 'Kurisu Evening Player Controller.lnk'
    $marker='Kurisu Evening Player controller autostart'
    $shell=New-Object -ComObject WScript.Shell
    if (Test-Path -LiteralPath $shortcutPath) {
        $existing=$shell.CreateShortcut($shortcutPath)
        if ($existing.Description -ne $marker) { throw 'This shortcut name belongs to another application. It was not changed.' }
    }
    if ($Action -eq 'Status') {
        if (Test-Path -LiteralPath $shortcutPath) { Write-Host ('Installed: '+$shortcutPath); Write-Host ('Launch directory: '+$existing.WorkingDirectory) }
        else { Write-Host 'Autostart is not installed.' }
        exit 0
    }
    if ($Action -eq 'Remove') {
        if (Test-Path -LiteralPath $shortcutPath) { Remove-Item -LiteralPath $shortcutPath; Write-Host 'Autostart removed. The running controller was not stopped.' }
        else { Write-Host 'Autostart was already disabled.' }
        exit 0
    }
    & $powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $launcher -CheckOnly
    if ($LASTEXITCODE -ne 0) { throw 'Dependency check failed. Autostart was not installed.' }
    $shortcut=$shell.CreateShortcut($shortcutPath)
    $shortcut.TargetPath=$powershell
    $shortcut.Arguments='-NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File "'+$launcher+'"'
    $shortcut.WorkingDirectory=$PSScriptRoot
    $shortcut.WindowStyle=7
    $shortcut.Description=$marker
    $shortcut.Save()
    Write-Host 'Autostart installed for this Windows user, at next sign-in.'
    Write-Host ('Controller directory: '+$PSScriptRoot)
    Write-Host 'To start now, run start-controller-background.cmd. This installer does not start a controller.'
} catch { Write-Host ('ERROR: '+$_.Exception.Message); exit 1 }
