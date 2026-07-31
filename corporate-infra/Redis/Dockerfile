FROM redis:8-alpine

LABEL org.opencontainers.image.authors="osvaldorojasg@gmail.com"
LABEL maintainer="Osvaldo Rojas G."

COPY entrypoint-wrapper.sh /usr/local/bin/entrypoint-wrapper.sh
RUN chmod +x /usr/local/bin/entrypoint-wrapper.sh

EXPOSE 6379

ENTRYPOINT ["/usr/local/bin/entrypoint-wrapper.sh"]
CMD ["redis-server"]
