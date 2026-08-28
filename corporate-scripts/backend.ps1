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

$composePath     = Join-Path $repoRoot "corporate-api\$composeFile"
$environmentPath = Join-Path $repoRoot 'corporate-secrets\Environment\.env'
$envStackPath    = Join-Path $repoRoot "corporate-secrets\$envFolder\.env"

foreach ($path in @($composePath, $environmentPath, $envStackPath)) {
    if (-not (Test-Path $path)) {
        Write-Error "No se encontro el archivo requerido: $path"
        exit 1
    }
}

# corporate-api depende de la red "backend" del proyecto Compose de
# corporate-infra (ver corporate-api/compose.dev.yml, red "infra-backend"
# external): sin ese stack arriba, "docker compose up" falla al no poder
# resolver una red externa que todavia no existe.
function Get-EnvValue {
    param([string]$Path, [string]$Key)
    $line = Get-Content $Path | Where-Object { $_ -match "^\s*$Key\s*=" } | Select-Object -Last 1
    if (-not $line) { return $null }
    return ($line -split '=', 2)[1].Trim()
}

$infraProjectName = Get-EnvValue -Path $envStackPath -Key 'PROJECT_NAME'
$suffix = Get-EnvValue -Path $envStackPath -Key 'SUFFIX'
$infraNetwork = "${infraProjectName}_backend${suffix}"
if (-not (docker network ls --format '{{.Name}}' | Select-String -Pattern "^$infraNetwork$")) {
    Write-Error "No existe la red '$infraNetwork'. Corre primero 'run.ps1 bdd $Ambiente' para levantar corporate-infra."
    exit 1
}

# Genera (solo si faltan) el usuario de aplicacion de MSSQL y los secrets de
# auth (JWT/sesion) -no interactivo e idempotente, mismo patron que
# ensure-monitoring-secrets.ps1 via corporate-scripts/infra.ps1.
& (Join-Path $PSScriptRoot 'ensure-backend-secrets.ps1') -Environment $Ambiente

# Certificado TLS autofirmado para nginx-apidev (solo si falta): mismo
# criterio idempotente, nunca pisa un certificado real de CA ya instalado.
& (Join-Path $PSScriptRoot 'ensure-api-tls-cert.ps1') -Environment $Ambiente

Write-Host "Levantando stack de backend [$Ambiente] -> $composeFile" -ForegroundColor Cyan

docker compose -f $composePath --env-file $envStackPath --env-file $environmentPath up --wait --wait-timeout 300 --build

if ($LASTEXITCODE -ne 0) {
    Write-Error "docker compose finalizo con codigo $LASTEXITCODE"
    exit $LASTEXITCODE
}

Write-Host "Stack de backend [$Ambiente] arriba y healthy." -ForegroundColor Green
