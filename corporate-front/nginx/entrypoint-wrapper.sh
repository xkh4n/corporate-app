#!/bin/sh
# Mismo patron que corporate-api/nginx/entrypoint-wrapper.sh: resuelve la
# plantilla con envsubst usando una allowlist explicita (no pisar variables
# propias de nginx que tambien usan sintaxis "$nombre").
set -eu

: "${APP_HOST:?falta APP_HOST}"
: "${FRONT_INTERNAL_PORT:?falta FRONT_INTERNAL_PORT}"
: "${SUFFIX:?falta SUFFIX}"
: "${FRONT_SSL_PORT:?falta FRONT_SSL_PORT}"
: "${ALLOCATED_IP:?falta ALLOCATED_IP}"
: "${API_SSL_PORT:?falta API_SSL_PORT}"

# tls.crt/tls.key deben existir ANTES de arrancar (montados desde
# corporate-secrets/Development/certs/front/, ver corporate-scripts/
# ensure-front-tls-cert.ps1): sin este check, nginx fallaria con un error de
# "SSL_CTX_use_certificate_file" poco claro si alguien levanta el stack sin
# haber corrido ese script antes.
if [ ! -s /etc/nginx/certs/tls.crt ] || [ ! -s /etc/nginx/certs/tls.key ]; then
    echo "[entrypoint-wrapper] Falta /etc/nginx/certs/tls.crt o tls.key. Correr corporate-scripts/ensure-front-tls-cert.ps1 antes de levantar este stack." >&2
    exit 1
fi

VARS='${APP_HOST} ${FRONT_INTERNAL_PORT} ${SUFFIX} ${FRONT_SSL_PORT} ${ALLOCATED_IP} ${API_SSL_PORT}'

envsubst "$VARS" < /etc/nginx/templates/nginx.conf.template > /etc/nginx/nginx.conf

exec nginx -g "daemon off;"
