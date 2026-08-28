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
$validServices = @('bdd', 'mongokey', 'monitoring', 'backend', 'mailer', 'frontend')

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
    Write-Host "  • mailer <ambiente>     - Levantar servicio de envio de correo" -ForegroundColor Yellow
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

# Base /16 por ambiente para las redes creadas imperativamente acá abajo (las
# que viven DENTRO de cada compose -infra/api/mailer/front/monitoring- usan
# su propio "ipam.config.subnet" en el compose.<ambiente>.yml correspondiente,
# ver esos archivos). Evita que dev/test/prod terminen compartiendo el mismo
# rango de "default-address-pools" del daemon -ese pool es global, no
# distingue por proyecto Compose-.
$netBase = @{ dev = '172.16'; test = '10.10'; prod = '10.200' }[$Ambiente]

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
        # Crear backend-net (publicacion de puerto para nginx-apidev hacia el
        # host/LAN). DELIBERADAMENTE SIN "--internal", pese al lineamiento
        # original de la auditoria: se probo en la practica (no se asumio) y
        # en este host (Docker Desktop/WSL2, Windows) una red "--internal"
        # hace que Docker NUNCA llegue a publicar el puerto al host -"docker
        # port"/"docker inspect" muestran el binding vacio, curl al host da
        # connection refused-, sin importar que el compose declare "ports:".
        # Confirmado con un contenedor de prueba nginx aislado antes de
        # aplicar esto al proyecto real. Por eso esta red se queda como la
        # UNICA de corporate-api con egreso NAT real, pero con un solo
        # miembro posible: nginx-apidev (ver corporate-api/compose.dev.yml,
        # red "public") -las 3 replicas de la API NUNCA se conectan aca,
        # solo a "internal"/"api-exporters"/"infra-backend"/"mailer-net", que
        # SI son "internal: true"-. Mismo patron de "un solo consumidor con
        # egreso real" que "mailer-egress" en corporate-mailer.
        $backendNet = "backend-net-$Ambiente"
        if (-not (docker network ls --format '{{.Name}}' | Select-String -Pattern "^$backendNet$")) {
            Write-Host "  ✅ Creando $backendNet (internal: false -- requerido para el port-publish de nginx-apidev, ver comentario)" -ForegroundColor Green
            docker network create --driver bridge --subnet "$netBase.11.0/24" $backendNet
        }
        # Crear mailer-net si todavia no existe (idempotente, igual que en el
        # case 'mailer' de abajo): la comparten corporate-api y
        # corporate-mailer, y no importa cual de los 2 stacks se levante
        # primero -el que llegue segundo la encuentra ya creada.
        # "--internal": hallazgo CRITICO de auditoria -sin esto, las 3
        # replicas de corporate-api (dual-homed acá para poder hablarle a
        # corporate-mailer) tenian egreso NAT real a internet "gratis" por
        # compartir red con el unico contenedor que legitimamente lo
        # necesita. El egreso real de corporate-mailer ya NO vive acá -ver
        # "mailer-egress" en corporate-mailer/compose.dev.yml, red exclusiva
        # de ese contenedor, no compartida con la API-.
        $mailerNet = "mailer-net-$Ambiente"
        if (-not (docker network ls --format '{{.Name}}' | Select-String -Pattern "^$mailerNet$")) {
            Write-Host "  ✅ Creando $mailerNet (internal: true)" -ForegroundColor Green
            docker network create --driver bridge --internal --subnet "$netBase.12.0/24" $mailerNet
        }
        # Crear frontapi-net si todavia no existe (idempotente, mismo patron
        # que mailer-net): la comparten corporate-api y corporate-front, no
        # importa cual de los 2 stacks se levante primero. Reemplaza el
        # intento inicial de que nginx-frontdev le pegara a corporate-api via
        # ALLOCATED_IP (hairpin NAT, intermitente en Docker Desktop/Windows)
        # o via host.docker.internal (hubiera exigido exponer nginx-apidev en
        # 0.0.0.0, aflojando el bind a ALLOCATED_IP). "--internal": mismo
        # motivo que mailer-net -esta red es solo el camino de ENTRADA
        # (corporate-front -> corporate-api), nginx-apidev no gana egreso NAT
        # real por compartirla.
        $frontApiNet = "frontapi-net-$Ambiente"
        if (-not (docker network ls --format '{{.Name}}' | Select-String -Pattern "^$frontApiNet$")) {
            Write-Host "  ✅ Creando $frontApiNet (internal: true)" -ForegroundColor Green
            docker network create --driver bridge --internal --subnet "$netBase.13.0/24" $frontApiNet
        }
        & ./corporate-scripts/backend.ps1 $Ambiente
    }
    'mailer' {
        # Red compartida con corporate-api -unico contenedor de todo el
        # proyecto con salida a internet, por eso vive en su propio stack
        # Compose en vez de dentro de corporate-api. Mismo criterio idempotente
        # que backend-net/frontend-net: no importa si "run.ps1 backend" ya la
        # creo antes. "--internal": mismo motivo que en el case 'backend' de
        # arriba -esta red es solo el camino de ENTRADA (corporate-api ->
        # corporate-mailer), el egreso real de corporate-mailer vive en su
        # propia red "mailer-egress" (ver corporate-mailer/compose.dev.yml),
        # nunca en esta que comparte con la API.
        $mailerNet = "mailer-net-$Ambiente"
        if (-not (docker network ls --format '{{.Name}}' | Select-String -Pattern "^$mailerNet$")) {
            Write-Host "  ✅ Creando $mailerNet (internal: true)" -ForegroundColor Green
            docker network create --driver bridge --internal --subnet "$netBase.12.0/24" $mailerNet
        }
        & ./corporate-scripts/mailer.ps1 $Ambiente
    }
    'frontend' {
        # Crear frontend-net si no existe. DELIBERADAMENTE SIN "--internal",
        # mismo motivo que "backend-net" arriba -en este host, una red
        # "--internal" impide que Docker publique el puerto al host, punto
        # confirmado en la practica, no asumido-. Cuando corporate-front
        # tenga su propio compose/Dockerfile, su proxy (si usa uno, mismo
        # patron que nginx-apidev/nginxdev/nginxmondev) deberia ser el UNICO
        # servicio conectado directo a esta red -cualquier otro contenedor
        # del stack de frontend que necesite estar aislado de internet real
        # deberia vivir en una red propia SI marcada "internal: true", igual
        # que "internal" en corporate-api-.
        $frontendNet = "frontend-net-$Ambiente"
        if (-not (docker network ls --format '{{.Name}}' | Select-String -Pattern "^$frontendNet$")) {
            Write-Host "  ✅ Creando $frontendNet (internal: false -- ver comentario, el port-publish del proxy del frontend lo requiere)" -ForegroundColor Green
            docker network create --driver bridge --subnet "$netBase.14.0/24" $frontendNet
        }
        # frontapi-net: mismo patron idempotente que en el case 'backend' -no
        # importa cual de los 2 stacks (backend/frontend) se levante primero,
        # el que llega segundo la encuentra ya creada.
        $frontApiNet = "frontapi-net-$Ambiente"
        if (-not (docker network ls --format '{{.Name}}' | Select-String -Pattern "^$frontApiNet$")) {
            Write-Host "  ✅ Creando $frontApiNet (internal: true)" -ForegroundColor Green
            docker network create --driver bridge --internal --subnet "$netBase.13.0/24" $frontApiNet
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
