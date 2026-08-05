#!/bin/sh
# Resuelve la plantilla con envsubst usando una allowlist explícita de
# variables, para no pisar las variables propias de NGINX (p.ej. $remote_addr)
# que también usan sintaxis "$nombre". Mismo patrón que
# corporate-infra/NGINX/entrypoint-wrapper.sh.
set -eu

: "${GRAFANA_HOST:?falta GRAFANA_HOST}"
: "${SUFFIX:?falta SUFFIX}"
: "${MONITORING_SSL_PORT:?falta MONITORING_SSL_PORT}"

# tls.crt/tls.key deben existir ANTES de arrancar (montados desde
# corporate-secrets/Development/certs/monitoring/, ver corporate-scripts/
# ensure-monitoring-tls-cert.ps1): sin este check, nginx fallaria con un
# error de "SSL_CTX_use_certificate_file" poco claro si alguien levanta el
# stack sin haber corrido ese script antes.
if [ ! -s /etc/nginx/certs/tls.crt ] || [ ! -s /etc/nginx/certs/tls.key ]; then
    echo "[entrypoint-wrapper] Falta /etc/nginx/certs/tls.crt o tls.key. Correr corporate-scripts/ensure-monitoring-tls-cert.ps1 antes de levantar este stack." >&2
    exit 1
fi

VARS='${GRAFANA_HOST} ${SUFFIX} ${MONITORING_SSL_PORT}'

envsubst "$VARS" < /etc/nginx/templates/nginx.conf.template > /etc/nginx/nginx.conf

exec nginx -g "daemon off;"
