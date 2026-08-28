FROM grafana/grafana:12.4.6

LABEL org.opencontainers.image.authors="osvaldorojasg@gmail.com"
LABEL maintainer="Osvaldo Rojas G."

USER root

# Provisioning nativo de datasources (Prometheus + Loki): Grafana lo lee solo
# al arrancar, con expansión de env vars propia -sin wrapper, ver
# provisioning/datasources/datasources.yml-.
COPY provisioning/datasources/datasources.yml /etc/grafana/provisioning/datasources/datasources.yml

# Dashboard provisioning: el YAML de "provider" (dice DÓNDE están los .json)
# va en /etc/grafana/provisioning/dashboards/, separado de los .json en sí
# (/etc/grafana/dashboards/) -mismo mecanismo de provisioning que datasources,
# ver provisioning/dashboards/dashboards.yml-.
COPY provisioning/dashboards/dashboards.yml /etc/grafana/provisioning/dashboards/dashboards.yml
COPY dashboards/ /etc/grafana/dashboards/

# "jq" para parsear la respuesta de la API en create-viewer-user.sh. Se
# instala acá (no en una imagen aparte) para reutilizar esta MISMA imagen
# también como el job de un solo uso "grafana-initdev" -mismo patrón que
# corporate-infra/MsSQL, donde mssql01dev y mssql-initdev comparten
# Dockerfile/imagen y solo cambia el "entrypoint:" en compose.dev.yml-.
RUN apk add --no-cache jq
COPY init/create-viewer-user.sh /init/create-viewer-user.sh
RUN chmod +x /init/create-viewer-user.sh

USER 472

EXPOSE 3000
