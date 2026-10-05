import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  abiertosDe, aplicarCerrar, aplicarNota, aplicarTomar, bloqueado, categoriaDescartada, colaDeRevision, consecuencia, delExcel,
  destinoAlCerrar, enlaceSeguro, fecha, filtrar, mapsUrl, negativaDeCodigo, notaLimpia, ordenar, poolInicial, poolsDe, puedeTomar,
  puestosLibres, RESULTADOS, sinTocar, tableroPorVendedor, telUrl, TOPE_POR_DEFECTO, veContacto, ventasDe, POOL_SIN_TIENDA,
  type EventoLead, type Filtros, type Lead, type Persona,
} from "./reglas";
import { almacenDemo, leadsDemo, PERSONAS_DEMO } from "./demo";
import { faltaLaTabla, leadDeLaBase } from "./almacen";

/**
 * Las reglas de «Leads» (migración 162), sin navegador y sin base: el tope de 10, tomar y soltar, y quién ve qué.
 * Todos los datos son inventados.
 */
const ANA: Persona = { id: "ana", name: "Ana", store: "RDZ Brownsville", admin: false };
const BETO: Persona = { id: "beto", name: "Beto", store: "RDZ Edinburg", admin: false };
const JEFE: Persona = { id: "jefe", name: "Jefe", store: null, admin: true };
const AHORA = "2026-10-04T15:00:00.000Z";

let serie = 0;
function lead(parcial: Partial<Lead> = {}): Lead {
  serie++;
  return {
    id: `l${serie}`, tabs_project: `T${String(serie).padStart(4, "0")}`, pool: "RDZ Brownsville", distance_miles: 5,
    category: "Sirve – usa piso", project_type: "Oficinas / suites", reason: null, county: "Cameron", registered_date: "2026-09-01",
    project_name: `Proyecto ${serie}`, facility_name: null, type_of_work: "New Construction", scope_of_work: null,
    square_footage: 1000, estimated_cost: 100000, est_start_date: null, est_completion_date: null, permit_status: null,
    site_address: "1 Calle Inventada", site_city: "Brownsville", site_zip: "78520", owner_name: "Dueño Inventado",
    owner_phone: "(956) 555-0100", owner_contact: null, tenant_name: null, tenant_phone: null, design_firm_name: null,
    design_firm_phone: null, tdlr_link: null, status: "free", holder: null, holder_name: null, taken_at: null, touched_at: null,
    follow_up_note: null, follow_up_at: null, last_outcome: null, last_note: null, last_by: null, last_by_name: null, last_at: null,
    ...parcial,
  };
}
const tomado = (p: Persona, parcial: Partial<Lead> = {}) => lead({ status: "taken", holder: p.id, holder_name: p.name, taken_at: AHORA, touched_at: AHORA, ...parcial });
const nTomados = (p: Persona, n: number) => Array.from({ length: n }, () => tomado(p));

describe("1 · el tope de 10", () => {
  it("el tope por defecto es 10", () => {
    expect(TOPE_POR_DEFECTO).toBe(10);
  });
  it("con 9 abiertos toma el décimo; con 10, el 11.º se rechaza por «lleno»", () => {
    const libre = lead();
    expect(puedeTomar(libre, [...nTomados(ANA, 9), libre], ANA.id, 10)).toEqual({ ok: true });
    expect(puedeTomar(libre, [...nTomados(ANA, 10), libre], ANA.id, 10)).toEqual({ ok: false, motivo: "lleno" });
  });
  it("el tope es por persona: los 10 de Ana no le quitan puestos a Beto", () => {
    const libre = lead();
    expect(puedeTomar(libre, [...nTomados(ANA, 10), libre], BETO.id, 10)).toEqual({ ok: true });
  });
  it("una venta lograda es suya pero NO ocupa puesto", () => {
    const venta = lead({ status: "won", holder: ANA.id, holder_name: ANA.name });
    const todos = [...nTomados(ANA, 9), venta];
    expect(abiertosDe(todos, ANA.id)).toHaveLength(9);
    expect(ventasDe(todos, ANA.id)).toEqual([venta]);
    expect(puestosLibres(todos, ANA.id, 10)).toBe(1);
  });
  it("si el admin baja el tope por debajo de lo que tiene, le quedan 0 puestos, no un número negativo", () => {
    expect(puestosLibres(nTomados(ANA, 6), ANA.id, 3)).toBe(0);
    expect(puedeTomar(lead(), nTomados(ANA, 6), ANA.id, 3)).toEqual({ ok: false, motivo: "lleno" });
  });
});

