#!/usr/bin/env bash
# Habilita conexiones de replicación desde la red interna de Docker.
#
# Confirmado contra el entrypoint oficial de la imagen postgres:17-alpine
# (docker-entrypoint.sh, función pg_setup_hba_conf): ya agrega por su cuenta
# "host all all all scram-sha-256" (usa POSTGRES_HOST_AUTH_METHOD, que por
# defecto es scram-sha-256) al final de pg_hba.conf durante el initdb inicial.
# Repetir esa línea acá era redundante -no incorrecto, pg_hba.conf solo usa
# la PRIMERA regla que matchea, así que la duplicada nunca llegaba a
# aplicarse, pero sí confundía a quien leyera el archivo generado. La
# pseudo-base "replication" sí requiere una entrada explícita propia: la
# regla genérica "all" de la imagen cubre "all all", no la base especial
# "replication".
set -euo pipefail

echo "host replication ${PG_REPLICATOR} all scram-sha-256" >> "$PGDATA/pg_hba.conf"
