import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

// Historia: la franja de «entrar como» (`ImpersonationBanner`, D-243) tapaba primero la barra superior (era `fixed`);
// D-253 la puso `sticky` en el flujo y publicó su alto en `--banner-impersonacion` para lo que se pegaba arriba
// (la cabecera de Time Tracker, la barra de acciones de RR. HH., el progreso de la inspección). Esta prueba fijaba esa
// forma y recorría todo `src` buscando lo que se pegara al borde de arriba sin contar con la franja.
//
// D-859 (2026-11-04) quita la franja entera. El dueño: «ya no quiero esa línea de arriba cuando cambio de usuario; es
// ineficiente». El aviso y la vuelta pasan a la burbuja general (abajo a la derecha): ver
// `suplantacion-en-burbuja.test.ts`. Aquí se fija que el espacio se recupera de verdad: no queda franja, ni su medida,
// ni nadie que la reste. Con la franja fuera, pegarse a `top: 0` vuelve a ser seguro, y el recorrido de exentos sobra.

const leer = (ruta: string) => readFileSync(join(process.cwd(), ruta), "utf8");
const VARIABLE = "--banner-impersonacion";

const ficheros = (raiz: string, exts: string[]) => {
  const out: string[] = [];
  const recorre = (dir: string) => {
    for (const f of readdirSync(dir)) {
      const p = join(dir, f);
      if (statSync(p).isDirectory()) recorre(p);
      else if (exts.some((e) => f.endsWith(e)) && !f.includes(".test.")) out.push(p.split("\\").join("/"));
    }
  };
  recorre(join(process.cwd(), raiz));
  return out;
};

describe("la franja de «entrar como» ya no existe (D-859)", () => {
  it("el componente se borró y el layout raíz no monta nada arriba del contenido", () => {
    expect(existsSync(join(process.cwd(), "src/components/ImpersonationBanner.tsx"))).toBe(false);
    const raiz = leer("src/app/layout.tsx");
    expect(raiz).not.toContain("<ImpersonationBanner");
    expect(raiz).not.toContain("import { ImpersonationBanner }");
    // Lo primero dentro de <body> es el proveedor de preferencias: nada se pinta antes que el contenido.
    const cuerpo = raiz.slice(raiz.indexOf("<body>") + "<body>".length).replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
    expect(cuerpo.trimStart().startsWith("<PrefsProvider>")).toBe(true);
  });

  it("nadie publica ni usa ya la medida de la franja: los pegados arriba vuelven a `top: 0`", () => {
    const todos = ficheros("src", [".tsx", ".ts", ".css"]);
    expect(todos.length).toBeGreaterThan(100); // control: el recorrido ve ficheros de verdad
    const usan = todos.filter((p) => readFileSync(p, "utf8").includes(VARIABLE));
    expect(usan).toEqual([]);
  });

  it("los tres que se pegaban debajo de la franja se pegan ahora al borde, sin hueco", () => {
    expect(leer("src/app/timetracker/timetracker.css")).toContain(".timetracker-module .tt-cabecera{position:sticky;top:0;z-index:20;margin-bottom:6px}");
    expect(leer("src/app/recruiting/recruiting.css")).toContain(".recruiting-module .bulk-bar { position: sticky; top: 0; z-index: 5;");
    const insp = leer("src/components/inspeccion/inspeccion.css");
    expect(insp).toContain("position: sticky; top: 0; z-index: 4;");
    expect(insp).toContain("scroll-margin-top: 96px;");
  });

  it("el texto del botón de vista de la franja (`.aviso-vista-texto`) se fue con ella", () => {
    expect(leer("src/app/globals.css")).not.toContain("aviso-vista-texto");
  });
});
