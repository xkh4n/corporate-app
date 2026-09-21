# Pin a 8.0.20 (no a "8.0"/latest de la serie) por SERVER-121912
# (https://jira.mongodb.org/browse/SERVER-121912): desde 8.0.23, mongod se
# niega a arrancar en kernels Linux >=6.19 ("MongoDB cannot start: Linux
# kernel versions 6.19 and newer has a known incompatibility..."), un guard
# incondicional en el binario -NO depende de TCMalloc/rseq en runtime, asi que
# GLIBC_TUNABLES no lo evita; se probo y confirmo en este host-. 8.0.20 es el
# ultimo patch de la serie 8.0 sin ese guard (confirmado con un arranque real
# aca: 8.0.20 OK, 8.0.23/24/26/28 bloqueados). Bump solo cuando MongoDB libere
# un patch que remueva el guard, o cuando el host corra kernel >=7.0.14 (fix
# real de la incompatibilidad de TCMalloc).
FROM mongo:8.0.20

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