import { describe, expect, it } from "vitest";
import { claveDeLugar, parecidosDe, tituloDeOtros } from "./parecidos";
import { filtrar, type Lead } from "./reglas";

const TODAS = { pool: null, categoria: "todas", tipo: "", ciudad: "", busca: "" } as const;

/** Un lead de prueba: STXP por defecto; el trabajo igual salvo lo que cada prueba cambie. */
function lead(extra: Partial<Lead> = {}): Lead {
  return {
    id: "a", tabs_project: "PRIV-1", pool: "RDZ Pharr", distance_miles: 3, category: "Sirve – usa piso", project_type: "Oficinas / suites",
    reason: null, county: "Hidalgo", registered_date: "2026-11-01", project_name: "Permiso Norte", facility_name: null, type_of_work: "New Construction",
    scope_of_work: "Piso de vinilo", square_footage: 2000, estimated_cost: 90000, est_start_date: null, est_completion_date: null, permit_status: null,
    site_address: "FM 88 & Mile 12 N", site_city: "Pharr", site_zip: "78577", owner_name: "Constructora Sur", owner_phone: null,
    owner_contact: null, tenant_name: null, tenant_phone: null, design_firm_name: null, design_firm_phone: null, tdlr_link: null,
    status: "free", holder: null, holder_name: null, taken_at: null, touched_at: null, follow_up_note: null, follow_up_at: null,
    follow_up_action: null, last_outcome: null, last_note: null, last_by: null, last_by_name: null, last_at: null,
    times_seen: 1, last_seen_at: null, source: "privado",
    ...extra,
  };
}

describe("claveDeLugar: el lugar que agrupa", () => {
  it("quita mayúsculas, signos, espacios y acentos", () => {
    expect(claveDeLugar({ site_address: "FM 88 & Mile 12 N" })).toBe("fm88mile12n");
    expect(claveDeLugar({ site_address: "  fm-88 &  mile 12   n. " })).toBe("fm88mile12n");
    expect(claveDeLugar({ site_address: "Calle Ñandú 1234" })).toBe("callenandu1234");
  });
  it("menos de 9 caracteres útiles, o vacío, no tiene clave", () => {
    expect(claveDeLugar({ site_address: "N" })).toBeNull();
    expect(claveDeLugar({ site_address: "Main St." })).toBeNull(); // 6 útiles
    expect(claveDeLugar({ site_address: "" })).toBeNull();
    expect(claveDeLugar({ site_address: null })).toBeNull();
    expect(claveDeLugar({ site_address: "Mile 12 N" })).toBeNull(); // 7 útiles: sin clave
    expect(claveDeLugar({ site_address: "Mile 123 N" })).toBeNull(); // 8: sin clave
    expect(claveDeLugar({ site_address: "Mile 1234 N" })).toBe("mile1234n"); // 9: con clave
  });
});

