import { describe, expect, it } from "vitest";
import {
  accionTono, aplicarNota, categoriaBuena, categoriaDescartada, cuantosVistosMasDeUna, cuentaPorEtapa, enlaceSeguro, estadoLabel, etapaDe,
  etapaLabel, etapaTono, ETAPAS, eventoLabel, filtrar, filtroDePool, fecha, mapsUrl, negativaDeCodigo, negativaTexto, notaLimpia, NOTA_MAX,
  ordenar, POOL_SIN_TIENDA, POOL_TODAS, poolInicial, poolsDe, resumenDeTodas, tableroPorTienda, tableroPorVendedor, telUrl, TIPOS_DE_ACCION,
  valoresDe, vecesVisto, vigentes, type EventoLead, type Lead, type Persona,
} from "./reglas";

const ahora = "2026-11-18T15:00:00.000Z";
const ana: Persona = { id: "ana", name: "Ana", store: "RDZ Brownsville", admin: false };
const beto: Persona = { id: "beto", name: "Beto", store: "RDZ Edinburg", admin: false };

/** Un lead de prueba: libre, sin etapa, sin dueño, en Brownsville. Cada prueba cambia solo lo que cuenta. */
function lead(extra: Partial<Lead> = {}): Lead {
  return {
    id: "l1", tabs_project: "TABS-1", pool: "RDZ Brownsville", distance_miles: 3, category: "Sirve – usa piso", project_type: "Oficinas / suites",
    reason: null, county: "Cameron", registered_date: "2026-11-01", project_name: "Oficinas Norte", facility_name: null, type_of_work: "New Construction",
    scope_of_work: null, square_footage: 2000, estimated_cost: 90000, est_start_date: null, est_completion_date: null, permit_status: null,
    site_address: "100 Calle", site_city: "Brownsville", site_zip: "78520", owner_name: "Constructora Sur", owner_phone: "(956) 555-0101",
    owner_contact: "Juan", tenant_name: null, tenant_phone: null, design_firm_name: null, design_firm_phone: null, tdlr_link: null,
    status: "free", holder: null, holder_name: null, taken_at: null, touched_at: null, follow_up_note: null, follow_up_at: null,
    follow_up_action: null, last_outcome: null, last_note: null, last_by: null, last_by_name: null, last_at: null,
    times_seen: 1, last_seen_at: null,
    ...extra,
  };
}

const TODAS = { pool: null, categoria: "todas", tipo: "", ciudad: "", busca: "" } as const;

describe("1 · las etapas", () => {
  it("son nueve, en orden: New primero; las que se eligen son ocho (New no se elige)", () => {
    expect(ETAPAS).toEqual(["new", "made_contact", "no_answer", "appointment", "quote", "negotiation", "closed", "lost", "bad_lead"]);
    expect(TIPOS_DE_ACCION).toEqual(["made_contact", "no_answer", "appointment", "quote", "negotiation", "closed", "lost", "bad_lead"]);
  });
  it("cada una tiene su texto en los dos idiomas; «closed» es venta y «bad_lead» es su propia etapa", () => {
    expect(etapaLabel("closed", "en")).toBe("Closed (sale made)");
    expect(etapaLabel("closed", "es")).toBe("Cerrado (venta lograda)");
    expect(etapaLabel("bad_lead", "en")).toBe("Not a good lead");
    expect(etapaLabel("bad_lead", "es")).toBe("No es buen lead");
    expect(etapaLabel("new", "es")).toBe("Nuevo");
    for (const e of ETAPAS) { expect(etapaLabel(e, "en")).not.toBe(""); expect(etapaLabel(e, "es")).not.toBe(""); }
  });
  it("sin etapa, el lead está en «New»; con ella, en la suya", () => {
    expect(etapaDe(lead())).toBe("new");
    expect(etapaDe(lead({ follow_up_action: "quote" }))).toBe("quote");
  });
  it("el color: verde la venta, rojo lo perdido y lo malo, ámbar «no contestó», gris «New»", () => {
    expect(etapaTono("closed")).toBe("verde");
    expect(etapaTono("lost")).toBe("rojo");
    expect(etapaTono("bad_lead")).toBe("rojo");
    expect(etapaTono("no_answer")).toBe("ambar");
    expect(etapaTono("new")).toBe("gris");
    expect(etapaTono("quote")).toBe("azul");
    expect(accionTono("closed")).toBe("verde");
    expect(accionTono("made_contact")).toBe("azul");
  });
  it("cuenta por etapa: los archivados no cuentan y lo que no tiene etapa es «New»", () => {
    const n = cuentaPorEtapa([lead(), lead({ id: "b", follow_up_action: "quote" }), lead({ id: "c", follow_up_action: "quote" }), lead({ id: "d", status: "archived", follow_up_action: "quote" })]);
    expect(n.new).toBe(1);
    expect(n.quote).toBe(2);
    expect(n.closed).toBe(0);
    expect(Object.values(n).reduce((a, b) => a + b, 0)).toBe(3);
  });
});

