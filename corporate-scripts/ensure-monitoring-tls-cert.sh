#!/usr/bin/env bash
# Ensure Monitoring TLS Certificate Generator
# Uso: ./ensure-monitoring-tls-cert.sh dev|test|prod
#
# Mismo criterio "no interactivo, idempotente, nunca sobreescribe" que
# ensure-api-tls-cert.sh: si ya existen tls.crt/tls.key, no los toca -asi,
# cuando llegue el certificado real de una CA, alcanza con pisar esos dos
# archivos a mano (mismo nombre, misma carpeta) y este script nunca los va a
# volver a generar por encima. nginxmondev (ver
# corporate-monitoring/NGINX/config/nginx.conf.template) los lee siempre de
# la misma ruta fija.
#
# Hallazgo de auditoria que motiva esto: Grafana se servia sobre HTTP plano
# con GF_SECURITY_COOKIE_SECURE=false -la cookie de sesion de Grafana viajaba
# sin cifrar por cualquier red donde el puerto fuera alcanzable.

set -uo pipefail

environment="${1:?Uso: ensure-monitoring-tls-cert.sh <dev|test|prod>}"
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

environment_path="$repo_root/corporate-secrets/Environment/.env"
env_stack_path="$repo_root/corporate-secrets/$env_folder/.env"

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

suffix="$(get_env_value_multi 'SUFFIX' "$env_stack_path" "$environment_path")" || suffix=""
nginx_host="$(get_env_value_multi 'NGINX_HOST' "$env_stack_path" "$environment_path")" || nginx_host=""
grafana_host="$(get_env_value_multi 'GRAFANA_HOST' "$env_stack_path" "$environment_path")" || grafana_host=""

if [ -z "$suffix" ] || [ -z "$nginx_host" ] || [ -z "$grafana_host" ]; then
    echo "Error: no se pudo determinar SUFFIX/NGINX_HOST/GRAFANA_HOST desde $env_stack_path / $environment_path" >&2
    exit 1
fi

# certs/monitoring/ separado de certs/api/ y certs/ (MsSQL AG) -misma
# convencion de "carpeta propia por concern" que ya existe en este proyecto.
certs_dir="$repo_root/corporate-secrets/$env_folder/certs/monitoring"
crt_path="$certs_dir/tls.crt"
key_path="$certs_dir/tls.key"

if [ -f "$crt_path" ] && [ -f "$key_path" ]; then
    echo "tls.crt/tls.key ya existen en $certs_dir, se omite (si es el certificado real de una CA, esto es lo esperado)."
    exit 0
fi

mkdir -p "$certs_dir"

if ! command -v openssl >/dev/null 2>&1; then
    echo "Error: no se encontro 'openssl' en el PATH. Instalalo (apt/dnf/pacman) o genera tls.crt/tls.key manualmente en $certs_dir." >&2
    exit 1
fi

# SANs pensados para acceso local: "localhost"/127.0.0.1 (browser contra el
# puerto publicado) + los hostnames internos de Docker del proxy y de
# Grafana (por si se accede via nombre de contenedor desde otro servicio de
# la misma red).
proxy_fqdn="${nginx_host}mon${suffix}"
grafana_fqdn="${grafana_host}01${suffix}"
san="subjectAltName=DNS:localhost,DNS:${proxy_fqdn},DNS:${grafana_fqdn},IP:127.0.0.1"

echo "Generando certificado autofirmado de monitoring para [$environment] en $certs_dir..."

if ! openssl req -x509 -nodes -newkey rsa:2048 -days 825 \
    -keyout "$key_path" -out "$crt_path" \
    -subj "/CN=${proxy_fqdn}" \
    -addext "$san"; then
    echo "Error: openssl finalizo con error." >&2
    exit 1
fi

echo "Certificado autofirmado generado: $crt_path / $key_path (CN=$proxy_fqdn, SAN=$san)"
echo "Para pasar a un certificado real de una CA: reemplazar estos dos archivos con el mismo nombre y reiniciar nginxmondev. No hace falta tocar compose ni nginx.conf."
