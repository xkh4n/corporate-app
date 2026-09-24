# Ensure Infra Secrets Generator
# Uso: .\ensure-infra-secrets.ps1 -Environment dev|test|prod
#
# Mismo criterio que ensure-backend-secrets.ps1/ensure-monitoring-secrets.ps1
# (no interactivo, idempotente, nunca sobreescribe un secret que ya existe):
# genera, SOLO si faltan, los secretos "de motor" que consume directamente
# corporate-infra/compose.*.yml (bloque "secrets:") y que NINGUN otro script
# de esta carpeta cubre hoy -ni ensure-backend-secrets.ps1 (que solo cubre
# mssql_app_password, el usuario de APLICACION, no el "sa"), ni
# ensure-monitoring-secrets.ps1 (que solo cubre los 4 passwords de
# exporters). Hallazgo de la auditoria de seguridad 2026-08-17: sin este
# script, mssql_password (sa), redis_password (root) y db_mongo_user_password
# (usuario de aplicacion de Mongo) no existian para Testing ni Production
# -alguien los hubiera tenido que inventar a mano durante la promocion.
#
# Se listan TAMBIEN los secretos que ya existen para Development/Testing/
# Production (creados antes de que este script existiera) para que sea el
# punto unico de verdad de "que secretos de infra hacen falta" en un
# checkout limpio; como no se sobreescribe nada, listarlos no tiene efecto
# donde ya existen.
#
# Pensado para correr en cada "run.ps1 bdd <ambiente>", ANTES de "docker
# compose up" (ver corporate-scripts/infra.ps1), mismo lugar que
# ensure-monitoring-secrets.ps1.

param(
    [Parameter(Mandatory=$true)]
    [ValidateSet('dev', 'test', 'prod')]
    [string]$Environment
)

$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$envFolder = switch ($Environment) {
    'dev'  { 'Development' }
    'test' { 'Testing' }
    'prod' { 'Production' }
}

$secretsDir = Join-Path $repoRoot "corporate-secrets\$envFolder"
if (-not (Test-Path $secretsDir)) {
    New-Item -ItemType Directory -Force -Path $secretsDir | Out-Null
}

function Get-RandomIndex {
    param(
        [System.Security.Cryptography.RandomNumberGenerator]$Rng,
        [int]$Max
    )
    $bytes = New-Object byte[] 4
    $Rng.GetBytes($bytes)
    return [BitConverter]::ToUInt32($bytes, 0) % $Max
}

# Mismo generador que el resto de ensure-*-secrets.ps1 (duplicado a
# proposito, ver el comentario original en ensure-monitoring-secrets.ps1).
function New-StrongPassword {
    param([int]$Length = 32)

    $upper  = [char[]]'ABCDEFGHJKLMNPQRSTUVWXYZ'
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

        for ($i = $chars.Count - 1; $i -gt 0; $i--) {
            $j = Get-RandomIndex -Rng $rng -Max ($i + 1)
            $tmp = $chars[$i]; $chars[$i] = $chars[$j]; $chars[$j] = $tmp
        }

        return -join $chars
    } finally {
        $rng.Dispose()
    }
}

# (nombre de archivo, longitud) -motores/roles que corporate-infra/compose.*.yml
# espera vía Docker secrets (bloque "secrets:") y que no genera ningun otro
# ensure-*-secrets.ps1. mongodb_keyfile queda afuera a proposito: lo maneja
# mongo-keyfile.ps1 (interactivo, ver infra.ps1).
$infraSecrets = @(
    # Postgres: admin/root, replication, usuario de logging y usuario base
    # "pg_password" (ver setup-postgres.sh / compose.dev.yml para el uso
    # exacto de cada uno) -pg_exporter_password y pg_user_password NO van
    # aca: el primero lo cubre ensure-monitoring-secrets.ps1, ver mas abajo
    # por que pg_user_password si queda en esta lista.
    @{ File = 'pg_admin_password.txt';       Length = 32 },
    @{ File = 'pg_replication_password.txt'; Length = 32 },
    @{ File = 'pg_logger_password.txt';      Length = 32 },
    @{ File = 'pg_password.txt';             Length = 32 },
    @{ File = 'pg_user_password.txt';        Length = 32 },
    # MongoDB: root (db_mongo_password) y usuario de aplicacion
    # (db_mongo_user_password) -distintos: root nunca lo usa corporate-api.
    @{ File = 'db_mongo_password.txt';      Length = 32 },
    @{ File = 'db_mongo_user_password.txt'; Length = 32 },
    @{ File = 'db_gui_password.txt';        Length = 32 },
    @{ File = 'db_mongo_logs.txt';          Length = 32 },
    # MSSQL: "sa" (server-wide, NO confundir con mssql_app_password -ese es
    # el usuario acotado de aplicacion, generado por ensure-backend-secrets.ps1).
    @{ File = 'mssql_password.txt'; Length = 32 },
    # Redis: usuario root/ACL por defecto (NO confundir con
    # redis_exporter_password, que genera ensure-monitoring-secrets.ps1).
    @{ File = 'redis_password.txt'; Length = 32 },
    # Redis: usuario ACL de corporate-api (REDIS_APP_USER), sin @admin/@dangerous.
    @{ File = 'redis_app_password.txt'; Length = 32 }
)

Write-Host "Verificando secretos de infra para el ambiente [$Environment]..." -ForegroundColor Cyan

$created = 0
foreach ($secret in $infraSecrets) {
    $path = Join-Path $secretsDir $secret.File
    if (Test-Path $path) {
        Write-Host "  = $($secret.File) ya existe, se omite." -ForegroundColor DarkGray
        continue
    }

    $value = New-StrongPassword -Length $secret.Length
    $value | Out-File -FilePath $path -Encoding ASCII -NoNewline
    Write-Host "  + $($secret.File) generado." -ForegroundColor Green
    $created++
}

if ($created -eq 0) {
    Write-Host "Todos los secretos de infra ya existian, nada que generar." -ForegroundColor Green
} else {
    Write-Host "$created secreto(s) de infra generado(s)." -ForegroundColor Green
}
