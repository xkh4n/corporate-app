#!/usr/bin/env bash
# Uso: ./frontend.sh dev|prod|test

set -uo pipefail

ambiente="${1:?Uso: frontend.sh <dev|prod|test>}"
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

compose_path="$repo_root/corporate-front/$compose_file"
environment_path="$repo_root/corporate-secrets/Environment/.env"
env_stack_path="$repo_root/corporate-secrets/$env_folder/.env"

for path in "$compose_path" "$environment_path" "$env_stack_path"; do
    if [ ! -f "$path" ]; then
        echo "Error: no se encontro el archivo requerido: $path" >&2
        exit 1
    fi
done

# A diferencia de corporate-api, corporate-front no depende de ninguna red
# externa de otro stack Compose: llega a la API por su puerto YA PUBLICADO
# (ALLOCATED_IP + API_SSL_PORT, ver nginx/config/nginx.conf.template), no por
# Docker DNS cross-stack. Tampoco tiene secrets propios (sin
# ensure-*-secrets.sh) -solo necesita su certificado TLS.
"$SCRIPT_DIR/ensure-front-tls-cert.sh" "$ambiente"

echo "Levantando stack de frontend [$ambiente] -> $compose_file"

docker compose -f "$compose_path" --env-file "$env_stack_path" --env-file "$environment_path" up --wait --wait-timeout 300 --build
status=$?
if [ $status -ne 0 ]; then
    echo "Error: docker compose finalizo con codigo $status" >&2
    exit $status
fi

echo "Stack de frontend [$ambiente] arriba y healthy."
