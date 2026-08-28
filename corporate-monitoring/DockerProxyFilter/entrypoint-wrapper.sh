#!/bin/sh
# Resuelve la plantilla con envsubst usando una allowlist explícita de
# variables, para no pisar las variables propias de NGINX ($request_method,
# $upstream, etc.) que también usan sintaxis "$nombre". Mismo patrón que
# corporate-infra/NGINX/entrypoint-wrapper.sh.
set -eu

: "${DOCKERPROXY_HOST:?falta DOCKERPROXY_HOST}"
: "${SUFFIX:?falta SUFFIX}"

VARS='${DOCKERPROXY_HOST} ${SUFFIX}'

envsubst "$VARS" < /etc/nginx/templates/nginx.conf.template > /etc/nginx/nginx.conf

exec nginx -g "daemon off;"
