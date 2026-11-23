# Windows PowerShell 5.1. Stop SentinelScan in its API terminal (Ctrl+C) first.
# -AssessmentId names an existing authorized demo assessment that must survive the migration.
param([Parameter(Mandatory=$true)][guid]$AssessmentId)
$ErrorActionPreference = 'Stop'
$infra = Join-Path $PSScriptRoot '..\sentinelscan-infrastructure'
$ctx = @('--context', 'desktop-linux')
Push-Location $PSScriptRoot
try {
    if ([Net.NetworkInformation.IPGlobalProperties]::GetIPGlobalProperties().GetActiveTcpListeners().Port -contains 4000) {
        throw 'Stop the API in its own terminal before applying the migration.'
    }
    $engine = docker @ctx info --format '{{.OSType}}'
    if ($LASTEXITCODE -ne 0 -or $engine -ne 'linux') { throw 'Linux engine unavailable.' }
    $pg = docker @ctx compose --project-directory $infra ps -q postgres
    if ($LASTEXITCODE -ne 0 -or !$pg) { throw 'Existing PostgreSQL container unavailable.' }
    $health = docker @ctx inspect --format '{{.State.Health.Status}}' $pg
    if ($LASTEXITCODE -ne 0 -or $health -ne 'healthy') { throw 'PostgreSQL is not healthy.' }
    $address = docker @ctx compose --project-directory $infra port postgres 5432
    if ($LASTEXITCODE -ne 0 -or $address -ne '127.0.0.1:5432') { throw 'Unexpected database port binding.' }
    node --env-file=.env --input-type=module -e "import {validateLocalDatabaseUrl} from './src/config/local.ts'; validateLocalDatabaseUrl(process.env.DATABASE_URL)"
    if ($LASTEXITCODE -ne 0) { throw 'Database URL verification failed.' }

    function Read-Database([string]$query) {
        $rows = $query | docker @ctx exec -i $pg psql -X -qAt -v ON_ERROR_STOP=1 -U sentinel -d sentinelscan
        if ($LASTEXITCODE -ne 0) { throw 'Independent database query failed.' }
        return $rows
    }
    $authorized = Read-Database "SELECT count(*) FROM sentinelscan.assessments a JOIN sentinelscan.targets t ON t.id=a.target_id WHERE a.id='$AssessmentId' AND a.target_url_snapshot='http://juice-shop:3000/' AND t.canonical_url=a.target_url_snapshot AND a.authorization_confirmed_at IS NOT NULL;"
    if ($authorized -ne '1') { throw 'Expected authorized assessment and target were not found.' }
    $tables = @('targets','assessments','findings','reports')
    function Read-Snapshot {
        foreach ($table in $tables) {
            Read-Database "SELECT count(*) || ':' || md5(coalesce(string_agg(md5(to_jsonb(r)::text),'' ORDER BY r.id),'')) FROM sentinelscan.$table r;"
        }
    }
    $before = @(Read-Snapshot)
    $name = 'sentinelscan-' + [guid]::NewGuid().ToString() + '.dump'
    $folder = Join-Path $env:LOCALAPPDATA 'SentinelScan\backups'
    New-Item -Type Directory -Force -Path $folder | Out-Null
    $copy = Join-Path $folder $name
    docker @ctx exec $pg pg_dump -U sentinel -d sentinelscan -Fc -f "/tmp/$name"
    if ($LASTEXITCODE -ne 0) { throw 'Backup failed.' }
    docker @ctx exec $pg pg_restore --file=/dev/null "/tmp/$name"
    if ($LASTEXITCODE -ne 0) { throw 'Backup archive failed full extraction.' }
    docker @ctx cp "${pg}:/tmp/$name" $copy
    if ($LASTEXITCODE -ne 0) { throw 'Backup copy failed.' }
    $sum = docker @ctx exec $pg sha256sum "/tmp/$name"
    if ($LASTEXITCODE -ne 0 -or ($sum -split ' ')[0] -ne (Get-FileHash $copy).Hash) { throw 'Backup checksum mismatch.' }
    Write-Output "Verified backup: $copy"
    npm.cmd run generate
    if ($LASTEXITCODE -ne 0) { throw 'Client generation failed before migration.' }
    npm.cmd run migrate
    if ($LASTEXITCODE -ne 0) { throw 'Migration failed. Preserve backup and inspect migration status.' }
    if ((Read-Database "SELECT to_regclass('sentinelscan.assessment_runs') IS NOT NULL") -ne 't') { throw 'Run storage table missing.' }
    $after = @(Read-Snapshot)
    for ($i=0; $i -lt $tables.Count; $i++) {
        if ($before[$i] -ne $after[$i]) { throw "Existing $($tables[$i]) changed. Preserve the backup for review." }
        Write-Output "$($tables[$i]): contents verified"
    }
} finally { Pop-Location }
