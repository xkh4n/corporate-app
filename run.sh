#!/usr/bin/env bash
# Equivalente Linux de run.ps1. Uso:
#   ./run.sh <servicio> [ambiente] [arg2] [resto...]

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

servicio="${1:-}"
ambiente="${2:-}"
arg2="${3:-}"
resto=("${@:4}")

if [ -z "$servicio" ]; then
    echo "Error: falta el nombre del servicio." >&2
    exit 1
fi

# Comando especial que no requiere ambiente
if [ "$servicio" = "fixendline" ]; then
    "$SCRIPT_DIR/corporate-scripts/fix-line-endings.sh"
    exit $?
fi

# ---------------------------------------------------------------------------
# Comandos de git/GitHub: commit+push y creacion de Pull Requests del modelo
# de ramas develop -> testing -> master. Centralizan el flujo para no olvidar
# pasos. Requieren GitHub CLI (gh) con sesion iniciada -ver README, seccion
# "Promocion entre ramas".
#
#   ./run.sh gitpush dev ["mensaje"]     commit (si hay cambios) + push de develop
#   ./run.sh gitpush testing ["mensaje"] idem sobre testing
#   ./run.sh gitpr testing dev           PR  develop -> testing
#   ./run.sh pre testing                 atajo: actualiza develop y abre el PR -> testing
#   ./run.sh pre prod   ["motivo"]       promociona testing -> master (rama limpia) y abre el PR
# ---------------------------------------------------------------------------
case "$servicio" in
    gitpush)
        if [ "$ambiente" != "dev" ] && [ "$ambiente" != "testing" ]; then
            echo "Error: uso: ./run.sh gitpush <dev|testing> [\"mensaje de commit\"]" >&2
            echo "master no recibe push directo; promocioná con:  ./run.sh pre prod" >&2
            exit 1
        fi
        "$SCRIPT_DIR/corporate-scripts/git-push.sh" "$ambiente" "$arg2" "${resto[@]}"
        exit $?
        ;;
    gitpr)
        if [ -z "$ambiente" ] || [ -z "$arg2" ]; then
            echo "Error: uso: ./run.sh gitpr <destino> <origen>   (ej: ./run.sh gitpr testing dev)" >&2
            exit 1
        fi
        "$SCRIPT_DIR/corporate-scripts/git-pr.sh" "$ambiente" "$arg2"
        exit $?
        ;;
    pre)
        case "$ambiente" in
            testing)
                "$SCRIPT_DIR/corporate-scripts/git-pr.sh" testing dev
                exit $?
                ;;
            prod)
                if [ -z "$arg2" ]; then
                    "$SCRIPT_DIR/corporate-scripts/promote-to-master.sh"
                else
                    "$SCRIPT_DIR/corporate-scripts/promote-to-master.sh" "$arg2"
                fi
                exit $?
                ;;
            *)
                echo "Error: uso: ./run.sh pre <testing|prod> [\"motivo\"]" >&2
                exit 1
                ;;
        esac
        ;;
esac

# Lista de comandos validos que requieren ambiente
valid_services=(bdd mongokey monitoring backend mailer frontend)

is_valid_service=0
for s in "${valid_services[@]}"; do
    if [ "$servicio" = "$s" ]; then
        is_valid_service=1
        break
    fi
done

# Verificar si el servicio es valido
if [ "$is_valid_service" -eq 0 ]; then
    echo "Error: servicio no reconocido: $servicio" >&2
    echo ""
    echo "Servicios disponibles:"
    echo "  - fixendline            - Corregir terminaciones de linea"
    echo "  - bdd <ambiente>        - Levantar stack de bases de datos"
    echo "  - mongokey <ambiente>   - Generar keyfile de MongoDB"
    echo "  - monitoring <ambiente> - Levantar stack de monitoreo"
    echo "  - backend <ambiente>    - Levantar servicios backend"
    echo "  - mailer <ambiente>     - Levantar servicio de envio de correo"
    echo "  - frontend <ambiente>   - Levantar servicios frontend"
    echo ""
    echo "Git / Pull Requests (requieren gh con sesion, ver README):"
    echo "  - gitpush <dev|testing> [msg] - commit (si hay cambios) + push de esa rama"
    echo "  - gitpr <destino> <origen>    - crear PR (ej: gitpr testing dev)"
    echo "  - pre testing                 - actualizar develop y abrir PR -> testing"
    echo "  - pre prod [motivo]           - promocionar testing -> master y abrir el PR"
    echo ""
    echo "Ambientes disponibles: dev, prod, test"
    exit 1
fi

# Validar ambiente para comandos que lo requieren
if [ -z "$ambiente" ]; then
    echo "Error: el parametro de ambiente es requerido. Use 'dev', 'prod' o 'test'" >&2
    exit 1
fi

if [ "$ambiente" != "dev" ] && [ "$ambiente" != "prod" ] && [ "$ambiente" != "test" ]; then
    echo "Error: el parametro enviado debe ser 'dev', 'prod' o 'test'" >&2
    exit 1
fi

# Base /16 por ambiente para las redes creadas imperativamente aca abajo (las
# que viven DENTRO de cada compose -infra/api/mailer/front/monitoring- usan
# su propio "ipam.config.subnet" en el compose.<ambiente>.yml correspondiente,
# ver esos archivos). Evita que dev/test/prod terminen compartiendo el mismo
# rango de "default-address-pools" del daemon -ese pool es global, no
# distingue por proyecto Compose-.
case "$ambiente" in
    dev)  net_base="172.16" ;;
    test) net_base="10.10" ;;
    prod) net_base="10.200" ;;
