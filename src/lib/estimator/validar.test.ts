import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { estadoDelEstimado, lineasCortas, loQueFalta, puedeGuardar, puedeTrabajar, type EstimadoHallado } from "./validar";
import { sePuedeGenerar, sePuedePedirLaCopia, POLITICA_PARRAFOS, POLITICA_CASILLA, POLITICA_TITULO } from "./politica";
import { borradorVacio, lineaSfVacia, type QuoteDraft } from "./modelo";

const leer = (r: string) => readFileSync(r, "utf8").split("\r\n").join("\n");

const hallado = (patch: Partial<EstimadoHallado> = {}): EstimadoHallado => ({
  quote_id: "q1", estimate_num: "104582", owner_id: "otro", owner_name: "Otro Vendedor", owner_store: null,
  my_approval_id: null, my_approval: null, ...patch,
});
const base = { baseDisponible: true, buscado: true, meId: "yo", esAdmin: false };

describe("de quién es el estimado", () => {
  it("sin la 148 no se puede comprobar: sin-base, y se deja trabajar", () => {
    expect(estadoDelEstimado({ ...base, baseDisponible: false, hallado: null })).toBe("sin-base");
    expect(puedeTrabajar("sin-base")).toBe(true);
  });
  it("sin buscar no se sabe, y no se deja", () => {
    expect(estadoDelEstimado({ ...base, buscado: false, hallado: null })).toBe("sin-buscar");
    expect(puedeTrabajar("sin-buscar")).toBe(false);
  });
  it("nadie la tiene: nueva; es mía: propia", () => {
    expect(estadoDelEstimado({ ...base, hallado: null })).toBe("nueva");
    expect(estadoDelEstimado({ ...base, hallado: hallado({ owner_id: "yo" }) })).toBe("propia");
  });
  it("es de otro: hace falta su aprobación", () => {
    expect(estadoDelEstimado({ ...base, hallado: hallado() })).toBe("sin-pedir");
    expect(estadoDelEstimado({ ...base, hallado: hallado({ my_approval: "pending" }) })).toBe("pendiente");
    expect(estadoDelEstimado({ ...base, hallado: hallado({ my_approval: "denied" }) })).toBe("denegada");
    expect(estadoDelEstimado({ ...base, hallado: hallado({ my_approval: "approved" }) })).toBe("aprobada");
    for (const e of ["sin-pedir", "pendiente", "denegada"] as const) expect(puedeTrabajar(e)).toBe(false);
    expect(puedeTrabajar("aprobada")).toBe(true);
  });
  it("el admin no necesita permiso", () => {
    expect(estadoDelEstimado({ ...base, esAdmin: true, hallado: hallado() })).toBe("admin");
    expect(puedeTrabajar("admin")).toBe(true);
  });
  it("un estimado sin dueño (el dueño se borró) no es «mío» aunque mi id sea nulo", () => {
    expect(estadoDelEstimado({ ...base, meId: null, hallado: hallado({ owner_id: null }) })).toBe("sin-pedir");
  });
});

function completo(patch: Partial<QuoteDraft> = {}): QuoteDraft {
  return {
    ...borradorVacio("2026-09-08"),
    estimate_num: "104582",
    sales_ext: "214",
    customer: { salutation: "Ms.", full_name: "Ana Prueba", last_name: "Prueba", last_name_edited: false, company: "", phone: "", address: "" },
    lines: [{ ...lineaSfVacia(), customer_category: "24x48 Tile", requested_sf: 100, sf_per_box: 10, price_per_sf: 2 }],
    ...patch,
  };
}

