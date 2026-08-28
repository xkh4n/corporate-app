# Ensure API TLS Certificate Generator
# Uso: .\ensure-api-tls-cert.ps1 -Environment dev|test|prod
#
# Mismo criterio "no interactivo, idempotente, nunca sobreescribe" que
# ensure-backend-secrets.ps1/ensure-monitoring-secrets.ps1: si ya existen
# tls.crt/tls.key, no los toca -asi, cuando llegue el certificado real de una
# CA, alcanza con pisar esos dos archivos a mano (mismo nombre, misma
# carpeta) y este script nunca los va a volver a generar por encima.
# nginx-apidev (ver corporate-api/nginx/config/nginx.conf.template) los lee
# siempre de la misma ruta fija: pasar de autofirmado a CA real es un cambio
# de ARCHIVOS, nunca de compose/nginx/codigo de la app.

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

$environmentPath = Join-Path $repoRoot 'corporate-secrets\Environment\.env'
$envStackPath    = Join-Path $repoRoot "corporate-secrets\$envFolder\.env"

function Get-EnvVarValue {
    param([string[]]$Files, [string]$Name)
    foreach ($file in $Files) {
        if (-not (Test-Path $file)) { continue }
        $line = Get-Content $file | Where-Object { $_ -match "^\s*$Name\s*=" } | Select-Object -Last 1
        if ($line) { return ($line -split '=', 2)[1].Trim() }
    }
    return $null
}

$suffix    = Get-EnvVarValue -Files @($envStackPath, $environmentPath) -Name 'SUFFIX'
$apiHost   = Get-EnvVarValue -Files @($envStackPath, $environmentPath) -Name 'API_HOST'
$proxyHost = Get-EnvVarValue -Files @($envStackPath, $environmentPath) -Name 'API_PROXY_HOST'

if (-not $suffix -or -not $apiHost -or -not $proxyHost) {
    Write-Error "No se pudo determinar SUFFIX/API_HOST/API_PROXY_HOST desde $envStackPath / $environmentPath"
    exit 1
}

# certs/api/ separado de certs/ (que ya usa MsSQL para su certificado del AG,
# ver corporate-infra/MsSQL/scripts/setup-ag.sh) -motivos distintos, carpetas
# distintas, para no pisarse ni confundir cual archivo es de que motor.
$certsDir = Join-Path $repoRoot "corporate-secrets\$envFolder\certs\api"
$crtPath  = Join-Path $certsDir 'tls.crt'
$keyPath  = Join-Path $certsDir 'tls.key'

if ((Test-Path $crtPath) -and (Test-Path $keyPath)) {
    Write-Host "tls.crt/tls.key ya existen en $certsDir, se omite (si es el certificado real de una CA, esto es lo esperado)." -ForegroundColor DarkGray
    exit 0
}

if (-not (Test-Path $certsDir)) {
    New-Item -ItemType Directory -Force -Path $certsDir | Out-Null
}

$openssl = Get-Command openssl -ErrorAction SilentlyContinue
if (-not $openssl) {
    $fallback = "C:\Program Files\OpenSSL-Win64\bin\openssl.exe"
    if (Test-Path $fallback) {
        $openssl = $fallback
    } else {
        Write-Error "No se encontro 'openssl' en el PATH ni en $fallback. Instalalo o generá tls.crt/tls.key manualmente en $certsDir."
        exit 1
    }
} else {
    $openssl = $openssl.Source
}

# SANs pensados para acceso local: "localhost"/127.0.0.1 (browser/Insomnia
# contra el puerto publicado) + los hostnames internos de Docker (por si se
# accede via el nombre de contenedor desde otro servicio de la misma red).
$proxyFqdn = "${proxyHost}${suffix}"
$apiFqdn   = "${apiHost}${suffix}"
$san = "subjectAltName=DNS:localhost,DNS:$proxyFqdn,DNS:$apiFqdn,IP:127.0.0.1"

Write-Host "Generando certificado autofirmado para [$Environment] en $certsDir..." -ForegroundColor Cyan

& $openssl req -x509 -nodes -newkey rsa:2048 -days 825 `
    -keyout $keyPath -out $crtPath `
    -subj "/CN=$proxyFqdn" `
    -addext $san

if ($LASTEXITCODE -ne 0) {
    Write-Error "openssl finalizo con codigo $LASTEXITCODE"
    exit $LASTEXITCODE
}

Write-Host "Certificado autofirmado generado: $crtPath / $keyPath (CN=$proxyFqdn, SAN=$san)" -ForegroundColor Green
Write-Host "Para pasar a un certificado real de una CA: reemplazar estos dos archivos con el mismo nombre y reiniciar nginx-apidev. No hace falta tocar compose ni nginx.conf." -ForegroundColor Yellow
