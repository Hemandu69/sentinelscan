# Explicit opt-in. Removes all containers and images on the local desktop-linux engine.
param([switch]$RemoveAllContainersAndImages)
$ErrorActionPreference = 'Stop'
if (-not $RemoveAllContainersAndImages) { throw 'Specify -RemoveAllContainersAndImages to run the authorized reset.' }
Set-Location -LiteralPath $PSScriptRoot
function Invoke-DesktopDocker {
    & docker --context desktop-linux @args
    if ($LASTEXITCODE -ne 0) { throw "Docker failed ($LASTEXITCODE): $($args -join ' ')" }
}
$endpoint = Invoke-DesktopDocker context inspect desktop-linux --format '{{.Endpoints.docker.Host}}'
if ($endpoint -ne 'npipe:////./pipe/dockerDesktopLinuxEngine') { throw "Unexpected endpoint: $endpoint" }
Invoke-DesktopDocker context ls
Invoke-DesktopDocker info
Invoke-DesktopDocker ps -a
Invoke-DesktopDocker images -a
Invoke-DesktopDocker compose -f compose.yaml config --quiet
$volumes = @(Invoke-DesktopDocker volume ls -q)
Write-Output "Volumes before cleanup: $($volumes -join ', ')"
foreach ($id in @(Invoke-DesktopDocker ps -q)) { Invoke-DesktopDocker stop $id }
foreach ($id in @(Invoke-DesktopDocker ps -aq)) { Invoke-DesktopDocker rm $id }
Invoke-DesktopDocker image prune --all --force
Invoke-DesktopDocker builder prune --all --force
Invoke-DesktopDocker network prune --force
Invoke-DesktopDocker ps -a
Invoke-DesktopDocker images -a
if (@(Invoke-DesktopDocker ps -aq).Count -or @(Invoke-DesktopDocker images -aq).Count) { throw 'Cleanup incomplete.' }
$remaining = @(Invoke-DesktopDocker volume ls -q)
foreach ($name in $volumes) { if ($remaining -notcontains $name) { throw "Volume missing after cleanup: $name" } }
Write-Output "Confirmed preservation of $($volumes.Count) pre-existing volumes."
& (Join-Path $PSScriptRoot 'verify.ps1')
