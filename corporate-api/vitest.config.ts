import { defineConfig } from "vitest/config";

// Dos proyectos separados en vez de un solo "include" con ambos patrones:
// "unit" corre en cualquier lado sin credenciales de BD (CI, laptop de
// cualquiera), "integration" necesita las bases de test reales (ver
// TESTING.md) y solo ese proyecto carga setupFiles.
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "unit",
          environment: "node",
          include: ["src/**/*.unit.test.ts"],
        },
      },
      {
        test: {
          name: "integration",
          environment: "node",
          include: ["src/**/*.integration.test.ts"],
          setupFiles: ["./test/setupIntegration.ts"],
          testTimeout: 20_000,
          hookTimeout: 30_000,
          // Los archivos de integracion comparten las mismas bases del stack
          // de Testing (ver TESTING.md); correrlos en paralelo arriesgaria
          // que el resetTestData/afterEach de un archivo pise datos que otro
          // archivo todavia esta usando. Un solo fork para todo el proyecto
          // "integration" los serializa.
          pool: "forks",
          poolOptions: { forks: { singleFork: true } },
        },
      },
    ],
  },
});