describe("2 · tomar", () => {
  it("solo se toma lo LIBRE: ni lo tomado, ni una venta, ni lo que está en revisión, ni lo archivado", () => {
    for (const status of ["taken", "won", "review", "archived"] as const) {
      const l = lead({ status, holder: status === "taken" || status === "won" ? BETO.id : null });
      expect(puedeTomar(l, [l], ANA.id, 10), status).toEqual({ ok: false, motivo: "no_libre" });
    }
  });
  it("tomar lo pone a tu nombre, con la hora, y limpia la nota de avance del anterior", () => {
    const l = lead({ follow_up_note: "vieja", follow_up_at: "2026-01-01T00:00:00Z" });
    const r = aplicarTomar(l, [l], ANA, 10, AHORA);
    expect(r.ok && r.valor).toMatchObject({ status: "taken", holder: "ana", holder_name: "Ana", taken_at: AHORA, touched_at: AHORA, follow_up_note: null });
  });
  it("A toma; B ya no puede tomar el mismo", () => {
    const l = lead();
    const a = aplicarTomar(l, [l], ANA, 10, AHORA);
    expect(a.ok).toBe(true);
    if (!a.ok) return;
    expect(aplicarTomar(a.valor, [a.valor], BETO, 10, AHORA)).toEqual({ ok: false, motivo: "no_libre" });
  });
  it("tomar NO borra la etiqueta con la que volvió al banco: el siguiente la sigue leyendo", () => {
    const l = lead({ last_outcome: "reassign", last_note: "Queda en Weslaco", last_by: ANA.id, last_by_name: "Ana", last_at: AHORA });
    const r = aplicarTomar(l, [l], BETO, 10, AHORA);
    expect(r.ok && r.valor).toMatchObject({ holder: "beto", last_outcome: "reassign", last_note: "Queda en Weslaco", last_by_name: "Ana" });
  });
});

describe("3 · cerrar con resultado y nota", () => {
  it("los cinco resultados, y «visitado» no es uno de ellos", () => {
    expect([...RESULTADOS]).toEqual(["sale", "bad_lead", "nothing", "review", "reassign"]);
  });
  it("venta lograda: queda SUYO y fuera del banco", () => {
    expect(destinoAlCerrar("sale")).toEqual({ estado: "won", conservaDueno: true });
    const r = aplicarCerrar(tomado(ANA), ANA, "sale", "Vendido", AHORA);
    expect(r.ok && r.valor).toMatchObject({ status: "won", holder: "ana", holder_name: "Ana", last_outcome: "sale", last_note: "Vendido" });
  });
  it("ocupa revisión: a la cola del admin, sin dueño", () => {
    expect(destinoAlCerrar("review")).toEqual({ estado: "review", conservaDueno: false });
    const r = aplicarCerrar(tomado(ANA), ANA, "review", "Teléfono equivocado", AHORA);
    expect(r.ok && r.valor).toMatchObject({ status: "review", holder: null, holder_name: null, last_outcome: "review" });
  });
  it("no es buen lead, no se logró nada y mejor reasignarlo: vuelven al banco con la etiqueta, la nota y quién la puso", () => {
    for (const res of ["bad_lead", "nothing", "reassign"] as const) {
      expect(destinoAlCerrar(res), res).toEqual({ estado: "free", conservaDueno: false });
      const r = aplicarCerrar(tomado(ANA, { follow_up_note: "avance" }), ANA, res, "  la nota  ", AHORA);
      expect(r.ok && r.valor, res).toMatchObject({
        status: "free", holder: null, holder_name: null, taken_at: null, follow_up_note: null,
        last_outcome: res, last_note: "la nota", last_by: "ana", last_by_name: "Ana", last_at: AHORA,
      });
    }
  });
  it("sin nota no se cierra: ni vacía, ni solo espacios, ni de más de 2000", () => {
    const l = tomado(ANA);
    expect(aplicarCerrar(l, ANA, "sale", "", AHORA)).toEqual({ ok: false, motivo: "falta_nota" });
    expect(aplicarCerrar(l, ANA, "nothing", "   ", AHORA)).toEqual({ ok: false, motivo: "falta_nota" });
    expect(notaLimpia("x".repeat(2001))).toBeNull();
    expect(notaLimpia("")).toBeNull();
    expect(notaLimpia("   ")).toBeNull();
    expect(notaLimpia(null)).toBeNull();
    expect(notaLimpia("  ok ")).toBe("ok");
  });
  it("solo quien lo tiene ABIERTO lo cierra: ni otra persona, ni el mismo dos veces", () => {
    const l = tomado(ANA);
    expect(aplicarCerrar(l, BETO, "sale", "mío", AHORA)).toEqual({ ok: false, motivo: "no_es_tuyo" });
    const r = aplicarCerrar(l, ANA, "nothing", "nada", AHORA);
    expect(r.ok).toBe(true);
    if (r.ok) expect(aplicarCerrar(r.valor, ANA, "nothing", "otra vez", AHORA)).toEqual({ ok: false, motivo: "no_es_tuyo" });
  });
  it("cerrar libera el puesto: con 10 no toma; cierra uno (cualquier resultado) y toma", () => {
    for (const res of RESULTADOS) {
      const diez = nTomados(ANA, 10);
      const libre = lead();
      expect(puedeTomar(libre, [...diez, libre], ANA.id, 10).ok, res).toBe(false);
      const c = aplicarCerrar(diez[0], ANA, res, "nota", AHORA);
      expect(c.ok, res).toBe(true);
      if (!c.ok) continue;
      expect(puedeTomar(libre, [c.valor, ...diez.slice(1), libre], ANA.id, 10), res).toEqual({ ok: true });
    }
  });
  it("lo que se dice antes de cerrar sale del mismo destino", () => {
    expect(consecuencia("sale", "es")).toMatch(/Se queda contigo/);
    expect(consecuencia("review", "es")).toMatch(/cola del admin/);
    expect(consecuencia("nothing", "es")).toMatch(/Vuelve al banco/);
    expect(consecuencia("bad_lead", "en")).toMatch(/back to the bank/);
  });
});

