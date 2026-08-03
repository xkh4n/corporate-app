#!/bin/sh
# Resuelve la plantilla con envsubst usando una allowlist explícita de
# variables, para no pisar las variables propias de NGINX (p.ej. $remote_addr)
# que también usan sintaxis "$nombre". Mismo patrón que
# corporate-infra/NGINX/entrypoint-wrapper.sh.
set -eu

: "${GRAFANA_HOST:?falta GRAFANA_HOST}"
: "${SUFFIX:?falta SUFFIX}"

VARS='${GRAFANA_HOST} ${SUFFIX}'

envsubst "$VARS" < /etc/nginx/templates/nginx.conf.template > /etc/nginx/nginx.conf

exec nginx -g "daemon off;"
