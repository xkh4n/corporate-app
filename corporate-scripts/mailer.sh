#!/usr/bin/env bash
# Uso: ./mailer.sh dev|prod|test

set -uo pipefail

ambiente="${1:?Uso: mailer.sh <dev|prod|test>}"
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

compose_path="$repo_root/corporate-mailer/$compose_file"
environment_path="$repo_root/corporate-secrets/Environment/.env"
env_stack_path="$repo_root/corporate-secrets/$env_folder/.env"

for path in "$compose_path" "$environment_path" "$env_stack_path"; do
    if [ ! -f "$path" ]; then
        echo "Error: no se encontro el archivo requerido: $path" >&2
        exit 1
    fi
done

# A diferencia de backend.sh/monitoring.sh, corporate-mailer NO depende de
# corporate-infra (no toca ninguna base de datos, es justamente el unico
# contenedor con salida a internet). Solo necesita que exista la red
# compartida "mailer-net-<ambiente>" -la crea el run.sh raiz (mismo patron
# que backend-net-<ambiente>/frontend-net-<ambiente>) antes de llamar a este
# script, asi que no importa el orden relativo con "run.sh backend".
mailer_network="mailer-net-${ambiente}"
if ! docker network ls --format '{{.Name}}' | grep -Fqx "$mailer_network"; then
    echo "Error: no existe la red '$mailer_network'. Corre './run.sh mailer $ambiente' desde la raiz del repo (el run.sh raiz crea la red antes de llegar aca)." >&2
    exit 1
fi

# Genera (solo si faltan) el secreto compartido con corporate-api y el
# placeholder de la password SMTP -no interactivo, idempotente.
"$SCRIPT_DIR/ensure-mailer-secrets.sh" "$ambiente"

echo "Levantando stack de mailer [$ambiente] -> $compose_file"

docker compose -f "$compose_path" --env-file "$env_stack_path" --env-file "$environment_path" up --wait --wait-timeout 120 --build
status=$?
if [ $status -ne 0 ]; then
    echo "Error: docker compose finalizo con codigo $status" >&2
    exit $status
fi

echo "Stack de mailer [$ambiente] arriba y healthy."