describe("4 · la nota de avance («visitado – en seguimiento»)", () => {
  it("deja el lead abierto, a su nombre, con la nota: NO libera puesto", () => {
    const diez = nTomados(ANA, 10);
    const r = aplicarNota(diez[0], ANA, " Visité la obra ", AHORA);
    expect(r.ok && r.valor).toMatchObject({ status: "taken", holder: "ana", follow_up_note: "Visité la obra", follow_up_at: AHORA, touched_at: AHORA });
    if (!r.ok) return;
    const libre = lead();
    expect(puedeTomar(libre, [r.valor, ...diez.slice(1), libre], ANA.id, 10)).toEqual({ ok: false, motivo: "lleno" });
  });
  it("sin texto no vale, y solo sobre lo tuyo", () => {
    expect(aplicarNota(tomado(ANA), ANA, " ", AHORA)).toEqual({ ok: false, motivo: "falta_nota" });
    expect(aplicarNota(tomado(ANA), BETO, "x", AHORA)).toEqual({ ok: false, motivo: "no_es_tuyo" });
    expect(aplicarNota(lead(), ANA, "x", AHORA)).toEqual({ ok: false, motivo: "no_es_tuyo" });
  });
});

describe("5 · quién ve qué", () => {
  it("el contacto se enseña si el lead está libre, si es tuyo o si eres admin; de lo de otro, no", () => {
    expect(veContacto(lead(), ANA)).toBe(true);
    expect(veContacto(tomado(ANA), ANA)).toBe(true);
    expect(veContacto(tomado(BETO), ANA)).toBe(false);
    expect(veContacto(lead({ status: "won", holder: BETO.id }), ANA)).toBe(false);
    expect(veContacto(lead({ status: "review" }), ANA)).toBe(false);
    expect(veContacto(lead({ status: "archived" }), ANA)).toBe(false);
    expect(veContacto(tomado(BETO), JEFE)).toBe(true);
    expect(veContacto(lead({ status: "review" }), JEFE)).toBe(true);
  });
  it("apagado y bloqueado: todo lo que no está libre ni es tuyo — también para el admin, que lo ve pero no lo toma", () => {
    expect(bloqueado(lead(), ANA)).toBe(false);
    expect(bloqueado(tomado(ANA), ANA)).toBe(false);
    expect(bloqueado(tomado(BETO), ANA)).toBe(true);
    expect(bloqueado(lead({ status: "review" }), ANA)).toBe(true);
    expect(bloqueado(tomado(BETO), JEFE)).toBe(true);
  });
});