describe("lo que falta antes de generar la copia", () => {
  it("completo y con permiso: nada", () => {
    expect(loQueFalta(completo(), "nueva", "2026-09-08")).toEqual([]);
  });
  it("sin buscar el estimado, no", () => {
    expect(loQueFalta(completo(), "sin-buscar", "2026-09-08")).toEqual(["buscar"]);
  });
  it("de otro vendedor sin su aprobación, no", () => {
    expect(loQueFalta(completo(), "pendiente", "2026-09-08")).toEqual(["permiso"]);
  });
  it("si es entrega, la dirección completa es obligatoria", () => {
    const d = completo({ delivery: { mode: "delivery", street: "1 Main", city: "X", state: "TX", zip: "", charge: null } });
    expect(loQueFalta(d, "nueva", "2026-09-08")).toEqual(["direccion"]);
    const bien = completo({ delivery: { ...d.delivery, zip: "78500" } });
    expect(loQueFalta(bien, "nueva", "2026-09-08")).toEqual([]);
    // Recogiendo, la dirección no se pide.
    expect(loQueFalta(completo({ delivery: { ...d.delivery, mode: "pickup" } }), "nueva", "2026-09-08")).toEqual([]);
  });
  it("extensión, nombre, apellido, categoría y línea completa", () => {
    const q = completo({ sales_ext: " ", lines: [{ ...lineaSfVacia(), requested_sf: 100 }] });
    q.customer = { ...q.customer, full_name: "", last_name: "" };
    expect(loQueFalta(q, "nueva", "2026-09-08")).toEqual(["extension", "nombre", "apellido", "linea-incompleta", "categoria"]);
    expect(loQueFalta(completo({ lines: [] }), "nueva", "2026-09-08")).toEqual(["lineas"]);
  });
  it("una validez ya pasada no se imprime; la de hoy sí", () => {
    expect(loQueFalta(completo({ valid_through: "2026-09-07" }), "nueva", "2026-09-08")).toEqual(["validez-pasada"]);
    expect(loQueFalta(completo({ valid_through: "" }), "nueva", "2026-09-08")).toEqual(["validez"]);
  });
  it("guardar pide menos: número y permiso, y con base", () => {
    expect(puedeGuardar(completo({ lines: [] }), "nueva")).toBe(true);
    expect(puedeGuardar(completo(), "sin-base")).toBe(false);
    expect(puedeGuardar(completo(), "sin-buscar")).toBe(false);
    expect(puedeGuardar(completo(), "sin-pedir")).toBe(false);
    expect(puedeGuardar(completo({ estimate_num: "" }), "nueva")).toBe(false);
  });
  it("aviso: cajas escritas que no cubren lo pedido", () => {
    const l = { ...lineaSfVacia(), id: "corta", customer_category: "x", requested_sf: 100, sf_per_box: 10, price_per_sf: 2, boxes: 9 };
    expect(lineasCortas(completo({ lines: [l] }))).toEqual(["corta"]);
    expect(lineasCortas(completo({ lines: [{ ...l, boxes: 10 }] }))).toEqual([]);
  });
});

describe("la política del vendedor: casilla obligatoria", () => {
  it("sin nada pendiente se abre; generar exige además la casilla", () => {
    expect(sePuedePedirLaCopia([])).toBe(true);
    expect(sePuedePedirLaCopia(["buscar"])).toBe(false);
    expect(sePuedeGenerar([], false)).toBe(false);
    expect(sePuedeGenerar([], true)).toBe(true);
    expect(sePuedeGenerar(["permiso"], true)).toBe(false);
  });
  it("el texto es el del documento del dueño", () => {
    expect(POLITICA_TITULO).toBe("CUSTOMER QUOTE POLICY");
    expect(POLITICA_PARRAFOS).toHaveLength(4);
    expect(POLITICA_PARRAFOS[0]).toMatch(/^Do not print by default\./);
    expect(POLITICA_PARRAFOS[3]).toContain("Search the estimate number first.");
    expect(POLITICA_CASILLA).toMatch(/^I have reviewed and will follow the Customer Quote Policy/);
  });
});

describe("la pantalla usa estas reglas, no una copia", () => {
  const p = leer("src/app/estimator/Estimador.tsx");
  it("el estado del estimado y lo que falta salen de validar", () => {
    expect(p).toMatch(/const estado = estadoDelEstimado\(\{/);
    expect(p).toContain("const faltas = loQueFalta(draft, estado);");
    expect(p).toContain("const total = totalDeMateriales(draft.lines);");
  });
  it("el botón de generar y el Continuar de la política pasan por politica.ts", () => {
    expect(p).toContain("disabled={ocupado || !sePuedePedirLaCopia(faltas)} onClick={abrirPolitica}");
    expect(p).toContain("disabled={!sePuedeGenerar(faltas, politicaMarcada)} onClick={() => void generar()}");
    expect(p).toContain("if (!sePuedeGenerar(faltas, politicaMarcada)) return;");
    // La casilla nace desmarcada cada vez que se abre.
    expect(p).toMatch(/const abrirPolitica = \(\) => \{\s*if \(!sePuedePedirLaCopia\(faltas\)\) return;\s*setPoliticaMarcada\(false\);/);
  });
  it("guardar pasa por puedeGuardar", () => {
    expect(p).toContain("if (!me || !puedeGuardar(draft, estado)) return null;");
  });
});
