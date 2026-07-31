FROM mongo:8.0

# El keyfile NO se hornea en la imagen: se monta en runtime como Docker secret
# (ver "mongodb_keyfile" en compose.dev.yml) y entrypoint-wrapper.sh lo copia a
# /etc/mongodb-keyfile con los permisos 400 que exige mongod.

LABEL org.opencontainers.image.authors="osvaldorojasg@gmail.com"
LABEL maintainer="Osvaldo Rojas G."


# Copy initialization script to custom location (not /docker-entrypoint-initdb.d/ to avoid auto-execution)
COPY init.sh /usr/local/bin/mongo-init.sh
COPY entrypoint-wrapper.sh /usr/local/bin/entrypoint-wrapper.sh
RUN chmod +x /usr/local/bin/mongo-init.sh && \
    chmod +x /usr/local/bin/entrypoint-wrapper.sh

EXPOSE 27017

# Use custom entrypoint wrapper
ENTRYPOINT ["/usr/local/bin/entrypoint-wrapper.sh"]
CMD ["mongod"]