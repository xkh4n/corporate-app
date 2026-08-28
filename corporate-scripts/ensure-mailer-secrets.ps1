# Ensure Mailer Secrets Generator
# Uso: .\ensure-mailer-secrets.ps1 -Environment dev|test|prod
#
# Mismo criterio que ensure-backend-secrets.ps1 (no interactivo, idempotente,
# nunca sobreescribe un secret que ya existe). Genera:
#   - mailer_shared_secret.txt: secreto real (aleatorio), compartido entre
#     corporate-api y corporate-mailer para el header X-Mailer-Token -no
#     depende de tener proveedor SMTP, se puede generar ya.
#   - smtp_password.txt: PLACEHOLDER vacio a proposito cuando todavia no hay
#     credencial real -un valor random seria activamente incorrecto (pasaria
#     por "configurado" sin servir para nada). Se reemplaza a mano por la
#     credencial real (contraseña de aplicacion de Gmail, API Key de
#     SendGrid, etc, segun el proveedor SMTP configurado en Development/.env).
#
# Pensado para correr en cada "run.ps1 mailer <ambiente>", ANTES de
# "docker compose up" (ver corporate-scripts/mailer.ps1).

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

# Mismo generador que ensure-backend-secrets.ps1/ensure-monitoring-secrets.ps1
# (duplicado a proposito, ver el comentario original en ese archivo).
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

Write-Host "Verificando secretos de mailer para el ambiente [$Environment]..." -ForegroundColor Cyan

$created = 0

$sharedSecretPath = Join-Path $secretsDir 'mailer_shared_secret.txt'
if (Test-Path $sharedSecretPath) {
    Write-Host "  = mailer_shared_secret.txt ya existe, se omite." -ForegroundColor DarkGray
} else {
    (New-StrongPassword -Length 64) | Out-File -FilePath $sharedSecretPath -Encoding ASCII -NoNewline
    Write-Host "  + mailer_shared_secret.txt generado." -ForegroundColor Green
    $created++
}

$smtpPasswordPath = Join-Path $secretsDir 'smtp_password.txt'
if (Test-Path $smtpPasswordPath) {
    Write-Host "  = smtp_password.txt ya existe, se omite." -ForegroundColor DarkGray
} else {
    New-Item -ItemType File -Path $smtpPasswordPath | Out-Null
    Write-Host "  + smtp_password.txt creado VACIO (placeholder) -reemplazar con la credencial SMTP real antes de poder enviar correos." -ForegroundColor Yellow
    $created++
}

if ($created -eq 0) {
    Write-Host "Todos los secretos de mailer ya existian, nada que generar." -ForegroundColor Green
} else {
    Write-Host "$created secreto(s) de mailer generado(s)." -ForegroundColor Green
}