describe("6 · el banco: pools, vistas, filtros y orden", () => {
  const F: Filtros = { pool: "RDZ Brownsville", vista: "libres", categoria: "utiles", tipo: "", ciudad: "", busca: "" };
  const a = lead({ project_name: "Clínica Árbol", distance_miles: 9, estimated_cost: 500, registered_date: "2026-01-01" });
  const b = tomado(BETO, { distance_miles: 2, estimated_cost: 900, registered_date: "2026-03-01" });
  const c = lead({ pool: "RDZ Edinburg", site_city: "Edinburg", distance_miles: 1 });
  const d = lead({ category: "No sirve – cadena / franquicia", distance_miles: null, estimated_cost: null, registered_date: null });
  const e = lead({ project_type: "Hotel", site_city: "Los Fresnos", distance_miles: 4, estimated_cost: 100, registered_date: "2026-06-01" });
  const todos = [a, b, c, d, e];

  it("«libres» es solo lo que se puede tomar; «todas» trae también lo tomado", () => {
    expect(filtrar(todos, F).map((l) => l.id)).toEqual([a.id, e.id]);
    expect(filtrar(todos, { ...F, vista: "todas" }).map((l) => l.id)).toEqual([a.id, b.id, e.id]);
  });
  it("cada pool trae solo lo suyo", () => {
    expect(filtrar(todos, { ...F, pool: "RDZ Edinburg" }).map((l) => l.id)).toEqual([c.id]);
  });
  it("de entrada no salen las categorías «No sirve»; con «todas» sí; y se puede pedir una sola", () => {
    expect(categoriaDescartada("No sirve – no lleva piso")).toBe(true);
    expect(categoriaDescartada("Might be useful")).toBe(false);
    expect(filtrar(todos, { ...F, categoria: "todas" }).map((l) => l.id)).toEqual([a.id, d.id, e.id]);
    expect(filtrar(todos, { ...F, categoria: "No sirve – cadena / franquicia" }).map((l) => l.id)).toEqual([d.id]);
  });
  it("tipo de proyecto, ciudad y búsqueda (sin acentos ni mayúsculas)", () => {
    expect(filtrar(todos, { ...F, tipo: "Hotel" }).map((l) => l.id)).toEqual([e.id]);
    expect(filtrar(todos, { ...F, ciudad: "Los Fresnos" }).map((l) => l.id)).toEqual([e.id]);
    expect(filtrar(todos, { ...F, busca: "clinica ARBOL" }).map((l) => l.id)).toEqual([a.id]);
    expect(filtrar(todos, { ...F, busca: a.tabs_project.toLowerCase() }).map((l) => l.id)).toEqual([a.id]);
  });
  it("orden: distancia (cerca primero), costo (alto primero), fecha (nuevo primero); sin dato, al final", () => {
    const lista = [a, b, d, e];
    expect(ordenar(lista, "distancia").map((l) => l.id)).toEqual([b.id, e.id, a.id, d.id]);
    expect(ordenar(lista, "costo").map((l) => l.id)).toEqual([b.id, a.id, e.id, d.id]);
    expect(ordenar(lista, "fecha").map((l) => l.id)).toEqual([e.id, b.id, a.id, d.id]);
    expect(lista.map((l) => l.id)).toEqual([a.id, b.id, d.id, e.id]);
  });
  it("los pools con sus cuentas, el de «sin tienda» al final; y se entra en el de tu tienda", () => {
    const sin = lead({ pool: POOL_SIN_TIENDA });
    const ps = poolsDe([sin, ...todos]);
    expect(ps.map((p) => p.pool)).toEqual(["RDZ Brownsville", "RDZ Edinburg", POOL_SIN_TIENDA]);
    expect(ps[0]).toEqual({ pool: "RDZ Brownsville", libres: 3, tomados: 1, total: 4 });
    expect(poolInicial(ps, "RDZ Edinburg")).toBe("RDZ Edinburg");
    expect(poolInicial(ps, "RDZ Mission")).toBe("RDZ Brownsville");
    expect(poolInicial(ps, null)).toBe("RDZ Brownsville");
    expect(poolInicial([], "RDZ Edinburg")).toBeNull();
  });
});

