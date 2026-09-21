#!/usr/bin/env bash
# Uso: ./monitoring.sh dev|prod|test

set -uo pipefail

ambiente="${1:?Uso: monitoring.sh <dev|prod|test>}"
case "$ambiente" in
    dev|prod|test) ;;
    *) echo "Error: ambiente debe ser 'dev', 'prod' o 'test'." >&2; exit 1 ;;
esac

# Raiz del monorepo = carpeta padre de corporate-scripts
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(dirname "$SCRIPT_DIR")"

case "$ambiente" in
    dev)  env_folder="Development" ;;
    prod) env_folder="Production" ;;
    test) env_folder="Testing" ;;
esac

case "$ambiente" in
    dev)  compose_file="compose.dev.yml" ;;
    prod) compose_file="compose.prod.yml" ;;
    test) compose_file="compose.test.yml" ;;
esac

# Definicion de rutas
compose_path="$repo_root/corporate-monitoring/$compose_file"
environment_path="$repo_root/corporate-secrets/Environment/.env"
env_stack_path="$repo_root/corporate-secrets/$env_folder/.env"

for path in "$compose_path" "$environment_path" "$env_stack_path"; do
    if [ ! -f "$path" ]; then
        echo "Error: no se encontro el archivo requerido: $path" >&2
        exit 1
    fi
done

# Lee el valor de una clave "NOMBRE=valor" desde el primero de los archivos
# .env que la contenga (mismo orden de precedencia que "--env-file": gana el
# ultimo archivo pasado a docker compose, asi que aca se busca primero en el
# mas especifico del ambiente y se cae al compartido).
get_env_value() {
    local file="$1" key="$2" line
    line="$(grep -E "^[[:space:]]*${key}[[:space:]]*=" "$file" 2>/dev/null | tail -n 1)"
    [ -z "$line" ] && return 1
    line="${line#*=}"
    line="${line#"${line%%[![:space:]]*}"}"
    line="${line%"${line##*[![:space:]]}"}"
    printf '%s' "$line"
}

get_env_value_multi() {
    local key="$1"; shift
    local file value
    for file in "$@"; do
        [ -f "$file" ] || continue
        if value="$(get_env_value "$file" "$key")"; then
            printf '%s' "$value"
            return 0
        fi
    done
    return 1
}

# corporate-monitoring/compose.dev.yml declara la red "backend" de
# corporate-infra como "external: true" (Prometheus necesita alcanzar los 8
# exporters, ver la NOTA dejada en corporate-infra/compose.dev.yml junto a
# esa red). Una red "external" que todavia no existe hace fallar el "up" con
# un error de Docker poco claro ("network ... declared as external, but could
# not be found") -se valida ACA, con un mensaje explicito, en vez de dejar
# que el usuario tenga que descifrar el error crudo de Docker-.
project_name_infra="$(get_env_value_multi 'PROJECT_NAME' "$env_stack_path" "$environment_path")" || project_name_infra=""
suffix="$(get_env_value_multi 'SUFFIX' "$env_stack_path" "$environment_path")" || suffix=""

if [ -z "$project_name_infra" ] || [ -z "$suffix" ]; then
    echo "Error: no se pudo determinar PROJECT_NAME/SUFFIX desde $env_stack_path / $environment_path" >&2
    exit 1
fi

infra_backend_network="${project_name_infra}_backend${suffix}"
if ! docker network ls --format '{{.Name}}' | grep -Fqx "$infra_backend_network"; then
    echo "Error: la red externa '$infra_backend_network' no existe todavia. Corre './run.sh bdd $ambiente' primero -el stack de bases de datos (corporate-infra) tiene que estar levantado ANTES que el de monitoreo, para que Prometheus pueda alcanzar sus exporters por nombre-." >&2
    exit 1
fi

echo "Red externa '$infra_backend_network' encontrada, OK."

# Mismo motivo que la validacion de arriba: corporate-monitoring/compose.dev.yml
# tambien declara "api-exporters" (red de corporate-api) como external, para
# que Prometheus pueda scrapear las 3 replicas de la API (ver
# corporate-api/compose.dev.yml).
project_name_backend="$(get_env_value_multi 'PROJECT_NAME_BACKEND' "$env_stack_path" "$environment_path")" || project_name_backend=""
api_exporters_network="${project_name_backend}_exporters${suffix}"
if ! docker network ls --format '{{.Name}}' | grep -Fqx "$api_exporters_network"; then
    echo "Error: la red externa '$api_exporters_network' no existe todavia. Corre './run.sh backend $ambiente' primero -el stack de la API (corporate-api) tiene que estar levantado ANTES que el de monitoreo, para que Prometheus pueda alcanzar sus replicas por nombre-." >&2
    exit 1
fi

echo "Red externa '$api_exporters_network' encontrada, OK."

# Certificado TLS autofirmado para nginxmondev (solo si falta): mismo
# criterio idempotente que ensure-api-tls-cert.sh.
"$SCRIPT_DIR/ensure-monitoring-tls-cert.sh" "$ambiente"

echo "Levantando stack de monitoreo [$ambiente] -> $compose_file"

# --wait implica -d (detached) y espera a que los healthchecks pasen. Sin
# --profile, este "up" NO levanta grafana-init<Ambiente> (profile "init", ver
# mas abajo).
docker compose -f "$compose_path" --env-file "$env_stack_path" --env-file "$environment_path" up --wait --wait-timeout 300 --build
status=$?
if [ $status -ne 0 ]; then
    echo "Error: docker compose finalizo con codigo $status" >&2
    exit $status
fi

# grafana-init<Ambiente> vive bajo el profile "init": no lo levanta el "up" de
# arriba. Se corre aparte con "run --rm" -mismo patron que mssql-initdev en
# corporate-infra/corporate-scripts/infra.sh-. Idempotente (guarda via
# /api/users/lookup contra el estado real de Grafana, ver
# Grafana/init/create-viewer-user.sh), asi que repetir la corrida en un
# ambiente ya inicializado no hace nada.
grafana_init_service="grafana-init${ambiente}"
echo "Creando usuario secundario de Grafana (rol Viewer)..."
docker compose -f "$compose_path" --env-file "$env_stack_path" --env-file "$environment_path" run --rm --build "$grafana_init_service"
status=$?
if [ $status -ne 0 ]; then
    echo "Error: $grafana_init_service finalizo con codigo $status" >&2
    exit $status
fi

monitoring_proxy_port="$(get_env_value_multi 'MONITORING_PROXY_PORT' "$env_stack_path" "$environment_path")" || monitoring_proxy_port=""
echo "Stack de monitoreo [$ambiente] arriba y healthy. Grafana disponible en http://localhost:$monitoring_proxy_port"
