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
# Postgres no soporta "CREATE ROLE IF NOT EXISTS": cada rol se crea via
# SELECT format(...) WHERE NOT EXISTS(...) \gexec (idiom estandar de Postgres
# para esto), no via DO $$...$$. Los passwords van como variables psql (-v),
# sustituidas en el SQL via :'nombre' -esa sintaxis le pide a psql que las
# escape como literal SQL, a diferencia de interpolarlas directo en el
# heredoc bash ('${PG_ADMIN_PASSWORD}'), donde una comilla simple dentro del
# archivo de secreto rompia el literal y el resto se ejecutaba como SQL con
# privilegio de bootstrap (hallazgo de auditoria de seguridad 2026-09-17).
# IMPORTANTE: psql NO hace sustitucion :'var' dentro de bloques DO $$...$$
# (la region dollar-quoted se trata como opaca, igual que un string simple)
# -una version anterior de este fix envolvia el CREATE ROLE en DO $$...$$ y
# rompia el bootstrap en TODA instalacion limpia con un error de sintaxis
# literal ("syntax error at or near ':'"), reproducido contra
# postgres:17-alpine antes de corregirse. \gexec ejecuta el SQL que arma el
# SELECT (via format(), que ademas escapa %I/%L del lado del servidor) solo
# si la fila existe -si el WHERE NOT EXISTS no matchea ninguna fila, \gexec
# no ejecuta nada, mismo efecto idempotente que el IF NOT EXISTS de antes.
# Los nombres de rol siguen interpolados por bash (":${PG_ADMIN}"): son
# valores de configuracion del deployment, no contenido de un archivo de
# secreto.
psql -v ON_ERROR_STOP=1 \
    -v pg_admin_password="$PG_ADMIN_PASSWORD" \
    -v pg_app_user_password="$PG_APP_USER_PASSWORD" \
    -v pg_logger_user_password="$PG_LOGGER_USER_PASSWORD" \
    -v pg_exporter_user_password="$PG_EXPORTER_USER_PASSWORD" \
    -v pg_replicator_password="$PG_REPLICATOR_PASSWORD" \
    --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
    BEGIN;

    -- Administrador de la app (superusuario propio, distinto del bootstrap "postgres")
    SELECT format('CREATE ROLE %I LOGIN SUPERUSER PASSWORD %L', '${PG_ADMIN}', :'pg_admin_password')
    WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '${PG_ADMIN}')
    \gexec

    -- Usuario de aplicación (CRUD sobre la base del proyecto)
    SELECT format('CREATE ROLE %I LOGIN PASSWORD %L', '${PG_APP_USER}', :'pg_app_user_password')
    WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '${PG_APP_USER}')
    \gexec
    GRANT ALL PRIVILEGES ON DATABASE "${POSTGRES_DB}" TO "${PG_APP_USER}";

    -- Usuario de logging (solo conexión + escritura, sin DDL)
    SELECT format('CREATE ROLE %I LOGIN PASSWORD %L', '${PG_LOGGER_USER}', :'pg_logger_user_password')
    WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '${PG_LOGGER_USER}')
    \gexec
    GRANT CONNECT ON DATABASE "${POSTGRES_DB}" TO "${PG_LOGGER_USER}";

    -- Usuario de métricas para postgres_exporter (Prometheus)
    SELECT format('CREATE ROLE %I LOGIN PASSWORD %L IN ROLE pg_monitor', '${PG_EXPORTER_USER}', :'pg_exporter_user_password')
    WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '${PG_EXPORTER_USER}')
    \gexec

    -- Usuario de replicación física (streaming replication hacia el nodo réplica)
    SELECT format('CREATE ROLE %I LOGIN REPLICATION PASSWORD %L', '${PG_REPLICATOR}', :'pg_replicator_password')
    WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '${PG_REPLICATOR}')
    \gexec

    GRANT ALL ON SCHEMA public TO "${PG_APP_USER}";

    COMMIT;
EOSQL
