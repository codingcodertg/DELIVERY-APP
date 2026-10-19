import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

// D-NEXT (2026-10-19) · El build de Vercel se quedaba sin memoria en «Linting and checking validity of types» (seis veces en un
// día, con el CI de GitHub en verde). En Vercel se salta el type-check y el lint; el CI los sigue haciendo antes de fusionar.

const leer = (p: string) => readFileSync(p, "utf8").split("\r\n").join("\n");

describe("el build de Vercel no repite el type-check ni el lint; el CI sí los hace", () => {
  it("next.config: los dos saltos cuelgan SOLO de `process.env.VERCEL`", () => {
    const cfg = leer("next.config.mjs");
    expect(cfg).toContain("const enVercel = !!process.env.VERCEL;");
    expect(cfg).toContain("typescript: { ignoreBuildErrors: enVercel },");
    expect(cfg).toContain("eslint: { ignoreDuringBuilds: enVercel },");
    // Nunca un `true` a secas: en local y en el CI, `next build` sigue comprobando.
    expect(cfg).not.toMatch(/ignoreBuildErrors: true/);
    expect(cfg).not.toMatch(/ignoreDuringBuilds: true/);
  });
  it("el CI corre tsc, vitest y next build completo antes de fusionar (y no pone VERCEL)", () => {
    const ci = leer(".github/workflows/ci.yml");
    expect(ci).toContain("run: npx tsc --noEmit");
    expect(ci).toContain("run: npx next build");
    expect(ci).toMatch(/vitest/);
    expect(ci).not.toMatch(/VERCEL:/);
  });
});
