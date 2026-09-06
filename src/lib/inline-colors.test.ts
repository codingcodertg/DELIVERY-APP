import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { bloquesStyle, coloresAPelo, coloresSueltosCss } from "./inline-colors";

// G-13 / G-14 (HR). La tabla de abajo es la de la decisión: colores a pelo por fichero DESPUÉS
// del encargo. La prueba cae si un fichero SUBE, o si aparece uno nuevo con colores (sube desde
// 0). No exige cero: los que quedan están dichos, uno a uno, en la decisión.

describe("el guardián se prueba a sí mismo", () => {
  const FIXTURE = `
export function Demo({ on }: { on: boolean }) {
  return (
    <div className="card" style={{ background: "#fff", color: on ? "var(--green)" : "#d64545" }}>
      <span style={{
        border: "1px solid rgba(0,0,0,.08)",
        boxShadow: "0 1px 2px rgba(21,34,56,.05)",
        background: "var(--card, #ffffff)",
      }}>x</span>
      <svg fill="#123456" />
      <i className="text-[#abcdef]" style={{ color: "hsl(210 10% 50%)" }} />
    </div>
  );
}`;
  it("cuenta hex, rgb/rgba y hsl dentro de style={{}}, y nada fuera", () => {
    const h = coloresAPelo(FIXTURE);
    expect(h.map((x) => x.texto)).toEqual(["#fff", "#d64545", "rgba(0,0,0,.08)", "rgba(21,34,56,.05)", "hsl(210 10% 50%)"]);
  });
  it("un bloque de varias líneas cuenta entero y con la línea real de cada color", () => {
    expect(bloquesStyle(FIXTURE)).toHaveLength(3);
    const h = coloresAPelo(FIXTURE);
    expect(h[2].linea).toBe(6);
    expect(h[3].linea).toBe(7);
  });
  it("el respaldo de var(--x, #hex) no es un color a pelo", () => {
    expect(coloresAPelo(`<a style={{ color: "var(--red, #d64545)" }} />`)).toEqual([]);
  });
  it("en CSS, los tokens (--x: #hex) no cuentan; lo suelto sí; los comentarios no", () => {
    const css = `.m { --ink: #152238; --line: #dfe5ee; }\n/* #000000 en comentario */\n.m .a { color: #fff; box-shadow: 0 0 1px rgba(0,0,0,.1); }`;
    expect(coloresSueltosCss(css).map((x) => `${x.linea}:${x.texto}`)).toEqual(["3:#fff", "3:rgba(0,0,0,.1)"]);
  });
});

const leer = (ruta: string) => readFileSync(join(process.cwd(), ruta), "utf8");

describe("recruiting.css: las dos paletas y lo suelto", () => {
  const css = leer("src/app/recruiting/recruiting.css");
  const tokens = (bloque: string) => [...bloque.matchAll(/^\s*(--[\w-]+)\s*:/gm)].map((m) => m[1]);
  const claro = tokens(css.slice(css.indexOf(".recruiting-module {"), css.indexOf("font-family: 'Inter'")));
  const oscuro = tokens(css.slice(css.indexOf(':root[data-theme="dark"] .recruiting-module {')));

  it("cada token claro tiene su valor oscuro, salvo --brand-surface (se queda azul marino a propósito)", () => {
    expect(claro.length).toBeGreaterThanOrEqual(30);
    expect(claro.filter((t) => !oscuro.includes(t))).toEqual(["--brand-surface"]);
    expect(oscuro.filter((t) => !claro.includes(t))).toEqual([]);
  });
  it("colores sueltos (no tokens): 15 en 14 líneas, los de la decisión, y no más", () => {
    const sueltos = coloresSueltosCss(css);
    expect(sueltos.length).toBeLessThanOrEqual(15);
    // Blancos sobre color (9), el velo, las sombras: intencionales, uno a uno.
    expect(sueltos.map((x) => x.texto).sort()).toEqual(
      ["#fff", "#fff", "#fff", "#fff", "#fff", "#fff", "#fff", "#fff", "#fff",
        "rgba(0,0,0,.15)", "rgba(0,0,0,.18)", "rgba(15,23,42,.55)", "rgba(21,34,56,.05)", "rgba(255,255,255,.08)", "rgba(36, 86, 201, .12)"].sort(),
    );
  });
});

describe("TSX de HR: colores a pelo por fichero, techo de la decisión", () => {
  // Después del encargo. Lo que queda: blancos sobre el azul marino de la barra y sobre chips,
  // las sombras y el velo del buscador, el rojo sobre la tarjeta oscura de Resultados, el #555
  // de una cabecera solo de impresión. Cada uno está en la decisión.
  const TECHO: Record<string, number> = {
    "src/components/recruiting/GlobalSearch.tsx": 6,
    "src/components/recruiting/TopBar.tsx": 3,
    "src/app/recruiting/(recruiting)/outcomes/page.tsx": 3,
    "src/app/recruiting/(recruiting)/settings/page.tsx": 2,
    "src/components/recruiting/CandidateRow.tsx": 1,
    "src/components/recruiting/ModalHost.tsx": 1,
    "src/app/recruiting/(recruiting)/metrics/page.tsx": 1,
  };

  const ficheros: string[] = [];
  const walk = (dir: string) => {
    for (const f of readdirSync(dir)) {
      const p = join(dir, f);
      if (statSync(p).isDirectory()) walk(p);
      else if (f.endsWith(".tsx")) ficheros.push(p.replace(/\\/g, "/").split(process.cwd().replace(/\\/g, "/") + "/")[1]);
    }
  };
  walk(join(process.cwd(), "src/app/recruiting"));
  walk(join(process.cwd(), "src/components/recruiting"));

  it("recorre los ficheros de HR (páginas y componentes)", () => {
    expect(ficheros.length).toBeGreaterThanOrEqual(15);
  });

  for (const ruta of ficheros) {
    it(`${ruta.replace("src/", "")} — ≤ ${TECHO[ruta] ?? 0}`, () => {
      const h = coloresAPelo(leer(ruta));
      expect(h.map((x) => `${ruta}:${x.linea} ${x.texto}`).length, h.map((x) => `${ruta}:${x.linea} ${x.texto}`).join("\n")).toBeLessThanOrEqual(TECHO[ruta] ?? 0);
    });
  }

  it("la tabla no lleva techos de más: cada fichero de la tabla existe y llega a su techo", () => {
    // Si un fichero baja, se baja el techo en la tabla (y en la decisión): que no quede holgura
    // para volver a subir sin que nadie lo vea.
    for (const [ruta, techo] of Object.entries(TECHO)) {
      expect(ficheros, ruta).toContain(ruta);
      expect(coloresAPelo(leer(ruta)).length, ruta).toBe(techo);
    }
  });
});
