param([Parameter(Mandatory=$true)][guid]$AssessmentId)
$ErrorActionPreference = 'Stop'
$base = 'http://127.0.0.1:4000'
$target = 'http://juice-shop:3000/'
$opts = @{ MaximumRedirection = 0; TimeoutSec = 15; ErrorAction = 'Stop' }
$infra = Join-Path $PSScriptRoot '../sentinelscan-infrastructure'
function Get-DaemonStamp {
    $id = docker --context desktop-linux compose --project-directory $infra -f "$infra/compose.yaml" ps -q zap
    if ($LASTEXITCODE -ne 0 -or !$id) { throw 'ZAP container identity unavailable.' }
    $binding = docker --context desktop-linux port $id 8090/tcp
    if ($LASTEXITCODE -ne 0 -or $binding -cne '127.0.0.1:8090') { throw 'Unexpected daemon binding.' }
    $stamp = docker --context desktop-linux inspect --format '{{.Id}} {{.State.StartedAt}}' $id
    if ($LASTEXITCODE -ne 0 -or !$stamp) { throw 'ZAP container start time unavailable.' }
    return $stamp
}
$stamp = Get-DaemonStamp
$a = Invoke-RestMethod @opts -Uri "$base/api/v1/assessments/$AssessmentId"
if ($a.id -ne $AssessmentId -or $a.targetUrlSnapshot -cne $target) { throw 'Assessment ID or authorized scope mismatch.' }
Write-Output "Assessment $AssessmentId; target $target; assessment state $($a.status); container $stamp; observed $([datetime]::UtcNow.ToString('o'))"
foreach ($kind in 'spider','active') {
    $listing = Invoke-RestMethod @opts -Uri "$base/api/v1/integrations/zap/scans?kind=$kind"
    if ($listing.provider.endpoint -cne 'http://127.0.0.1:8090' -or $listing.provider.version -cne '2.17.0' -or $null -eq $listing.runs) { throw 'Unexpected provider identity or listing.' }
    Write-Output "$kind listed runs $($listing.runs.Count)"
    foreach ($run in $listing.runs) {
        if ($run.kind -ne $kind -or $run.id -notmatch '^[0-9]{1,12}$') { throw 'Invalid provider run identity.' }
        $match = if (!$run.reportedOrigin) {'Unavailable'} elseif ($run.reportedOrigin -ceq 'http://juice-shop:3000') {'Matches origin only'} else {'Outside authorized origin'}
        [pscustomobject]@{Kind=$kind;Id=$run.id;ProviderState=$run.state;ReportedProgress=$run.progress;ReportedOrigin=$run.reportedOrigin;ScopeComparison=$match}
    }
}
Push-Location -LiteralPath $PSScriptRoot
try {
    npm.cmd run inspect:zap
    if ($LASTEXITCODE -ne 0) { throw 'Independent progress or attributed ID inspection failed.' }
} finally { Pop-Location }
if ((Get-DaemonStamp) -cne $stamp) { throw 'Daemon changed while collecting evidence. Discard this observation.' }
