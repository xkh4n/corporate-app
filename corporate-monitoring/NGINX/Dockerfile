FROM nginx:1.27-alpine

LABEL org.opencontainers.image.authors="osvaldorojasg@gmail.com"
LABEL maintainer="Osvaldo Rojas G."

# Igual que corporate-infra/NGINX: la plantilla se resuelve en runtime
# (entrypoint-wrapper.sh) con envsubst, que esta imagen sí trae de fábrica.
COPY config/nginx.conf.template /etc/nginx/templates/nginx.conf.template

COPY entrypoint-wrapper.sh /usr/local/bin/entrypoint-wrapper.sh
RUN chmod +x /usr/local/bin/entrypoint-wrapper.sh

EXPOSE 3333 3334

ENTRYPOINT ["/usr/local/bin/entrypoint-wrapper.sh"]
