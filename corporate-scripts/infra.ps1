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
$composePath     = Join-Path $repoRoot "corporate-infra\$composeFile"
$environmentPath = Join-Path $repoRoot 'corporate-secrets\Environment\.env'
$envStackPath    = Join-Path $repoRoot "corporate-secrets\$envFolder\.env"

foreach ($path in @($composePath, $environmentPath, $envStackPath)) {
    if (-not (Test-Path $path)) {
        Write-Error "No se encontró el archivo requerido: $path"
        exit 1
    }
}

Write-Host "Levantando stack de bases de datos [$Ambiente] -> $composeFile" -ForegroundColor Cyan

# --env-file admite múltiples ocurrencias: docker compose las mezcla en orden,
# y en caso de clave repetida gana la del último archivo (Environment/.env).
# --wait implica -d (detached) y espera a que los healthchecks pasen.
docker compose -f $composePath --env-file $envStackPath --env-file $environmentPath up --wait --wait-timeout 300

if ($LASTEXITCODE -ne 0) {
    Write-Error "docker compose finalizó con código $LASTEXITCODE"
    exit $LASTEXITCODE
}

# mssql-init<Ambiente> vive bajo el profile "init": no lo levanta el "up" de
# arriba. Se corre aparte con "run --rm" para que, a diferencia de un service
# normal, el contenedor se autoelimine al terminar en vez de quedar dando
# vueltas en estado "Exited". Es idempotente (guardias "IF NOT EXISTS" contra
# el estado real de cada instancia, ver setup-ag.sh), así que repetir la
# corrida en un ambiente ya inicializado no hace nada.
$mssqlInitService = "mssql-init$Ambiente"
Write-Host "Ejecutando bootstrap del Availability Group de MSSQL..." -ForegroundColor Cyan
docker compose -f $composePath --env-file $envStackPath --env-file $environmentPath run --rm $mssqlInitService

if ($LASTEXITCODE -ne 0) {
    Write-Error "$mssqlInitService finalizó con código $LASTEXITCODE"
    exit $LASTEXITCODE
}

Write-Host "Stack de bases de datos [$Ambiente] arriba y healthy." -ForegroundColor Green
