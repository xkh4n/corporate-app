# Ensure Monitoring Secrets Generator
# Uso: .\ensure-monitoring-secrets.ps1 -Environment dev|test|prod
#
# Genera, SOLO si faltan, los archivos de password de los usuarios de metricas
# (exporters de Prometheus) de cada motor de base de datos. A diferencia de
# mongo-keyfile.ps1 (que pregunta antes de sobreescribir), este script es
# NO interactivo e IDEMPOTENTE: nunca pregunta nada y nunca toca un secreto
# que ya existe -si el archivo esta, se omite tal cual esta. Regenerarlo en
# silencio dejaria el usuario ya creado en la base con un password viejo que
# ya no coincide con el secret nuevo (la unica forma de "rotar" es borrar el
# archivo a mano y dejar que el motor recree el usuario, igual que el resto
# de los secretos de este proyecto).
#
# Pensado para correr en cada "run.ps1 bdd <ambiente>", ANTES de "docker
# compose up" (ver corporate-scripts/infra.ps1), para que el ambiente quede
# listo para scrapear sin que el usuario tenga que acordarse de un paso manual.

param(
    [Parameter(Mandatory=$true)]
    [ValidateSet('dev', 'test', 'prod')]
    [string]$Environment
)

$ErrorActionPreference = 'Stop'

# Rutas absolutas (no dependen del directorio desde el que se invoque el script)
$repoRoot = Split-Path -Parent $PSScriptRoot
$envFolder = switch ($Environment) {
    'dev'  { 'Development' }
    'test' { 'Testing' }
    'prod' { 'Production' }
}

$secretsDir = Join-Path $repoRoot "corporate-secrets\$envFolder"
if (-not (Test-Path $secretsDir)) {
    # No deberia pasar en un ambiente ya inicializado (infra.ps1 ya valida que
    # exista corporate-secrets\<Ambiente>\.env antes de llegar aca), pero por
    # las dudas se crea para que este script tambien pueda correr solo.
    New-Item -ItemType Directory -Force -Path $secretsDir | Out-Null
}

# Passwords de exporters de Prometheus que necesita el stack. Se listan TODOS
# -incluidos los que ya existen desde antes (pg_exporter_password,
# db_mongo_exporter)- para que este script sea el punto unico de verdad de
# "que secretos de monitoreo hacen falta"; pero solo se genera el archivo
# cuando falta, los que ya existen no se tocan ni se leen.
$monitoringSecrets = @(
    'pg_exporter_password.txt',
    'db_mongo_exporter.txt',
    'redis_exporter_password.txt',
    'mssql_exporter_password.txt'
)

# Devuelve un indice aleatorio criptograficamente seguro en [0, Max).
function Get-RandomIndex {
    param(
        [System.Security.Cryptography.RandomNumberGenerator]$Rng,
        [int]$Max
    )
    $bytes = New-Object byte[] 4
    $Rng.GetBytes($bytes)
    return [BitConverter]::ToUInt32($bytes, 0) % $Max
}

# Password fuerte, alfanumerico + un set de simbolos deliberadamente acotado
# a los "URL/shell-safe": ni siquiera intenta usar el charset completo de
# simbolos porque estos passwords terminan interpolados en lugares fragiles
# (DSNs de connection string, comandos "ACL SETUSER" de Redis, heredocs de
# shell) donde un caracter como @ : / \ ' " $ ` # ? & % espacio puede romper
# el parseo -exactamente el tipo de bug que ya salio una vez en este proyecto
# con la interpolacion de un --eval de mongosh. Garantiza ademas al menos un
# caracter de cada categoria (mayuscula, minuscula, digito, simbolo) para
# cumplir politicas de complejidad como la de SQL Server sin depender del
# azar ni tener que desactivar CHECK_POLICY.
function New-StrongPassword {
    param([int]$Length = 32)

    $upper  = [char[]]'ABCDEFGHJKLMNPQRSTUVWXYZ'   # sin I/O: evita confusion visual con 1/0
    $lower  = [char[]]'abcdefghijkmnpqrstuvwxyz'
    $digit  = [char[]]'23456789'
    $symbol = [char[]]'-_.'
    $all    = $upper + $lower + $digit + $symbol

    $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    try {
        $chars = New-Object System.Collections.Generic.List[char]
        $chars.Add($upper[(Get-RandomIndex -Rng $rng -Max $upper.Length)])
        $chars.Add($lower[(Get-RandomIndex -Rng $rng -Max $lower.Length)])
        $chars.Add($digit[(Get-RandomIndex -Rng $rng -Max $digit.Length)])
        $chars.Add($symbol[(Get-RandomIndex -Rng $rng -Max $symbol.Length)])

        while ($chars.Count -lt $Length) {
            $chars.Add($all[(Get-RandomIndex -Rng $rng -Max $all.Length)])
        }

        # Fisher-Yates: sin esto, las 4 posiciones garantizadas de arriba
        # quedarian siempre al principio del password (patron predecible).
        for ($i = $chars.Count - 1; $i -gt 0; $i--) {
            $j = Get-RandomIndex -Rng $rng -Max ($i + 1)
            $tmp = $chars[$i]; $chars[$i] = $chars[$j]; $chars[$j] = $tmp
        }

        return -join $chars
    } finally {
        $rng.Dispose()
    }
}

Write-Host "Verificando secretos de monitoreo para el ambiente [$Environment]..." -ForegroundColor Cyan

$created = 0
foreach ($secretFile in $monitoringSecrets) {
    $path = Join-Path $secretsDir $secretFile
    if (Test-Path $path) {
        Write-Host "  = $secretFile ya existe, se omite." -ForegroundColor DarkGray
        continue
    }

    $password = New-StrongPassword -Length 32
    $password | Out-File -FilePath $path -Encoding ASCII -NoNewline
    Write-Host "  + $secretFile generado." -ForegroundColor Green
    $created++
}

if ($created -eq 0) {
    Write-Host "Todos los secretos de monitoreo ya existian, nada que generar." -ForegroundColor Green
} else {
    Write-Host "$created secreto(s) de monitoreo generado(s)." -ForegroundColor Green
}
