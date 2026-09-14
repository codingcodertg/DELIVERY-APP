import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

// El banner de «entrar como» tapaba la barra superior entera: era `position: fixed` en el borde
// de arriba y nada compensaba su alto, así que ningún botón de la barra era alcanzable. Lo vio el
// dueño la primera vez que usó la función, en producción.
//
// Lo que se fija aquí es la forma del arreglo, no el aspecto: que el banner esté EN EL FLUJO del
// documento —así empuja lo que viene detrás y no hay altura que sincronizar— y que el único sitio
// donde sí hace falta un desplazamiento, la barra lateral `fixed` del ERP, lo tome de una medida
// que el propio banner publica y borra al desmontarse.

const leer = (ruta: string) => readFileSync(join(process.cwd(), ruta), "utf8");
const BANNER = "src/components/ImpersonationBanner.tsx";
const SIDE_NAV = "src/components/erp/side-nav.tsx";
const LAYOUT = "src/app/layout.tsx";
const VARIABLE = "--banner-impersonacion";

describe("el banner de «entrar como» no se pone encima de nada", () => {
  it("el fichero se lee y trae el banner (control)", () => {
    const src = leer(BANNER);
    expect(src.length).toBeGreaterThan(500);
    expect(src).toContain("role=\"alert\"");
  });

  it("no es `fixed`: eso es lo que tapaba la barra", () => {
    const src = leer(BANNER);
    expect(src).not.toMatch(/position:\s*"fixed"/);
  });

  it("es `sticky` en el borde de arriba, para seguir viéndose al bajar", () => {
    const src = leer(BANNER);
    expect(src).toMatch(/position:\s*"sticky"/);
    expect(src).toMatch(/top:\s*0/);
  });

  it("va delante del contenido en el layout raíz, que es lo que hace que lo empuje", () => {
    const src = leer(LAYOUT);
    const banner = src.indexOf("<ImpersonationBanner />");
    const hijos = src.indexOf("{children}");
    expect(banner).toBeGreaterThan(-1);
    expect(hijos).toBeGreaterThan(-1);
    expect(banner).toBeLessThan(hijos);
  });
});

describe("la medida que usa el ERP existe solo mientras el banner está puesto", () => {
  it("el banner la publica midiendo, no con un número escrito", () => {
    const src = leer(BANNER);
    expect(src).toContain(`setProperty("${VARIABLE}"`);
    expect(src).toContain("offsetHeight");
  });

  it("y la borra al desmontarse, para que fuera de una impersonación no exista", () => {
    const src = leer(BANNER);
    expect(src).toContain(`removeProperty("${VARIABLE}")`);
  });

  it("la barra lateral del ERP y su botón la usan, con respaldo de cero", () => {
    const src = leer(SIDE_NAV);
    const usos = src.split(`var(${VARIABLE}, 0px)`).length - 1;
    // Dos: la barra lateral `fixed inset-y-0` y el botón de desplegarla, que también es `fixed`.
    expect(usos).toBe(2);
  });
});

describe("nadie más se cuelga del borde de arriba a lo ancho", () => {
  // Recorre en vez de enumerar: el fallo no fue que el banner estuviera mal escrito, fue que
  // NADIE comprobaba si algo se ponía encima de la barra. Si mañana aparece otro aviso `fixed`
  // pegado arriba y ocupando todo el ancho, esta prueba lo cuenta antes que el dueño.
  const tsx: string[] = [];
  const recorre = (dir: string) => {
    for (const f of readdirSync(dir)) {
      const p = join(dir, f);
      if (statSync(p).isDirectory()) recorre(p);
      else if (f.endsWith(".tsx")) tsx.push(p);
    }
  };
  recorre(join(process.cwd(), "src/components"));

  it("recorre los componentes (control)", () => {
    expect(tsx.length).toBeGreaterThanOrEqual(40);
  });

  it("ninguno es `fixed` con `insetInline: 0` y `top: 0`", () => {
    const culpables: string[] = [];
    for (const p of tsx) {
      const src = readFileSync(p, "utf8");
      if (/position:\s*"fixed"[^}]*insetInline:\s*0[^}]*top:\s*0/.test(src)) culpables.push(p);
    }
    expect(culpables, culpables.join("\n")).toEqual([]);
  });
});
