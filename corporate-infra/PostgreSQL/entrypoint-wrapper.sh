#!/usr/bin/env bash
# Entrypoint condicional según el rol del nodo (PG_ROLE=primary|replica).
# - primary: delega directamente en el entrypoint oficial (initdb + scripts de /docker-entrypoint-initdb.d/)
# - replica: si PGDATA está vacío, clona el primario con pg_basebackup (streaming replication)
#            antes de delegar en el entrypoint oficial, que arrancará en modo standby
#            al encontrar el archivo standby.signal generado por -R.
set -euo pipefail

: "${PG_ROLE:?PG_ROLE debe ser 'primary' o 'replica'}"
: "${PGDATA:=/var/lib/postgresql/data}"

if [ "$PG_ROLE" = "replica" ]; then
    : "${PG_PRIMARY_HOST:?falta PG_PRIMARY_HOST}"
    : "${PG_REPLICATOR:?falta PG_REPLICATOR}"
    : "${PG_REPLICATOR_PASSWORD_FILE:?falta PG_REPLICATOR_PASSWORD_FILE}"

    REPL_PASSWORD="$(cat "$PG_REPLICATOR_PASSWORD_FILE")"

    if [ -z "$(ls -A "$PGDATA" 2>/dev/null)" ]; then
        echo "[entrypoint-wrapper] Rol=replica, PGDATA vacío. Esperando al primario ${PG_PRIMARY_HOST}..."
        until pg_isready -h "$PG_PRIMARY_HOST" -p 5432 -U "$PG_REPLICATOR" >/dev/null 2>&1; do
            sleep 2
        done

        echo "[entrypoint-wrapper] Clonando primario con pg_basebackup..."
        # La contraseña va embebida en el connection string (-d), no en ~/.pgpass:
        # este wrapper corre como root pero docker-entrypoint.sh reinicia el server
        # como el usuario "postgres" (gosu) y el walreceiver hereda ESE proceso, no
        # el nuestro, así que un .pgpass propio es frágil. Con -R, pg_basebackup
        # graba el mismo connection string (con password incluida) como
        # primary_conninfo en postgresql.auto.conf, que es lo que usará el
        # walreceiver en cada reconexión sin depender de ningún archivo aparte.
        pg_basebackup \
            -d "host=${PG_PRIMARY_HOST} port=5432 user=${PG_REPLICATOR} password=${REPL_PASSWORD} application_name=$(hostname)" \
            -D "$PGDATA" \
            -Fp -Xs -P -R -w

        chmod 700 "$PGDATA"
        echo "[entrypoint-wrapper] Clonación completa. standby.signal generado por -R."
    else
        echo "[entrypoint-wrapper] Rol=replica, PGDATA ya inicializado. Se omite pg_basebackup."
    fi
fi

exec docker-entrypoint.sh "$@"
