#!/usr/bin/env bash
# Ensure Mailer Secrets Generator
# Uso: ./ensure-mailer-secrets.sh dev|test|prod
#
# Mismo criterio que ensure-backend-secrets.sh (no interactivo, idempotente,
# nunca sobreescribe un secret que ya existe). Genera:
#   - mailer_shared_secret.txt: secreto real (aleatorio), compartido entre
#     corporate-api y corporate-mailer para el header X-Mailer-Token -no
#     depende de tener proveedor SMTP, se puede generar ya.
#   - smtp_password.txt: PLACEHOLDER vacio a proposito cuando todavia no hay
#     credencial real -un valor random seria activamente incorrecto (pasaria
#     por "configurado" sin servir para nada). Se reemplaza a mano por la
#     credencial real (contraseña de aplicacion de Gmail, API Key de
#     SendGrid, etc, segun el proveedor SMTP configurado en Development/.env).
#
# Pensado para correr en cada "run.sh mailer <ambiente>", ANTES de
# "docker compose up" (ver corporate-scripts/mailer.sh).

set -uo pipefail

environment="${1:?Uso: ensure-mailer-secrets.sh <dev|test|prod>}"
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

# Mismo generador que ensure-backend-secrets.sh/ensure-monitoring-secrets.sh
# (duplicado a proposito, ver el comentario original en ese archivo).
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

echo "Verificando secretos de mailer para el ambiente [$environment]..."

created=0

shared_secret_path="$secrets_dir/mailer_shared_secret.txt"
if [ -f "$shared_secret_path" ]; then
    echo "  = mailer_shared_secret.txt ya existe, se omite."
else
    value="$(new_strong_password 64)"
    printf '%s' "$value" > "$shared_secret_path"
    echo "  + mailer_shared_secret.txt generado."
    created=$((created + 1))
fi

smtp_password_path="$secrets_dir/smtp_password.txt"
if [ -f "$smtp_password_path" ]; then
    echo "  = smtp_password.txt ya existe, se omite."
else
    : > "$smtp_password_path"
    echo "  + smtp_password.txt creado VACIO (placeholder) -reemplazar con la credencial SMTP real antes de poder enviar correos."
    created=$((created + 1))
fi

if [ "$created" -eq 0 ]; then
    echo "Todos los secretos de mailer ya existian, nada que generar."
else
    echo "$created secreto(s) de mailer generado(s)."
fi
