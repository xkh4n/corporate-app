#!/bin/sh
# Crea (si no existe) un segundo usuario de Grafana con rol limitado (Viewer),
# vía la API HTTP de admin. Grafana solo tiene env vars nativas para crear el
# PRIMER usuario (el admin: GF_SECURITY_ADMIN_USER / _PASSWORD__FILE, ya
# resueltas por la imagen oficial sin wrapper); para un segundo usuario no
# admin no hay equivalente, así que hace falta este paso aparte -mismo tipo
# de patrón que ya usamos para usuarios con permisos acotados en Postgres/
# Mongo (creación explícita + guard de idempotencia), pero acá vía API en vez
# de SQL/mongosh-.
#
# Corre en un servicio de un solo uso bajo profile "init" (grafana-initdev),
# el mismo patrón que mssql-initdev en corporate-infra: se ejecuta aparte,
# DESPUÉS de que grafanadev ya esté healthy (ver corporate-scripts/monitoring.ps1).
set -euo pipefail

: "${GRAFANA_URL:?falta GRAFANA_URL}"
: "${GF_ADMIN_USER:?falta GF_ADMIN_USER}"
: "${GF_ADMIN_PASSWORD_FILE:?falta GF_ADMIN_PASSWORD_FILE}"
: "${GF_VIEWER_USER:?falta GF_VIEWER_USER}"
: "${GF_VIEWER_PASSWORD_FILE:?falta GF_VIEWER_PASSWORD_FILE}"
: "${GF_VIEWER_EMAIL:?falta GF_VIEWER_EMAIL}"

ADMIN_PASSWORD="$(cat "$GF_ADMIN_PASSWORD_FILE")"
VIEWER_PASSWORD="$(cat "$GF_VIEWER_PASSWORD_FILE")"

echo "[grafana-init] Esperando a que Grafana acepte conexiones en ${GRAFANA_URL}..."
until curl -sf "${GRAFANA_URL}/api/health" >/dev/null 2>&1; do
    sleep 2
done

echo "[grafana-init] Verificando si el usuario '${GF_VIEWER_USER}' ya existe..."
LOOKUP_STATUS="$(curl -s -o /dev/null -w '%{http_code}' -u "${GF_ADMIN_USER}:${ADMIN_PASSWORD}" "${GRAFANA_URL}/api/users/lookup?loginOrEmail=${GF_VIEWER_USER}")"

if [ "$LOOKUP_STATUS" = "200" ]; then
    echo "[grafana-init] El usuario '${GF_VIEWER_USER}' ya existe, se omite creación."
    exit 0
fi

echo "[grafana-init] Creando usuario '${GF_VIEWER_USER}'..."
curl -sf -X POST -H "Content-Type: application/json" \
    -u "${GF_ADMIN_USER}:${ADMIN_PASSWORD}" \
    -d "{\"name\":\"${GF_VIEWER_USER}\",\"email\":\"${GF_VIEWER_EMAIL}\",\"login\":\"${GF_VIEWER_USER}\",\"password\":\"${VIEWER_PASSWORD}\"}" \
    "${GRAFANA_URL}/api/admin/users" >/dev/null

echo "[grafana-init] Buscando el id del usuario recién creado..."
USER_ID="$(curl -s -u "${GF_ADMIN_USER}:${ADMIN_PASSWORD}" "${GRAFANA_URL}/api/users/lookup?loginOrEmail=${GF_VIEWER_USER}" | jq -r '.id')"

echo "[grafana-init] Fijando rol 'Viewer' en la organización default para el usuario id=${USER_ID} (por defecto /api/admin/users lo crea como Viewer, esto lo deja explícito e idempotente)..."
curl -sf -X PATCH -H "Content-Type: application/json" \
    -u "${GF_ADMIN_USER}:${ADMIN_PASSWORD}" \
    -d '{"role":"Viewer"}' \
    "${GRAFANA_URL}/api/org/users/${USER_ID}" >/dev/null

echo "[grafana-init] Usuario '${GF_VIEWER_USER}' creado con rol Viewer."
