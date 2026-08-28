#!/bin/sh
# Mismo patron que corporate-infra/NGINX/entrypoint-wrapper.sh: resuelve la
# plantilla con envsubst usando una allowlist explicita (no pisar variables
# propias de nginx que tambien usan sintaxis "$nombre").
set -eu

: "${API_HOST:?falta API_HOST}"
: "${API_INTERNAL_PORT:?falta API_INTERNAL_PORT}"
: "${SUFFIX:?falta SUFFIX}"
: "${API_SSL_PORT:?falta API_SSL_PORT}"

# tls.crt/tls.key deben existir ANTES de arrancar (montados desde
# corporate-secrets/Development/certs/api/, ver corporate-scripts/
# ensure-api-tls-cert.ps1): sin este check, nginx fallaria con un error de
# "SSL_CTX_use_certificate_file" poco claro si alguien levanta el stack sin
# haber corrido ese script antes.
if [ ! -s /etc/nginx/certs/tls.crt ] || [ ! -s /etc/nginx/certs/tls.key ]; then
    echo "[entrypoint-wrapper] Falta /etc/nginx/certs/tls.crt o tls.key. Correr corporate-scripts/ensure-api-tls-cert.ps1 antes de levantar este stack." >&2
    exit 1
fi

VARS='${API_HOST} ${API_INTERNAL_PORT} ${SUFFIX} ${API_SSL_PORT}'

envsubst "$VARS" < /etc/nginx/templates/nginx.conf.template > /etc/nginx/nginx.conf

exec nginx -g "daemon off;"
