import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { HojaCliente } from "@/app/estimator/HojaCliente";
import { borradorDeFila, filaDeBorrador, resumenDeFila } from "./almacen";
import { hojaDelCliente } from "./hoja";
import { celdaDePriceMatch, textoDePriceMatch, valorDeColumna, type CotizacionResumen } from "./lista-admin";
import {
  borradorVacio, lineaSfVacia, lineaUnidadVacia, resumenDeTotales, type QuoteDraft, type SfLine, type UnitLine,
} from "./modelo";
import {
  alternarPriceMatch, competidoresAdjuntos, competidorLimpio, cotizacionesConPriceMatch, etiquetaPriceMatch, lineasConPriceMatch,
  marcaDeFila, ponCompetidor, tienePriceMatch,
} from "./price-match";

/**
 * D-555: la marca «Price Match» en el precio de una línea. El dueño, 2026-10-14: «Quote builder should allow you to tag
 * "Price Match" to a price so its known that competitors are giving low». Interna: la ven el Quote Builder y las listas,
 * nunca la hoja del cliente (como el estimado de la competencia, D-425).
 */

const leer = (r: string) => readFileSync(r, "utf8").split("\r\n").join("\n");
const t = (en: string) => en;
const COMPETIDOR = "Pisos Zeta Ficticios";

const sf = (p: Partial<SfLine> = {}): SfLine => ({
  ...lineaSfVacia(), customer_category: "24x48 Tile", requested_sf: 1000, sf_per_box: 25, price_per_sf: 2, ...p,
});
const lote = (p: Partial<UnitLine> = {}): UnitLine => ({
  ...lineaUnidadVacia(), customer_category: "Installation Materials", unit_price: 385, ...p,
});
function borrador(lines: QuoteDraft["lines"]): QuoteDraft {
  return { ...borradorVacio("2026-10-14"), estimate_num: "E-77", customer: { salutation: "Mr.", full_name: "Luis Pena", company: "", phone: "" }, lines };
}

describe("qué cuenta como marcada", () => {
  it("solo el booleano true; un \"true\", un 1 o la clave ausente no", () => {
    expect(tienePriceMatch({ price_match: true })).toBe(true);
    expect(tienePriceMatch({ price_match: false })).toBe(false);
    expect(tienePriceMatch({})).toBe(false);
    expect(tienePriceMatch(null)).toBe(false);
    expect(marcaDeFila({ price_match: "true" })).toEqual({});
    expect(marcaDeFila({ price_match: 1 })).toEqual({});
  });
});

describe("del jsonb a la línea y de vuelta (sin migración)", () => {
  it("una línea vieja, sin las claves, se lee sin marcar y no gana claves", () => {
    const d = borradorDeFila({ lines: [{ kind: "sf", id: "a", price_per_sf: 2 }, { kind: "unit", id: "b", unit_price: 9 }] });
    expect(d.lines.map(tienePriceMatch)).toEqual([false, false]);
    expect(d.lines.some((l) => "price_match" in l || "price_match_competitor" in l)).toBe(false);
  });
  it("la marca y el competidor (recortado) vuelven en las dos clases de línea; el competidor sin marca se descarta", () => {
    const d = borradorDeFila({
      lines: [
        { kind: "sf", id: "a", price_per_sf: 2, price_match: true, price_match_competitor: `  ${COMPETIDOR}  ` },
        { kind: "unit", id: "b", unit_price: 9, price_match: true },
        { kind: "unit", id: "c", unit_price: 9, price_match_competitor: COMPETIDOR },
      ],
    });
    expect(d.lines[0]).toMatchObject({ price_match: true, price_match_competitor: COMPETIDOR });
    expect(d.lines[1]).toMatchObject({ price_match: true });
    expect("price_match_competitor" in d.lines[1]).toBe(false);
    expect(tienePriceMatch(d.lines[2])).toBe(false);
    expect("price_match_competitor" in d.lines[2]).toBe(false);
  });
  it("lo que se guarda (filaDeBorrador) lleva las claves en las líneas, y se lee igual", () => {
    const linea = alternarPriceMatch(sf(), [COMPETIDOR]);
    const guardado = JSON.parse(JSON.stringify(filaDeBorrador(borrador([linea, lote()]))));
    expect(guardado.lines[0]).toMatchObject({ price_match: true, price_match_competitor: COMPETIDOR });
    expect("price_match" in guardado.lines[1]).toBe(false);
    const leido = borradorDeFila(guardado);
    expect(leido.lines.map(tienePriceMatch)).toEqual([true, false]);
    expect(leido.lines[0].price_match_competitor).toBe(COMPETIDOR);
  });
  it("el competidor se corta a 120, el mismo tope que la empresa del estimado de la competencia", () => {
    expect(competidorLimpio("x".repeat(200))).toHaveLength(120);
    expect(marcaDeFila({ price_match: true, price_match_competitor: "y".repeat(200) }).price_match_competitor).toHaveLength(120);
    expect(competidorLimpio(42)).toBe("");
  });
});

