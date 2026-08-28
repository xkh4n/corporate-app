#!/bin/bash
# Bootstrap de un Availability Group "read-scale" (CLUSTER_TYPE = NONE, sin WSFC),
# autenticado por certificado y con auto-seeding, entre dos instancias mssql-server
# en contenedores. Corre en un servicio de un solo uso (mssql-init) que se
# ejecuta después de que ambas instancias estén healthy.
#
# Notas:
# - Reutiliza el secreto de SA (mssql_password) también como contraseña de la
#   master key / certificado / login HADR para no multiplicar secretos en este
#   primer pase (dev). Antes de ir a producción, separarlos en secretos propios.
# - El certificado (.cer/.pvk) viaja entre nodos a través del volumen compartido
#   montado en /var/opt/mssql/certs (corporate-secrets/Development/certs).
set -euo pipefail

SQLCMD=(/opt/mssql-tools18/bin/sqlcmd -C)

: "${MSSQL_PRIMARY_HOST:?falta MSSQL_PRIMARY_HOST}"
: "${MSSQL_SECONDARY_HOST:?falta MSSQL_SECONDARY_HOST}"
: "${MSSQL_AG_NAME:?falta MSSQL_AG_NAME}"
: "${MSSQL_DATABASE:?falta MSSQL_DATABASE}"
: "${MSSQL_SA_PASSWORD_FILE:?falta MSSQL_SA_PASSWORD_FILE}"
: "${MSSQL_EXPORTER_USER:?falta MSSQL_EXPORTER_USER}"
: "${MSSQL_EXPORTER_PASSWORD_FILE:?falta MSSQL_EXPORTER_PASSWORD_FILE}"
: "${MSSQL_APP_USER:?falta MSSQL_APP_USER}"
: "${MSSQL_APP_USER_PASSWORD_FILE:?falta MSSQL_APP_USER_PASSWORD_FILE}"

SA_PASSWORD="$(cat "$MSSQL_SA_PASSWORD_FILE")"
CERT_PASSWORD="$SA_PASSWORD"
HADR_LOGIN_PASSWORD="$SA_PASSWORD"
EXPORTER_PASSWORD="$(cat "$MSSQL_EXPORTER_PASSWORD_FILE")"
APP_USER_PASSWORD="$(cat "$MSSQL_APP_USER_PASSWORD_FILE")"

# Sin marker file: cada paso de abajo ya es idempotente por su cuenta (guards
# "IF NOT EXISTS" contra el estado real de cada instancia). Un marker file
# aparte (p.ej. en el bind-mount de certs) puede quedar desincronizado del
# volumen real de datos de SQL Server -si ese volumen se recrea vacío por
# cualquier motivo, el marker miente diciendo "ya está listo" y el AG nunca
# se reconstruye-, así que la fuente de verdad es siempre SQL Server mismo.

run_primary()   { "${SQLCMD[@]}" -S "$MSSQL_PRIMARY_HOST"   -U sa -P "$SA_PASSWORD" -Q "$1"; }
run_secondary() { "${SQLCMD[@]}" -S "$MSSQL_SECONDARY_HOST" -U sa -P "$SA_PASSWORD" -Q "$1"; }

wait_for() {
    local host="$1"
    until "${SQLCMD[@]}" -S "$host" -U sa -P "$SA_PASSWORD" -Q "SELECT 1" >/dev/null 2>&1; do
        echo "[setup-ag] Esperando a que $host acepte conexiones..."
        sleep 3
    done
}

echo "[setup-ag] Esperando a ambas instancias..."
wait_for "$MSSQL_PRIMARY_HOST"
wait_for "$MSSQL_SECONDARY_HOST"

# Se limpian .cer/.pvk viejos antes de exportar: si quedaron de una instancia
# anterior (p.ej. porque el volumen de datos se recreó vacío pero este
# bind-mount de certs no), BACKUP CERTIFICATE fallaría en silencio al
# encontrar el archivo ya existente y dejaría un certificado que no matchea
# la instancia actual. Si nada cambió, esto solo vuelve a exportar el mismo
# certificado - no tiene efecto.
rm -f /certs/dbm_certificate.cer /certs/dbm_certificate.pvk

echo "[setup-ag] Master key + certificado HADR en el primario..."
run_primary "
IF NOT EXISTS (SELECT 1 FROM sys.symmetric_keys WHERE name = '##MS_DatabaseMasterKey##')
    CREATE MASTER KEY ENCRYPTION BY PASSWORD = N'${CERT_PASSWORD}';
IF NOT EXISTS (SELECT 1 FROM sys.certificates WHERE name = 'dbm_certificate')
    CREATE CERTIFICATE dbm_certificate WITH SUBJECT = 'dbm_certificate';
"

