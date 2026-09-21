# Writes the local security-review marker consumed by
# corporate-scripts/git-hooks/pre-push. Run this AFTER a passing security
# review (cybersecurity-orchestrator, /code-review, or security-audit skill)
# for the commit you are about to push to master.
#
# Usage: corporate-scripts/security-gate-mark.ps1 [-Sha <commit-sha>]
#   -Sha defaults to the current HEAD.

param(
    [string]$Sha
)

$ErrorActionPreference = 'Stop'

$repoRoot = (git rev-parse --show-toplevel).Trim()
Set-Location $repoRoot

if (-not $Sha) {
    $Sha = (git rev-parse HEAD).Trim()
}

$gateDir = Join-Path $repoRoot '.security-gate'
if (-not (Test-Path $gateDir)) {
    New-Item -ItemType Directory -Path $gateDir | Out-Null
}

$reviewer = if ($env:SECURITY_GATE_REVIEWER) { $env:SECURITY_GATE_REVIEWER } else { 'manual' }
$timestamp = [DateTime]::UtcNow.ToString('yyyy-MM-ddTHH:mm:ssZ')

$marker = [ordered]@{
    commit   = $Sha
    reviewer = $reviewer
    verdict  = 'pass'
    at       = $timestamp
}

$markerPath = Join-Path $gateDir 'last-review.json'
$marker | ConvertTo-Json | Set-Content -Path $markerPath -Encoding utf8

Write-Host "security-gate: marked $Sha as reviewed (reviewer=$reviewer) at $timestamp."
Write-Host "  This only affects pushes to master and only on this machine."
