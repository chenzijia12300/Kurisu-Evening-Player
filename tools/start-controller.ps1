param([switch]$Foreground, [switch]$CheckOnly, [ValidateRange(1024,65535)][int]$Port=18743)
$ErrorActionPreference='Stop'
function Find-Python {
    foreach ($name in @('py.exe','python.exe','python3.exe')) {
        $command=Get-Command $name -ErrorAction SilentlyContinue | Select-Object -First 1
        if (-not $command -or $command.Source -match '\\WindowsApps\\') { continue }
        $arguments=@()
        if ($name -eq 'py.exe') { $arguments+='-3' }
        $arguments+=@('-c','import sys; print(sys.executable); sys.exit(0 if sys.version_info >= (3,9) else 1)')
        try {
            $result=& $command.Source @arguments 2>$null
            if ($LASTEXITCODE -eq 0 -and $result) {
                $executable=([string]($result | Select-Object -Last 1)).Trim()
                if (Test-Path -LiteralPath $executable -PathType Leaf) { return $executable }
            }
        } catch { }
    }
    throw 'Python 3.9+ not found. Install Python with the py launcher or add Python to PATH.'
}
function Read-Health {
    $tokenFile=Join-Path $PSScriptRoot '.connection-code'
    if (-not (Test-Path -LiteralPath $tokenFile)) { return $null }
    $token=(Get-Content -LiteralPath $tokenFile -Raw).Trim()
    try { return Invoke-RestMethod -Uri ('http://127.0.0.1:'+$Port+'/health') -Headers @{'X-Kurisu-Token'=$token} -TimeoutSec 2 }
    catch { return $null }
}
function Test-Listener {
    $client=New-Object System.Net.Sockets.TcpClient
    try {
        $pending=$client.BeginConnect('127.0.0.1',$Port,$null,$null)
        if (-not $pending.AsyncWaitHandle.WaitOne(1000)) { return $false }
        $client.EndConnect($pending)
        return $client.Connected
    } catch { return $false } finally { $client.Dispose() }
}
function Write-Status([string]$Message) {
    Write-Host $Message
    if ($CheckOnly) { return }
    try {
        $logDir=Join-Path $PSScriptRoot '.logs'
        New-Item -ItemType Directory -Path $logDir -Force | Out-Null
        $log=Join-Path $logDir 'launcher.log'
        if ((Test-Path -LiteralPath $log) -and (Get-Item -LiteralPath $log).Length -gt 262144) { Move-Item -LiteralPath $log -Destination ($log+'.old') -Force }
        Add-Content -LiteralPath $log -Value ((Get-Date -Format s)+' '+$Message) -Encoding UTF8
    } catch { }
}
$launchMutex=$null
$ownsMutex=$false
try {
    $python=Find-Python
    $controller=Join-Path $PSScriptRoot 'media_controller.py'
    foreach ($file in @($controller,(Join-Path $PSScriptRoot 'kugou-timeline.ps1'),(Join-Path $PSScriptRoot 'kugou-accessibility.cs'))) {
        if (-not (Test-Path -LiteralPath $file -PathType Leaf)) { throw ('Missing controller file: '+$file) }
    }
    if ($CheckOnly) { Write-Host ('Ready. Python: '+$python); Write-Host ('Controller directory: '+$PSScriptRoot); exit 0 }
    $launchMutex=New-Object System.Threading.Mutex($false,('Local\KurisuEveningControllerLaunch-'+$Port))
    try { $ownsMutex=$launchMutex.WaitOne(0) } catch [System.Threading.AbandonedMutexException] { $ownsMutex=$true }
    if (-not $ownsMutex) { Write-Status 'Another launcher is already starting the controller.'; exit 0 }
    if (Test-Listener) {
        $health=Read-Health
        if ($health -and $health.ok -and -not $health.dryRun -and $health.timelineFallback -eq 'kugou-window') {
            Write-Status 'Controller is already connected. No duplicate process was started.'
            if ($Foreground) { Write-Host 'Connection code (keep private):'; Get-Content -LiteralPath (Join-Path $PSScriptRoot '.connection-code') }
            exit 0
        }
        throw ('Port '+$Port+' is occupied or the connection code differs. Use the running controller tools directory. No second controller was started.')
    }
    if ($Foreground) {
        $launchMutex.ReleaseMutex();$ownsMutex=$false
        & $python $controller --port $Port
        exit $LASTEXITCODE
    }
    $logDir=Join-Path $PSScriptRoot '.logs'
    New-Item -ItemType Directory -Path $logDir -Force | Out-Null
    $arguments='"'+$controller+'" --quiet --port '+$Port
    $process=Start-Process -FilePath $python -ArgumentList $arguments -WorkingDirectory $PSScriptRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $logDir 'controller.out.log') -RedirectStandardError (Join-Path $logDir 'controller.err.log')
    for ($i=0;$i -lt 20;$i++) {
        Start-Sleep -Milliseconds 300
        if ($process.HasExited) { throw 'Controller exited. See tools/.logs/controller.err.log.' }
        $health=Read-Health
        if ($health -and $health.ok -and -not $health.dryRun) { Write-Status ('Controller started in background. PID: '+$process.Id); exit 0 }
    }
    throw 'Controller did not become ready. Inspect tools/.logs before retrying.'
} catch { Write-Status ('ERROR: '+$_.Exception.Message); exit 1 }
finally { if ($ownsMutex) { $launchMutex.ReleaseMutex() }; if ($launchMutex) { $launchMutex.Dispose() } }
