FROM oliver006/redis_exporter:v1.88.0-alpine

LABEL org.opencontainers.image.authors="osvaldorojasg@gmail.com"
LABEL maintainer="Osvaldo Rojas G."

# La imagen oficial no soporta leer la contraseña desde un archivo de Docker
# secret de forma nativa: REDIS_PASSWORD solo acepta texto plano (existe
# -redis.password-file, pero espera un JSON keyed por dirección, no un
# secreto "un archivo = un valor" como el resto de este proyecto). Se resuelve
# acá con el mismo patrón que MsSQL/entrypoint-wrapper.sh.
#
# La imagen base arranca como el usuario no-root 59000:59000 (sin permisos de
# escritura sobre "/"); se necesita "USER root" para poder copiar y dar
# permisos de ejecución al wrapper, y se vuelve al usuario original después.
USER root
COPY entrypoint-wrapper.sh /entrypoint-wrapper.sh
RUN chmod +x /entrypoint-wrapper.sh
USER 59000:59000

EXPOSE 9121

ENTRYPOINT ["/entrypoint-wrapper.sh"]