# El respaldo a archivo se maneja aparte del guard de creación del certificado:
# si el objeto ya existía (p.ej. por un reintento tras borrar el .cer/.pvk del
# volumen compartido) igual hace falta volver a exportarlo a disco.
run_primary "
BEGIN TRY
    BACKUP CERTIFICATE dbm_certificate TO FILE = '/var/opt/mssql/certs/dbm_certificate.cer'
        WITH PRIVATE KEY (FILE = '/var/opt/mssql/certs/dbm_certificate.pvk', ENCRYPTION BY PASSWORD = N'${CERT_PASSWORD}');
END TRY
BEGIN CATCH
    PRINT 'BACKUP CERTIFICATE omitido: ' + ERROR_MESSAGE();
END CATCH
"

echo "[setup-ag] Esperando a que el certificado aparezca en el volumen compartido..."
until [ -f /certs/dbm_certificate.cer ]; do sleep 1; done

echo "[setup-ag] Importando certificado en el secundario..."
run_secondary "
IF NOT EXISTS (SELECT 1 FROM sys.symmetric_keys WHERE name = '##MS_DatabaseMasterKey##')
    CREATE MASTER KEY ENCRYPTION BY PASSWORD = N'${CERT_PASSWORD}';
IF NOT EXISTS (SELECT 1 FROM sys.certificates WHERE name = 'dbm_certificate')
    CREATE CERTIFICATE dbm_certificate FROM FILE = '/var/opt/mssql/certs/dbm_certificate.cer'
        WITH PRIVATE KEY (FILE = '/var/opt/mssql/certs/dbm_certificate.pvk', DECRYPTION BY PASSWORD = N'${CERT_PASSWORD}');
"

for pair in "primary:run_primary" "secondary:run_secondary"; do
    name="${pair%%:*}"
    fn="${pair##*:}"
    echo "[setup-ag] Endpoint HADR en $name..."
    "$fn" "
    IF NOT EXISTS (SELECT 1 FROM sys.endpoints WHERE name = 'hadr_endpoint')
        CREATE ENDPOINT hadr_endpoint STATE = STARTED
            AS TCP (LISTENER_PORT = 5022)
            FOR DATABASE_MIRRORING (ROLE = ALL, AUTHENTICATION = CERTIFICATE dbm_certificate, ENCRYPTION = REQUIRED ALGORITHM AES);
    IF NOT EXISTS (SELECT 1 FROM sys.server_principals WHERE name = 'hadr_login')
    BEGIN
        CREATE LOGIN hadr_login WITH PASSWORD = N'${HADR_LOGIN_PASSWORD}';
        CREATE USER hadr_user FOR LOGIN hadr_login;
        GRANT CONNECT ON ENDPOINT::hadr_endpoint TO hadr_login;
    END
    "
done

# Login de metricas para sql_exporter (Prometheus). A diferencia de Postgres/
# Mongo (donde el usuario de metricas se crea una sola vez y replica solo
# hacia el otro nodo via streaming/oplog), los logins de SQL Server son a
# nivel de instancia y NO se replican -hay que crearlo explicitamente en
# AMBAS instancias, igual que hadr_login arriba. Permisos minimos estandar
# para un exporter de SQL Server: VIEW SERVER STATE (DMVs de rendimiento,
# sesiones, esperas, estado del AG) + VIEW ANY DEFINITION (metadata de
# objetos) -sin acceso de lectura/escritura a datos de negocio en ninguna
# base-.
for pair in "primary:run_primary" "secondary:run_secondary"; do
    name="${pair%%:*}"
    fn="${pair##*:}"
    echo "[setup-ag] Login de metricas '${MSSQL_EXPORTER_USER}' en $name..."
    "$fn" "
    IF NOT EXISTS (SELECT 1 FROM sys.server_principals WHERE name = '${MSSQL_EXPORTER_USER}')
    BEGIN
        CREATE LOGIN [${MSSQL_EXPORTER_USER}] WITH PASSWORD = N'${EXPORTER_PASSWORD}';
    END
    GRANT VIEW SERVER STATE TO [${MSSQL_EXPORTER_USER}];
    GRANT VIEW ANY DEFINITION TO [${MSSQL_EXPORTER_USER}];
    "
done

# Login de aplicacion para corporate-api. Mismo motivo que hadr_login/
# MSSQL_EXPORTER_USER arriba: los logins de SQL Server son a nivel de
# instancia, hay que crearlo explicitamente en AMBAS instancias. Los permisos
# de datos (db_datareader/db_datawriter/db_ddladmin) se otorgan mas abajo,
# UNA sola vez sobre el primario, despues de crear la base -el usuario a
# nivel de base SI replica al secundario via el AG, a diferencia del login-.
for pair in "primary:run_primary" "secondary:run_secondary"; do
    name="${pair%%:*}"
    fn="${pair##*:}"
    echo "[setup-ag] Login de aplicacion '${MSSQL_APP_USER}' en $name..."
    "$fn" "
    IF NOT EXISTS (SELECT 1 FROM sys.server_principals WHERE name = '${MSSQL_APP_USER}')
    BEGIN
        CREATE LOGIN [${MSSQL_APP_USER}] WITH PASSWORD = N'${APP_USER_PASSWORD}';
    END
    "
