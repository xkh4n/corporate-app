# Ensure Backend Secrets Generator
# Uso: .\ensure-backend-secrets.ps1 -Environment dev|test|prod
#
# Mismo criterio que ensure-monitoring-secrets.ps1 (no interactivo, idempotente,
# nunca sobreescribe un secret que ya existe): genera, SOLO si faltan, los
# secrets propios de corporate-api -el usuario de aplicacion de MSSQL
# (db_datareader+db_datawriter+db_ddladmin sobre MSSQL_DBNAME, ver
# corporate-infra/MsSQL/scripts/setup-ag.sh), los secrets de auth (JWT
# access/refresh, cookie de sesion) y el password del usuario "admin" de
# arranque (services/../databases/seed.ts).
#
# Pensado para correr en cada "run.ps1 backend <ambiente>", ANTES de
# "docker compose up" (ver corporate-scripts/backend.ps1).

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

# Mismo generador que ensure-monitoring-secrets.ps1 (charset URL/shell-safe a
# proposito, ver el comentario original ahi): se duplica en vez de compartir
# un modulo porque ningun otro script de corporate-scripts importa modulos
# propios hoy, y estos dos generadores ya pueden divergir con el tiempo
# (longitudes distintas por secret).
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

# (nombre de archivo, longitud)
$backendSecrets = @(
    @{ File = 'mssql_app_password.txt'; Length = 32 },
    @{ File = 'jwt_access_secret.txt';  Length = 64 },
    @{ File = 'jwt_refresh_secret.txt'; Length = 64 },
    @{ File = 'session_secret.txt';     Length = 64 },
    @{ File = 'bootstrap_admin_password.txt'; Length = 20 },
    # Contraseña inicial de cualquier User nuevo (ver createUser en
    # user.service.ts): un solo valor fijo para todo el ambiente, no por
    # usuario -el forced-change-password de mustChangePassword es lo que
    # acota el riesgo de que sea un valor conocido/adivinable.
    @{ File = 'default_user_password.txt'; Length = 20 },
    # Plan 017: clave maestra del segundo factor (cifra el secreto TOTP y firma los hashes de
    # codigos, ver corporate-api/src/library/mfa/keys.ts). Si se pierde o se rota, las apps
    # autenticadoras y los codigos de recuperacion ya entregados dejan de servir.
    @{ File = 'mfa_encryption_key.txt'; Length = 64 }
)

Write-Host "Verificando secretos de backend para el ambiente [$Environment]..." -ForegroundColor Cyan

$created = 0
foreach ($secret in $backendSecrets) {
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

# Datos de prueba (plan 014): compose.dev/test montan seed_test_data.json. Si falta, se deja vacio para
# que el stack levante; vacio = sin datos de prueba. El archivo con los datos reales se copia a mano
# (no se genera ni se versiona). Produccion no lo usa.
if ($Environment -ne 'prod') {
    $seedPath = Join-Path $secretsDir 'seed_test_data.json'
    if (-not (Test-Path $seedPath)) {
        New-Item -ItemType File -Path $seedPath | Out-Null
        Write-Host "  + seed_test_data.json creado vacio (sin datos de prueba)." -ForegroundColor Yellow
    }
}

if ($created -eq 0) {
    Write-Host "Todos los secretos de backend ya existian, nada que generar." -ForegroundColor Green
} else {
    Write-Host "$created secreto(s) de backend generado(s)." -ForegroundColor Green
}
