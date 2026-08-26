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
    include: ["src/**/*.test.ts"],
  },
});
