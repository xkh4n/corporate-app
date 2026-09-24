#!/bin/sh
# Arranca redis-server con auth (requirepass/masterauth) leída desde el Docker
# secret y, si el rol es "replica", lo enlaza al primario vía replicaof
# (replicación nativa asíncrona de Redis).
#
# Hardening (hallazgo de auditoría: Redis era el único de los 4 motores que
# corría como root en runtime -Postgres/Mongo/MSSQL ya bajan privilegios-):
# el contenedor sigue arrancando como root (sin USER en el Dockerfile) SOLO
# para poder corregir el ownership de /data antes de arrancar redis-server;
# mismo patrón ya usado acá en MongoDB/entrypoint-wrapper.sh (root -> chown/
# install -> gosu), pero con "su-exec" en vez de "gosu" porque la imagen
# oficial de Redis no trae gosu (sí trae su-exec, agregado vía apk en el
# Dockerfile).
set -eu

: "${REDIS_ROLE:?REDIS_ROLE debe ser 'primary' o 'replica'}"
: "${REDIS_PASSWORD_FILE:?falta REDIS_PASSWORD_FILE}"
: "${REDIS_EXPORTER_USER:?falta REDIS_EXPORTER_USER}"
: "${REDIS_EXPORTER_PASSWORD_FILE:?falta REDIS_EXPORTER_PASSWORD_FILE}"
: "${REDIS_APP_USER:?falta REDIS_APP_USER}"
: "${REDIS_APP_PASSWORD_FILE:?falta REDIS_APP_PASSWORD_FILE}"

REDIS_PASSWORD="$(cat "$REDIS_PASSWORD_FILE")"
REDIS_EXPORTER_PASSWORD="$(cat "$REDIS_EXPORTER_PASSWORD_FILE")"
REDIS_APP_PASSWORD="$(cat "$REDIS_APP_PASSWORD_FILE")"

# Necesario tanto para volúmenes nuevos (el punto de montaje ya queda
# redis:redis por la imagen base, pero por las dudas) como, sobre todo, para
# volúmenes YA EXISTENTES de antes de este fix: como Redis corría como root
# hasta ahora, el AOF/RDB que ya escribió quedó root:root -sin este chown,
# bajar privilegios a "redis" rompería la escritura en esos archivos ya
# existentes en el primer arranque post-fix-.
chown -R redis:redis /data

# Tope de memoria por debajo del limite del contenedor (512M en los compose): sin esto un Redis lleno (p. ej. cargas masivas
# de activos sin iniciar, ~1 MB cada una) lo mata el cgroup por OOM y se caen sesiones, rate limits y trabajos. Con
# "noeviction" NUNCA se descartan sesiones ni contadores: al llegar al tope las ESCRITURAS fallan con un error y el proceso sigue.
set -- redis-server \
    --requirepass "$REDIS_PASSWORD" \
    --masterauth "$REDIS_PASSWORD" \
    --appendonly yes \
    --maxmemory 400mb \
    --maxmemory-policy noeviction \
    --bind 0.0.0.0

# Usuario ACL de solo-lectura para oliver006/redis_exporter (Prometheus). Se
# define acá (flag --user en el arranque), NO vía "ACL SETUSER" en runtime,
# porque un --user de línea de comandos lo procesa cada nodo por su cuenta al
# bootear -necesario en este wrapper compartido por primario y réplica, ya
# que un ACL SETUSER emitido en runtime en el primario sí se replicaría al
# secundario vía el stream de replicación, pero acá cada nodo arranca desde
# cero con su propio redis-server, no hay "runtime" que replicar todavía.
#
# La regla ACL es la recomendada TAL CUAL por la documentación oficial del
# propio exporter (ver README.md, sección "Authenticating with Redis" ->
# "ACL SETUSER"), no una lista armada de memoria: da acceso de solo-lectura a
# INFO/LATENCY/SLOWLOG/CLUSTER INFO/CONFIG GET/CLIENT (replicación, memoria,
# comandos lentos, keyspace vía INFO) y a los comandos puntuales de
# inspección de claves que el exporter usa opcionalmente (GET/STRLEN/LLEN/
# HLEN/SCARD/ZCARD/XLEN/TYPE/PFCOUNT/SCAN/EVAL) para --check-keys/--check-
# streams, sin otorgar +@all ni acceso de escritura (-readwrite, -command).
set -- "$@" --user "$REDIS_EXPORTER_USER" on ">$REDIS_EXPORTER_PASSWORD" \
    -@all +@connection +memory -readonly +strlen +config\|get +xinfo +pfcount \
    -quit +zcard +type +xlen -readwrite -command +client -wait +scard +llen \
    +hlen +arcount +get +eval +slowlog +cluster\|info +cluster\|slots \
    +cluster\|nodes -hello -echo +info +latency +scan -reset -auth -asking

# Usuario ACL de corporate-api (hallazgo del plan 000, 2026-09-24): antes la
# API entraba con el usuario "default", o sea con la contraseña de
# administrador, y podia correr CONFIG SET (escribir archivos en el
# contenedor), FLUSHALL, ACL SETUSER, SHUTDOWN, etc. Ahora: todas las claves
# (~*) y canales pub/sub (&*, adaptador de Socket.IO), todos los comandos
# MENOS @admin y @dangerous (CONFIG, KEYS, FLUSH*, ACL, INFO, DEBUG, MONITOR,
# REPLICAOF, SHUTDOWN, CLIENT KILL/LIST...). Lo que la API usa -GET/SET/
# INCR/PTTL, MULTI, EVAL/EVALSHA/SCRIPT LOAD (rate-limit-redis y leases de la
# carga masiva), SCAN (connect-redis, barrido de importaciones), SELECT,
# PUBLISH/SUBSCRIBE, CLIENT SETINFO- queda permitido. "default" sigue igual
# para replicacion (masterauth), healthchecks y administracion.
set -- "$@" --user "$REDIS_APP_USER" on ">$REDIS_APP_PASSWORD" \
    '~*' '&*' +@all -@admin -@dangerous

if [ "$REDIS_ROLE" = "replica" ]; then
    : "${REDIS_PRIMARY_HOST:?falta REDIS_PRIMARY_HOST}"
    set -- "$@" --replicaof "$REDIS_PRIMARY_HOST" 6379
fi

# su-exec reemplaza el proceso actual (execve, no fork+wait): "docker top"
# muestra redis-server corriendo como el usuario "redis", no como root, y las
# señales (SIGTERM en un "docker stop") le llegan directo al proceso de
# Redis, no a un wrapper intermedio.
exec su-exec redis "$@"
