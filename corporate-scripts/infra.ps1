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

# Genera (solo si faltan) los secretos de los usuarios de metricas/exporters
# de Prometheus antes de levantar el stack -no interactivo e idempotente, ver
# ensure-monitoring-secrets.ps1-, para que "run.ps1 bdd <ambiente>" deje el
# ambiente listo para scrapear sin que haga falta acordarse de un paso manual.
& (Join-Path $PSScriptRoot 'ensure-monitoring-secrets.ps1') -Environment $Ambiente

Write-Host "Levantando stack de bases de datos [$Ambiente] -> $composeFile" -ForegroundColor Cyan

# --env-file admite múltiples ocurrencias: docker compose las mezcla en orden,
# y en caso de clave repetida gana la del último archivo (Environment/.env).
# --wait implica -d (detached) y espera a que los healthchecks pasen. Sin
# --profile, este "up" NO levanta servicios con profile propio: ni
# mssql-init<Ambiente> (profile "init") ni mssql-exporter0N<Ambiente>
# (profile "mssql-monitoring", ver más abajo por qué).
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

# Recién ahora, con mssql-initdev ya corrido, existe el login SQL de métricas
# (MSSQL_EXPORTER_USER, creado en setup-ag.sh) que necesitan estos dos
# exporters para pasar su propio healthcheck. Viven bajo el profile
# "mssql-monitoring" -a propósito, NO junto al resto en el "up" de arriba-:
# si arrancaran antes de este punto (profile default, junto a todo lo demás),
# su healthcheck jamás pasaría porque el login todavía no existiría, el
# "up --wait" inicial agotaría sus 300s esperándolos, fallaría, y
# mssql-initdev nunca llegaría a correr -deadlock circular real, encontrado
# por reality-checker con un "run.ps1 bdd dev" desde cero-. Separarlos rompe
# el ciclo: ahora arrancan en su propio paso, después de que el login ya
# existe. 60s de timeout alcanza de sobra (confirmado: pasan a healthy en
# ~8s, un solo ciclo de healthcheck, una vez que el login existe).
$mssqlExporter1Service = "mssql-exporter01$Ambiente"
$mssqlExporter2Service = "mssql-exporter02$Ambiente"
Write-Host "Levantando exporters de métricas de MSSQL..." -ForegroundColor Cyan
docker compose -f $composePath --env-file $envStackPath --env-file $environmentPath --profile mssql-monitoring up --wait --wait-timeout 60 $mssqlExporter1Service $mssqlExporter2Service

if ($LASTEXITCODE -ne 0) {
    Write-Error "Exporters de MSSQL finalizaron con código $LASTEXITCODE"
    exit $LASTEXITCODE
}

Write-Host "Stack de bases de datos [$Ambiente] arriba y healthy." -ForegroundColor Green
