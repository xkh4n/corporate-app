param(
    [Parameter(Mandatory=$true, Position=0)]
    [string]$Servicio,
    [Parameter(Position=1)]
    [string]$Ambiente
)

# Comando especial que no requiere ambiente
if ($Servicio -eq 'fixendline') {
    & ./corporate-scripts/fix-line-endings.ps1
    exit $LASTEXITCODE
}

# Lista de comandos válidos que requieren ambiente
$validServices = @('bdd', 'mongokey', 'monitoring', 'backend', 'frontend')

# Verificar si el servicio es válido
if ($Servicio -notin $validServices) {
    Write-Host "❌ Servicio no reconocido: $Servicio" -ForegroundColor Red
    Write-Host ""
    Write-Host "📋 Servicios disponibles:" -ForegroundColor Cyan
    Write-Host "  • fixendline            - Corregir terminaciones de línea (Windows)" -ForegroundColor Yellow
    Write-Host "  • bdd <ambiente>        - Levantar stack de bases de datos" -ForegroundColor Yellow
    Write-Host "  • mongokey <ambiente>   - Generar keyfile de MongoDB" -ForegroundColor Yellow
    Write-Host "  • monitoring <ambiente> - Levantar stack de monitoreo" -ForegroundColor Yellow
    Write-Host "  • backend <ambiente>    - Levantar servicios backend" -ForegroundColor Yellow
    Write-Host "  • frontend <ambiente>   - Levantar servicios frontend" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "💡 Ambientes disponibles: dev, prod, test" -ForegroundColor Cyan
    exit 1
}

# Validar ambiente para comandos que lo requieren
if ([string]::IsNullOrEmpty($Ambiente)) {
    Write-Error "El parámetro de ambiente es requerido. Use 'dev', 'prod' o 'test'"
    exit 1
}

if ($Ambiente -ne 'dev' -and $Ambiente -ne 'prod' -and $Ambiente -ne 'test') {
    Write-Error "El parámetro enviado debe ser 'dev', 'prod' o 'test'"
    exit 1
}

switch ($Servicio) {
    'bdd' {
        & ./corporate-scripts/infra.ps1 $Ambiente
    }
    'mongokey' {
        & ./corporate-scripts/mongo-keyfile.ps1 $Ambiente
    }
    'monitoring' {
        & ./corporate-scripts/monitoring.ps1 $Ambiente
    }
    'backend' {
        # Crear backend-net (acceso público para CDN/assets)
        $backendNet = "backend-net-$Ambiente"
        if (-not (docker network ls --format '{{.Name}}' | Select-String -Pattern "^$backendNet$")) {
            Write-Host "  ✅ Creando $backendNet (internal: false)" -ForegroundColor Green
            docker network create --driver bridge $backendNet
        }
        & ./corporate-scripts/backend.ps1 $Ambiente
    }
    'frontend' {
        # Crear frontend-net si no existe
        $frontendNet = "frontend-net-$Ambiente"
        if (-not (docker network ls --format '{{.Name}}' | Select-String -Pattern "^$frontendNet$")) {
            Write-Host "  ✅ Creando $frontendNet (internal: false)" -ForegroundColor Green
            docker network create --driver bridge $frontendNet
        }
        & ./corporate-scripts/frontend.ps1 $Ambiente
    }
    default {
        # Este caso no debería ocurrir debido a la validación anterior
        Write-Error "Error inesperado en el switch"
        exit 1
    }
}

exit $LASTEXITCODE
