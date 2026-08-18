FROM nginx:1.27-alpine

LABEL org.opencontainers.image.authors="osvaldorojasg@gmail.com"
LABEL maintainer="Osvaldo Rojas G."

COPY config/nginx.conf.template /etc/nginx/templates/nginx.conf.template
COPY config/nginx.conf.prod.template /etc/nginx/templates/nginx.conf.prod.template

COPY entrypoint-wrapper.sh /usr/local/bin/entrypoint-wrapper.sh
RUN chmod +x /usr/local/bin/entrypoint-wrapper.sh

ENTRYPOINT ["/usr/local/bin/entrypoint-wrapper.sh"]
