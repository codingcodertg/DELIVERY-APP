import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/** Regla de toda la app (D-749, 2026-10-29): disponible = color vivo; bloqueado = apagado y gris. */

const leer = (r: string) => readFileSync(join(process.cwd(), r), "utf8").split("\r\n").join("\n");
const sinComentarios = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "");
const regla = (css: string, selector: string) => { const i = css.indexOf(selector + " {"); if (i < 0) throw new Error(selector); return css.slice(i, css.indexOf("}", i)); };

describe("globals.css", () => {
  const css = sinComentarios(leer("src/app/globals.css"));
  it("ningún botón disponible lleva un tinte pálido: secundario con borde de acento, peligro/verde/ámbar sólidos", () => {
    expect(regla(css, ".btn-ghost")).toContain("box-shadow: inset 0 0 0 1.5px var(--accent)");
    expect(regla(css, ".btn-ghost")).not.toContain("accent-soft");
    expect(regla(css, ".btn-danger")).toContain("background: var(--red); color: #fff;");
    expect(regla(css, ".btn-green")).toContain("color: #fff;");
    expect(regla(css, ".btn-amber")).toContain("background: var(--amber);");
    for (const tinte of ["#fdeaea", "#e5f6ee", "#fbf1df"]) expect(css).not.toContain(`.btn-${tinte}`);
    expect(css).not.toMatch(/\.btn-(danger|green|amber) \{ background: #f/);
  });
  it("bloqueado = opacidad baja Y gris, con cursor de prohibido", () => {
    const d = regla(css, '.btn:disabled, .btn[aria-disabled="true"], button.btn:disabled');
    expect(d).toContain("opacity: .45");
    expect(d).toContain("filter: grayscale(1)");
    expect(d).toContain("cursor: not-allowed");
  });
});

describe("las otras hojas siguen la misma regla", () => {
  it("RR. HH.", () => {
    const css = sinComentarios(leer("src/app/recruiting/recruiting.css"));
    expect(regla(css, ".recruiting-module .btn-ghost")).toContain("box-shadow: inset 0 0 0 1.5px var(--accent)");
    expect(regla(css, ".recruiting-module .btn-danger")).toContain("background: var(--red); color: #fff;");
    expect(regla(css, ".recruiting-module .btn:disabled")).toContain("filter: grayscale(1)");
    expect(css).not.toContain("tint-red-strong); color: var(--red); }");
  });
  it("Time Tracker", () => {
    expect(sinComentarios(leer("src/app/timetracker/timetracker.css"))).toContain(".timetracker-module button:disabled{opacity:.45;filter:grayscale(1);cursor:not-allowed}");
  });
  it("ERP y Clientes (Tailwind)", () => {
    const b = leer("src/components/erp/ui/button.tsx");
    expect(b).toContain("disabled:opacity-45 disabled:grayscale disabled:cursor-not-allowed");
    expect(b).not.toContain("disabled:opacity-50");
    expect(b).toContain('outline: "border-[1.5px] border-clay-500 bg-white text-clay-700 hover:bg-clay-50"');
  });
});
