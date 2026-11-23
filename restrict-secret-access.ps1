# Removes one principal's access from the SentinelScan secrets and backups. Reports only unless -Apply is given.
# Every other entry and the owner are preserved. File contents are never read, moved or changed.
param(
    [string]$Principal = 'CodexSandboxUsers',
    [string[]]$Path = @(
        (Join-Path $env:LOCALAPPDATA 'SentinelScan\backups'),
        (Join-Path $PSScriptRoot '.env'),
        (Join-Path $PSScriptRoot '..\sentinelscan-api\.env')
    ),
    [switch]$Apply
)
$ErrorActionPreference = 'Stop'
$sidType = [Security.Principal.SecurityIdentifier]
$sid = (New-Object Security.Principal.NTAccount $Principal).Translate($sidType)
$protected = @('S-1-5-18', 'S-1-5-32-544', [Security.Principal.WindowsIdentity]::GetCurrent().User.Value)
if ($protected -contains $sid.Value) { throw 'Refusing to remove the owner, SYSTEM or Administrators.' }

function Get-Security($item) {
    if ($item.PSIsContainer) { [IO.Directory]::GetAccessControl($item.FullName, 'Access, Owner') }
    else { [IO.File]::GetAccessControl($item.FullName, 'Access, Owner') }
}
function Get-Entries($security) {
    @($security.GetAccessRules($true, $true, $sidType) | ForEach-Object {
        "$($_.IdentityReference.Value)|$($_.AccessControlType)|$([int]$_.FileSystemRights)|$($_.InheritanceFlags)|$($_.PropagationFlags)"
    })
}
# Check every path before changing any of them.
$items = @(foreach ($entry in $Path) {
    $item = Get-Item -LiteralPath $entry -Force
    if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint -and $item.LinkType) { throw "Links are not supported: $($item.FullName)" }
    $item
})
foreach ($item in $items) {
    $security = Get-Security $item
    $owner = $security.GetOwner($sidType).Value
    $before = @(Get-Entries $security)
    $expected = @($before | Where-Object { $_ -notlike "$($sid.Value)|*" } | Sort-Object)
    Write-Output "$($item.FullName)"
    foreach ($rule in $security.GetAccessRules($true, $true, [Security.Principal.NTAccount])) {
        $mark = if ($rule.IdentityReference.Translate($sidType) -eq $sid) { 'REMOVE' } else { 'keep' }
        Write-Output "  $mark $($rule.IdentityReference) $($rule.AccessControlType) $($rule.FileSystemRights) inherited=$($rule.IsInherited)"
    }
    if ($before.Count -eq $expected.Count) { Write-Output '  Nothing to remove.'; continue }
    foreach ($required in $protected) {
        if (-not ($before -like "$required|Allow|2032127|*")) { throw "Required full control is missing on $($item.FullName). Nothing was changed on this path." }
    }
    if (-not $Apply) { continue }
    # Keep inherited entries as explicit copies, then drop the principal. Only access rules are written.
    $change = if ($item.PSIsContainer) { [IO.Directory]::GetAccessControl($item.FullName, 'Access') } else { [IO.File]::GetAccessControl($item.FullName, 'Access') }
    $change.SetAccessRuleProtection($true, $true)
    if ($item.PSIsContainer) { [IO.Directory]::SetAccessControl($item.FullName, $change) } else { [IO.File]::SetAccessControl($item.FullName, $change) }
    $change = if ($item.PSIsContainer) { [IO.Directory]::GetAccessControl($item.FullName, 'Access') } else { [IO.File]::GetAccessControl($item.FullName, 'Access') }
    $change.PurgeAccessRules($sid)
    if ($item.PSIsContainer) { [IO.Directory]::SetAccessControl($item.FullName, $change) } else { [IO.File]::SetAccessControl($item.FullName, $change) }
    $after = Get-Security $item
    $actual = @(Get-Entries $after | Sort-Object)
    if (Compare-Object $expected $actual) { throw "Unexpected permissions on $($item.FullName). Review them before continuing." }
    if ($after.GetOwner($sidType).Value -ne $owner) { throw "Owner changed on $($item.FullName)." }
    if ($item.PSIsContainer) {
        foreach ($child in Get-ChildItem -LiteralPath $item.FullName -Recurse -Force) {
            if ((Get-Entries (Get-Security $child)) -like "$($sid.Value)|*") { throw "Access remains on $($child.FullName)." }
        }
    }
    Write-Output '  Applied and verified.'
}
if (-not $Apply) { Write-Output 'Report only. Review the lines above, then add -Apply.' }
