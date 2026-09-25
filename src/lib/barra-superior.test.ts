import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { altoMaximoDeCaja, anchoDelRelleno, hayQueMostrarBarra, scrollQueToca, type Carril } from "./barra-superior";

/**
 * Cabecera bloqueada y barra de arriba (D-398). Pedido de Juan Briseño (Office Manager), 2026-09-25:
 * «Need headers to be locked and have the scroll bar on top of headers in the tables».
 *
 * vitest corre sin DOM: la lógica va en funciones puras (arriba) y que las pantallas la usan se comprueba
 * leyendo el fuente (abajo). Lo medido en el navegador está en la entrada de DECISIONS.md.
 */

const leer = (p: string) => readFileSync(p, "utf8").split("\r\n").join("\n");
const carril = (scrollLeft: number, scrollWidth: number, clientWidth: number): Carril => ({ scrollLeft, scrollWidth, clientWidth });

describe("cuándo se pinta la barra", () => {
  it("solo si la tabla es más ancha que la caja", () => {
    expect(hayQueMostrarBarra(1430, 1167)).toBe(true); // Órdenes a 1280, medido
    expect(hayQueMostrarBarra(1167, 1167)).toBe(false);
    expect(hayQueMostrarBarra(900, 1167)).toBe(false);
  });
  it("un píxel de más es redondeo, no algo que ver; dos ya cuentan", () => {
    expect(hayQueMostrarBarra(1168, 1167)).toBe(false);
    expect(hayQueMostrarBarra(1169, 1167)).toBe(true);
  });
});

describe("el relleno de la barra da el MISMO recorrido que la caja", () => {
  it("con los números medidos en Órdenes a 1280: 263 px de recorrido en las dos", () => {
    const caja = { scrollWidth: 1430, clientWidth: 1167 };
    const relleno = anchoDelRelleno(1184, caja);
    expect(relleno).toBe(1447);
    expect(relleno - 1184).toBe(caja.scrollWidth - caja.clientWidth);
  });
  it("no es el ancho de la tabla: la barra y la caja no miden lo mismo por dentro", () => {
    // Si se usara el ancho de la tabla (1430), la barra recorrería 246 y la caja 263.
    expect(anchoDelRelleno(1184, { scrollWidth: 1430, clientWidth: 1167 })).not.toBe(1430);
  });
  it("sin desborde, el relleno es la barra y no hay recorrido", () => {
    expect(anchoDelRelleno(1184, { scrollWidth: 1100, clientWidth: 1167 })).toBe(1184);
  });
});

describe("la sincronización, en los dos sentidos", () => {
  it("con el mismo recorrido, un píxel de una es un píxel de la otra", () => {
    expect(scrollQueToca(carril(120, 1447, 1184), carril(0, 1430, 1167))).toBe(120);
    expect(scrollQueToca(carril(226, 1430, 1167), carril(0, 1447, 1184))).toBe(226);
  });
  it("si el recorrido no coincide, va en proporción", () => {
    expect(scrollQueToca(carril(100, 1200, 1000), carril(0, 1400, 1000))).toBe(200);
    expect(scrollQueToca(carril(200, 1400, 1000), carril(0, 1200, 1000))).toBe(100);
  });
  it("los extremos: al final va al final y al principio al principio", () => {
    expect(scrollQueToca(carril(263, 1447, 1184), carril(0, 1430, 1167))).toBe(263);
    expect(scrollQueToca(carril(0, 1447, 1184), carril(263, 1430, 1167))).toBe(0);
    // Un scrollLeft fuera de rango (rebote elástico) no lleva la otra más allá de su final.
    expect(scrollQueToca(carril(400, 1447, 1184), carril(0, 1430, 1167))).toBe(263);
  });
  it("si ya coinciden no se mueve nada: eso corta el eco", () => {
    const barra = carril(120, 1447, 1184), caja = carril(0, 1430, 1167);
    const x = scrollQueToca(barra, caja)!;
    caja.scrollLeft = x; // mover la caja dispara SU evento, que pregunta al revés…
    expect(scrollQueToca(caja, barra)).toBeNull(); // …y como ya coinciden, no toca la barra
  });
  it("sin recorrido en alguno de los dos no hay nada que sincronizar", () => {
    expect(scrollQueToca(carril(0, 1000, 1000), carril(0, 1400, 1000))).toBeNull();
    expect(scrollQueToca(carril(50, 1400, 1000), carril(0, 1000, 1000))).toBeNull();
  });
});

describe("el alto bajo algo fijo (el mapa del Gestor)", () => {
  it("sin nada fijo arriba no se pone nada en línea: manda el CSS", () => {
    expect(altoMaximoDeCaja(0)).toBeUndefined();
    expect(altoMaximoDeCaja(Number.NaN)).toBeUndefined();
  });
  it("con el panel del Gestor (444 px medidos a 1280×900) la caja se acorta a lo que queda debajo", () => {
    expect(altoMaximoDeCaja(444)).toBe("max(240px, calc(100dvh - 504px))");
  });
});