describe("parecidosDe: el grupo de leads que comparten lugar", () => {
  it("dos leads en el mismo lugar con trabajo distinto: «mismo_lugar»; el grupo y los otros, con sus ids", () => {
    const m = parecidosDe([lead({ id: "a" }), lead({ id: "b", project_name: "Otro permiso", scope_of_work: "Pintura" })]);
    expect(m.get("a")).toEqual({ clase: "mismo_lugar", otros: ["b"], cuantos: 2 });
    expect(m.get("b")).toEqual({ clase: "mismo_lugar", otros: ["a"], cuantos: 2 });
  });
  it("idénticos salvo el número: «posible_duplicado»", () => {
    const m = parecidosDe([lead({ id: "a" }), lead({ id: "b" })]);
    expect(m.get("a")?.clase).toBe("posible_duplicado");
    expect(m.get("b")?.clase).toBe("posible_duplicado");
  });
  it("sin lugar en común, o sin lugar, no hay grupo", () => {
    const m = parecidosDe([lead({ id: "a" }), lead({ id: "b", site_address: "Otro lugar lejos" }), lead({ id: "c", site_address: null })]);
    expect(m.size).toBe(0);
  });
  it("de tres: el que es idéntico a otro es posible duplicado; el que no lo es, mismo lugar; en el duplicado cuantos son los IGUALES (él incluido); en «mismo lugar», el grupo entero", () => {
    const m = parecidosDe([
      lead({ id: "a" }),
      lead({ id: "b" }),
      lead({ id: "c", project_name: "Otro" }),
    ]);
    expect(m.get("a")).toEqual({ clase: "posible_duplicado", otros: ["b"], cuantos: 2 });
    expect(m.get("b")).toEqual({ clase: "posible_duplicado", otros: ["a"], cuantos: 2 });
    expect(m.get("c")).toEqual({ clase: "mismo_lugar", otros: ["a", "b"], cuantos: 3 });
  });
  it("un origen distinto no agrupa: un GOV y un STXP con el mismo lugar no son del mismo grupo", () => {
    const m = parecidosDe([lead({ id: "a" }), lead({ id: "g", source: "tdlr" })]);
    expect(m.size).toBe(0);
  });
  it("dos GOV con el mismo lugar sí se agrupan entre ellos", () => {
    const m = parecidosDe([lead({ id: "g1", source: "tdlr" }), lead({ id: "g2", source: "tdlr" })]);
    expect(m.get("g1")?.clase).toBe("posible_duplicado");
  });
  it("los archivados no cuentan: ni forman grupo ni se etiquetan", () => {
    const m = parecidosDe([lead({ id: "a" }), lead({ id: "b", status: "archived" })]);
    expect(m.size).toBe(0);
    const tres = parecidosDe([lead({ id: "a" }), lead({ id: "b", status: "archived" }), lead({ id: "c" })]);
    expect(tres.get("a")).toEqual({ clase: "posible_duplicado", otros: ["c"], cuantos: 2 });
  });
  it("mayúsculas y espacios de más no cuentan como diferencia; dos vacíos son iguales", () => {
    const m = parecidosDe([
      lead({ id: "a", project_name: "Permiso  Norte", scope_of_work: null, type_of_work: null }),
      lead({ id: "b", project_name: "permiso norte", scope_of_work: "", type_of_work: null }),
    ]);
    expect(m.get("a")?.clase).toBe("posible_duplicado");
  });
  it("el costo distinto separa: no es duplicado aunque todo lo demás coincida", () => {
    const m = parecidosDe([lead({ id: "a" }), lead({ id: "b", estimated_cost: 91000 })]);
    expect(m.get("a")?.clase).toBe("mismo_lugar");
  });
  it("el lugar se compara sin acentos, mayúsculas ni signos: «FM 88 & Mile 12 N» y «fm 88 & mile-12, n» son el mismo lugar", () => {
    const m = parecidosDe([lead({ id: "a", site_address: "FM 88 & Mile 12 N" }), lead({ id: "b", site_address: "fm 88 & mile-12, n" })]);
    expect(m.get("a")?.clase).toBe("posible_duplicado");
  });
});

describe("el filtro «Posibles duplicados»: solo los ids del conjunto", () => {
  it("con el conjunto, solo esos; sin él (null), todos", () => {
    const de = [lead({ id: "a" }), lead({ id: "b" }), lead({ id: "c", site_address: "Otro lugar lejos" })];
    expect(filtrar(de, { ...TODAS, soloDeIds: new Set(["a"]) }).map((l) => l.id)).toEqual(["a"]);
    expect(filtrar(de, { ...TODAS, soloDeIds: null }).map((l) => l.id)).toEqual(["a", "b", "c"]);
  });
});

describe("tituloDeOtros: la lista de los otros, como mucho seis", () => {
  it("hasta seis, separados por coma; más de seis, las seis y «…»", () => {
    expect(tituloDeOtros(["A", "B"])).toBe("A, B");
    expect(tituloDeOtros(["1", "2", "3", "4", "5", "6"])).toBe("1, 2, 3, 4, 5, 6");
    expect(tituloDeOtros(["1", "2", "3", "4", "5", "6", "7"])).toBe("1, 2, 3, 4, 5, 6 …");
  });
});
