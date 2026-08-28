# Pineado a un tag de Cumulative Update especifico (no "2022-latest", que es
# flotante): confirmado contra el catalogo real de mcr.microsoft.com
# (mcr.microsoft.com/v2/mssql/server/tags/list) que 2022-CU26-ubuntu-22.04 es
# el CU mas reciente disponible para SQL Server 2022 al momento de este
# cambio, y que su digest coincide EXACTO con el de "2022-latest" que estaba
# en uso -mismo build subyacente, cero riesgo de romper algo por cambiar de
# versión, solo se deja de depender de un tag que puede correr por debajo
# sin aviso-.
FROM mcr.microsoft.com/mssql/server:2022-CU26-ubuntu-22.04

LABEL org.opencontainers.image.authors="osvaldorojasg@gmail.com"
LABEL maintainer="Osvaldo Rojas G."

USER root
COPY entrypoint-wrapper.sh /usr/local/bin/entrypoint-wrapper.sh
RUN chmod +x /usr/local/bin/entrypoint-wrapper.sh
USER mssql

# 1433: motor SQL / 5022: endpoint HADR (mirroring) del Availability Group
EXPOSE 1433 5022

ENTRYPOINT ["/usr/local/bin/entrypoint-wrapper.sh"]
