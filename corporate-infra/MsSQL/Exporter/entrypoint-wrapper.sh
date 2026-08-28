#!/bin/sh
# sql_exporter necesita su target (data_source_name) en un archivo YAML; acá
# se genera ese archivo en runtime con la contraseña resuelta desde
# /run/secrets/, para no dejar el password en texto plano horneado en la
# imagen ni en una variable de entorno visible en "docker inspect".
set -eu

: "${MSSQL_EXPORTER_USER:?falta MSSQL_EXPORTER_USER}"
: "${MSSQL_EXPORTER_PASSWORD_FILE:?falta MSSQL_EXPORTER_PASSWORD_FILE}"
: "${MSSQL_TARGET_HOST:?falta MSSQL_TARGET_HOST}"

MSSQL_EXPORTER_PASSWORD="$(cat "$MSSQL_EXPORTER_PASSWORD_FILE")"

CONFIG_FILE="/tmp/sql_exporter.yml"

cat > "$CONFIG_FILE" <<CONF
global:
    scrape_timeout: 10s
    scrape_timeout_offset: 500ms
    min_interval: 0s
    max_connections: 3
    max_idle_connections: 3

target:
    data_source_name: 'sqlserver://${MSSQL_EXPORTER_USER}:${MSSQL_EXPORTER_PASSWORD}@${MSSQL_TARGET_HOST}:1433'
    collectors: [mssql_standard, mssql_hadr]

collector_files:
    - "/etc/sql_exporter/*.collector.yml"
CONF

exec /bin/sql_exporter --config.file="$CONFIG_FILE"
