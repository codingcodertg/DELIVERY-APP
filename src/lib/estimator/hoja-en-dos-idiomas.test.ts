import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { fechaLargaEs, hojaDelCliente, TEXTOS_DE_LA_HOJA } from "./hoja";
import { borradorVacio, lineaSfVacia, lineaUnidadVacia } from "./modelo";

/**
 * D-NEXT: la hoja del cliente en español o en inglés (el dueño: «debería haber un language toggle switch para hacer el
 * quote en español o en inglés»), y la política en el idioma del usuario.
 */
const leer = (r: string) => readFileSync(join(process.cwd(), r), "utf8").replace(/\r\n/g, "\n");

function borrador() {
  const q = borradorVacio();
  q.estimate_num = "170875"; q.sales_ext = "902"; q.valid_through = "2026-11-01"; q.project_summary = "Casa nueva";
  q.customer = { ...q.customer, full_name: "Serna" };
  const l = lineaSfVacia(); l.customer_category = "8X36 Wood"; l.customer_note = "Living"; l.requested_sf = 2000; l.sf_per_box = 19.38; l.price_per_sf = 2.5;
  const u = lineaUnidadVacia(); u.customer_category = "Grout"; u.quantity = 3; u.unit = "Bags"; u.unit_price = 21.95;
  q.lines = [l, u];
  q.display_level = "detailed";
  q.delivery = { ...q.delivery, mode: "delivery" };
  return q;
}

describe("la hoja en español", () => {
  const es = hojaDelCliente(borrador(), "Edinburg", "es");
  const en = hojaDelCliente(borrador(), "Edinburg", "en");
  it("todo lo escrito en palabras cambia; los números y el dinero no", () => {
    expect(es.idioma).toBe("es");
    expect(es.subtitulo).toBe(TEXTOS_DE_LA_HOJA.es.subtitulo);
    expect(es.rotulos.preparadoPara).toBe("Preparada para:");
    expect(es.representante).toBe("Ext. 902");
    expect(es.filas[0].descripcion).toBe("8X36 Wood — Living · 19.38 SF/caja");
    expect(es.filas[0].cantidad).toEqual(["Área pedida: 2,000 SF", "Cantidad: 104 cajas"]);
    expect(es.filas[1].cantidad).toEqual(["3 Bags"]);
    expect(es.textoSubtotal.startsWith("Subtotal: $")).toBe(true);
    expect(es.textoImpuesto.startsWith("Impuesto ")).toBe(true);
    expect(es.textoTotal.startsWith("Total estimado de materiales: $")).toBe(true);
    expect(es.validezConspicua).toBe("COTIZACIÓN VÁLIDA HASTA EL 1 DE NOVIEMBRE DE 2026");
    expect(es.avisoJuntoAlTotal).toBe(TEXTOS_DE_LA_HOJA.es.aviso);
    expect(es.entrega).toBe(TEXTOS_DE_LA_HOJA.es.entrega);
    expect(es.notaDeCajas).toBe(TEXTOS_DE_LA_HOJA.es.notaDeCajas);
    expect(es.total).toBe(en.total);
    expect(es.filas.map((f) => f.importe)).toEqual(en.filas.map((f) => f.importe));
  });
  it("en inglés (y sin pedir idioma) sale lo de siempre", () => {
    expect(hojaDelCliente(borrador(), "Edinburg").idioma).toBe("en");
    expect(en.validezConspicua).toBe("QUOTE VALID THROUGH NOVEMBER 1, 2026");
    expect(en.filas[0].cantidad).toEqual(["Requested Area: 2,000 SF", "Quantity: 104 Boxes"]);
    expect(en.rotulos.resumen).toBe("PROJECT SUMMARY");
  });
  it("la fecha larga en español", () => {
    expect(fechaLargaEs("2026-03-05")).toBe("5 de marzo de 2026");
    expect(fechaLargaEs("")).toBe("");
  });
});

describe("la pantalla", () => {
  const p = leer("src/app/estimator/Estimador.tsx");
  it("el idioma de la hoja nace del usuario y se cambia en la vista previa, en vivo", () => {
    expect(p).toContain('const idiomaDeLaHoja: IdiomaDeLaHoja = idiomaElegido ?? (lang === "es" ? "es" : "en");');
    expect(p).toContain("hojaDelCliente(draft, tiendaHoja, idiomaDeLaHoja)");
    expect(p).toContain("data-idioma-de-la-hoja");
    expect(p).toContain('data-idioma={k} checked={idiomaDeLaHoja === k} onChange={() => setIdiomaElegido(k)}');
  });
  it("la política sale SOLO en el idioma del usuario", () => {
    expect(p).toContain("{lang === \"es\" ? POLITICA_TITULO_ES : POLITICA_TITULO}");
    expect(p).toContain('{(lang === "es" ? POLITICA_PARRAFOS_ES : POLITICA_PARRAFOS).map((p, i) => (');
    expect(p).toContain('{lang === "es" ? POLITICA_CASILLA_ES : POLITICA_CASILLA}');
    expect(p).not.toContain('<span className="hint">{POLITICA_PARRAFOS_ES[i]}</span>');
  });
  it("HojaCliente pinta los rótulos de la hoja, no los suyos", () => {
    const h = leer("src/app/estimator/HojaCliente.tsx");
    for (const k of ["preparadoPara", "referencia", "tienda", "representante", "resumen", "descripcion", "cantidad", "importe"]) expect(h).toContain(`{hoja.rotulos.${k}}`);
    expect(h).not.toContain("Prepared for:");
    expect(h).toContain('lang={hoja.idioma}');
  });
});
