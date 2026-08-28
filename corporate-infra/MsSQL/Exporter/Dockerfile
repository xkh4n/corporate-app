FROM burningalchemist/sql_exporter:0.24.3

LABEL org.opencontainers.image.authors="osvaldorojasg@gmail.com"
LABEL maintainer="Osvaldo Rojas G."

# sql_exporter arma su target (DSN) desde un archivo de configuración en
# texto plano: no soporta leer la contraseña desde un Docker secret de forma
# nativa (solo backends de secret managers en la nube: AWS/GCP/Vault/K8s).
# Se resuelve acá generando ese archivo en runtime, mismo patrón que
# MsSQL/entrypoint-wrapper.sh usa para MSSQL_SA_PASSWORD.
USER root
COPY entrypoint-wrapper.sh /entrypoint-wrapper.sh
COPY collectors/ /etc/sql_exporter/
RUN chmod +x /entrypoint-wrapper.sh
USER nobody

EXPOSE 9399

ENTRYPOINT ["/entrypoint-wrapper.sh"]
