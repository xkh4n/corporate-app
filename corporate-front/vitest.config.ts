import { defineConfig } from "vitest/config";

// Fase 0: solo funciones puras (validators, helpers) -sin DOM. Tests de
// componentes (@testing-library/react + jsdom, mockeando fetch/router/
// context por pantalla) quedan fuera de alcance a proposito, ver
// corporate-api/TESTING.md.
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.unit.test.ts"],
  },
});
