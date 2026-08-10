import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";
import { defineConfig, globalIgnores } from "eslint/config";

export default defineConfig([
  globalIgnores(["dist"]),
  {
    files: ["**/*.{ts,tsx}"],
    extends: [
      js.configs.recommended,
      ...tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    rules: {
      // Falso positivo en el patron estandar "verificar sesion al montar"
      // (useEffect + fetch, ver src/auth/AuthContext.tsx) -react.dev lo
      // documenta como uso valido de useEffect, pero esta regla (nueva en
      // eslint-plugin-react-hooks v7, alineada al React Compiler) lo marca
      // como error igual. No se baja la version del paquete completo por
      // esto (v6 entra en conflicto de peer-dep con eslint@10 del resto del
      // proyecto, ver feedback_frontend_tooling_version_pins): se desactiva
      // puntualmente esta unica regla.
      "react-hooks/set-state-in-effect": "off",
      // Falso positivo en el patron de icono dinamico (ver src/components/
      // MenuIcon.tsx): "icon" es texto libre en la DB (menu_items.icon), asi
      // que el componente de react-icons se resuelve en runtime a partir de
      // ese string, no es un import estatico. Esta regla (alineada al React
      // Compiler) no distingue "elegir una referencia estable de un modulo
      // externo" de "definir un componente nuevo en cada render" -el
      // resultado de resolveIcon() es siempre el mismo export estable de
      // "react-icons/io5" para el mismo nombre, nunca una funcion nueva.
      "react-hooks/static-components": "off",
    },
  },
]);