describe("marcar, desmarcar y escribir el competidor", () => {
  it("con UN solo competidor adjunto, marcar lo pone; con dos o ninguno no se adivina", () => {
    expect(alternarPriceMatch(sf(), [COMPETIDOR])).toMatchObject({ price_match: true, price_match_competitor: COMPETIDOR });
    const conDos = alternarPriceMatch(sf(), [COMPETIDOR, "Otra Casa"]);
    expect(conDos.price_match).toBe(true);
    expect("price_match_competitor" in conDos).toBe(false);
    expect("price_match_competitor" in alternarPriceMatch(sf(), [])).toBe(false);
  });
  it("el competidor que ya tenía la línea manda sobre el adjunto", () => {
    expect(alternarPriceMatch(sf({ price_match_competitor: "Mio" }), [COMPETIDOR]).price_match_competitor).toBe("Mio");
  });
  it("desmarcar QUITA las dos claves: el jsonb no se queda con un false ni con el competidor", () => {
    const marcada = alternarPriceMatch(lote(), [COMPETIDOR]);
    const desmarcada = alternarPriceMatch(marcada, [COMPETIDOR]);
    expect(tienePriceMatch(desmarcada)).toBe(false);
    expect(JSON.stringify(desmarcada)).not.toContain("price_match");
    expect(desmarcada).toEqual(lote({ id: marcada.id }));
  });
  it("escribir no se come el espacio de en medio, vacío quita la clave, y sin la marca no escribe", () => {
    const marcada = alternarPriceMatch(sf(), []);
    expect(ponCompetidor(marcada, "Floor ").price_match_competitor).toBe("Floor ");
    expect(ponCompetidor(marcada, "Floor & Decor").price_match_competitor).toBe("Floor & Decor");
    expect("price_match_competitor" in ponCompetidor(ponCompetidor(marcada, "X"), "   ")).toBe(false);
    const sinMarca = sf();
    expect(ponCompetidor(sinMarca, COMPETIDOR)).toBe(sinMarca);
    expect(ponCompetidor(marcada, "z".repeat(200)).price_match_competitor).toHaveLength(120);
  });
  it("la etiqueta: «Price Match», o «Price Match · vs X» con el competidor recortado; null sin marca", () => {
    expect(etiquetaPriceMatch(sf({ price_match: true }))).toBe("Price Match");
    expect(etiquetaPriceMatch(sf({ price_match: true, price_match_competitor: " Floor & Decor " }))).toBe("Price Match · vs Floor & Decor");
    expect(etiquetaPriceMatch(sf({ price_match_competitor: COMPETIDOR }))).toBeNull();
  });
  it("los competidores adjuntos: el de la lectura manda sobre el escrito al subir, sin repetir ni vacíos", () => {
    const archivos = [
      { id: "1", competitor: "Escrito Al Subir" }, { id: "2", competitor: "  " }, { id: "3", competitor: COMPETIDOR.toUpperCase() },
      { id: "4", competitor: null },
    ];
    const lecturas = { 1: { competitor: COMPETIDOR }, 4: { competitor: null } };
    expect(competidoresAdjuntos(archivos, lecturas)).toEqual([COMPETIDOR]);
  });
});

describe("la marca no cambia ningún número", () => {
  it("el total, el ahorro y el impuesto son los mismos con y sin la marca", () => {
    const lineas = [sf({ lower_price_per_sf: 1.6 }), lote()];
    const marcadas = lineas.map((l) => alternarPriceMatch(l, [COMPETIDOR]));
    expect(resumenDeTotales(marcadas)).toEqual(resumenDeTotales(lineas));
  });
});

