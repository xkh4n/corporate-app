#!/bin/sh
# Resuelve el usuario/password del exporter desde /run/secrets/ (la imagen
# oficial de redis_exporter solo acepta REDIS_PASSWORD en texto plano) y
# arranca el binario apuntando al nodo Redis local de este contenedor.
set -eu

: "${REDIS_EXPORTER_USER:?falta REDIS_EXPORTER_USER}"
: "${REDIS_EXPORTER_PASSWORD_FILE:?falta REDIS_EXPORTER_PASSWORD_FILE}"
: "${REDIS_TARGET_ADDR:?falta REDIS_TARGET_ADDR}"

export REDIS_USER="$REDIS_EXPORTER_USER"
export REDIS_PASSWORD="$(cat "$REDIS_EXPORTER_PASSWORD_FILE")"
export REDIS_ADDR="$REDIS_TARGET_ADDR"

exec /redis_exporter "$@"
