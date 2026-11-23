# Verifies the existing SentinelScan services. Never creates, recreates or replaces a container.
# By default nothing is restarted or written. -PersistenceRestart additionally restarts PostgreSQL
# only, to prove that a marker row survives. The ZAP container is never restarted because its
# in-memory session holds run evidence.
param([switch]$PersistenceRestart)
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
$project = 'sentinelscan-infrastructure'
function Invoke-Docker {
    $out = & docker --context desktop-linux @args
    if ($LASTEXITCODE -ne 0) { throw "Docker command failed (exit $LASTEXITCODE): $($args[0])" }
    return $out
}
function Invoke-Compose { Invoke-Docker compose -p $project -f compose.yaml @args }
function Invoke-Sql([string]$sql) {
    $out = $sql | docker --context desktop-linux compose -p $project -f compose.yaml exec -T postgres sh -ec 'export PGPASSWORD=$POSTGRES_PASSWORD; exec psql -qXAt -v ON_ERROR_STOP=1 -h 127.0.0.1 -U sentinel -d sentinelscan'
    if ($LASTEXITCODE -ne 0) { throw 'PostgreSQL command failed.' }
    return $out
}
function Get-Identity([string]$service) {
    $id = @(Invoke-Compose ps -q $service)
    if ($id.Count -ne 1 -or $id[0] -notmatch '^[a-f0-9]{12,64}$') {
        throw "Expected one running $service container. This script does not create containers. See README.md."
    }
    return (Invoke-Docker inspect --format '{{.Id}}|{{.State.StartedAt}}|{{.State.Status}}|{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' $id[0])
}
function Assert-Healthy([string]$service, [string]$identity) {
    $expected = if ($service -eq 'juice-shop') { '\|running\|(none|healthy)$' } else { '\|running\|healthy$' }
    if ($identity -notmatch $expected) { throw "$service is not running and healthy." }
}
Invoke-Compose config --quiet
$before = @{}
foreach ($service in 'postgres','zap','juice-shop') {
    $before[$service] = Get-Identity $service
    Assert-Healthy $service $before[$service]
}
Write-Output 'Existing containers are running and healthy.'
if ((Invoke-Sql 'SELECT 1') -ne '1') { throw 'Unexpected PostgreSQL response.' }
if ($PersistenceRestart) {
    $marker = [guid]::NewGuid().ToString()
    Invoke-Sql 'CREATE TABLE IF NOT EXISTS stage1_persistence_check (marker uuid PRIMARY KEY)'
    Invoke-Sql "INSERT INTO stage1_persistence_check VALUES ('$marker')"
    $query = "SELECT marker FROM stage1_persistence_check WHERE marker = '$marker'"
    if ((Invoke-Sql $query) -ne $marker) { throw 'Initial marker mismatch.' }
    Invoke-Compose restart --no-deps postgres
    $healthy = $false
    foreach ($attempt in 1..60) {
        if ((Get-Identity 'postgres') -match '\|running\|healthy$') { $healthy = $true; break }
        Start-Sleep -Seconds 2
    }
    if (-not $healthy) { throw 'PostgreSQL did not become healthy after restart.' }
    if ((Invoke-Sql $query) -ne $marker) { throw 'Persistence check failed.' }
    Invoke-Sql "DELETE FROM stage1_persistence_check WHERE marker = '$marker'"
    Write-Output 'PostgreSQL persistence marker survived the restart.'
}
& node ./verify-zap.cjs
if ($LASTEXITCODE -ne 0) { throw 'ZAP credential verification failed.' }
foreach ($service in 'postgres','zap','juice-shop') {
    $now = Get-Identity $service
    Assert-Healthy $service $now
    $old = $before[$service] -split '\|'
    $new = $now -split '\|'
    $restarted = $old[1] -ne $new[1] -and -not ($PersistenceRestart -and $service -eq 'postgres')
    if ($old[0] -ne $new[0] -or $restarted) { throw "$service changed while it was being verified." }
}
Write-Output 'Verification passed. Container identities are unchanged.'
