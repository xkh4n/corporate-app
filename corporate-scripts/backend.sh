#!/usr/bin/env bash
# Uso: ./backend.sh dev|prod|test

set -uo pipefail

ambiente="${1:?Uso: backend.sh <dev|prod|test>}"
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

compose_path="$repo_root/corporate-api/$compose_file"
environment_path="$repo_root/corporate-secrets/Environment/.env"
env_stack_path="$repo_root/corporate-secrets/$env_folder/.env"

for path in "$compose_path" "$environment_path" "$env_stack_path"; do
    if [ ! -f "$path" ]; then
        echo "Error: no se encontro el archivo requerido: $path" >&2
        exit 1
    fi
done

# corporate-api depende de la red "backend" del proyecto Compose de
# corporate-infra (ver corporate-api/compose.dev.yml, red "infra-backend"
# external): sin ese stack arriba, "docker compose up" falla al no poder
# resolver una red externa que todavia no existe.
get_env_value() {
    local file="$1" key="$2" line
    line="$(grep -E "^[[:space:]]*${key}[[:space:]]*=" "$file" 2>/dev/null | tail -n 1)"
    [ -z "$line" ] && return 1
    line="${line#*=}"
    line="${line#"${line%%[![:space:]]*}"}"
    line="${line%"${line##*[![:space:]]}"}"
    printf '%s' "$line"
}

infra_project_name="$(get_env_value "$env_stack_path" 'PROJECT_NAME')" || infra_project_name=""
suffix="$(get_env_value "$env_stack_path" 'SUFFIX')" || suffix=""
infra_network="${infra_project_name}_backend${suffix}"
if ! docker network ls --format '{{.Name}}' | grep -Fqx "$infra_network"; then
    echo "Error: no existe la red '$infra_network'. Corre primero 'run.sh bdd $ambiente' para levantar corporate-infra." >&2
    exit 1
fi

# Genera (solo si faltan) el usuario de aplicacion de MSSQL y los secrets de
# auth (JWT/sesion) -no interactivo e idempotente, mismo patron que
# ensure-monitoring-secrets.sh via corporate-scripts/infra.sh.
"$SCRIPT_DIR/ensure-backend-secrets.sh" "$ambiente"

# Certificado TLS autofirmado para nginx-apidev (solo si falta): mismo
# criterio idempotente, nunca pisa un certificado real de CA ya instalado.
"$SCRIPT_DIR/ensure-api-tls-cert.sh" "$ambiente"

echo "Levantando stack de backend [$ambiente] -> $compose_file"

docker compose -f "$compose_path" --env-file "$env_stack_path" --env-file "$environment_path" up --wait --wait-timeout 300 --build
status=$?
if [ $status -ne 0 ]; then
    echo "Error: docker compose finalizo con codigo $status" >&2
    exit $status
fi

echo "Stack de backend [$ambiente] arriba y healthy."
