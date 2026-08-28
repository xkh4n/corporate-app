FROM grafana/loki:3.5.7

LABEL org.opencontainers.image.authors="osvaldorojasg@gmail.com"
LABEL maintainer="Osvaldo Rojas G."

# Config estática: no hace falta resolver nada en runtime (ver loki-config.yml),
# así que alcanza con copiarla directo, sin wrapper.
COPY loki-config.yml /etc/loki/loki-config.yml

EXPOSE 3100 9096

ENTRYPOINT ["/usr/bin/loki"]
CMD ["-config.file=/etc/loki/loki-config.yml"]
