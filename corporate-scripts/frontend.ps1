param(
    [Parameter(Mandatory=$true, Position=0)]
    [ValidateSet('dev', 'prod', 'test')]
    [string]$Ambiente
)

$ErrorActionPreference = 'Stop'

# Raiz del monorepo = carpeta padre de corporate-scripts
$repoRoot = Split-Path -Parent $PSScriptRoot

$envFolder = switch ($Ambiente) {
    'dev'  { 'Development' }
    'prod' { 'Production' }
    'test' { 'Testing' }
}

$composeFile = switch ($Ambiente) {
    'dev'  { 'compose.dev.yml' }
    'prod' { 'compose.prod.yml' }
    'test' { 'compose.test.yml' }
}

$composePath     = Join-Path $repoRoot "corporate-front\$composeFile"
$environmentPath = Join-Path $repoRoot 'corporate-secrets\Environment\.env'
$envStackPath    = Join-Path $repoRoot "corporate-secrets\$envFolder\.env"

foreach ($path in @($composePath, $environmentPath, $envStackPath)) {
    if (-not (Test-Path $path)) {
        Write-Error "No se encontro el archivo requerido: $path"
        exit 1
    }
}

# A diferencia de corporate-api, corporate-front no depende de ninguna red
# externa de otro stack Compose: llega a la API por su puerto YA PUBLICADO
# (ALLOCATED_IP + API_SSL_PORT, ver nginx/config/nginx.conf.template), no por
# Docker DNS cross-stack. Tampoco tiene secrets propios (sin
# ensure-*-secrets.ps1) -solo necesita su certificado TLS.
& (Join-Path $PSScriptRoot 'ensure-front-tls-cert.ps1') -Environment $Ambiente

Write-Host "Levantando stack de frontend [$Ambiente] -> $composeFile" -ForegroundColor Cyan

docker compose -f $composePath --env-file $envStackPath --env-file $environmentPath up --wait --wait-timeout 300 --build

if ($LASTEXITCODE -ne 0) {
    Write-Error "docker compose finalizo con codigo $LASTEXITCODE"
    exit $LASTEXITCODE
}

Write-Host "Stack de frontend [$Ambiente] arriba y healthy." -ForegroundColor Green
