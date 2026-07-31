#!/bin/bash
# La imagen oficial de mssql-server no soporta el patrón "_FILE" de Docker
# secrets de forma nativa, así que se resuelve aquí antes de lanzar sqlservr.
set -euo pipefail

: "${MSSQL_SA_PASSWORD_FILE:?falta MSSQL_SA_PASSWORD_FILE}"
export MSSQL_SA_PASSWORD="$(cat "$MSSQL_SA_PASSWORD_FILE")"
export ACCEPT_EULA=Y
export MSSQL_PID="${MSSQL_PID:-Developer}"
export MSSQL_ENABLE_HADR="${MSSQL_ENABLE_HADR:-1}"

exec /opt/mssql/bin/sqlservr