esac

network_exists() {
    docker network ls --format '{{.Name}}' | grep -Fqx "$1"
}

case "$servicio" in
    bdd)
        "$SCRIPT_DIR/corporate-scripts/infra.sh" "$ambiente"
        ;;
    mongokey)
        "$SCRIPT_DIR/corporate-scripts/mongo-keyfile.sh" "$ambiente"
        ;;
    monitoring)
        "$SCRIPT_DIR/corporate-scripts/monitoring.sh" "$ambiente"
        ;;
    backend)
        # Crear backend-net (publicacion de puerto para nginx-apidev hacia el
        # host/LAN). DELIBERADAMENTE SIN "--internal": en este host (Docker
        # Desktop/WSL2, Windows) una red "--internal" hacia que Docker NUNCA
        # llegara a publicar el puerto al host, sin importar que el compose
        # declare "ports:" (ver run.ps1 para el detalle completo del
        # hallazgo). Por eso esta red se queda como la UNICA de corporate-api
        # con egreso NAT real, pero con un solo miembro posible:
        # nginx-apidev (ver corporate-api/compose.dev.yml, red "public") -las
        # 3 replicas de la API NUNCA se conectan aca, solo a
        # "internal"/"api-exporters"/"infra-backend"/"mailer-net", que SI son
        # "internal: true"-.
        backend_net="backend-net-$ambiente"
        if ! network_exists "$backend_net"; then
            echo "  Creando $backend_net (internal: false -- requerido para el port-publish de nginx-apidev, ver comentario)"
            docker network create --driver bridge --subnet "${net_base}.11.0/24" "$backend_net"
        fi
        # Crear mailer-net si todavia no existe (idempotente, igual que en el
        # caso 'mailer' de abajo): la comparten corporate-api y
        # corporate-mailer, y no importa cual de los 2 stacks se levante
        # primero -el que llegue segundo la encuentra ya creada.
        # "--internal": sin esto, las 3 replicas de corporate-api (dual-homed
        # aca para poder hablarle a corporate-mailer) tendrian egreso NAT
        # real a internet "gratis" por compartir red con el unico contenedor
        # que legitimamente lo necesita.
        mailer_net="mailer-net-$ambiente"
        if ! network_exists "$mailer_net"; then
            echo "  Creando $mailer_net (internal: true)"
            docker network create --driver bridge --internal --subnet "${net_base}.12.0/24" "$mailer_net"
        fi
        # Crear frontapi-net si todavia no existe (idempotente, mismo patron
        # que mailer-net): la comparten corporate-api y corporate-front, no
        # importa cual de los 2 stacks se levante primero. "--internal":
        # mismo motivo que mailer-net -esta red es solo el camino de ENTRADA
        # (corporate-front -> corporate-api), nginx-apidev no gana egreso NAT
        # real por compartirla.
        frontapi_net="frontapi-net-$ambiente"
        if ! network_exists "$frontapi_net"; then
            echo "  Creando $frontapi_net (internal: true)"
            docker network create --driver bridge --internal --subnet "${net_base}.13.0/24" "$frontapi_net"
        fi
        "$SCRIPT_DIR/corporate-scripts/backend.sh" "$ambiente"
        ;;
    mailer)
        # Red compartida con corporate-api -unico contenedor de todo el
        # proyecto con salida a internet, por eso vive en su propio stack
        # Compose en vez de dentro de corporate-api. Mismo criterio
        # idempotente que backend-net/frontend-net: no importa si "run.sh
        # backend" ya la creo antes. "--internal": mismo motivo que en el
        # caso 'backend' de arriba -esta red es solo el camino de ENTRADA
        # (corporate-api -> corporate-mailer), el egreso real de
        # corporate-mailer vive en su propia red "mailer-egress" (ver
        # corporate-mailer/compose.dev.yml), nunca en esta que comparte con
        # la API.
        mailer_net="mailer-net-$ambiente"
        if ! network_exists "$mailer_net"; then
            echo "  Creando $mailer_net (internal: true)"
            docker network create --driver bridge --internal --subnet "${net_base}.12.0/24" "$mailer_net"
        fi
        "$SCRIPT_DIR/corporate-scripts/mailer.sh" "$ambiente"
        ;;
    frontend)
        # Crear frontend-net si no existe. DELIBERADAMENTE SIN "--internal",
        # mismo motivo que "backend-net" arriba -en este host, una red
        # "--internal" impide que Docker publique el puerto al host-. Cuando
        # corporate-front tenga su propio compose/Dockerfile, su proxy (si
        # usa uno, mismo patron que nginx-apidev/nginxdev/nginxmondev)
        # deberia ser el UNICO servicio conectado directo a esta red.
        frontend_net="frontend-net-$ambiente"
        if ! network_exists "$frontend_net"; then
            echo "  Creando $frontend_net (internal: false -- ver comentario, el port-publish del proxy del frontend lo requiere)"
            docker network create --driver bridge --subnet "${net_base}.14.0/24" "$frontend_net"
        fi
        # frontapi-net: mismo patron idempotente que en el caso 'backend' -no
        # importa cual de los 2 stacks (backend/frontend) se levante primero,
        # el que llega segundo la encuentra ya creada.
        frontapi_net="frontapi-net-$ambiente"
        if ! network_exists "$frontapi_net"; then
            echo "  Creando $frontapi_net (internal: true)"
            docker network create --driver bridge --internal --subnet "${net_base}.13.0/24" "$frontapi_net"
        fi
        "$SCRIPT_DIR/corporate-scripts/frontend.sh" "$ambiente"
        ;;
esac

exit $?
