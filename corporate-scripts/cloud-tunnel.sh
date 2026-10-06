#!/usr/bin/env bash
# Expone el frontend de un ambiente con un Quick Tunnel de Cloudflare.
# Uso: ./run.sh cloud <dev|test|prod>   (equivalente de cloud-tunnel.ps1)
#
# Lee ALLOCATED_IP y FRONT_SSL_PORT de corporate-secrets (Environment/.env y
# despues <Ambiente>/.env; gana la ultima ocurrencia). --no-tls-verify: el
# certificado de nginx-front es self-signed. Solo dev agrega
# --http-host-header <ALLOCATED_IP>: Vite bloquea cualquier Host que no sea una
# IP (anti DNS-rebinding, ver corporate-front/vite.config.ts). El tunel queda en
# primer plano (Ctrl+C lo cierra); mientras este abierto, el ambiente es publico.

set -uo pipefail

ambiente="${1:?Uso: cloud-tunnel.sh <dev|test|prod>}"
case "$ambiente" in
    dev)  env_folder="Development" ;;
    test) env_folder="Testing" ;;
    prod) env_folder="Production" ;;
    *) echo "Error: ambiente debe ser 'dev', 'test' o 'prod'." >&2; exit 1 ;;
esac

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(dirname "$SCRIPT_DIR")"

if ! command -v cloudflared >/dev/null 2>&1; then
    echo "Error: no se encontro 'cloudflared' en el PATH." >&2
    exit 1
fi

ip=""
port=""
for file in "$repo_root/corporate-secrets/Environment/.env" "$repo_root/corporate-secrets/$env_folder/.env"; do
    if [ ! -f "$file" ]; then
        echo "Error: no se encontro el archivo requerido: $file" >&2
        exit 1
    fi
    while IFS= read -r line || [ -n "$line" ]; do
        line="${line%$'\r'}"
        case "$line" in
            ALLOCATED_IP=*)   ip="${line#ALLOCATED_IP=}" ;;
            FRONT_SSL_PORT=*) port="${line#FRONT_SSL_PORT=}" ;;
        esac
    done < "$file"
done
ip="$(echo "$ip" | tr -d "\"' ")"
port="$(echo "$port" | tr -d "\"' ")"

if [ -z "$ip" ] || [ -z "$port" ]; then
    echo "Error: faltan ALLOCATED_IP o FRONT_SSL_PORT en los .env de $env_folder" >&2
    exit 1
fi

args=(tunnel --url "https://${ip}:${port}" --no-tls-verify)
if [ "$ambiente" = "dev" ]; then
    args+=(--http-host-header "$ip")
fi

echo "Exponiendo $ambiente (https://${ip}:${port}) con cloudflared. Ctrl+C para cerrar."
echo "Aviso: mientras el tunel este abierto, el ambiente queda publico en internet."
exec cloudflared "${args[@]}"
