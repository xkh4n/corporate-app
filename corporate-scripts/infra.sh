#!/usr/bin/env bash
# Uso: ./infra.sh dev|prod|test

set -uo pipefail

ambiente="${1:?Uso: infra.sh <dev|prod|test>}"
case "$ambiente" in
    dev|prod|test) ;;
    *) echo "Error: ambiente debe ser 'dev', 'prod' o 'test'." >&2; exit 1 ;;
esac

# Raiz del monorepo = carpeta padre de corporate-scripts
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(dirname "$SCRIPT_DIR")"

case "$ambiente" in
    dev)  env_folder="Development" ;;
    prod) env_folder="Production" ;;
    test) env_folder="Testing" ;;
esac

case "$ambiente" in
    dev)  compose_file="compose.dev.yml" ;;
    prod) compose_file="compose.prod.yml" ;;
    test) compose_file="compose.test.yml" ;;
esac

# Definicion de rutas
compose_path="$repo_root/corporate-infra/$compose_file"
environment_path="$repo_root/corporate-secrets/Environment/.env"
env_stack_path="$repo_root/corporate-secrets/$env_folder/.env"

for path in "$compose_path" "$environment_path" "$env_stack_path"; do
    if [ ! -f "$path" ]; then
        echo "Error: no se encontro el archivo requerido: $path" >&2
        exit 1
    fi
done

# mongodb_keyfile es el UNICO secreto de este stack que no tiene un
# "ensure-*.sh" propio (es interactivo/manual a proposito, ver
# mongo-keyfile.sh) y que este script tambien valida antes de levantar el
# compose -sin este check, un checkout limpio que se olvide de
# "run.sh mongokey <ambiente>" fallaria con el error generico de Docker
# "secret file not found" en vez de un mensaje claro como el resto.
mongo_keyfile_path="$repo_root/corporate-secrets/$env_folder/MongoKeyfile/mongodb_keyfile.txt"
if [ ! -f "$mongo_keyfile_path" ]; then
    echo "Error: no se encontro el keyfile de MongoDB: $mongo_keyfile_path. Corre './run.sh mongokey $ambiente' primero." >&2
    exit 1
fi

# Genera (solo si faltan) los secretos "de motor" que consume directamente
# este compose (admin/root de cada engine) -no interactivo e idempotente, ver
# ensure-infra-secrets.sh-, antes de que corran los guards de arriba, para
# que un checkout limpio no falle a mitad del "docker compose up" con un
# "secret file not found" sobre mssql_password/redis_password/etc.
"$SCRIPT_DIR/ensure-infra-secrets.sh" "$ambiente"

# Genera (solo si faltan) los secretos de los usuarios de metricas/exporters
# de Prometheus antes de levantar el stack -no interactivo e idempotente, ver
# ensure-monitoring-secrets.sh-, para que "run.sh bdd <ambiente>" deje el
# ambiente listo para scrapear sin que haga falta acordarse de un paso manual.
"$SCRIPT_DIR/ensure-monitoring-secrets.sh" "$ambiente"

echo "Levantando stack de bases de datos [$ambiente] -> $compose_file"

# --env-file admite multiples ocurrencias: docker compose las mezcla en orden,
# y en caso de clave repetida gana la del ultimo archivo (Environment/.env).
# --wait implica -d (detached) y espera a que los healthchecks pasen. Sin
# --profile, este "up" NO levanta servicios con profile propio: ni
# mssql-init<Ambiente> (profile "init") ni mssql-exporter0N<Ambiente>
# (profile "mssql-monitoring", ver mas abajo por que).
docker compose -f "$compose_path" --env-file "$env_stack_path" --env-file "$environment_path" up --wait --wait-timeout 300 --build
status=$?
if [ $status -ne 0 ]; then
    echo "Error: docker compose finalizo con codigo $status" >&2
    exit $status
fi

# mssql-init<Ambiente> vive bajo el profile "init": no lo levanta el "up" de
# arriba. Se corre aparte con "run --rm" para que, a diferencia de un service
# normal, el contenedor se autoelimine al terminar en vez de quedar dando
# vueltas en estado "Exited". Es idempotente (guardias "IF NOT EXISTS" contra
# el estado real de cada instancia, ver setup-ag.sh), asi que repetir la
# corrida en un ambiente ya inicializado no hace nada.
mssql_init_service="mssql-init${ambiente}"
echo "Ejecutando bootstrap del Availability Group de MSSQL..."
docker compose -f "$compose_path" --env-file "$env_stack_path" --env-file "$environment_path" run --rm --build "$mssql_init_service"
status=$?
if [ $status -ne 0 ]; then
    echo "Error: $mssql_init_service finalizo con codigo $status" >&2
    exit $status
fi

# Recien ahora, con mssql-initdev ya corrido, existe el login SQL de metricas
# (MSSQL_EXPORTER_USER, creado en setup-ag.sh) que necesitan estos dos
# exporters para pasar su propio healthcheck. Viven bajo el profile
# "mssql-monitoring" -a proposito, NO junto al resto en el "up" de arriba-:
# si arrancaran antes de este punto (profile default, junto a todo lo demas),
# su healthcheck jamas pasaria porque el login todavia no existiria, el
# "up --wait" inicial agotaria sus 300s esperandolos, fallaria, y
# mssql-initdev nunca llegaria a correr -deadlock circular real-. Separarlos
# rompe el ciclo: ahora arrancan en su propio paso, despues de que el login
# ya existe.
mssql_exporter1_service="mssql-exporter01${ambiente}"
mssql_exporter2_service="mssql-exporter02${ambiente}"
echo "Levantando exporters de metricas de MSSQL..."
docker compose -f "$compose_path" --env-file "$env_stack_path" --env-file "$environment_path" --profile mssql-monitoring up --wait --wait-timeout 60 --build "$mssql_exporter1_service" "$mssql_exporter2_service"
status=$?
if [ $status -ne 0 ]; then
    echo "Error: exporters de MSSQL finalizaron con codigo $status" >&2
    exit $status
fi

echo "Stack de bases de datos [$ambiente] arriba y healthy."