describe("el CSS que lo hace funcionar", () => {
  const css = leer("src/app/globals.css");
  const regla = (selector: string, desde = 0) => {
    const ini = css.indexOf(selector + " {", desde);
    expect(ini, selector).toBeGreaterThan(0);
    return css.slice(ini, css.indexOf("}", ini) + 1);
  };
  it("la caja tiene alto máximo: sin él el `sticky` del `th` se pega a una caja que nunca se desplaza", () => {
    expect(regla(".tbl-scroll.tbl-caja")).toContain("max-height: calc(100dvh - 150px);");
  });
  it("la cabecera sigue siendo `sticky` arriba, y va por encima de las celdas", () => {
    expect(regla("table.orders th")).toContain("position: sticky; top: 0;");
    expect(regla(".tbl-caja table.orders thead th")).toContain("z-index: 2;");
  });
  it("la barra se desplaza a lo ancho y nunca a lo alto", () => {
    const barra = regla(".tbl-barra-superior");
    expect(barra).toContain("overflow-x: auto;");
    expect(barra).toContain("overflow-y: hidden;");
  });
  it("el envoltorio no deja que la página se desplace de lado", () => {
    expect(regla(".tbl-con-barra")).toContain("min-width: 0;");
  });
  it("en el teléfono la caja no lleva alto: las tarjetas se apilan y baja la página", () => {
    const movil = css.indexOf("@media (max-width: 640px) {", css.indexOf("---- Orders table → stacked cards on phones"));
    expect(movil).toBeGreaterThan(0);
    expect(regla(".tbl-scroll.tbl-caja", movil)).toContain("max-height: none !important;");
    // …y está DENTRO de ese bloque, no después.
    expect(css.indexOf(".tbl-scroll.tbl-caja {", movil)).toBeLessThan(css.indexOf("table.orders-responsive {", movil));
  });
});

describe("el componente usa la lógica de aquí", () => {
  const comp = leer("src/components/BarraSuperior.tsx");
  it("decide si se pinta con `hayQueMostrarBarra`, y si no, no pinta nada", () => {
    expect(comp).toContain("const ve = hayQueMostrarBarra(c.scrollWidth, c.clientWidth);");
    expect(comp).toContain("if (!medida.ve) return null;");
  });
  it("mide el relleno con `anchoDelRelleno` y lo pone en el hijo", () => {
    expect(comp).toContain("const relleno = anchoDelRelleno(anchoBarra, c);");
    expect(comp).toContain("<div style={{ width: medida.relleno, height: 1 }} />");
  });
  it("sincroniza con `scrollQueToca` en los dos sentidos", () => {
    expect(comp).toContain("const x = scrollQueToca(origen, destino);");
    expect(comp).toContain("const deLaCaja = sigue(c, b), deLaBarra = sigue(b, c);");
    expect(comp).toContain('c.addEventListener("scroll", deLaCaja');
    expect(comp).toContain('b.addEventListener("scroll", deLaBarra');
  });
  it("vuelve a medir cuando cambia el ancho de la caja o de la tabla", () => {
    expect(comp).toContain("ro.observe(c);");
    expect(comp).toContain("ro.observe(c.firstElementChild);");
  });
  it("la barra se marca para medirla y no sale en lo impreso", () => {
    expect(comp).toMatch(/className="tbl-barra-superior no-print" data-barra-superior/);
  });
});

describe("las pantallas que la llevan", () => {
  // Cada barra va JUSTO antes de su caja y con la MISMA ref: si una apunta a otra caja, mueve la que no es.
  const pares = (src: string) => [...src.matchAll(/<BarraSuperior caja=\{([^}]+)\} \/>\s*<div className="tbl-scroll([^"]*)" ref=\{([^}]+)\}/g)]
    .map((m) => ({ barra: m[1], clases: m[2], caja: m[3] }));
  const pantallas: [string, number][] = [
    ["src/components/OrdersTable.tsx", 1], // Órdenes, Almacén (colas y Recepción) y Chofer
    ["src/app/promos/[id]/TablaDeRonda.tsx", 1],
    ["src/app/(app)/routes/page.tsx", 2], // «Sin asignar» y las paradas de cada chofer
  ];
  for (const [fichero, cuantas] of pantallas) {
    it(`${fichero}: ${cuantas} tabla(s) con barra, cada una sobre SU caja con cabecera bloqueada`, () => {
      const src = leer(fichero);
      const ps = pares(src);
      expect(ps).toHaveLength(cuantas);
      for (const p of ps) {
        expect(p.barra).toBe(p.caja);
        expect(p.clases).toContain("tbl-caja");
      }
      // Ni una caja con `tbl-caja` sin su barra, ni una barra suelta.
      expect(src.match(/<div className="tbl-scroll[^"]*tbl-caja/g) ?? []).toHaveLength(cuantas);
      expect(src.match(/<BarraSuperior /g) ?? []).toHaveLength(cuantas);
    });
  }
  it("Órdenes: barra y caja en un mismo envoltorio (en Almacén la rejilla las separaba 10 px)", () => {
    expect(leer("src/components/OrdersTable.tsx")).toMatch(/<div className="tbl-con-barra">\s*<BarraSuperior caja=\{cajaRef\} \/>/);
  });
  it("el Gestor acorta sus cajas a lo que deja el mapa fijo, midiéndolo", () => {
    const rutas = leer("src/app/(app)/routes/page.tsx");
    expect(rutas).toMatch(/<div ref=\{panelFijoRef\} style=\{\{ [^}]*position: "sticky", top: 6,/);
    expect(rutas).toContain("const mide = () => setAltoPanelFijo(Math.round(el.getBoundingClientRect().height));");
    expect(rutas).toContain("maxHeight: altoMaximoDeCaja(altoPanelFijo)");
    expect(rutas.match(/className="tbl-scroll tbl-fit tbl-caja" ref=\{[^}]+\} style=\{estiloDeCaja\}/g) ?? []).toHaveLength(2);
    // Sin el mapa, nada en línea: manda el CSS.
    expect(rutas).toContain("if (!showTop || !el) { setAltoPanelFijo(0); return; }");
  });
});
