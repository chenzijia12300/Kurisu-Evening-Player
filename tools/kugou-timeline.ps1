param([switch]$Watch)
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName Accessibility
Add-Type -Path (Join-Path $PSScriptRoot 'kugou-accessibility.cs') -ReferencedAssemblies Accessibility
function Read-KugouTimeline {
    $players = @(Get-Process -Name KuGou -ErrorAction SilentlyContinue)
    if ($players.Count -eq 0) { return @{available=$false;source='kugou-window';reason='not-running'} }
    $sample = [KugouAccessibility]::Read([int[]]$players.Id)
    if ($null -ne $sample) { return $sample }
    return @{available=$false;source='kugou-window';reason='no-accessible-timeline'}
}
do {
    try { $sample=Read-KugouTimeline } catch { $sample=@{available=$false;source='kugou-window';reason='read-failed'} }
    $sample | ConvertTo-Json -Compress -Depth 4
    if ($Watch) { Start-Sleep -Seconds 1 }
} while ($Watch)