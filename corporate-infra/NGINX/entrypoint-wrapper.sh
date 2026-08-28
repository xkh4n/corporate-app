#!/bin/sh
# Resuelve las plantillas de NGINX con envsubst usando una allowlist explícita
# de variables, para no pisar las variables propias de NGINX (p.ej. $remote_addr)
# que también usan sintaxis "$nombre".
set -eu

: "${DEPLOY_ENV:?falta DEPLOY_ENV (dev|test|prod)}"

STREAMS_SRC="/etc/nginx/templates/streams.${DEPLOY_ENV}.conf"
if [ ! -s "$STREAMS_SRC" ]; then
    echo "[entrypoint-wrapper] $STREAMS_SRC no existe o está vacío todavía." >&2
    exit 1
fi

VARS='${POSTGRES_HOST} ${POSTGRE_PORT} ${MONGO_HOST} ${MONGO_PORT} ${REDIS_HOST} ${REDIS_PORT} ${MSSQL_HOST} ${MSSQL_PORT} ${SUFFIX}'

envsubst "$VARS" < /etc/nginx/templates/nginx.conf.template > /etc/nginx/nginx.conf
envsubst "$VARS" < "$STREAMS_SRC" > /etc/nginx/streams.conf

exec nginx -g "daemon off;"
