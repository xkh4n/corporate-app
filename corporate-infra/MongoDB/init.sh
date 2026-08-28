#!/usr/bin/env bash
# Bootstrap del replica set. Se invoca desde entrypoint-wrapper.sh, solo en el
# nodo primario. Levanta un mongod temporal, inicializa el replica set como
# single-member, crea el usuario root aprovechando la excepción de localhost,
# crea el resto de usuarios funcionales y finalmente agrega el nodo secundario
# y el arbiter al set. Al terminar, el wrapper arranca el mongod definitivo.
#
# IDEMPOTENCIA (importante): este script puede ejecutarse más de una vez sobre
# el mismo /data/db si un run anterior murió a mitad de camino (host crash,
# OOM-kill, docker kill) -el marker file de entrypoint-wrapper.sh es solo un
# fast-path, no una garantía-. Por eso cada paso mutante de abajo primero
# verifica el estado REAL del servidor antes de actuar, nunca asume que parte
# de cero. Mismo principio que las guardas "IF NOT EXISTS" de
# MsSQL/scripts/setup-ag.sh: la fuente de verdad es siempre el motor, no un
# archivo externo que pueda desincronizarse.
#
# El punto delicado es que, según en qué momento se interrumpió la corrida
# anterior, el mongod temporal puede o no tener ya usuarios creados:
#   - Arranque fresco: no hay ningún usuario todavía, mongosh conecta sin
#     autenticación gracias a la excepción de localhost.
#   - Reintento tras un crash parcial (ya existe al menos el usuario root):
#     TODA consulta no exenta (rs.status, getUser, etc.) requiere auth desde
#     ese momento; conectar sin credenciales falla con error de autorización,
#     no porque el paso no se pueda verificar sino porque falta autenticar.
# La detección de modo de abajo usa exactamente esa asimetría para decidir
# con qué credenciales conectar en el resto del script.
set -euo pipefail

MONGOD_ARGS=("$@")

: "${MONGO_PRIMARY_HOST:?falta MONGO_PRIMARY_HOST}"
: "${MONGO_SECONDARY_HOST:?falta MONGO_SECONDARY_HOST}"
: "${MONGO_ARBITER_HOST:?falta MONGO_ARBITER_HOST}"
: "${MONGO_REPLICA_SET:?falta MONGO_REPLICA_SET}"
: "${MONGO_INITDB_ROOT_USERNAME:?falta MONGO_INITDB_ROOT_USERNAME}"
: "${MONGO_INITDB_ROOT_PASSWORD_FILE:?falta MONGO_INITDB_ROOT_PASSWORD_FILE}"
: "${MONGO_USER:?falta MONGO_USER}"
: "${MONGO_USER_PASSWORD_FILE:?falta MONGO_USER_PASSWORD_FILE}"
: "${MONGO_USER_LOGS:?falta MONGO_USER_LOGS}"
: "${MONGO_USER_LOGS_PASSWORD_FILE:?falta MONGO_USER_LOGS_PASSWORD_FILE}"
: "${MONGO_EXPORTER_USER:?falta MONGO_EXPORTER_USER}"
: "${MONGO_EXPORTER_PASSWORD_FILE:?falta MONGO_EXPORTER_PASSWORD_FILE}"
: "${MPONGO_DB_NAME:?falta MPONGO_DB_NAME}"
: "${MONGO_DB_LOGS:?falta MONGO_DB_LOGS}"

ROOT_PASSWORD="$(cat "$MONGO_INITDB_ROOT_PASSWORD_FILE")"
APP_PASSWORD="$(cat "$MONGO_USER_PASSWORD_FILE")"
LOGS_PASSWORD="$(cat "$MONGO_USER_LOGS_PASSWORD_FILE")"
EXPORTER_PASSWORD="$(cat "$MONGO_EXPORTER_PASSWORD_FILE")"

echo "[mongo-init] Arrancando mongod temporal para el bootstrap del replica set..."
gosu mongodb mongod "${MONGOD_ARGS[@]}" &
MONGOD_PID=$!

echo "[mongo-init] Esperando a que el mongod temporal acepte conexiones..."
until mongosh --quiet --host localhost --eval "db.adminCommand('ping')" >/dev/null 2>&1; do
    sleep 1
done

