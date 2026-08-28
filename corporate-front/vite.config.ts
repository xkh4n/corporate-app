import { readFileSync } from "node:fs";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import basicSsl from "@vitejs/plugin-basic-ssl";

// Parser minimo de ".env" (KEY=VALUE, ignora comentarios/lineas vacias): no
// usamos vite.loadEnv aca porque estas variables NO viven en este proyecto
// -viven en corporate-secrets, la fuente unica de verdad de env vars de todo
// el monorepo (mismo criterio que docker compose --env-file en
// corporate-scripts/*.ps1: Environment/.env primero, Development/.env
// despues, y gana la ultima ocurrencia de cada clave).
function parseEnvFile(path: string): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const line of readFileSync(path, "utf-8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    vars[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
  }
  return vars;
}

// Seteado por corporate-front/compose.dev.yml (frontenddev.environment):
// corre detras de nginx-frontdev (ver corporate-front/nginx), que ya
// termina TLS y ya proxea "/api" directo al endpoint publicado de
// corporate-api -este Vite ya no necesita hacer ninguna de las dos cosas.
// Sin ese flag (pnpm dev en host bare-metal), el comportamiento es
// exactamente el de antes: HTTPS propio via basicSsl() + proxy /api propio.
const isDockerDev = process.env.DOCKER_DEV === "true";

// Lazy: corporate-secrets vive FUERA de este proyecto, como directorio
// hermano en el host -dentro del contenedor Docker ese path ni siquiera
// existe (no esta bind-mounteado, a proposito: nginx-frontdev ya resuelve
// "/api" ahi, este proceso no necesita esas variables). Si esto se
// evaluara incondicionalmente, "vite dev" no arrancaria en Docker.
function readHostSecrets(): Record<string, string> {
  const secretsDir = new URL("../corporate-secrets", import.meta.url).pathname.replace(/^\/([a-zA-Z]:)/, "$1");
  return {
    ...parseEnvFile(`${secretsDir}/Environment/.env`),
    ...parseEnvFile(`${secretsDir}/Development/.env`),
  };
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss(), ...(isDockerDev ? [] : [basicSsl()])],
  server: {
    // Sin esto Vite bindea solo a localhost: nginx-frontdev (otro
    // contenedor) no podria alcanzarlo. Inofensivo en host bare-metal.
    host: true,
    port: 5173,
    ...(isDockerDev
      ? {
          // El navegador ve el sitio en wss://host:${FRONT_SSL_PORT} (TLS
          // terminada por nginx-frontdev), pero Vite adentro del contenedor
          // escucha HTTP plano en otro puerto -sin este hint, el cliente de
          // HMR intenta reconectar al puerto/protocolo equivocado.
          hmr: { clientPort: Number(process.env.FRONT_SSL_PORT), protocol: "wss" },
          // Mismo problema de inotify sobre bind mounts en Docker Desktop/
          // Windows que ya afecta a tsx watch (ver corporate-api/compose.dev.yml).
          watch: { usePolling: true, interval: 300 },
          // NO se setea allowedHosts aca (hallazgo de auditoria de seguridad
          // 2026-08-12: "allowedHosts: true" desactivaba por completo la
          // proteccion anti DNS-rebinding de Vite). No hace falta: nginx-
          // frontdev publica el puerto SOLO en ALLOCATED_IP (ver
          // compose.dev.yml, "ports"), asi que el Host que reenvia siempre
          // es un literal de IP -y Vite permite literales de IP sin
          // necesidad de allowlist (ver isHostAllowedInternal en
          // node_modules/vite/dist/node/chunks/node.js: retorna true de
          // inmediato para IPv4/IPv6, sin mirar la config). El default
          // (allowedHosts: []) ya cubre este caso sin abrir nada de mas.
        }
      : (() => {
          // Solo aplica al flujo pnpm dev en host: nginx-frontdev ya
          // resuelve "/api" cuando corre en Docker (ver nginx.conf.template).
          const env = readHostSecrets();
          return {
            proxy: {
              "/api": {
                // Mismo host/puerto que usa el navegador para llegar a la
                // API en dev (ver corporate-api/nginx, ALLOCATED_IP +
                // API_SSL_PORT en corporate-secrets).
                target: `https://${env.ALLOCATED_IP}:${env.API_SSL_PORT}`,
                changeOrigin: true,
                secure: false, // certificado self-signed del backend en dev
                // Sin esto el websocket de Socket.IO (/api/socket.io,
                // notificaciones push en tiempo real) no atraviesa el proxy
                // de Vite -mismo motivo que el "map $http_upgrade" en los
                // templates de nginx para el flujo dockerizado.
                ws: true,
              },
            },
          };
        })()),
  },
});
