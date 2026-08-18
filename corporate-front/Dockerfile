# syntax=docker/dockerfile:1

# Imagen de produccion (Testing/Production): a diferencia de Dockerfile.dev
# (vite dev server + codigo montado en vivo, hallazgo CRITICO de auditoria
# 2026-08-17 -sin minificar, con verbosidad de dev, sirviendo el arbol de
# fuente), esta build compila el bundle estatico con "vite build" y lo sirve
# con "serve" (server estatico minimo, con fallback de SPA vía -s para que
# las rutas de react-router-dom no den 404 al recargar). Mismo puerto interno
# (FRONT_INTERNAL_PORT) que ya espera nginx-frontdev/test/prod -no hace falta
# tocar el proxy NGINX para este cambio, solo lo que hay detras de el.

FROM node:22-alpine AS build
WORKDIR /app

# vite.config.ts solo evalua su rama "host bare-metal" (que lee
# ../corporate-secrets/Environment|Development/.env, un directorio hermano
# que NO existe dentro del build context de Docker) cuando DOCKER_DEV !=
# "true" -sin este flag, "vite build" revienta con ENOENT buscando esos
# archivos que en un build de imagen nunca estan. El contenido de esa rama
# (proxy /api propio, HTTPS con basicSsl) es exclusivo de "server:", que
# "vite build" ni siquiera usa -da igual que el flag diga "true" aca aunque
# esto sea una build de produccion, no un dev server.
ENV DOCKER_DEV=true

COPY package.json ./
RUN npm install

COPY . .
RUN npm run build

FROM node:22-alpine AS runtime
LABEL org.opencontainers.image.authors="osvaldorojasg@gmail.com"
LABEL maintainer="Osvaldo Rojas G."

WORKDIR /app

RUN npm install --global serve@14

COPY --from=build /app/dist ./dist

RUN chown -R node:node /app
USER node

# El puerto real lo pasa el compose de cada ambiente (ver FRONT_INTERNAL_PORT
# en compose.*.yml); 5173 es solo el default si se corre esta imagen suelta.
CMD ["sh", "-c", "serve -s dist -l ${FRONT_INTERNAL_PORT:-5173}"]
