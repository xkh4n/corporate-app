<#
    .SYNOPSIS
    Expone el frontend de un ambiente con un Quick Tunnel de Cloudflare
    (cloudflared tunnel --url ...). Uso: .\run.ps1 cloud <dev|test|prod>

    .DESCRIPTION
    Lee ALLOCATED_IP y FRONT_SSL_PORT de corporate-secrets (Environment/.env
    primero y despues <Ambiente>/.env; gana la ultima ocurrencia, mismo
    criterio que docker compose --env-file en el resto de los scripts).

    --no-tls-verify: el certificado de nginx-front es self-signed.
    Solo dev agrega --http-host-header <ALLOCATED_IP>: alli nginx-frontdev
    reenvia el Host a Vite, que bloquea cualquier nombre que no sea una IP
    (proteccion anti DNS-rebinding, ver corporate-front/vite.config.ts). Con el
    Host reescrito a la IP no hace falta abrir allowedHosts. Test y prod sirven
    estaticos con nginx y no lo necesitan.

    El tunel queda en primer plano: Ctrl+C lo cierra. Mientras este abierto, el
    ambiente es publico en internet.
#>
param(
    [Parameter(Mandatory = $true, Position = 0)]
    [ValidateSet('dev', 'test', 'prod')]
    [string]$Ambiente
)

$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$envFolder = @{ dev = 'Development'; test = 'Testing'; prod = 'Production' }[$Ambiente]
$envFiles = @(
    (Join-Path $repoRoot 'corporate-secrets/Environment/.env'),
    (Join-Path $repoRoot "corporate-secrets/$envFolder/.env")
)

if (-not (Get-Command cloudflared -ErrorAction SilentlyContinue)) {
    Write-Host "❌ No se encontro 'cloudflared' en el PATH (winget install --id Cloudflare.cloudflared)" -ForegroundColor Red
    exit 1
}

$vars = @{}
foreach ($file in $envFiles) {
    if (-not (Test-Path $file)) {
        Write-Host "❌ No se encontro el archivo requerido: $file" -ForegroundColor Red
        exit 1
    }
    foreach ($line in Get-Content $file) {
        $trimmed = $line.Trim()
        if (-not $trimmed -or $trimmed.StartsWith('#')) { continue }
        $eq = $trimmed.IndexOf('=')
        if ($eq -lt 1) { continue }
        $vars[$trimmed.Substring(0, $eq).Trim()] = $trimmed.Substring($eq + 1).Trim().Trim('"', "'")
    }
}

$ip = $vars['ALLOCATED_IP']
$port = $vars['FRONT_SSL_PORT']
if (-not $ip -or -not $port) {
    Write-Host "❌ Faltan ALLOCATED_IP o FRONT_SSL_PORT en los .env de $envFolder" -ForegroundColor Red
    exit 1
}

$tunnelArgs = @('tunnel', '--url', "https://${ip}:${port}", '--no-tls-verify')
if ($Ambiente -eq 'dev') {
    $tunnelArgs += @('--http-host-header', $ip)
}

Write-Host "🌐 Exponiendo $Ambiente (https://${ip}:${port}) con cloudflared. Ctrl+C para cerrar." -ForegroundColor Cyan
Write-Host "⚠️  Mientras el tunel este abierto, el ambiente queda publico en internet." -ForegroundColor Yellow
& cloudflared @tunnelArgs
exit $LASTEXITCODE
