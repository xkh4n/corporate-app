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
# Los passwords van como variables psql (-v), sustituidas en el SQL via
# :'nombre' (comilla simple) -esa sintaxis le pide a psql que las escape
# como literal SQL (equivalente a quote_literal), a diferencia de
# interpolarlas directo en el heredoc bash ('${PG_ADMIN_PASSWORD}'), donde
# una comilla simple dentro del archivo de secreto rompia el literal y el
# resto se ejecutaba como SQL con privilegio de bootstrap (hallazgo de
# auditoria de seguridad 2026-09-17). Los nombres de rol siguen interpolados
# por bash (":${PG_ADMIN}"): son valores de configuracion del deployment, no
# contenido de un archivo de secreto.
psql -v ON_ERROR_STOP=1 \
    -v pg_admin_password="$PG_ADMIN_PASSWORD" \
    -v pg_app_user_password="$PG_APP_USER_PASSWORD" \
    -v pg_logger_user_password="$PG_LOGGER_USER_PASSWORD" \
    -v pg_exporter_user_password="$PG_EXPORTER_USER_PASSWORD" \
    -v pg_replicator_password="$PG_REPLICATOR_PASSWORD" \
    --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
    BEGIN;

    -- Administrador de la app (superusuario propio, distinto del bootstrap "postgres")
    DO \$\$
    BEGIN
        IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '${PG_ADMIN}') THEN
            CREATE ROLE "${PG_ADMIN}" LOGIN SUPERUSER PASSWORD :'pg_admin_password';
        END IF;
    END
    \$\$;

    -- Usuario de aplicación (CRUD sobre la base del proyecto)
    DO \$\$
    BEGIN
        IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '${PG_APP_USER}') THEN
            CREATE ROLE "${PG_APP_USER}" LOGIN PASSWORD :'pg_app_user_password';
        END IF;
    END
    \$\$;
    GRANT ALL PRIVILEGES ON DATABASE "${POSTGRES_DB}" TO "${PG_APP_USER}";

    -- Usuario de logging (solo conexión + escritura, sin DDL)
    DO \$\$
    BEGIN
        IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '${PG_LOGGER_USER}') THEN
            CREATE ROLE "${PG_LOGGER_USER}" LOGIN PASSWORD :'pg_logger_user_password';
        END IF;
    END
    \$\$;
    GRANT CONNECT ON DATABASE "${POSTGRES_DB}" TO "${PG_LOGGER_USER}";

    -- Usuario de métricas para postgres_exporter (Prometheus)
    DO \$\$
    BEGIN
        IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '${PG_EXPORTER_USER}') THEN
            CREATE ROLE "${PG_EXPORTER_USER}" LOGIN PASSWORD :'pg_exporter_user_password' IN ROLE pg_monitor;
        END IF;
    END
    \$\$;

    -- Usuario de replicación física (streaming replication hacia el nodo réplica)
    DO \$\$
    BEGIN
        IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '${PG_REPLICATOR}') THEN
            CREATE ROLE "${PG_REPLICATOR}" LOGIN REPLICATION PASSWORD :'pg_replicator_password';
        END IF;
    END
    \$\$;

    GRANT ALL ON SCHEMA public TO "${PG_APP_USER}";

    COMMIT;
EOSQL
