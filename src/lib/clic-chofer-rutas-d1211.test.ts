import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const pagina = readFileSync(join(__dirname, "..", "app", "(app)", "routes", "page.tsx"), "utf8");

describe("D-1211 · clicking a driver opens the Routes tab", () => {
  it("both panel handlers switch to «routes»", () => {
    const alterna = pagina.slice(pagina.indexOf("const alternaEnElPanel"), pagina.indexOf("const enfocaEnElPanel"));
    const enfoca = pagina.slice(pagina.indexOf("const enfocaEnElPanel"), pagina.indexOf("const eligeVista"));
    expect(alterna).toContain('setTab("routes")');
    expect(enfoca).toContain('setTab("routes")');
  });
});
