#!/bin/sh
# Resuelve prometheus.yml.template con los hosts/SUFFIX del ambiente actual.
#
# Mismo PATRÓN que corporate-infra/NGINX/entrypoint-wrapper.sh (plantilla +
# resolución en runtime, allowlist explícita de variables), pero con "sed" en
# vez de "envsubst": la imagen oficial de Prometheus (prom/prometheus, base
# busybox) no trae "envsubst" instalado -a diferencia de nginx:1.27-alpine,
# que sí lo incluye de fábrica para su propio mecanismo de templates-, y no
# tiene gestor de paquetes para agregarlo sin irse a una imagen intermedia.
# "sed" sí está disponible en la imagen base, así que alcanza para esta lista
# acotada y fija de placeholders.
set -eu

: "${SUFFIX:?falta SUFFIX}"
: "${POSTGRES_HOST:?falta POSTGRES_HOST}"
: "${MONGO_HOST:?falta MONGO_HOST}"
: "${REDIS_HOST:?falta REDIS_HOST}"
: "${MSSQL_HOST:?falta MSSQL_HOST}"
: "${API_HOST:?falta API_HOST}"
: "${API_INTERNAL_PORT:?falta API_INTERNAL_PORT}"

sed \
    -e "s|\${SUFFIX}|${SUFFIX}|g" \
    -e "s|\${POSTGRES_HOST}|${POSTGRES_HOST}|g" \
    -e "s|\${MONGO_HOST}|${MONGO_HOST}|g" \
    -e "s|\${REDIS_HOST}|${REDIS_HOST}|g" \
    -e "s|\${MSSQL_HOST}|${MSSQL_HOST}|g" \
    -e "s|\${API_HOST}|${API_HOST}|g" \
    -e "s|\${API_INTERNAL_PORT}|${API_INTERNAL_PORT}|g" \
    /etc/prometheus/prometheus.yml.template > /etc/prometheus/prometheus.yml

exec /bin/prometheus \
    --config.file=/etc/prometheus/prometheus.yml \
    --storage.tsdb.path=/prometheus \
    --storage.tsdb.retention.time=15d \
    --web.listen-address=:9090