describe("la hoja del cliente NO la lleva (interna, como D-425)", () => {
  it("la hoja de una cotización marcada es idéntica a la de la misma sin marcar, y el HTML no dice Price Match ni el competidor", () => {
    const sinMarca = borrador([sf({ lower_price_per_sf: 1.6 }), lote()]);
    const marcada = { ...sinMarca, lines: sinMarca.lines.map((l) => alternarPriceMatch(l, [COMPETIDOR])) };
    expect(lineasConPriceMatch(marcada.lines)).toBe(2);
    expect(hojaDelCliente(marcada, "Pharr")).toEqual(hojaDelCliente(sinMarca, "Pharr"));
    const html = renderToStaticMarkup(createElement(HojaCliente, { hoja: hojaDelCliente(marcada, "Pharr") }));
    expect(html).toContain("Subtotal");
    expect(html).not.toMatch(/price.?match/i);
    expect(html).not.toContain(COMPETIDOR);
  });
  it("ni hoja.ts ni HojaCliente.tsx leen las claves de la marca", () => {
    for (const f of ["src/lib/estimator/hoja.ts", "src/app/estimator/HojaCliente.tsx"]) {
      expect(leer(f)).not.toMatch(/price_match|PriceMatch|price-match/);
    }
  });
});

describe("las listas: la cuenta por cotización, la columna y su filtro", () => {
  const cot = (n: number): CotizacionResumen => ({
    id: `q${n}`, estimate_num: "E", owner_id: "u1", owner_name: null, store: null, customer_name: "", sf: 0, total: 0,
    price_match_lines: n, print_count: 0, printed_at: null, created_at: "2026-10-14T15:00:00Z", updated_at: "2026-10-14T15:00:00Z",
  });
  it("el resumen de la fila cuenta las líneas marcadas; una fila vieja, cero", () => {
    const fila = {
      id: "q1", estimate_num: "E-1", customer: {}, created_at: "2026-10-14T15:00:00Z",
      lines: [
        { kind: "sf", id: "a", price_per_sf: 2, price_match: true },
        { kind: "unit", id: "b", unit_price: 9, price_match: true, price_match_competitor: COMPETIDOR },
        { kind: "unit", id: "c", unit_price: 9 },
      ],
    };
    expect(resumenDeFila(fila).price_match_lines).toBe(2);
    expect(resumenDeFila({ ...fila, lines: [{ kind: "unit", id: "c", unit_price: 9 }] }).price_match_lines).toBe(0);
  });
  it("la columna filtra con dos valores, «Price Match» y vacío, sin partir por cuántas líneas", () => {
    expect(textoDePriceMatch(cot(0))).toBeNull();
    expect(textoDePriceMatch(cot(1))).toBe("Price Match");
    expect(textoDePriceMatch(cot(3))).toBe("Price Match");
    expect(valorDeColumna("price_match", cot(2), t)).toBe("Price Match");
    expect(valorDeColumna("price_match", cot(0), t)).toBeNull();
  });
  it("la celda dice cuántas si son varias", () => {
    expect(celdaDePriceMatch(cot(0))).toBeNull();
    expect(celdaDePriceMatch(cot(1))).toBe("Price Match");
    expect(celdaDePriceMatch(cot(2))).toBe("Price Match ×2");
  });
  it("la cabecera cuenta cotizaciones con alguna marca, no líneas", () => {
    expect(cotizacionesConPriceMatch([cot(0), cot(1), cot(3)])).toBe(2);
    expect(cotizacionesConPriceMatch([])).toBe(0);
  });
});

describe("las pantallas usan estas piezas", () => {
  const estimador = leer("src/app/estimator/Estimador.tsx");
  const lista = leer("src/app/estimator/TodasLasCotizaciones.tsx");
  const competencia = leer("src/app/estimator/Competencia.tsx");
  it("el Quote Builder marca con alternarPriceMatch (con los competidores adjuntos) y escribe con ponCompetidor", () => {
    expect(estimador).toContain("onChange={() => cambiaLinea(l.id, (x) => alternarPriceMatch(x, competidoresAdjuntos))} />");
    expect(estimador).toContain("onChange={(e) => cambiaLinea(l.id, (x) => ponCompetidor(x, e.target.value))} />");
    expect(estimador).toContain("<span className=\"est-pm\" data-price-match-etiqueta>🏷️ {etiquetaPriceMatch(l)}</span>");
    expect(estimador).toContain("onCompetidores={setCompetidoresAdjuntos}");
  });
  it("la sección de la competencia avisa con competidoresAdjuntos de sus archivos y lecturas", () => {
    expect(competencia).toContain("onCompetidores?.(competidoresAdjuntos(archivos, lecturas));");
  });
  it("la lista pinta la celda y la cuenta con las funciones probadas", () => {
    expect(lista).toContain("{celdaDePriceMatch(c) && <span className=\"est-pm\">🏷️ {celdaDePriceMatch(c)}</span>}");
    expect(lista).toContain("{cotizacionesConPriceMatch(orden.visibles)} {t(\"with Price Match\", \"con Price Match\")}");
  });
});
