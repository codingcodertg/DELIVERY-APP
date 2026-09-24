import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL(".", import.meta.url)).replace(/\/$/, "");

// Unit tests for the pure business logic (scheduling rules, dispatch,
// analytics, formatting). These are mode-agnostic — no React, no Supabase.
export default defineConfig({
  resolve: {
    tsconfigPaths: true,
    // The ERP's server-only modules (D-090) import `server-only`, which throws outside a server
    // bundle. Stubbed for tests only; the real build still enforces it.
    alias: { "server-only": root + "/src/test-stubs/server-only.ts" },
  },
  test: {
    environment: "node",
    // `tracker/` vive fuera de `src/` —es una herramienta, no la app— pero sus pruebas corren en la
    // misma suite a propósito: una herramienta que CI no vigila se pudre sin que nadie se entere, y
    // esta guarda la regla de que «Completado» no se pone solo.
    include: ["src/**/*.test.ts", "tracker/**/*.test.mjs"],
  },
});
