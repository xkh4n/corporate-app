FROM redis:8-alpine

LABEL org.opencontainers.image.authors="osvaldorojasg@gmail.com"
LABEL maintainer="Osvaldo Rojas G."

# su-exec: para bajar privilegios a "redis" en el entrypoint (hallazgo de
# auditoría: Redis era el único de los 4 motores que corría como root en
# runtime). La imagen oficial de Redis no trae gosu (a diferencia de la de
# Postgres, que sí); su-exec es el equivalente minimalista, estándar en
# imágenes Alpine para este mismo propósito.
RUN apk add --no-cache su-exec

COPY entrypoint-wrapper.sh /usr/local/bin/entrypoint-wrapper.sh
RUN chmod +x /usr/local/bin/entrypoint-wrapper.sh

EXPOSE 6379

ENTRYPOINT ["/usr/local/bin/entrypoint-wrapper.sh"]
CMD ["redis-server"]
