FROM nginx:1.27-alpine

LABEL org.opencontainers.image.authors="osvaldorojasg@gmail.com"
LABEL maintainer="Osvaldo Rojas G."

# Mismo patrón que corporate-infra/NGINX y corporate-monitoring/NGINX: la
# plantilla se resuelve en runtime con envsubst (esta imagen ya lo trae).
COPY config/nginx.conf.template /etc/nginx/templates/nginx.conf.template

COPY entrypoint-wrapper.sh /usr/local/bin/entrypoint-wrapper.sh
RUN chmod +x /usr/local/bin/entrypoint-wrapper.sh

EXPOSE 2375

ENTRYPOINT ["/usr/local/bin/entrypoint-wrapper.sh"]
