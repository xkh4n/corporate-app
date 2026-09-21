#!/usr/bin/env bash
# Ensure Backend Secrets Generator
# Uso: ./ensure-backend-secrets.sh dev|test|prod
#
# Mismo criterio que ensure-monitoring-secrets.sh (no interactivo, idempotente,
# nunca sobreescribe un secret que ya existe): genera, SOLO si faltan, los
# secrets propios de corporate-api -el usuario de aplicacion de MSSQL
# (db_datareader+db_datawriter+db_ddladmin sobre MSSQL_DBNAME, ver
# corporate-infra/MsSQL/scripts/setup-ag.sh), los secrets de auth (JWT
# access/refresh, cookie de sesion) y el password del usuario "admin" de
# arranque (services/../databases/seed.ts).
#
# Pensado para correr en cada "run.sh backend <ambiente>", ANTES de
# "docker compose up" (ver corporate-scripts/backend.sh).

set -uo pipefail

environment="${1:?Uso: ensure-backend-secrets.sh <dev|test|prod>}"
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

# Mismo generador que ensure-monitoring-secrets.sh (charset URL/shell-safe a
# proposito, ver el comentario original ahi): se duplica en vez de compartir
# un modulo porque ningun otro script de corporate-scripts importa modulos
# propios hoy, y estos dos generadores ya pueden divergir con el tiempo
# (longitudes distintas por secret).
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

    # Fisher-Yates: sin esto, las 4 posiciones garantizadas de arriba
    # quedarian siempre al principio del password (patron predecible).
    local i j tmp
    for (( i=${#chars[@]}-1; i>0; i-- )); do
        j=$(random_index $((i+1)))
        tmp="${chars[$i]}"; chars[$i]="${chars[$j]}"; chars[$j]="$tmp"
    done

    local result=""
    for c in "${chars[@]}"; do result+="$c"; done
    printf '%s' "$result"
}

# (nombre de archivo, longitud)
backend_secret_files=(mssql_app_password.txt jwt_access_secret.txt jwt_refresh_secret.txt session_secret.txt bootstrap_admin_password.txt default_user_password.txt)
backend_secret_lengths=(32 64 64 64 20 20)

echo "Verificando secretos de backend para el ambiente [$environment]..."

created=0
for i in "${!backend_secret_files[@]}"; do
    file="${backend_secret_files[$i]}"
    length="${backend_secret_lengths[$i]}"
    path="$secrets_dir/$file"
    if [ -f "$path" ]; then
        echo "  = $file ya existe, se omite."
        continue
    fi
    value="$(new_strong_password "$length")"
    printf '%s' "$value" > "$path"
    echo "  + $file generado."
    created=$((created + 1))
done

if [ "$created" -eq 0 ]; then
    echo "Todos los secretos de backend ya existian, nada que generar."
else
    echo "$created secreto(s) de backend generado(s)."
fi