describe("2 · anotar: la nota de avance (lead_note)", () => {
  it("con etapa, la nota es opcional y la etapa queda; quien anota queda como último contacto", () => {
    const r = aplicarNota(lead(), ana, "", ahora, "appointment");
    expect(r).toMatchObject({ ok: true, valor: { follow_up_action: "appointment", follow_up_note: null, last_by: "ana", last_by_name: "Ana", last_at: ahora, follow_up_at: ahora, status: "free", holder: null } });
  });
  it("sin etapa, la nota es obligatoria (vacía o solo espacios no vale)", () => {
    expect(aplicarNota(lead(), ana, "", ahora, null)).toEqual({ ok: false, motivo: "falta_nota" });
    expect(aplicarNota(lead(), ana, "   ", ahora, null)).toEqual({ ok: false, motivo: "falta_nota" });
  });
  it("sin etapa, la nota no cambia la etapa ni el estado ni el dueño (solo cuenta como último contacto)", () => {
    const venta = lead({ status: "won", holder: "beto", holder_name: "Beto", follow_up_action: "closed", taken_at: ahora });
    const r = aplicarNota(venta, ana, "Llamé al cliente", ahora, null);
    expect(r).toMatchObject({ ok: true, valor: { status: "won", holder: "beto", follow_up_action: "closed", follow_up_note: "Llamé al cliente", last_by: "ana" } });
  });
  it("cerrar (closed) es venta: won, a nombre de quien la anota; el dueño anterior se va", () => {
    const r = aplicarNota(lead({ follow_up_action: "negotiation" }), beto, "", ahora, "closed");
    expect(r).toMatchObject({ ok: true, valor: { status: "won", holder: "beto", holder_name: "Beto", follow_up_action: "closed" } });
  });
  it("cualquier otra etapa deja el lead libre y sin dueño, aunque antes fuera una venta (suya)", () => {
    const venta = lead({ status: "won", holder: "beto", holder_name: "Beto", follow_up_action: "closed" });
    for (const e of ["lost", "bad_lead", "quote", "no_answer"] as const) {
      expect(aplicarNota(venta, beto, "", ahora, e)).toMatchObject({ ok: true, valor: { status: "free", holder: null, holder_name: null, follow_up_action: e } });
    }
  });
  it("un perdido puede volver: cualquier nota nueva lo mueve otra vez", () => {
    const perdido = lead({ follow_up_action: "lost" });
    expect(aplicarNota(perdido, ana, "Nos llamó de nuevo", ahora, "made_contact")).toMatchObject({ ok: true, valor: { follow_up_action: "made_contact" } });
  });
  it("una etapa que no existe no vale; un lead archivado no recibe notas", () => {
    expect(aplicarNota(lead(), ana, "x", ahora, "released" as never)).toEqual({ ok: false, motivo: "dato_invalido" });
    expect(aplicarNota(lead({ status: "archived" }), ana, "x", ahora, "quote")).toEqual({ ok: false, motivo: "no_existe" });
  });
  it("la nota de más de 2000 caracteres no vale", () => {
    expect(aplicarNota(lead(), ana, "x".repeat(NOTA_MAX + 1), ahora, "quote")).toEqual({ ok: false, motivo: "dato_invalido" });
  });
  it("notaLimpia recorta, y una vacía o de más de 2000 no es nota", () => {
    expect(notaLimpia("  hola  ")).toBe("hola");
    expect(notaLimpia("   ")).toBeNull();
    expect(notaLimpia("x".repeat(NOTA_MAX + 1))).toBeNull();
  });
});

