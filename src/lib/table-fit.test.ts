import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

// El dueño: «a la derecha de la tabla hay un espacio en blanco que parece de la tabla». Y lo era:
// `.tbl-scroll` es un bloque al 100% con su borde y su fondo, y `table.tbl-resize` es `width: auto`
// —la suma de sus columnas—. Cuando las columnas no llegan al 100%, lo que se ve a la derecha es el
// contenedor, vacío.

const leer = (r: string) => readFileSync(join(process.cwd(), r), "utf8");
const css = leer("src/app/globals.css").split("\r\n").join("\n");

const norm = (s: string) => s.split("\\").join("/");
const RAIZ = norm(process.cwd());
const tsx: string[] = [];
const recorre = (dir: string) => {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) recorre(p);
    else if (f.endsWith(".tsx")) tsx.push(norm(p).replace(RAIZ + "/", ""));
  }
};
recorre(join(process.cwd(), "src"));

/** Contenedores `.tbl-scroll` que envuelven una tabla `tbl-resize`, y el resto. */
function contenedores() {
  let conResize = 0, total = 0, conFit = 0, fitSinResize: string[] = [];
  for (const r of tsx) {
    const src = leer(r);
    for (const m of src.matchAll(/<div className="tbl-scroll([^"]*)"[^>]*>\s*(?:\{\/\*[\s\S]*?\*\/\}\s*)?<table className="([^"]*)"/g)) {
      total += 1;
      const clasesDiv = m[1], clasesTabla = m[2];
      const resize = clasesTabla.includes("tbl-resize");
      const fit = clasesDiv.includes("tbl-fit");
      if (resize) conResize += 1;
      if (fit) conFit += 1;
      if (fit && !resize) fitSinResize.push(`${r}: ${m[0].slice(0, 60)}`);
    }
  }
  return { conResize, total, conFit, fitSinResize };
}

describe("el marco mide lo que miden las columnas", () => {
  it("la regla existe y se apoya en `max-content`, con tope del 100%", () => {
    // `max-content` encoge el marco a la suma de las columnas; `max-width: 100%` es lo que
    // conserva el desplazamiento cuando la tabla SÍ es más ancha que el hueco.
    expect(css).toContain(".tbl-scroll.tbl-fit { width: max-content; max-width: 100%; }");
  });
  it("y en el teléfono se desactiva, donde la tabla ya son tarjetas al 100%", () => {
    const movil = css.slice(css.indexOf("@media (max-width: 640px)"));
    expect(movil).toContain(".tbl-scroll.tbl-fit { width: auto; }");
  });
});

describe("no se toca el contenedor de las otras once tablas", () => {
  it("`.tbl-scroll` sigue con su fondo, que es la base de las sombras de desplazamiento", () => {
    // Son cuatro gradientes: dos que tapan el borde cuando NO hay más contenido y dos que pintan
    // la sombra cuando sí lo hay. Sin `background-color` no hay con qué tapar, y una ventana
    // estrecha pasaría a leerse como «faltan columnas» en vez de «desplázate».
    // Acotado AL BLOQUE de `.tbl-scroll`: en todo el fichero hay ocho `linear-gradient`, y contar
    // sobre el fichero entero mediría otra cosa. Es el mismo cuidado que con los patrones de una
    // línea — el número tiene que ser de lo que se dice que es.
    const bloque = css.slice(css.indexOf(".tbl-scroll {"), css.indexOf("table.orders {"));
    expect(bloque).toContain("background-color: var(--card);");
    expect(bloque.match(/linear-gradient\(to (right|left)/g) ?? []).toHaveLength(4);
    expect(bloque).toContain("background-attachment: local, local, scroll, scroll;");
  });
  it("la regla base de `.tbl-scroll` no fija ancho: quien no pida `tbl-fit` queda igual", () => {
    const base = css.slice(css.indexOf(".tbl-scroll {"), css.indexOf("table.orders {"));
    expect(base).not.toContain("width:");
    expect(base).toContain("overflow-x: auto;");
  });
  it("y la tabla tampoco cambia: sigue siendo `width: auto` con `table-layout: fixed`", () => {
    // El comentario que hay encima explica por qué no puede ser `max-content`: ignoraría los
    // anchos por columna y bloquearía encoger. Esta rama no lo toca.
    expect(css).toContain("table.tbl-resize { table-layout: fixed; min-width: 0; width: auto; }");
  });
});

describe("quién lleva la clase", () => {
  it("los CINCO contenedores que envuelven una `tbl-resize`, y ninguno más", () => {
    const { conResize, conFit, fitSinResize } = contenedores();
    expect(conResize).toBe(5);
    expect(conFit).toBe(5);
    expect(fitSinResize, "un `tbl-fit` sobre una tabla que no es `tbl-resize`").toEqual([]);
  });
  it("los demás `.tbl-scroll` del repo se quedan como estaban", () => {
    // El número importa: si mañana alguien le pone `tbl-fit` a un contenedor con una tabla
    // normal (`width: 100%`), no gana nada y se arriesga a encogerlo por un `max-content` que
    // no cuadra con el 100%.
    const usos = tsx.filter((r) => leer(r).includes('className="tbl-scroll')).length;
    expect(usos).toBeGreaterThanOrEqual(10);
  });
});
