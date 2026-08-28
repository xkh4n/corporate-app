# syntax=docker/dockerfile:1

# Imagen de produccion (Testing/Production): ver el mismo comentario en
# corporate-api/Dockerfile -compila con tsc y corre el artefacto compilado,
# sin devDependencies ni codigo fuente TS en la imagen final.

FROM node:22-alpine AS build
WORKDIR /app

COPY package.json ./
RUN npm install

COPY . .
RUN npm run build

RUN npm install --omit=dev

FROM node:22-alpine AS runtime
LABEL org.opencontainers.image.authors="osvaldorojasg@gmail.com"
LABEL maintainer="Osvaldo Rojas G."

ENV NODE_ENV=production
WORKDIR /app

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/package.json ./package.json

RUN chown -R node:node /app
USER node

CMD ["node", "dist/index.js"]