# --- Detección de modo: ¿arranque fresco o reintento tras crash parcial? ---
#
# rs.status() (replSetGetStatus) NO está en la lista de comandos exentos de
# auth de Mongo (a diferencia de ping/hello), así que sirve como sonda única
# para dos cosas a la vez:
#   - Si responde (ok o NotYetInitialized) sin credenciales: todavía no existe
#     ningún usuario en el deployment (excepción de localhost abierta) -> modo
#     fresco.
#   - Si responde error de autorización sin credenciales: ya hay usuarios
#     creados (y por el orden de este script, eso implica que rs.initiate y
#     la creación del root YA corrieron en un intento anterior) -> modo resume.
NOAUTH_ARGS=(--host localhost --quiet)

PROBE="$(mongosh "${NOAUTH_ARGS[@]}" --eval "
    try {
        rs.status();
        print('RS_OK');
    } catch (e) {
        if (e.codeName === 'NotYetInitialized' || e.code === 94) {
            print('RS_NOT_INITIATED');
        } else if (e.codeName === 'Unauthorized' || e.code === 13) {
            print('AUTH_REQUIRED');
        } else {
            print('UNKNOWN_ERROR: ' + e.message);
        }
    }
" 2>&1)"

RESUME=false
case "$PROBE" in
    *AUTH_REQUIRED*)
        RESUME=true
        ;;
    *RS_OK*|*RS_NOT_INITIATED*)
        RESUME=false
        ;;
    *)
        echo "[mongo-init] ERROR: no se pudo determinar el estado del replica set. Salida de la sonda:" >&2
        echo "$PROBE" >&2
        exit 1
        ;;
esac

if [ "$RESUME" = true ]; then
    echo "[mongo-init] Ya existen usuarios en el deployment: reanudando un bootstrap parcial anterior."
    if ! mongosh --host localhost -u "$MONGO_INITDB_ROOT_USERNAME" -p "$ROOT_PASSWORD" --authenticationDatabase admin --quiet --eval "db.adminCommand('ping')" >/dev/null 2>&1; then
        echo "[mongo-init] ERROR: hay usuarios creados pero las credenciales root no autentican. Estado inconsistente, requiere intervención manual." >&2
        exit 1
    fi
    MONGOSH_AUTH=(--host localhost -u "$MONGO_INITDB_ROOT_USERNAME" -p "$ROOT_PASSWORD" --authenticationDatabase admin --quiet)
else
    echo "[mongo-init] Sin usuarios todavía: arranque fresco."

    if echo "$PROBE" | grep -q RS_NOT_INITIATED; then
        echo "[mongo-init] Inicializando replica set ${MONGO_REPLICA_SET} (single-member)..."
        mongosh "${NOAUTH_ARGS[@]}" --eval "
            rs.initiate({
                _id: '${MONGO_REPLICA_SET}',
                members: [{ _id: 0, host: '${MONGO_PRIMARY_HOST}:27017', priority: 2 }]
            });
        "
    else
        echo "[mongo-init] El replica set ya estaba inicializado (crash parcial detectado antes de crear usuarios)."
    fi

    echo "[mongo-init] Esperando a que el nodo asuma el rol PRIMARY..."
    until mongosh "${NOAUTH_ARGS[@]}" --eval "db.hello().isWritablePrimary" 2>/dev/null | grep -q true; do
        sleep 1
    done

    # Sin guard de existencia acá (a propósito, no es un descuido): llegar a
    # esta rama "else" ya es, por construcción del PROBE de arriba, prueba de
    # que el usuario root todavía NO existe. El PROBE llamó rs.status() sin
    # credenciales y respondió RS_OK o RS_NOT_INITIATED (no AUTH_REQUIRED); la
    # excepción de localhost de Mongo se cierra para siempre en el instante en
    # que se crea el PRIMER usuario del deployment, así que si el root ya
    # existiera de un intento previo, el PROBE habría visto AUTH_REQUIRED y
    # RESUME hubiera sido "true", saltando directo a la rama de auth de
    # arriba. Es imposible llegar acá con el root ya creado.
    #
    # Se probó agregar igual un guard explícito con
    # db.getSiblingDB('admin').getUser(...) sin autenticar, y falló en TODO
    # arranque limpio: getUser() ejecuta el comando usersInfo, y en MongoDB
    # 8.0 la excepción de localhost NO cubre usersInfo -solo cubre comandos de
    # gestión de usuarios como createUser-, así que el comando volvía
    # "Unauthorized" (código 13), la pipeline fallaba bajo "set -euo
    # pipefail", el script abortaba, y como el replica set ya había quedado
    # inicializado, el reintento (restart: always) caía en el mismo punto:
    # crash-loop infinito. Por eso el guard se sacó en vez de repararse.
    echo "[mongo-init] Creando usuario root (excepción de localhost, aún sin usuarios)..."
    mongosh "${NOAUTH_ARGS[@]}" --eval "
        db.getSiblingDB('admin').createUser({
            user: '${MONGO_INITDB_ROOT_USERNAME}',
            pwd: '${ROOT_PASSWORD}',
            roles: [{ role: 'root', db: 'admin' }]
        });
    "

    MONGOSH_AUTH=(--host localhost -u "$MONGO_INITDB_ROOT_USERNAME" -p "$ROOT_PASSWORD" --authenticationDatabase admin --quiet)