describe("7 · el tablero del admin", () => {
  const ev = (parcial: Partial<EventoLead>): EventoLead => ({ id: ++serie, lead_id: "x", at: AHORA, kind: "closed", outcome: "nothing", note: "n", actor: ANA.id, actor_name: "Ana", subject: ANA.id, subject_name: "Ana", ...parcial });
  it("por vendedor: abiertos de los leads; cerrados y ventas del historial", () => {
    // La venta de Ana es suya, pero no está abierta: no cuenta en «abiertos».
    const leads = [tomado(ANA), tomado(ANA), tomado(BETO), lead(), lead({ status: "won", holder: ANA.id, holder_name: "Ana" })];
    const eventos = [ev({}), ev({ outcome: "sale" }), ev({ outcome: "sale", subject: BETO.id, subject_name: "Beto" }), ev({ kind: "taken", outcome: null })];
    expect(tableroPorVendedor(leads, eventos)).toEqual([
      { id: "ana", nombre: "Ana", abiertos: 2, cerrados: 2, ventas: 1 },
      { id: "beto", nombre: "Beto", abiertos: 1, cerrados: 1, ventas: 1 },
    ]);
  });
  it("sin tocar hace N días: solo lo TOMADO, contando desde la última nota; lo más viejo primero", () => {
    const ahora = new Date("2026-10-04T12:00:00Z");
    const viejo = tomado(ANA, { touched_at: "2026-09-01T12:00:00Z" });
    const justo = tomado(ANA, { touched_at: "2026-09-27T12:00:00Z" });
    const reciente = tomado(ANA, { touched_at: "2026-10-01T12:00:00Z" });
    const libreViejo = lead({ touched_at: "2026-01-01T00:00:00Z" });
    expect(sinTocar([reciente, justo, viejo, libreViejo], 7, ahora).map((l) => l.id)).toEqual([viejo.id, justo.id]);
    expect(sinTocar([reciente, justo, viejo], 30, ahora).map((l) => l.id)).toEqual([viejo.id]);
  });
  it("la cola de revisión: solo lo que está en revisión, lo más antiguo primero", () => {
    const r1 = lead({ status: "review", last_at: "2026-10-02T00:00:00Z" });
    const r2 = lead({ status: "review", last_at: "2026-10-01T00:00:00Z" });
    expect(colaDeRevision([r1, lead(), r2, tomado(ANA)]).map((l) => l.id)).toEqual([r2.id, r1.id]);
  });
});

describe("8 · enlaces y textos", () => {
  it("Google Maps con la dirección de la obra; sin dirección, nada", () => {
    expect(mapsUrl({ site_address: "1 Calle Inventada", site_city: "Brownsville", site_zip: "78520" }))
      .toBe("https://www.google.com/maps/search/?api=1&query=1%20Calle%20Inventada%2C%20Brownsville%2C%20TX%2C%2078520");
    expect(mapsUrl({ site_address: null, site_city: null, site_zip: "78520" })).toBeNull();
  });
  it("tel: con solo dígitos; con menos de 7, nada", () => {
    expect(telUrl("(956) 555-0100")).toBe("tel:9565550100");
    expect(telUrl("+1 956 555 0100")).toBe("tel:+19565550100");
    expect(telUrl("ext 12")).toBeNull();
    expect(telUrl(null)).toBeNull();
  });
  it("a TDLR solo se enlaza si es https", () => {
    expect(enlaceSeguro("https://example.com/x")).toBe("https://example.com/x");
    expect(enlaceSeguro("javascript:alert(1)")).toBeNull();
    expect(enlaceSeguro("http://example.com")).toBeNull();
  });
  it("las fechas no pasan por zonas horarias; las categorías del Excel se traducen", () => {
    expect(fecha("2026-09-16")).toBe("09/16/2026");
    expect(fecha("2026-09-16T23:59:00Z")).toBe("09/16/2026");
    expect(fecha(null)).toBe("—");
    expect(delExcel("Sirve – usa piso", "en")).toBe("Useful – uses flooring");
    expect(delExcel("Sirve – usa piso", "es")).toBe("Sirve – usa piso");
    expect(delExcel("Algo nuevo", "en")).toBe("Algo nuevo");
  });
  it("los códigos de la 162 se traducen a su negativa", () => {
    expect(negativaDeCodigo("LD001")).toBe("lleno");
    expect(negativaDeCodigo("LD002")).toBe("no_libre");
    expect(negativaDeCodigo("LD003")).toBe("falta_nota");
    expect(negativaDeCodigo("LD004")).toBe("no_es_tuyo");
    expect(negativaDeCodigo("42501")).toBe("sin_permiso");
    expect(negativaDeCodigo("XX000")).toBeNull();
  });
});

