#!/usr/bin/env bash
# Ensure Monitoring Secrets Generator
# Uso: ./ensure-monitoring-secrets.sh dev|test|prod
#
# Genera, SOLO si faltan, los archivos de password de los usuarios de metricas
# (exporters de Prometheus) de cada motor de base de datos. A diferencia de
# mongo-keyfile.sh (que pregunta antes de sobreescribir), este script es
# NO interactivo e IDEMPOTENTE: nunca pregunta nada y nunca toca un secreto
# que ya existe -si el archivo esta, se omite tal cual esta. Regenerarlo en
# silencio dejaria el usuario ya creado en la base con un password viejo que
# ya no coincide con el secret nuevo (la unica forma de "rotar" es borrar el
# archivo a mano y dejar que el motor recree el usuario, igual que el resto
# de los secretos de este proyecto).
#
# Pensado para correr en cada "run.sh bdd <ambiente>", ANTES de "docker
# compose up" (ver corporate-scripts/infra.sh), para que el ambiente quede
# listo para scrapear sin que el usuario tenga que acordarse de un paso manual.

set -uo pipefail

environment="${1:?Uso: ensure-monitoring-secrets.sh <dev|test|prod>}"
case "$environment" in
    dev|test|prod) ;;
    *) echo "Error: environment debe ser 'dev', 'test' o 'prod'." >&2; exit 1 ;;
esac

# Rutas absolutas (no dependen del directorio desde el que se invoque el script)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(dirname "$SCRIPT_DIR")"

case "$environment" in
    dev)  env_folder="Development" ;;
    test) env_folder="Testing" ;;
    prod) env_folder="Production" ;;
esac

secrets_dir="$repo_root/corporate-secrets/$env_folder"
if [ ! -d "$secrets_dir" ]; then
    # No deberia pasar en un ambiente ya inicializado (infra.sh ya valida que
    # exista corporate-secrets/<Ambiente>/.env antes de llegar aca), pero por
    # las dudas se crea para que este script tambien pueda correr solo.
    mkdir -p "$secrets_dir"
fi

# Passwords de exporters de Prometheus que necesita el stack. Se listan TODOS
# -incluidos los que ya existen desde antes (pg_exporter_password,
# db_mongo_exporter)- para que este script sea el punto unico de verdad de
# "que secretos de monitoreo hacen falta"; pero solo se genera el archivo
# cuando falta, los que ya existen no se tocan ni se leen.
monitoring_secrets=(
    pg_exporter_password.txt
    db_mongo_exporter.txt
    redis_exporter_password.txt
    mssql_exporter_password.txt
)

# Devuelve un indice aleatorio criptograficamente seguro en [0, max).
random_index() {
    local max="$1" n
    n=$(od -An -N4 -tu4 /dev/urandom | tr -d ' ')
    echo $(( n % max ))
}

# Password fuerte, alfanumerico + un set de simbolos deliberadamente acotado
# a los "URL/shell-safe": ni siquiera intenta usar el charset completo de
# simbolos porque estos passwords terminan interpolados en lugares fragiles
# (DSNs de connection string, comandos "ACL SETUSER" de Redis, heredocs de
# shell) donde un caracter como @ : / \ ' " $ ` # ? & % espacio puede romper
# el parseo -exactamente el tipo de bug que ya salio una vez en este proyecto
# con la interpolacion de un --eval de mongosh. Garantiza ademas al menos un
# caracter de cada categoria (mayuscula, minuscula, digito, simbolo) para
# cumplir politicas de complejidad como la de SQL Server sin depender del
# azar ni tener que desactivar CHECK_POLICY.
new_strong_password() {
    local length="${1:-32}"
    local upper="ABCDEFGHJKLMNPQRSTUVWXYZ"   # sin I/O: evita confusion visual con 1/0
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

echo "Verificando secretos de monitoreo para el ambiente [$environment]..."

created=0
for secret_file in "${monitoring_secrets[@]}"; do
    path="$secrets_dir/$secret_file"
    if [ -f "$path" ]; then
        echo "  = $secret_file ya existe, se omite."
        continue
    fi

    password="$(new_strong_password 32)"
    printf '%s' "$password" > "$path"
    echo "  + $secret_file generado."
    created=$((created + 1))
done

if [ "$created" -eq 0 ]; then
    echo "Todos los secretos de monitoreo ya existian, nada que generar."
else
    echo "$created secreto(s) de monitoreo generado(s)."
fi
