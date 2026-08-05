param(
    [Parameter(Mandatory=$true, Position=0)]
    [ValidateSet('dev', 'prod', 'test')]
    [string]$Ambiente
)

$ErrorActionPreference = 'Stop'

# Raíz del monorepo = carpeta padre de corporate-scripts
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

# Definición de rutas
$composePath     = Join-Path $repoRoot "corporate-monitoring\$composeFile"
$environmentPath = Join-Path $repoRoot 'corporate-secrets\Environment\.env'
$envStackPath    = Join-Path $repoRoot "corporate-secrets\$envFolder\.env"

foreach ($path in @($composePath, $environmentPath, $envStackPath)) {
    if (-not (Test-Path $path)) {
        Write-Error "No se encontró el archivo requerido: $path"
        exit 1
    }
}

# Lee el valor de una clave "NOMBRE=valor" desde el primero de los archivos
# .env que la contenga (mismo orden de precedencia que "--env-file": gana el
# último archivo pasado a docker compose, así que acá se busca primero en el
# más específico del ambiente y se cae al compartido).
function Get-EnvVarValue {
    param(
        [string[]]$Files,
        [string]$Name
    )
    foreach ($file in $Files) {
        $line = Get-Content $file | Where-Object { $_ -match "^\s*$Name\s*=" } | Select-Object -Last 1
        if ($line) {
            return ($line -split '=', 2)[1].Trim()
        }
    }
    return $null
}

# corporate-monitoring/compose.dev.yml declara la red "backend" de
# corporate-infra como "external: true" (Prometheus necesita alcanzar los 8
# exporters, ver la NOTA dejada en corporate-infra/compose.dev.yml junto a
# esa red). Una red "external" que todavía no existe hace fallar el "up" con
# un error de Docker poco claro ("network ... declared as external, but could
# not be found") -se valida ACÁ, con un mensaje explícito, en vez de dejar que
# el usuario tenga que descifrar el error crudo de Docker-.
$projectNameInfra = Get-EnvVarValue -Files @($envStackPath, $environmentPath) -Name 'PROJECT_NAME'
$suffix           = Get-EnvVarValue -Files @($envStackPath, $environmentPath) -Name 'SUFFIX'

if (-not $projectNameInfra -or -not $suffix) {
    Write-Error "No se pudo determinar PROJECT_NAME/SUFFIX desde $envStackPath / $environmentPath"
    exit 1
}

$infraBackendNetwork = "${projectNameInfra}_backend${suffix}"
$networkExists = docker network ls --format '{{.Name}}' | Select-String -Pattern "^$([regex]::Escape($infraBackendNetwork))$"

if (-not $networkExists) {
    Write-Error "La red externa '$infraBackendNetwork' no existe todavía. Corré '.\run.ps1 bdd $Ambiente' primero -el stack de bases de datos (corporate-infra) tiene que estar levantado ANTES que el de monitoreo, para que Prometheus pueda alcanzar sus exporters por nombre-."
    exit 1
}

Write-Host "Red externa '$infraBackendNetwork' encontrada, OK." -ForegroundColor Green

# Mismo motivo que la validación de arriba: corporate-monitoring/compose.dev.yml
# también declara "api-exporters" (red de corporate-api) como external, para
# que Prometheus pueda scrapear las 3 réplicas de la API (ver
# corporate-api/compose.dev.yml).
$projectNameBackend = Get-EnvVarValue -Files @($envStackPath, $environmentPath) -Name 'PROJECT_NAME_BACKEND'
$apiExportersNetwork = "${projectNameBackend}_exporters${suffix}"
$apiNetworkExists = docker network ls --format '{{.Name}}' | Select-String -Pattern "^$([regex]::Escape($apiExportersNetwork))$"

if (-not $apiNetworkExists) {
    Write-Error "La red externa '$apiExportersNetwork' no existe todavía. Corré '.\run.ps1 backend $Ambiente' primero -el stack de la API (corporate-api) tiene que estar levantado ANTES que el de monitoreo, para que Prometheus pueda alcanzar sus réplicas por nombre-."
    exit 1
}

Write-Host "Red externa '$apiExportersNetwork' encontrada, OK." -ForegroundColor Green

Write-Host "Levantando stack de monitoreo [$Ambiente] -> $composeFile" -ForegroundColor Cyan

# --wait implica -d (detached) y espera a que los healthchecks pasen. Sin
# --profile, este "up" NO levanta grafana-init<Ambiente> (profile "init",
# ver más abajo).
docker compose -f $composePath --env-file $envStackPath --env-file $environmentPath up --wait --wait-timeout 300

if ($LASTEXITCODE -ne 0) {
    Write-Error "docker compose finalizó con código $LASTEXITCODE"
    exit $LASTEXITCODE
}

# grafana-init<Ambiente> vive bajo el profile "init": no lo levanta el "up" de
# arriba. Se corre aparte con "run --rm" -mismo patrón que mssql-initdev en
# corporate-infra/corporate-scripts/infra.ps1-. Idempotente (guarda vía
# /api/users/lookup contra el estado real de Grafana, ver
# Grafana/init/create-viewer-user.sh), así que repetir la corrida en un
# ambiente ya inicializado no hace nada.
$grafanaInitService = "grafana-init$Ambiente"
Write-Host "Creando usuario secundario de Grafana (rol Viewer)..." -ForegroundColor Cyan
docker compose -f $composePath --env-file $envStackPath --env-file $environmentPath run --rm $grafanaInitService

if ($LASTEXITCODE -ne 0) {
    Write-Error "$grafanaInitService finalizó con código $LASTEXITCODE"
    exit $LASTEXITCODE
}

$monitoringProxyPort = Get-EnvVarValue -Files @($envStackPath, $environmentPath) -Name 'MONITORING_PROXY_PORT'
Write-Host "Stack de monitoreo [$Ambiente] arriba y healthy. Grafana disponible en http://localhost:$monitoringProxyPort" -ForegroundColor Green
