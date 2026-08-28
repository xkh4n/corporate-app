#!/bin/sh
# Resuelve el usuario/password del exporter desde /run/secrets/ (la imagen
# oficial de mongodb_exporter solo acepta MONGODB_PASSWORD en texto plano) y
# arranca el binario apuntando al nodo MongoDB local de este contenedor.
set -eu

: "${MONGO_EXPORTER_USER:?falta MONGO_EXPORTER_USER}"
: "${MONGO_EXPORTER_PASSWORD_FILE:?falta MONGO_EXPORTER_PASSWORD_FILE}"
: "${MONGO_TARGET_URI:?falta MONGO_TARGET_URI}"

export MONGODB_USER="$MONGO_EXPORTER_USER"
export MONGODB_PASSWORD="$(cat "$MONGO_EXPORTER_PASSWORD_FILE")"
export MONGODB_URI="$MONGO_TARGET_URI"

exec /bin/mongodb_exporter "$@"
