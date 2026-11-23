# Removes explicitly selected SentinelScan containers, and nothing else.
# Never removes images, volumes, networks or build cache, and never starts anything afterwards.
# Without -Remove it only reports what would be removed.
param(
    [Parameter(Mandatory=$true)]
    [ValidateSet('postgres','zap','juice-shop')]
    [string[]]$Service,
    [switch]$Remove,
    [switch]$DiscardZapSession
)
$ErrorActionPreference = 'Stop'
$project = 'sentinelscan-infrastructure'
function Invoke-Docker {
    $out = & docker --context desktop-linux @args
    if ($LASTEXITCODE -ne 0) { throw "Docker command failed (exit $LASTEXITCODE): $($args[0])" }
    return $out
}
$endpoint = Invoke-Docker context inspect desktop-linux --format '{{.Endpoints.docker.Host}}'
if ($endpoint -cne 'npipe:////./pipe/dockerDesktopLinuxEngine') { throw 'Unexpected Docker endpoint.' }
$selected = @($Service | ForEach-Object { $_.ToLowerInvariant() } | Select-Object -Unique)
if ($Remove -and $selected -contains 'zap' -and -not $DiscardZapSession) {
    throw 'Removing zap discards its session and run evidence. Add -DiscardZapSession to accept that.'
}
# Identify every target first. Any mismatch stops the script before anything is touched.
$targets = @()
foreach ($name in $selected) {
    $container = "$project-$name-1"
    # Labels are read as JSON because Windows PowerShell drops embedded quotes from native arguments.
    $row = Invoke-Docker inspect --type container --format '{{.Id}}|{{.Name}}|{{json .Config.Labels}}' $container
    $parts = "$row".Split([char[]]'|', 3)
    if ($parts.Count -ne 3 -or $parts[0] -cnotmatch '^[a-f0-9]{64}$' -or $parts[1] -cne "/$container") {
        throw "$container is not the expected SentinelScan container. Nothing was removed."
    }
    $labels = $parts[2] | ConvertFrom-Json
    if ($labels.'com.docker.compose.project' -cne $project -or $labels.'com.docker.compose.service' -cne $name) {
        throw "$container is not the expected SentinelScan container. Nothing was removed."
    }
    $targets += [pscustomobject]@{ Name = $container; Id = $parts[0] }
}
foreach ($target in $targets) { Write-Output "Selected: $($target.Name) $($target.Id)" }
if (-not $Remove) { Write-Output 'Report only. Add -Remove to remove the selected containers.'; return }
$volumes = @(Invoke-Docker volume ls -q)
foreach ($target in $targets) {
    Invoke-Docker stop $target.Id | Out-Null
    Invoke-Docker rm $target.Id | Out-Null
    Write-Output "Removed container: $($target.Name)"
}
$remaining = @(Invoke-Docker volume ls -q)
foreach ($name in $volumes) { if ($remaining -cnotcontains $name) { throw "Volume missing after removal: $name" } }
Write-Output "Confirmed $($volumes.Count) existing volumes. Images, networks and other containers were not touched."
