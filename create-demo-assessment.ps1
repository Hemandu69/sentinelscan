# Run once per intended assessment. A confirmation receipt is never retried automatically.
$ErrorActionPreference = 'Stop'
$base = 'http://127.0.0.1:4000'
$target = 'http://juice-shop:3000/'
$opts = @{ MaximumRedirection = 0; TimeoutSec = 10; ErrorAction = 'Stop' }
if ((Invoke-RestMethod @opts -Uri "$base/health/database").status -ne 'ok') { throw 'PostgreSQL is unavailable.' }
if ((Invoke-RestMethod @opts -Uri "$base/health/zap").version -ne '2.17.0') { throw 'Fastify cannot authenticate to ZAP 2.17.0.' }
$sites = @(Invoke-RestMethod @opts -Uri "$base/api/v1/targets" | ForEach-Object { $_ } | Where-Object { $_.canonicalUrl -ceq $target })
if ($sites.Count -gt 1) { throw 'Ambiguous target record.' }
if ($sites.Count -eq 0) {
    $body = @{displayName='Local Juice Shop';url=$target} | ConvertTo-Json -Compress
    $site = Invoke-RestMethod @opts -Method Post -ContentType 'application/json' -Body $body -Uri "$base/api/v1/targets"
} else { $site = $sites[0] }
$detail = Invoke-RestMethod @opts -Uri "$base/api/v1/targets/$($site.id)"
if ($detail.canonicalUrl -cne $target -or $detail.confirmation.url -cne $target -or !$detail.confirmation.token) { throw 'Consent scope mismatch.' }
Write-Host "Authorized target: $target"
Write-Host $detail.confirmation.wording
if ((Read-Host 'Type AUTHORIZE to create one pending assessment') -cne 'AUTHORIZE') { return }
$body = @{targetId=$site.id;url=$target;authorized=$true;authorizationTextVersion=$detail.confirmation.version;confirmationToken=$detail.confirmation.token} | ConvertTo-Json -Compress
$row = Invoke-RestMethod @opts -Method Post -ContentType 'application/json' -Body $body -Uri "$base/api/v1/assessments"
if ($row.targetId -ne $site.id -or $row.targetUrlSnapshot -cne $target -or $row.status -ne 'PENDING') { throw 'Unexpected creation receipt. Check assessment history before retrying.' }
$row | Select-Object id,targetUrlSnapshot,status,requestedAt
