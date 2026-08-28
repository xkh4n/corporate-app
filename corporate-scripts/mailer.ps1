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

$composePath     = Join-Path $repoRoot "corporate-mailer\$composeFile"
$environmentPath = Join-Path $repoRoot 'corporate-secrets\Environment\.env'
$envStackPath    = Join-Path $repoRoot "corporate-secrets\$envFolder\.env"

foreach ($path in @($composePath, $environmentPath, $envStackPath)) {
    if (-not (Test-Path $path)) {
        Write-Error "No se encontro el archivo requerido: $path"
        exit 1
    }
}

# A diferencia de backend.ps1/monitoring.ps1, corporate-mailer NO depende de
# corporate-infra (no toca ninguna base de datos, es justamente el unico
# contenedor con salida a internet). Solo necesita que exista la red
# compartida "mailer-net-<ambiente>" -la crea root run.ps1 (mismo patron que
# backend-net-<ambiente>/frontend-net-<ambiente>) antes de llamar a este
# script, asi que no importa el orden relativo con "run.ps1 backend".
function Get-EnvValue {
    param([string]$Path, [string]$Key)
    $line = Get-Content $Path | Where-Object { $_ -match "^\s*$Key\s*=" } | Select-Object -Last 1
    if (-not $line) { return $null }
    return ($line -split '=', 2)[1].Trim()
}

$mailerNetwork = "mailer-net-$Ambiente"
if (-not (docker network ls --format '{{.Name}}' | Select-String -Pattern "^$([regex]::Escape($mailerNetwork))$")) {
    Write-Error "No existe la red '$mailerNetwork'. Corre '.\run.ps1 mailer $Ambiente' desde la raiz del repo (root run.ps1 crea la red antes de llegar aca)."
    exit 1
}

# Genera (solo si faltan) el secreto compartido con corporate-api y el
# placeholder de la password SMTP -no interactivo, idempotente.
& (Join-Path $PSScriptRoot 'ensure-mailer-secrets.ps1') -Environment $Ambiente

Write-Host "Levantando stack de mailer [$Ambiente] -> $composeFile" -ForegroundColor Cyan

docker compose -f $composePath --env-file $envStackPath --env-file $environmentPath up --wait --wait-timeout 120 --build

if ($LASTEXITCODE -ne 0) {
    Write-Error "docker compose finalizo con codigo $LASTEXITCODE"
    exit $LASTEXITCODE
}

Write-Host "Stack de mailer [$Ambiente] arriba y healthy." -ForegroundColor Green
