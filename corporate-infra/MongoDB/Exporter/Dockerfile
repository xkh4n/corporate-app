# La imagen oficial de percona/mongodb_exporter es FROM scratch (sin shell ni
# coreutils): no admite agregarle un entrypoint-wrapper propio directamente.
# Se copia el binario ya compilado a una base alpine mínima (que sí tiene
# /bin/sh) para poder resolver la contraseña desde el Docker secret en
# runtime -el exporter solo acepta MONGODB_PASSWORD en texto plano, no un
# archivo-, igual patrón que MsSQL/entrypoint-wrapper.sh.
FROM percona/mongodb_exporter:0.52.0 AS src

FROM alpine:3.20

LABEL org.opencontainers.image.authors="osvaldorojasg@gmail.com"
LABEL maintainer="Osvaldo Rojas G."

RUN apk add --no-cache ca-certificates

COPY --from=src /mongodb_exporter /bin/mongodb_exporter
COPY entrypoint-wrapper.sh /entrypoint-wrapper.sh
RUN chmod +x /entrypoint-wrapper.sh /bin/mongodb_exporter

# Mismo uid:gid no-root que usa la imagen oficial (percona/mongodb_exporter
# corre como 65535:65535).
USER 65535:65535

EXPOSE 9216

ENTRYPOINT ["/entrypoint-wrapper.sh"]
