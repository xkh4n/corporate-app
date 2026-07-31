FROM mcr.microsoft.com/mssql/server:2022-latest

LABEL org.opencontainers.image.authors="osvaldorojasg@gmail.com"
LABEL maintainer="Osvaldo Rojas G."

USER root
COPY entrypoint-wrapper.sh /usr/local/bin/entrypoint-wrapper.sh
RUN chmod +x /usr/local/bin/entrypoint-wrapper.sh
USER mssql

# 1433: motor SQL / 5022: endpoint HADR (mirroring) del Availability Group
EXPOSE 1433 5022

ENTRYPOINT ["/usr/local/bin/entrypoint-wrapper.sh"]
