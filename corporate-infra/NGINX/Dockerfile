FROM nginx:1.27-alpine

LABEL org.opencontainers.image.authors="osvaldorojasg@gmail.com"
LABEL maintainer="Osvaldo Rojas G."

# Las plantillas se resuelven en runtime (entrypoint-wrapper.sh) con envsubst,
# usando las variables de corporate-secrets/Environment/.env y
# corporate-secrets/<Ambiente>/.env, seleccionando streams.<DEPLOY_ENV>.conf.
COPY config/nginx.conf.template /etc/nginx/templates/nginx.conf.template
COPY config/streams.dev.conf /etc/nginx/templates/streams.dev.conf
COPY config/streams.test.conf /etc/nginx/templates/streams.test.conf
COPY config/streams.prod.conf /etc/nginx/templates/streams.prod.conf

COPY entrypoint-wrapper.sh /usr/local/bin/entrypoint-wrapper.sh
RUN chmod +x /usr/local/bin/entrypoint-wrapper.sh

ENTRYPOINT ["/usr/local/bin/entrypoint-wrapper.sh"]