describe("9 · el demo se comporta como la base", () => {
  const [ana, beto, admin] = PERSONAS_DEMO;
  it("los datos del demo son inventados: teléfonos 555-01xx, TABS «DEMO», enlaces a example.com", () => {
    for (const l of leadsDemo()) {
      expect(l.tabs_project).toMatch(/^DEMO/);
      expect(l.owner_phone).toMatch(/555-01\d\d/);
      expect(l.tdlr_link).toMatch(/^https:\/\/example\.com\//);
      expect(l.owner_name).toMatch(/Demo/);
    }
  });
  it("Ana (9 abiertos) toma uno, y el 11.º se le rechaza por «lleno»; Beto no puede tomar el de Ana", async () => {
    let yo = ana;
    const a = almacenDemo(() => yo);
    const r0 = await a.leer();
    if (!r0.ok) throw new Error("no lee");
    expect(abiertosDe(r0.valor.leads, ana.id)).toHaveLength(9);
    const libres = r0.valor.leads.filter((l) => l.status === "free");
    const t1 = await a.tomar(libres[0].id);
    expect(t1.ok && t1.valor.holder).toBe(ana.id);
    const t2 = await a.tomar(libres[1].id);
    expect(t2).toMatchObject({ ok: false, motivo: "lleno" });
    yo = beto;
    expect(await a.tomar(libres[0].id)).toMatchObject({ ok: false, motivo: "no_libre" });
    expect(await a.cerrar(libres[0].id, "sale", "mío")).toMatchObject({ ok: false, motivo: "no_es_tuyo" });
    yo = ana;
    expect(await a.cerrar(libres[0].id, "nothing", " ")).toMatchObject({ ok: false, motivo: "falta_nota" });
    const c = await a.cerrar(libres[0].id, "nothing", "No contestan");
    expect(c.ok && c.valor).toMatchObject({ status: "free", holder: null, last_outcome: "nothing", last_by_name: ana.name });
    const t3 = await a.tomar(libres[1].id);
    expect(t3.ok).toBe(true);
    const h = await a.historial(libres[0].id);
    expect(h.ok && h.valor.map((e) => e.kind)).toEqual(["taken", "closed"]);
  });
  it("lo del admin es solo del admin", async () => {
    let yo = ana;
    const a = almacenDemo(() => yo);
    const r0 = await a.leer();
    if (!r0.ok) throw new Error("no lee");
    const deAna = abiertosDe(r0.valor.leads, ana.id)[0];
    expect(await a.liberar(deAna.id, "x")).toMatchObject({ ok: false, motivo: "sin_permiso" });
    expect(await a.asignar(deAna.id, beto.id, "")).toMatchObject({ ok: false, motivo: "sin_permiso" });
    expect(await a.archivar(deAna.id, "")).toMatchObject({ ok: false, motivo: "sin_permiso" });
    expect(await a.ponerTope(50)).toMatchObject({ ok: false, motivo: "sin_permiso" });
    yo = admin;
    const lib = await a.liberar(deAna.id, "Corregido");
    expect(lib.ok && lib.valor).toMatchObject({ status: "free", holder: null, last_outcome: "admin", last_note: "Corregido" });
    const asg = await a.asignar(deAna.id, beto.id, "");
    expect(asg.ok && asg.valor).toMatchObject({ status: "taken", holder: beto.id });
    expect(await a.ponerTope(3)).toEqual({ ok: true, valor: 3 });
    expect(await a.ponerTope(0)).toMatchObject({ ok: false, motivo: "dato_invalido" });
  });
});

describe("10 · lo que llega de la base", () => {
  it("numeric como texto o como número; un estado desconocido no se ofrece", () => {
    const l = leadDeLaBase({ id: "x", tabs_project: "T", pool: "P", distance_miles: "2.6", estimated_cost: 350000, status: "raro", last_outcome: "otro" });
    expect(l).toMatchObject({ distance_miles: 2.6, estimated_cost: 350000, status: "archived", last_outcome: null, holder: null });
  });
  it("«falta la 162» son solo esos cuatro códigos", () => {
    for (const code of ["PGRST205", "PGRST202", "42P01", "42883"]) expect(faltaLaTabla({ code })).toBe(true);
    expect(faltaLaTabla({ code: "42501" })).toBe(false);
    expect(faltaLaTabla(null)).toBe(false);
  });
});

describe("11 · la pantalla usa las reglas probadas", () => {
  const p = readFileSync("src/app/leads/Leads.tsx", "utf8").split("\r\n").join("\n");
  it("el botón «Tomar» obedece a puedeTomar con el tope leído de la base", () => {
    expect(p).toContain("puede={puedeTomar(l, leads, yo.id, tope)}");
    expect(p).toContain("disabled={ocupado || !puede.ok}");
    expect(p).toContain("setTope(r.valor.tope);");
    expect(p).toContain("{donde !== \"mio\" && l.status === \"free\" && (");
  });
  it("el banco se pinta filtrado y ordenado por las funciones, con «libres» y «sirve» de entrada, y en el pool de su tienda", () => {
    expect(p).toContain("ordenar(filtrar(leads, { pool, vista, categoria, tipo, ciudad, busca }), orden)");
    expect(p).toContain('useState<Vista>("libres")');
    expect(p).toContain('useState<FiltroCategoria>("utiles")');
    expect(p).toContain('useState<Orden>("distancia")');
    expect(p).toContain("poolInicial(pools, tienda)");
    expect(p).toContain("const tienda = yo?.store ?? null;");
  });
  it("mi pool son mis abiertos y mis ventas, y la cuenta de la pestaña es abiertos/tope", () => {
    expect(p).toContain("const mios = abiertosDe(leads, yo.id);");
    expect(p).toContain("const misVentas = ventasDe(leads, yo.id);");
    expect(p).toContain("{mios.length}/{tope}");
    expect(p).toContain("const libres = puestosLibres(leads, yo.id, tope);");
  });
  it("la tarjeta apaga lo bloqueado y esconde el contacto con las dos reglas", () => {
    expect(p).toContain('const apagado = donde !== "admin" && bloqueado(l, yo);');
    expect(p).toContain("const contacto = veContacto(l, yo);");
    expect(p).toContain('className={`ld-tarjeta${apagado ? " apagado" : ""}`}');
    expect(p).toContain("{contacto ? (");
  });
  it("cerrar y anotar exigen la nota antes de dejar pulsar, y van por el almacén", () => {
    expect(p).toContain("const notaOk = notaLimpia(nota) !== null;");
    expect(p).toContain("disabled={enviando || !notaOk || !resultado}");
    expect(p).toContain("disabled={enviando || !notaOk}");
    expect(p).toContain("almacen.cerrar(l.id, resultado, nota)");
    expect(p).toContain("almacen.anotar(l.id, nota)");
    expect(p).toContain("almacen.tomar(l.id)");
    expect(p).toContain("{RESULTADOS.map((r) => (");
  });
  it("lo que se pinta tras una acción es lo que devolvió la base; un rechazo se dice y se relee", () => {
    expect(p).toContain("setLeads((prev) => prev.map((l) => (l.id === r.valor.id ? r.valor : l)));");
    expect(p).toContain("r.motivo ? negativaTexto(r.motivo, lang)");
    expect(p).toMatch(/negativaTexto\(r\.motivo, lang\)[^\n]*\n\s+void cargar\(\);/);
  });
  it("lo del admin solo se pinta al admin, y usa la cola, el tablero y los sin tocar", () => {
    expect(p).toContain('{pestana === "admin" && yo.admin && (');
    expect(p).toContain("{yo.admin && <button type=\"button\" className=\"btn btn-ghost btn-sm\" data-admin-lead");
    expect(p).toContain("const cola = colaDeRevision(leads);");
    expect(p).toContain("const vendedores = tableroPorVendedor(leads, cierres);");
    expect(p).toContain("const viejos = sinTocar(leads, dias, new Date());");
    expect(p).toContain("poolsDe(leads).map((p) =>");
  });
  it("sin la 162 lo dice, tiene cómo volver al hub, y los enlaces son maps, tel y TDLR", () => {
    expect(p).toContain('r.sinTabla ? { tipo: "sinTabla" }');
    expect(p).toContain("migration 162 is not applied");
    expect(p).toMatch(/<Link href="\/home"/);
    expect(p).toContain("const mapa = mapsUrl(l);");
    expect(p).toContain("href={telUrl(l.owner_phone)!}");
    expect(p).toContain("const tdlr = enlaceSeguro(l.tdlr_link);");
  });
});
