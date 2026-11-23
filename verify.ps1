# Run from the infrastructure repository on the Docker Desktop host.
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
function Invoke-Compose {
    & docker --context desktop-linux compose -f compose.yaml @args
    if ($LASTEXITCODE -ne 0) { throw "Compose command failed (exit $LASTEXITCODE)." }
}
function Invoke-Sql([string]$sql) {
    $sql | docker --context desktop-linux compose -f compose.yaml exec -T postgres sh -ec 'export PGPASSWORD=$POSTGRES_PASSWORD; exec psql -XAt -v ON_ERROR_STOP=1 -h 127.0.0.1 -U sentinel -d sentinelscan'
    if ($LASTEXITCODE -ne 0) { throw 'PostgreSQL command failed.' }
}
Invoke-Compose config --quiet
Invoke-Compose up -d --wait --wait-timeout 240
Invoke-Compose ps
$marker = [guid]::NewGuid().ToString()
Invoke-Sql 'CREATE TABLE IF NOT EXISTS stage1_persistence_check (marker uuid PRIMARY KEY)'
Invoke-Sql "INSERT INTO stage1_persistence_check VALUES ('$marker')"
$query = "SELECT marker FROM stage1_persistence_check WHERE marker = '$marker'"
if ((Invoke-Sql $query) -ne $marker) { throw 'Initial marker mismatch.' }
Write-Output "Marker before restart: $marker"
Invoke-Compose restart postgres zap
Invoke-Compose up -d --wait --wait-timeout 240
Invoke-Compose ps
$after = Invoke-Sql $query
if ($after -ne $marker) { throw 'Persistence check failed.' }
Write-Output "Marker after restart: $after"
Invoke-Sql "DELETE FROM stage1_persistence_check WHERE marker = '$marker'"
& node ./verify-zap.cjs
if ($LASTEXITCODE -ne 0) { throw 'ZAP credential verification failed.' }
Write-Output 'Stage 1 acceptance passed.'