fi

# --- A partir de acá, MONGOSH_AUTH ya autentica (root existe en ambos modos) ---

mongo_user_exists() {
    local username="$1"
    local result
    result="$(mongosh "${MONGOSH_AUTH[@]}" --eval "print(db.getSiblingDB('admin').getUser('${username}') !== null)" 2>/dev/null | tail -n1)"
    [ "$result" = "true" ]
}

if mongo_user_exists "${MONGO_USER}"; then
    echo "[mongo-init] Usuario de aplicación '${MONGO_USER}' ya existe, se omite creación."
else
    echo "[mongo-init] Creando usuario de aplicación '${MONGO_USER}' (auth en admin, permisos en '${MPONGO_DB_NAME}')..."
    mongosh "${MONGOSH_AUTH[@]}" --eval "
        db.getSiblingDB('admin').createUser({
            user: '${MONGO_USER}',
            pwd: '${APP_PASSWORD}',
            roles: [{ role: 'readWrite', db: '${MPONGO_DB_NAME}' }]
        });
    "
fi

if mongo_user_exists "${MONGO_USER_LOGS}"; then
    echo "[mongo-init] Usuario de logs '${MONGO_USER_LOGS}' ya existe, se omite creación."
else
    echo "[mongo-init] Creando usuario de logs '${MONGO_USER_LOGS}' (auth en admin, permisos en '${MONGO_DB_LOGS}')..."
    mongosh "${MONGOSH_AUTH[@]}" --eval "
        db.getSiblingDB('admin').createUser({
            user: '${MONGO_USER_LOGS}',
            pwd: '${LOGS_PASSWORD}',
            roles: [{ role: 'readWrite', db: '${MONGO_DB_LOGS}' }]
        });
    "
fi

if mongo_user_exists "${MONGO_EXPORTER_USER}"; then
    echo "[mongo-init] Usuario de métricas '${MONGO_EXPORTER_USER}' ya existe, se omite creación."
else
    echo "[mongo-init] Creando usuario de métricas '${MONGO_EXPORTER_USER}' para mongodb_exporter..."
    mongosh "${MONGOSH_AUTH[@]}" --eval "
        db.getSiblingDB('admin').createUser({
            user: '${MONGO_EXPORTER_USER}',
            pwd: '${EXPORTER_PASSWORD}',
            roles: [
                { role: 'clusterMonitor', db: 'admin' },
                { role: 'read', db: 'local' }
            ]
        });
    "
fi

mongo_member_exists() {
    local host_port="$1"
    local result
    result="$(mongosh "${MONGOSH_AUTH[@]}" --eval "print(rs.conf().members.some(function(m) { return m.host === '${host_port}'; }))" 2>/dev/null | tail -n1)"
    [ "$result" = "true" ]
}

echo "[mongo-init] Esperando a que el nodo secundario ${MONGO_SECONDARY_HOST} esté disponible..."
until mongosh --quiet --host "${MONGO_SECONDARY_HOST}" --eval "db.adminCommand('ping')" >/dev/null 2>&1; do
    sleep 2
done

if mongo_member_exists "${MONGO_SECONDARY_HOST}:27017"; then
    echo "[mongo-init] El secundario ya es miembro del replica set, se omite rs.add."
