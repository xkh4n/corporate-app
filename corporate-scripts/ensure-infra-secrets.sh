#!/usr/bin/env bash
# Ensure Infra Secrets Generator
# Uso: ./ensure-infra-secrets.sh dev|test|prod
#
# Mismo criterio que ensure-backend-secrets.sh/ensure-monitoring-secrets.sh
# (no interactivo, idempotente, nunca sobreescribe un secret que ya existe):
# genera, SOLO si faltan, los secretos "de motor" que consume directamente
# corporate-infra/compose.*.yml (bloque "secrets:") y que NINGUN otro script
# de esta carpeta cubre hoy -ni ensure-backend-secrets.sh (que solo cubre
# mssql_app_password, el usuario de APLICACION, no el "sa"), ni
# ensure-monitoring-secrets.sh (que solo cubre los 4 passwords de exporters).
#
# Se listan TAMBIEN los secretos que ya existen para Development/Testing/
# Production (creados antes de que este script existiera) para que sea el
# punto unico de verdad de "que secretos de infra hacen falta" en un
# checkout limpio; como no se sobreescribe nada, listarlos no tiene efecto
# donde ya existen.
#
# Pensado para correr en cada "run.sh bdd <ambiente>", ANTES de "docker
# compose up" (ver corporate-scripts/infra.sh), mismo lugar que
# ensure-monitoring-secrets.sh.

set -uo pipefail

environment="${1:?Uso: ensure-infra-secrets.sh <dev|test|prod>}"
case "$environment" in
    dev|test|prod) ;;
    *) echo "Error: environment debe ser 'dev', 'test' o 'prod'." >&2; exit 1 ;;
esac

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(dirname "$SCRIPT_DIR")"

case "$environment" in
    dev)  env_folder="Development" ;;
    test) env_folder="Testing" ;;
    prod) env_folder="Production" ;;
esac

secrets_dir="$repo_root/corporate-secrets/$env_folder"
mkdir -p "$secrets_dir"

random_index() {
    local max="$1" n
    n=$(od -An -N4 -tu4 /dev/urandom | tr -d ' ')
    echo $(( n % max ))
}

# Mismo generador que el resto de ensure-*-secrets.sh (duplicado a proposito,
# ver el comentario original en ensure-monitoring-secrets.sh).
new_strong_password() {
    local length="${1:-32}"
    local upper="ABCDEFGHJKLMNPQRSTUVWXYZ"
    local lower="abcdefghijkmnpqrstuvwxyz"
    local digit="23456789"
    local symbol="-_."
    local all="${upper}${lower}${digit}${symbol}"
    local chars=()
    local idx

    idx=$(random_index ${#upper});  chars+=("${upper:$idx:1}")
    idx=$(random_index ${#lower});  chars+=("${lower:$idx:1}")
    idx=$(random_index ${#digit});  chars+=("${digit:$idx:1}")
    idx=$(random_index ${#symbol}); chars+=("${symbol:$idx:1}")

    while [ "${#chars[@]}" -lt "$length" ]; do
        idx=$(random_index ${#all})
        chars+=("${all:$idx:1}")
    done

    local i j tmp
    for (( i=${#chars[@]}-1; i>0; i-- )); do
        j=$(random_index $((i+1)))
        tmp="${chars[$i]}"; chars[$i]="${chars[$j]}"; chars[$j]="$tmp"
    done

    local result=""
    for c in "${chars[@]}"; do result+="$c"; done
    printf '%s' "$result"
}

# (nombre de archivo, longitud) -motores/roles que corporate-infra/compose.*.yml
# espera via Docker secrets (bloque "secrets:") y que no genera ningun otro
# ensure-*-secrets.sh. mongodb_keyfile queda afuera a proposito: lo maneja
# mongo-keyfile.sh (interactivo, ver infra.sh).
infra_secret_files=(
    pg_admin_password.txt
    pg_replication_password.txt
    pg_logger_password.txt
    pg_password.txt
    pg_user_password.txt
    db_mongo_password.txt
    db_mongo_user_password.txt
    db_gui_password.txt
    db_mongo_logs.txt
    mssql_password.txt
    redis_password.txt
    redis_app_password.txt
)

echo "Verificando secretos de infra para el ambiente [$environment]..."

created=0
for file in "${infra_secret_files[@]}"; do
    path="$secrets_dir/$file"
    if [ -f "$path" ]; then
        echo "  = $file ya existe, se omite."
        continue
    fi
    value="$(new_strong_password 32)"
    printf '%s' "$value" > "$path"
    echo "  + $file generado."
    created=$((created + 1))
done

if [ "$created" -eq 0 ]; then
    echo "Todos los secretos de infra ya existian, nada que generar."
else
    echo "$created secreto(s) de infra generado(s)."
fi
