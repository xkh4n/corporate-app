#!/bin/bash
# Verificación A DEMANDA del estado de sincronización del Availability Group.
#
# Por qué esto NO es un healthcheck de Docker Compose: mssql-initdev (el job
# que arma el AG) depende de que mssql01dev y mssql02dev ya estén
# service_healthy. Si el healthcheck de esas dos instancias exigiera
# pertenencia al AG, nunca pasarían healthy la primera vez -el AG todavía no
# existe cuando arrancan por primera vez-, y mssql-initdev jamás podría
# correr para crearlo: dependencia circular. Por eso los healthchecks de
# mssql01dev/mssql02dev en compose.dev.yml se dejan como liveness simple
# (SELECT 1) y este script queda aparte, para diagnóstico manual.
#
# Reutiliza las mismas variables de entorno / secretos que ya están
# declarados para el servicio mssql-initdev (perfil "init"), así que se
# invoca reemplazando su entrypoint, por ejemplo:
#
#   docker compose -f corporate-infra/compose.dev.yml \
#       --env-file corporate-secrets/Development/.env \
#       --env-file corporate-secrets/Environment/.env \
#       run --rm --entrypoint "/bin/bash /scripts/verify-ag.sh" mssql-initdev
#
set -euo pipefail

SQLCMD=(/opt/mssql-tools18/bin/sqlcmd -C)

: "${MSSQL_PRIMARY_HOST:?falta MSSQL_PRIMARY_HOST}"
: "${MSSQL_AG_NAME:?falta MSSQL_AG_NAME}"
: "${MSSQL_DATABASE:?falta MSSQL_DATABASE}"
: "${MSSQL_SA_PASSWORD_FILE:?falta MSSQL_SA_PASSWORD_FILE}"

SA_PASSWORD="$(cat "$MSSQL_SA_PASSWORD_FILE")"

# Los DMV de Always On (dm_hadr_*) son visibles desde cualquier réplica del AG,
# así que basta con consultar al primario; no hace falta conectarse también al
# secundario para ver su estado de sincronización.
echo "[verify-ag] Estado del Availability Group '${MSSQL_AG_NAME}' (visto desde ${MSSQL_PRIMARY_HOST}):"
"${SQLCMD[@]}" -S "$MSSQL_PRIMARY_HOST" -U sa -P "$SA_PASSWORD" -Q "
SET NOCOUNT ON;
SELECT
    ag.name                         AS availability_group,
    ar.replica_server_name          AS replica,
    d.name                          AS database_name,
    drs.synchronization_state_desc,
    drs.synchronization_health_desc,
    hars.role_desc,
    hars.operational_state_desc,
    hars.connected_state_desc
FROM sys.dm_hadr_database_replica_states drs
JOIN sys.databases d
    ON d.database_id = drs.database_id
JOIN sys.availability_groups ag
    ON ag.group_id = drs.group_id
JOIN sys.availability_replicas ar
    ON ar.replica_id = drs.replica_id
JOIN sys.dm_hadr_availability_replica_states hars
    ON hars.replica_id = drs.replica_id
WHERE ag.name = '${MSSQL_AG_NAME}'
  AND d.name = '${MSSQL_DATABASE}';
"
