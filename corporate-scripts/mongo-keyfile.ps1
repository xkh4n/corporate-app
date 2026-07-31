# MongoDB Keyfile Generator
# Usage: .\mongo-keyfile.ps1 -Environment dev|test|prod

param(
    [Parameter(Mandatory=$true)]
    [ValidateSet('dev', 'test', 'prod')]
    [string]$Environment
)

# Rutas absolutas (no dependen del directorio desde el que se invoque el script)
$repoRoot = Split-Path -Parent $PSScriptRoot
if ($Environment -eq 'dev') {
    $keyfilePath = Join-Path $repoRoot 'corporate-secrets\Development\MongoKeyfile\mongodb_keyfile.txt'
} elseif ($Environment -eq 'test') {
    $keyfilePath = Join-Path $repoRoot 'corporate-secrets\Testing\MongoKeyfile\mongodb_keyfile.txt'
} elseif ($Environment -eq 'prod') {
    $keyfilePath = Join-Path $repoRoot 'corporate-secrets\Production\MongoKeyfile\mongodb_keyfile.txt'
}

# El folder MongoKeyfile puede no existir todavía en ambientes recién creados
$keyfileDir = Split-Path -Parent $keyfilePath
if (-not (Test-Path $keyfileDir)) {
    New-Item -ItemType Directory -Force -Path $keyfileDir | Out-Null
}

Write-Host "Generating MongoDB keyfile for environment: $Environment" -ForegroundColor Cyan

# Check if keyfile already exists
if (Test-Path $keyfilePath) {
    $confirmation = Read-Host "Keyfile already exists. Overwrite? (yes/no)"
    if ($confirmation -ne 'yes') {
        Write-Host "Operation cancelled." -ForegroundColor Yellow
        exit 0
    }
}

# Generate secure random keyfile (1024 bytes base64)
# MongoDB requires keyfile between 6 and 1024 bytes
$bytes = New-Object byte[] 756  # 756 bytes = 1008 base64 chars
$rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
$rng.GetBytes($bytes)
$base64 = [Convert]::ToBase64String($bytes)

# Save to file
$base64 | Out-File -FilePath $keyfilePath -Encoding ASCII -NoNewline

Write-Host "✓ MongoDB keyfile generated successfully" -ForegroundColor Green
Write-Host "  Location: $keyfilePath" -ForegroundColor Gray
Write-Host "  Size: $($base64.Length) characters" -ForegroundColor Gray
Write-Host ""
Write-Host "⚠️  IMPORTANT SECURITY NOTES:" -ForegroundColor Yellow
Write-Host "  1. This keyfile is used for ReplicaSet authentication" -ForegroundColor White
Write-Host "  2. Keep it secure and never commit to Git" -ForegroundColor White
Write-Host "  3. All nodes in the ReplicaSet must use the SAME keyfile" -ForegroundColor White
Write-Host "  4. Rotate this keyfile periodically (recommended: every 90 days)" -ForegroundColor White
Write-Host ""
