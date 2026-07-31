#!/bin/sh
# Arranca redis-server con auth (requirepass/masterauth) leída desde el Docker
# secret y, si el rol es "replica", lo enlaza al primario vía replicaof
# (replicación nativa asíncrona de Redis).
set -eu

: "${REDIS_ROLE:?REDIS_ROLE debe ser 'primary' o 'replica'}"
: "${REDIS_PASSWORD_FILE:?falta REDIS_PASSWORD_FILE}"

REDIS_PASSWORD="$(cat "$REDIS_PASSWORD_FILE")"

set -- redis-server \
    --requirepass "$REDIS_PASSWORD" \
    --masterauth "$REDIS_PASSWORD" \
    --appendonly yes \
    --bind 0.0.0.0

if [ "$REDIS_ROLE" = "replica" ]; then
    : "${REDIS_PRIMARY_HOST:?falta REDIS_PRIMARY_HOST}"
    set -- "$@" --replicaof "$REDIS_PRIMARY_HOST" 6379
fi

exec "$@"