else
    # Cualquier reconfig (rs.add, rs.addArb, incluso rs.initiate) puede dejar
    # a este nodo transitoriamente en SECONDARY mientras reconfirma su rol de
    # PRIMARY -Mongo lo loguea como "Cannot select sync source because we are
    # a voter and it is not"-. Si el siguiente reconfig se dispara en esa
    # ventana, replSetReconfig lo rechaza ("should only be run on a writable
    # PRIMARY. Current state SECONDARY"), el script muere bajo "set -euo
    # pipefail" y el contenedor entra en crash-loop. Por eso se espera a
    # PRIMARY otra vez, inmediatamente antes de CADA reconfig, no solo la
    # primera vez (después de rs.initiate).
    echo "[mongo-init] Esperando a que el nodo esté en PRIMARY antes de agregar el secundario..."
    until mongosh "${MONGOSH_AUTH[@]}" --eval "db.hello().isWritablePrimary" 2>/dev/null | grep -q true; do
        sleep 1
    done

    # Al pasar de 1 a 2 miembros votantes, el "implicit default write concern"
    # (IDWC, calculado automáticamente según la topología) cambiaría de forma
    # silenciosa; Mongo bloquea el reconfig con "Reconfig attempted to install
    # a config that would change the implicit default write concern" hasta
    # que se fije explícitamente con setDefaultRWConcern. Idempotente: fijar
    # el mismo valor de nuevo no tiene efecto adverso, así que no hace falta
    # guardarlo con un if.
    mongosh "${MONGOSH_AUTH[@]}" --eval "
        db.adminCommand({ setDefaultRWConcern: 1, defaultWriteConcern: { w: 'majority' } });
    "

    echo "[mongo-init] Agregando nodo secundario al replica set..."
    mongosh "${MONGOSH_AUTH[@]}" --eval "
        rs.add({ host: '${MONGO_SECONDARY_HOST}:27017', priority: 1 });
    "
fi

# Arbiter: da mayoría de votos (2 de 3) para que el secundario pueda
# auto-promoverse si el primario cae. Ver el comentario junto al servicio
# mongo-arbiterdev en compose.dev.yml sobre el trade-off que esto introduce
# (escrituras majority bloqueadas si el SECUNDARIO de datos cae, en vez del
# primario).
echo "[mongo-init] Esperando a que el arbiter ${MONGO_ARBITER_HOST} esté disponible..."
until mongosh --quiet --host "${MONGO_ARBITER_HOST}" --eval "db.adminCommand('ping')" >/dev/null 2>&1; do
    sleep 2
done

if mongo_member_exists "${MONGO_ARBITER_HOST}:27017"; then
    echo "[mongo-init] El arbiter ya es miembro del replica set, se omite rs.addArb."
else
    # Mismo motivo que antes de rs.add: el rs.add del secundario (si acaba de
    # correr) pudo haber dejado este nodo transitoriamente en SECONDARY;
    # esperar a PRIMARY otra vez antes de este segundo reconfig.
    echo "[mongo-init] Esperando a que el nodo esté en PRIMARY antes de agregar el arbiter..."
    until mongosh "${MONGOSH_AUTH[@]}" --eval "db.hello().isWritablePrimary" 2>/dev/null | grep -q true; do
        sleep 1
    done

    # Mismo motivo que antes de rs.add: pasar de 2 a 3 miembros votantes
    # también cambia el IDWC implícito, y Mongo exige fijarlo explícitamente
    # antes de aceptar el reconfig. Ver comentario junto a rs.add más arriba.
    mongosh "${MONGOSH_AUTH[@]}" --eval "
        db.adminCommand({ setDefaultRWConcern: 1, defaultWriteConcern: { w: 'majority' } });
    "

    echo "[mongo-init] Agregando arbiter al replica set..."
    mongosh "${MONGOSH_AUTH[@]}" --eval "
        rs.addArb('${MONGO_ARBITER_HOST}:27017');
    "
fi

echo "[mongo-init] Bootstrap completo. Deteniendo mongod temporal..."
mongosh "${MONGOSH_AUTH[@]}" --eval "db.getSiblingDB('admin').shutdownServer({ force: true })" >/dev/null 2>&1 || true
wait "$MONGOD_PID" 2>/dev/null || true
