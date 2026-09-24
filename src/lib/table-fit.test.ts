import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

// El dueño: «a la derecha de la tabla hay un espacio en blanco que parece de la tabla». Y lo era:
// `.tbl-scroll` es un bloque al 100% con su borde y su fondo, y `table.tbl-resize` es `width: auto`
// —la suma de sus columnas—. Cuando las columnas no llegan al 100%, lo que se ve a la derecha es el
// contenedor, vacío.
//
// D-281 le da la vuelta al arreglo: en vez de encoger el marco hasta las columnas, **la tabla se
// estira hasta el marco** (`min-width: 100%`), porque el dueño volvió con la queja contraria —«only
// sales people gets the table cropped»—. El objetivo de aquí no cambia: que no quede un rectángulo
// vacío con borde. Lo que cambia es de qué lado se cierra el hueco, y estas pruebas con él. La regla
// de ancho vive ahora en `tabla-ancho.test.ts`; aquí se queda lo que D-232 protegía del contenedor.

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

describe("el marco ya no encoge, y por eso no hay franja vacía", () => {
  it("la clase se queda, sin `max-content` y con tope del 100% (D-281)", () => {
    // Sin `max-content` el marco vuelve a ocupar el hueco, que es contra lo que la tabla resuelve
    // su `min-width: 100%`. El tope conserva el desplazamiento cuando la tabla es más ancha.
    expect(css).toContain(".tbl-scroll.tbl-fit { width: auto; max-width: 100%; }");
    // Sin comentarios: el porqué del cambio sí nombra `max-content`, y contar sobre el fichero
    // entero mediría el comentario en vez de la regla.
    const reglas = css.replace(/\/\*[\s\S]*?\*\//g, "");
    expect(reglas).not.toContain("max-content");
  });
  it("y en el teléfono no hay nada que desactivar: ahí la tabla ya son tarjetas al 100%", () => {
    const movil = css.slice(css.indexOf("@media (max-width: 640px)"));
    expect(movil).not.toContain(".tbl-scroll.tbl-fit {");
    expect(movil).toContain("table.orders-responsive { width: 100% !important; min-width: 0 !important;");
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
  it("la tabla sigue siendo `width: auto` con `table-layout: fixed`, y ahora con mínimo del 100%", () => {
    // El comentario que hay encima explica por qué no puede ser `max-content`: ignoraría los
    // anchos por columna y bloquearía encoger. El mínimo lo puso D-281; lo demás es de D-232.
    expect(css).toContain("table.tbl-resize { table-layout: fixed; min-width: 100%; width: auto; }");
  });
});

describe("quién lleva la clase", () => {
  it("los CINCO contenedores que envuelven una `tbl-resize`, y ninguno más", () => {
    // Sube de cinco a seis con D-287: la vista «Ruta del día» de Almacén trae otra tabla de
    // columnas redimensionables. El número es un techo, no una estimación, así que se mueve con su
    // motivo y no se afloja. Baja a cinco con D-NEXT: la tabla de «Programadas» del Gestor de Rutas se fue con su pestaña.
    const { conResize, conFit, fitSinResize } = contenedores();
    expect(conResize).toBe(5);
    expect(conFit).toBe(5);
    expect(fitSinResize, "un `tbl-fit` sobre una tabla que no es `tbl-resize`").toEqual([]);
  });
  it("los demás `.tbl-scroll` del repo se quedan como estaban", () => {
    // El número importa: si mañana alguien le pone `tbl-fit` a un contenedor con una tabla
    // normal (`width: 100%`), no gana nada; y la clase solo tiene sentido junto a una
    // `tbl-resize`, que es la que se estira.
    const usos = tsx.filter((r) => leer(r).includes('className="tbl-scroll')).length;
    expect(usos).toBeGreaterThanOrEqual(10);
  });
});