describe("3 · el banco: filtros, pools y orden", () => {
  const leads = [
    lead({ id: "a", pool: "RDZ Brownsville", follow_up_action: "quote", square_footage: 500 }),
    lead({ id: "b", pool: "RDZ Brownsville", category: "No sirve – cadena / franquicia", square_footage: 900 }),
    lead({ id: "c", pool: "RDZ Edinburg", follow_up_action: "closed", status: "won", holder: "beto", holder_name: "Beto", square_footage: 700 }),
    lead({ id: "d", pool: "RDZ Edinburg", status: "archived" }),
    lead({ id: "e", pool: POOL_SIN_TIENDA, category: "Might be useful", customer_match_id: 9, customer_match_note: "teléfono igual" }),
  ];

  it("lo archivado nunca se ve en el banco ni en las cuentas", () => {
    expect(vigentes(leads).map((l) => l.id)).toEqual(["a", "b", "c", "e"]);
    expect(filtrar(leads, TODAS).map((l) => l.id)).not.toContain("d");
  });
  it("la etapa es el filtro: una por etapa", () => {
    expect(filtrar(leads, { ...TODAS, etapa: "quote" }).map((l) => l.id)).toEqual(["a"]);
    expect(filtrar(leads, { ...TODAS, etapa: "closed" }).map((l) => l.id)).toEqual(["c"]);
    expect(filtrar(leads, { ...TODAS, etapa: "new" }).map((l) => l.id)).toEqual(["b", "e"]);
  });
  it("la categoría de entrada: «Sirve + podría servir» quita las que no sirven; «todas» las enseña", () => {
    expect(filtrar(leads, { ...TODAS, categoria: "utiles" }).map((l) => l.id)).not.toContain("b");
    expect(filtrar(leads, TODAS).map((l) => l.id)).toContain("b");
  });
  it("el chip «categoría buena» deja solo las que empiezan por «Sirve»", () => {
    expect(filtrar(leads, { ...TODAS, buena: true }).map((l) => l.id)).toEqual(["a", "c"]);
    expect(categoriaBuena("Sirve – usa piso")).toBe(true);
    expect(categoriaBuena("Might be useful")).toBe(false);
    expect(categoriaDescartada("No sirve – no lleva piso")).toBe(true);
  });
  it("«Coinciden con clientes» deja solo los cruzados", () => {
    expect(filtrar(leads, { ...TODAS, coinciden: true }).map((l) => l.id)).toEqual(["e"]);
  });
  it("la búsqueda no distingue acentos ni mayúsculas", () => {
    expect(filtrar(leads, { ...TODAS, busca: "OFICINAS" }).length).toBeGreaterThan(0);
    // La búsqueda mira también el nombre del pool: «edinburg» trae lo de Edinburg que está vigente (c), y nada más.
    expect(filtrar(leads, { ...TODAS, busca: "edinburg" }).map((l) => l.id)).toEqual(["c"]);
    expect(filtrar(leads, { ...TODAS, busca: "zzzz" }).map((l) => l.id)).toEqual([]);
  });
  it("pools con su cuenta de vigentes; el de «sin tienda» al final; «Todas las tiendas» suma", () => {
    const pools = poolsDe(leads);
    expect(pools.map((p) => [p.pool, p.total])).toEqual([["RDZ Brownsville", 2], ["RDZ Edinburg", 1], [POOL_SIN_TIENDA, 1]]);
    expect(resumenDeTodas(pools).total).toBe(4);
    expect(filtroDePool(POOL_TODAS)).toBeNull();
    expect(poolInicial(pools, "RDZ Edinburg")).toBe("RDZ Edinburg");
    expect(poolInicial(pools, "RDZ Nada")).toBe("RDZ Brownsville");
    expect(poolInicial(pools, "RDZ Edinburg", true)).toBe(POOL_TODAS);
  });
  it("orden: pies² (lo más grande primero), sin dato al final", () => {
    expect(ordenar([lead({ id: "x", square_footage: null }), lead({ id: "y", square_footage: 10 }), lead({ id: "z", square_footage: 99 })], "pies").map((l) => l.id)).toEqual(["z", "y", "x"]);
  });
  it("valores de los desplegables, sin repetir y en orden", () => {
    expect(valoresDe(leads, "site_city")).toEqual(["Brownsville"]);
  });
});

