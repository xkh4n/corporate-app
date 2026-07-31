#!/usr/bin/env bash
# Solo corre en el primario, durante el initdb inicial (PGDATA vacío).
# Crea los roles funcionales del proyecto sobre la base bootstrap (POSTGRES_USER/POSTGRES_DB).
set -euo pipefail

: "${PG_ADMIN:?falta PG_ADMIN}"
: "${PG_APP_USER:?falta PG_APP_USER}"
: "${PG_LOGGER_USER:?falta PG_LOGGER_USER}"
: "${PG_EXPORTER_USER:?falta PG_EXPORTER_USER}"
: "${PG_REPLICATOR:?falta PG_REPLICATOR}"

PG_ADMIN_PASSWORD="$(cat "$PG_ADMIN_PASSWORD_FILE")"
PG_APP_USER_PASSWORD="$(cat "$PG_APP_USER_PASSWORD_FILE")"
PG_LOGGER_USER_PASSWORD="$(cat "$PG_LOGGER_USER_PASSWORD_FILE")"
PG_EXPORTER_USER_PASSWORD="$(cat "$PG_EXPORTER_USER_PASSWORD_FILE")"
PG_REPLICATOR_PASSWORD="$(cat "$PG_REPLICATOR_PASSWORD_FILE")"

# Todo en una única transacción explícita: si algo falla a mitad (p.ej. un
# archivo de password mal montado), Postgres revierte TODO el bloque en vez
# de dejar roles a medio crear. Sin esto, ON_ERROR_STOP=1 detiene la
# ejecución en el primer error pero NO revierte las sentencias ya corridas
# (cada CREATE ROLE se autocommitea por su cuenta) -y como Postgres solo
# corre los scripts de docker-entrypoint-initdb.d/ una vez, cuando PGDATA
# está vacío durante el initdb inicial, no hay ninguna segunda pasada
# automática que "termine el trabajo": el nodo quedaría reportando
# pg_isready sano para siempre con roles parciales y sin vía de recuperación.
#
# Postgres no soporta "CREATE ROLE IF NOT EXISTS": cada rol se envuelve en un
# bloque DO $$ ... END $$ que verifica pg_roles antes de crear, así que
# además de transaccional el script queda protegido ante reintentos manuales.
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
    BEGIN;

    -- Administrador de la app (superusuario propio, distinto del bootstrap "postgres")
    DO \$\$
    BEGIN
        IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '${PG_ADMIN}') THEN
            CREATE ROLE "${PG_ADMIN}" LOGIN SUPERUSER PASSWORD '${PG_ADMIN_PASSWORD}';
        END IF;
    END
    \$\$;

    -- Usuario de aplicación (CRUD sobre la base del proyecto)
    DO \$\$
    BEGIN
        IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '${PG_APP_USER}') THEN
            CREATE ROLE "${PG_APP_USER}" LOGIN PASSWORD '${PG_APP_USER_PASSWORD}';
        END IF;
    END
    \$\$;
    GRANT ALL PRIVILEGES ON DATABASE "${POSTGRES_DB}" TO "${PG_APP_USER}";

    -- Usuario de logging (solo conexión + escritura, sin DDL)
    DO \$\$
    BEGIN
        IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '${PG_LOGGER_USER}') THEN
            CREATE ROLE "${PG_LOGGER_USER}" LOGIN PASSWORD '${PG_LOGGER_USER_PASSWORD}';
        END IF;
    END
    \$\$;
    GRANT CONNECT ON DATABASE "${POSTGRES_DB}" TO "${PG_LOGGER_USER}";

    -- Usuario de métricas para postgres_exporter (Prometheus)
    DO \$\$
    BEGIN
        IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '${PG_EXPORTER_USER}') THEN
            CREATE ROLE "${PG_EXPORTER_USER}" LOGIN PASSWORD '${PG_EXPORTER_USER_PASSWORD}' IN ROLE pg_monitor;
        END IF;
    END
    \$\$;

    -- Usuario de replicación física (streaming replication hacia el nodo réplica)
    DO \$\$
    BEGIN
        IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '${PG_REPLICATOR}') THEN
            CREATE ROLE "${PG_REPLICATOR}" LOGIN REPLICATION PASSWORD '${PG_REPLICATOR_PASSWORD}';
        END IF;
    END
    \$\$;

    GRANT ALL ON SCHEMA public TO "${PG_APP_USER}";

    COMMIT;
EOSQL
