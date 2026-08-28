FROM prom/prometheus:v3.13.2

LABEL org.opencontainers.image.authors="osvaldorojasg@gmail.com"
LABEL maintainer="Osvaldo Rojas G."

# La imagen base arranca como el usuario no-root "nobody" (sin permisos de
# escritura sobre "/etc/prometheus"); se necesita "USER root" para copiar y
# dar permisos de ejecución al wrapper, y se vuelve al usuario original
# después (mismo patrón que corporate-infra/Redis/Exporter/Dockerfile).
USER root
COPY prometheus.yml.template /etc/prometheus/prometheus.yml.template
COPY entrypoint-wrapper.sh /entrypoint-wrapper.sh
RUN chmod +x /entrypoint-wrapper.sh
USER nobody

EXPOSE 9090

ENTRYPOINT ["/entrypoint-wrapper.sh"]