describe("4 · el tablero del admin", () => {
  const leads = [
    lead({ id: "a", pool: "RDZ Brownsville", follow_up_action: "quote", times_seen: 3 }),
    lead({ id: "b", pool: "RDZ Brownsville", follow_up_action: "closed", status: "won", holder: "beto", times_seen: 2 }),
    lead({ id: "c", pool: "RDZ Edinburg", status: "archived", times_seen: 2 }),
    lead({ id: "d", pool: "RDZ Edinburg", follow_up_action: "lost" }),
  ];
  const eventos: EventoLead[] = [
    { id: 1, lead_id: "a", at: ahora, kind: "progress", outcome: null, note: "Quote #1041", action: "quote", actor: "ana", actor_name: "Ana", subject: "ana", subject_name: "Ana" },
    { id: 2, lead_id: "a", at: ahora, kind: "progress", outcome: null, note: "Cita", action: "appointment", actor: "ana", actor_name: "Ana", subject: "ana", subject_name: "Ana" },
    { id: 3, lead_id: "b", at: ahora, kind: "progress", outcome: null, note: "Vendido", action: "closed", actor: "beto", actor_name: "Beto", subject: "beto", subject_name: "Beto" },
    { id: 4, lead_id: "d", at: ahora, kind: "closed", outcome: "sale", note: "vieja", actor: "beto", actor_name: "Beto", subject: "beto", subject_name: "Beto" },
    { id: 5, lead_id: "d", at: ahora, kind: "imported", outcome: null, note: null, actor: null, actor_name: null, subject: null, subject_name: null },
  ];

  it("por persona: notas, cotizaciones y ventas, de quien anotó (y las ventas viejas cuentan)", () => {
    const filas = tableroPorVendedor(eventos);
    expect(filas.find((f) => f.id === "ana")).toMatchObject({ notas: 2, cotizaciones: 1, ventas: 0 });
    expect(filas.find((f) => f.id === "beto")).toMatchObject({ notas: 1, cotizaciones: 0, ventas: 2 });
    expect(filas[0].id).toBe("beto");
  });
  it("por tienda: cuántos vigentes en cada etapa y cuántos han tenido alguna cotización en el historial", () => {
    const filas = tableroPorTienda(leads, eventos);
    const brownsville = filas.find((f) => f.pool === "RDZ Brownsville")!;
    expect(brownsville.porEtapa.quote).toBe(1);
    expect(brownsville.porEtapa.closed).toBe(1);
    expect(brownsville.cotizadosAlgunaVez).toBe(1);
    expect(brownsville.total).toBe(2);
    const edinburg = filas.find((f) => f.pool === "RDZ Edinburg")!;
    expect(edinburg.total).toBe(1);
    expect(edinburg.porEtapa.lost).toBe(1);
  });
  it("visto en más de una carga: cuántos vigentes; sin dato, una", () => {
    expect(cuantosVistosMasDeUna(leads)).toBe(2);
    expect(vecesVisto(lead({ times_seen: undefined }))).toBe(1);
  });
  it("el historial dice la etapa de la nota; un cierre viejo dice su resultado", () => {
    expect(eventoLabel(eventos[1], "en")).toBe("Had Appointment");
    expect(eventoLabel(eventos[3], "es")).toContain("Venta lograda");
    expect(eventoLabel(eventos[4], "en")).toBe("Imported");
  });
});

describe("5 · textos, enlaces y códigos de la base", () => {
  it("Google Maps con la dirección de la obra; sin dirección, nada", () => {
    expect(mapsUrl({ site_address: "100 Calle", site_city: "Brownsville", site_zip: "78520" })).toContain("100%20Calle");
    expect(mapsUrl({ site_address: null, site_city: null, site_zip: null })).toBeNull();
  });
  it("tel: con solo dígitos; con menos de 7, nada; a TDLR solo https", () => {
    expect(telUrl("+1 (956) 555-0101")).toBe("tel:+19565550101");
    expect(telUrl("555-01")).toBeNull();
    expect(enlaceSeguro("https://example.com/x")).toBe("https://example.com/x");
    expect(enlaceSeguro("http://example.com")).toBeNull();
  });
  it("las fechas no pasan por zonas horarias", () => {
    expect(fecha("2026-11-18T23:30:00Z")).toBe("11/18/2026");
    expect(fecha(null)).toBe("—");
  });
  it("los códigos de la base se traducen a su negativa", () => {
    expect(negativaDeCodigo("P0002")).toBe("no_existe");
    expect(negativaDeCodigo("42501")).toBe("sin_permiso");
    expect(negativaDeCodigo("LD005")).toBe("otra_tienda");
    expect(negativaDeCodigo("XX")).toBeNull();
    expect(negativaTexto("no_existe", "es")).toBe("Ese lead ya no existe.");
  });
  it("los estados tienen su texto", () => {
    expect(estadoLabel("archived", "en")).toBe("Archived");
  });
});

describe("328 · una venta cerrada es de quien la cerró", () => {
  const venta = { status: "won", holder: "a", follow_up_action: "closed" } as unknown as Parameters<typeof aplicarNota>[0];
  const p = (id: string, admin = false) => ({ id, name: id, admin }) as unknown as Parameters<typeof aplicarNota>[1];
  it("otra persona no le cambia la etapa, pero sí deja nota", () => {
    expect(aplicarNota(venta, p("b"), "", "2026-11-18T00:00:00Z", "lost")).toEqual({ ok: false, motivo: "sin_permiso" });
    expect(aplicarNota(venta, p("b"), "llamó de nuevo", "2026-11-18T00:00:00Z", null).ok).toBe(true);
  });
  it("quien la cerró y el admin sí", () => {
    expect(aplicarNota(venta, p("a"), "", "2026-11-18T00:00:00Z", "lost").ok).toBe(true);
    expect(aplicarNota(venta, p("c", true), "", "2026-11-18T00:00:00Z", "negotiation").ok).toBe(true);
  });
});
