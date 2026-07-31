FROM postgres:17-alpine

LABEL org.opencontainers.image.authors="osvaldorojasg@gmail.com"
LABEL maintainer="Osvaldo Rojas G."

# Scripts de inicialización (solo se ejecutan cuando PGDATA está vacío, es decir,
# únicamente en el nodo primario la primera vez que arranca)
COPY init/ /docker-entrypoint-initdb.d/

# Entrypoint propio: decide si el nodo es primario o réplica antes de delegar
# en el entrypoint oficial de la imagen
COPY entrypoint-wrapper.sh /usr/local/bin/entrypoint-wrapper.sh
RUN chmod +x /usr/local/bin/entrypoint-wrapper.sh && \
    chmod +x /docker-entrypoint-initdb.d/*.sh

EXPOSE 5432

ENTRYPOINT ["/usr/local/bin/entrypoint-wrapper.sh"]
CMD ["postgres"]
