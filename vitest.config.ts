import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL(".", import.meta.url)).replace(/\/$/, "");

// Unit tests for the pure business logic (scheduling rules, dispatch,
// analytics, formatting). These are mode-agnostic — no React, no Supabase.
export default defineConfig({
  // tsconfig dice `jsx: "preserve"` porque la compila Next; sin esto, una prueba que importe un .tsx
  // no se puede ni leer. La primera en necesitarlo: la hoja impresa del Estimador, que se RENDERIZA en
  // su prueba para comprobar que no lleva nada interno (T-0408).
  oxc: { jsx: { runtime: "automatic" } },
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
    //
    // `scripts/` entra por lo mismo (D-512), y con más motivo: ahí vive lo que decide si una
    // migración se aplica a producción. Los dos errores que paga ese guarda —la 124 aplicándose en
    // un ensayo con ROLLBACK, y un checksum declarado que dejó de ser el del cuerpo— ya pasaron de
    // verdad, y una herramienta que nadie vigila los deja volver.
    include: ["src/**/*.test.ts", "tracker/**/*.test.mjs", "scripts/**/*.test.mjs"],
  },
});
