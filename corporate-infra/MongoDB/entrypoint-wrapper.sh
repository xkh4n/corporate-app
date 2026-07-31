#!/usr/bin/env bash
# Entrypoint condicional según el rol del nodo (MONGO_ROLE=primary|secondary|arbiter).
# El bootstrap del replica set (rs.initiate, creación de usuarios, rs.add del
# secundario y del arbiter) corre SOLO en el primario; el secundario y el
# arbiter simplemente arrancan con el mismo keyFile/replSet y se unen cuando
# el primario los agrega.
#
# Sobre el marker file (/data/db/.mongo-initialized): YA NO es garantía de
# corrección, solo un fast-path. Antes, si el contenedor moría entre el
# rs.initiate() y el touch del marker, el marker no quedaba escrito pero el
# replica set sí tenía estado real en disco -al reiniciar, se reintentaba
# mongo-init.sh desde cero, rs.initiate() explotaba contra un set ya
# inicializado y el contenedor entraba en crash-loop-. Ahora mongo-init.sh es
# plenamente idempotente por sí mismo (guardas contra el estado real del
# replica set y de los usuarios, no contra este archivo), así que si el
# marker falta o quedó desactualizado por un crash a mitad de bootstrap, en
# el peor caso se vuelve a invocar el script -que no encuentra nada pendiente
# y no hace nada, a costa de levantar un mongod temporal innecesario-. El
# marker solo evita pagar ese costo en cada arranque normal.
set -euo pipefail

: "${MONGO_ROLE:?MONGO_ROLE debe ser 'primary', 'secondary' o 'arbiter'}"
: "${MONGO_REPLICA_SET:?falta MONGO_REPLICA_SET}"
: "${MONGO_KEYFILE_SOURCE:=/run/secrets/mongodb_keyfile}"

# El secreto se monta de solo lectura; mongod exige que el keyfile tenga
# permisos 400, así que se copia a un archivo propio del contenedor.
install -m 400 -o mongodb -g mongodb "$MONGO_KEYFILE_SOURCE" /etc/mongodb-keyfile

MONGOD_ARGS=(--replSet "$MONGO_REPLICA_SET" --keyFile /etc/mongodb-keyfile --bind_ip_all)

if [ "$MONGO_ROLE" = "primary" ] && [ ! -f /data/db/.mongo-initialized ]; then
    /usr/local/bin/mongo-init.sh "${MONGOD_ARGS[@]}"
    touch /data/db/.mongo-initialized
fi

echo "[entrypoint-wrapper] Arrancando mongod definitivo (rol=${MONGO_ROLE})..."
exec gosu mongodb mongod "${MONGOD_ARGS[@]}"