done

echo "[setup-ag] Creando Availability Group '${MSSQL_AG_NAME}' (read-scale, CLUSTER_TYPE=NONE)..."
run_primary "
IF NOT EXISTS (SELECT 1 FROM sys.availability_groups WHERE name = '${MSSQL_AG_NAME}')
CREATE AVAILABILITY GROUP [${MSSQL_AG_NAME}]
    WITH (CLUSTER_TYPE = NONE)
    FOR REPLICA ON
    '${MSSQL_PRIMARY_HOST}' WITH (
        ENDPOINT_URL = 'TCP://${MSSQL_PRIMARY_HOST}:5022',
        AVAILABILITY_MODE = ASYNCHRONOUS_COMMIT,
        FAILOVER_MODE = MANUAL,
        SEEDING_MODE = AUTOMATIC),
    '${MSSQL_SECONDARY_HOST}' WITH (
        ENDPOINT_URL = 'TCP://${MSSQL_SECONDARY_HOST}:5022',
        AVAILABILITY_MODE = ASYNCHRONOUS_COMMIT,
        FAILOVER_MODE = MANUAL,
        SEEDING_MODE = AUTOMATIC);
"

echo "[setup-ag] Uniendo el secundario al Availability Group..."
run_secondary "
IF NOT EXISTS (SELECT 1 FROM sys.availability_groups WHERE name = '${MSSQL_AG_NAME}')
    ALTER AVAILABILITY GROUP [${MSSQL_AG_NAME}] JOIN WITH (CLUSTER_TYPE = NONE);
ALTER AVAILABILITY GROUP [${MSSQL_AG_NAME}] GRANT CREATE ANY DATABASE;
"

echo "[setup-ag] Creando base '${MSSQL_DATABASE}' con un full backup inicial..."
run_primary "
IF NOT EXISTS (SELECT 1 FROM sys.databases WHERE name = '${MSSQL_DATABASE}')
BEGIN
    CREATE DATABASE [${MSSQL_DATABASE}];
    ALTER DATABASE [${MSSQL_DATABASE}] SET RECOVERY FULL;
    -- Un AG exige al menos un full backup previo antes de poder unir la base,
    -- aunque el auto-seeding se encargue después de replicar los datos reales.
    BACKUP DATABASE [${MSSQL_DATABASE}] TO DISK = '/var/opt/mssql/data/${MSSQL_DATABASE}_seed.bak';
END
"

echo "[setup-ag] Agregando '${MSSQL_DATABASE}' al AG (auto-seeding hacia el secundario)..."
run_primary "
IF NOT EXISTS (SELECT 1 FROM sys.availability_databases_cluster WHERE database_name = '${MSSQL_DATABASE}')
    ALTER AVAILABILITY GROUP [${MSSQL_AG_NAME}] ADD DATABASE [${MSSQL_DATABASE}];
"

echo "[setup-ag] Usuario de aplicacion '${MSSQL_APP_USER}' en '${MSSQL_DATABASE}' (db_datareader+db_datawriter+db_ddladmin)..."
run_primary "
USE [${MSSQL_DATABASE}];
IF NOT EXISTS (SELECT 1 FROM sys.database_principals WHERE name = '${MSSQL_APP_USER}')
    CREATE USER [${MSSQL_APP_USER}] FOR LOGIN [${MSSQL_APP_USER}];
ALTER ROLE db_datareader ADD MEMBER [${MSSQL_APP_USER}];
ALTER ROLE db_datawriter ADD MEMBER [${MSSQL_APP_USER}];
-- db_ddladmin (no sysadmin/sa): corporate-api corre sus propias migraciones
-- idempotentes (CREATE TABLE IF NOT EXISTS) contra su propio esquema, sin
-- necesitar el usuario de superadministracion del motor.
ALTER ROLE db_ddladmin ADD MEMBER [${MSSQL_APP_USER}];
"

echo "[setup-ag] Esperando a que el secundario sincronice via auto-seeding..."
for i in $(seq 1 30); do
    STATE="$("${SQLCMD[@]}" -h -1 -W -S "$MSSQL_SECONDARY_HOST" -U sa -P "$SA_PASSWORD" -Q "SET NOCOUNT ON; SELECT synchronization_state_desc FROM sys.dm_hadr_database_replica_states drs JOIN sys.databases d ON d.database_id = drs.database_id WHERE d.name = '${MSSQL_DATABASE}';" | tr -d '[:space:]')"
    echo "[setup-ag] Estado de sincronización en el secundario: ${STATE:-<sin datos aún>}"
    if [ "$STATE" = "SYNCHRONIZED" ] || [ "$STATE" = "SYNCHRONIZING" ]; then
        break
    fi
    sleep 5
done

echo "[setup-ag] Listo: '${MSSQL_DATABASE}' en read-scale AG (primario=${MSSQL_PRIMARY_HOST}, réplica=${MSSQL_SECONDARY_HOST})."
