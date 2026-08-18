#!/bin/sh
# Mismo patron que corporate-api/nginx/entrypoint-wrapper.sh: resuelve la
# plantilla con envsubst usando una allowlist explicita (no pisar variables
# propias de nginx que tambien usan sintaxis "$nombre").
set -eu

: "${APP_HOST:?falta APP_HOST}"
: "${FRONT_INTERNAL_PORT:?falta FRONT_INTERNAL_PORT}"
: "${SUFFIX:?falta SUFFIX}"
: "${FRONT_SSL_PORT:?falta FRONT_SSL_PORT}"
: "${API_PROXY_HOST:?falta API_PROXY_HOST}"
: "${NODE_ENV:?falta NODE_ENV}"

# tls.crt/tls.key deben existir ANTES de arrancar (montados desde
# corporate-secrets/${SECRETS_ENV}/certs/front/, ver corporate-scripts/
# ensure-front-tls-cert.ps1): sin este check, nginx fallaria con un error de
# "SSL_CTX_use_certificate_file" poco claro si alguien levanta el stack sin
# haber corrido ese script antes.
if [ ! -s /etc/nginx/certs/tls.crt ] || [ ! -s /etc/nginx/certs/tls.key ]; then
    echo "[entrypoint-wrapper] Falta /etc/nginx/certs/tls.crt o tls.key. Correr corporate-scripts/ensure-front-tls-cert.ps1 antes de levantar este stack." >&2
    exit 1
fi

# development -> plantilla que proxea a "vite dev" con soporte de HMR
# (websocket, CSP relajada). Cualquier otro NODE_ENV (test/production) ->
# plantilla de produccion, que sirve el bundle estatico ya compilado via
# "serve" (ver corporate-front/Dockerfile) con CSP endurecida y HSTS
# (hallazgos de auditoria de seguridad 2026-08-17: C1 y H2/M1).
if [ "$NODE_ENV" = "development" ]; then
    TEMPLATE=/etc/nginx/templates/nginx.conf.template
else
    TEMPLATE=/etc/nginx/templates/nginx.conf.prod.template
fi

VARS='${APP_HOST} ${FRONT_INTERNAL_PORT} ${SUFFIX} ${FRONT_SSL_PORT} ${API_PROXY_HOST}'

envsubst "$VARS" < "$TEMPLATE" > /etc/nginx/nginx.conf

exec nginx -g "daemon off;"
