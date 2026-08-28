# syntax=docker/dockerfile:1

# Imagen de produccion (Testing/Production): a diferencia de Dockerfile.dev
# (tsx watch + codigo montado en vivo, hallazgo CRITICO de auditoria
# 2026-08-17), esta build compila a JS con tsc y corre el artefacto ya
# compilado -sin devDependencies, sin codigo fuente TS, sin bind-mount- en la
# imagen final. npm en vez de pnpm por el mismo motivo que Dockerfile.dev
# (ver ese archivo): symlinks rotos de pnpm en Docker Desktop/Windows.

FROM node:22-alpine AS build
WORKDIR /app

COPY package.json ./
RUN npm install

COPY . .
RUN npm run build

# tsc SOLO emite .js a partir de .ts -no copia los assets no-TS que el
# codigo lee en runtime via __dirname (join(__dirname, "..."), ver
# services/{mssql,postgres}/*.service.ts y library/pdf/quoteRequestPdf.ts).
# Sin este paso, dist/ queda sin ellos y el primer seed (seedGeography/
# seedCostCenters) revienta con ENOENT apenas arranca el contenedor -
# encontrado en vivo el 2026-08-18 corriendo compose.prod.yml por primera
# vez: exactamente el tipo de bug que "tsc --noEmit" nunca iba a detectar.
RUN cp -r src/databases/seed-data dist/src/databases/seed-data \
    && cp -r src/library/pdf/assets dist/src/library/pdf/assets

# Solo dependencias de produccion para la imagen final: "npm install" (sin
# package-lock.json, ver Dockerfile.dev) resuelve de nuevo contra
# package.json, esta vez con --omit=dev.
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
