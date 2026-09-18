import { describe, expect, it } from "vitest";
import { cacheEnMemoria } from "@/lib/route-times/tiempos";
import type { ProveedorDeTiempos } from "@/lib/route-times/proveedores";
import { planificaElDia } from "./borrador";
import { aplicaMovimiento, esUnaRuta, estadoDeParadas, movimientoValido, revalida, type EstadoDelPlan } from "./ajuste";
import type { DatosDelDia } from "./entrada";

/** Ajustar a mano un borrador (D-323): qué movimientos valen, y que tras moverlo se REVALIDA con lo guardado. */

const P = (orden: string) => ({ orden, tipo: "P" as const });
const D = (orden: string) => ({ orden, tipo: "D" as const });
const estado = (secuencias: EstadoDelPlan["secuencias"], fijadas: string[] = []): EstadoDelPlan => ({ secuencias, fijadas });
const CHOFERES = ["c1", "c2", "c3"];

describe("qué es una ruta", () => {
  it("cada orden se recoge antes de entregarse, con el mismo chofer, una vez cada cosa", () => {
    expect(esUnaRuta({ c1: [P("a"), P("b"), D("b"), D("a")], c2: [] })).toBe(true);
    expect(esUnaRuta({ c1: [D("a"), P("a")] })).toBe(false);                 // entrega antes de recoger
    expect(esUnaRuta({ c1: [P("a")], c2: [D("a")] })).toBe(false);           // repartida entre dos choferes
    expect(esUnaRuta({ c1: [P("a")], c2: [P("z"), D("z"), D("a")] })).toBe(false);   // …aunque la entrega caiga «después» en la otra ruta
    expect(esUnaRuta({ c1: [P("a")] })).toBe(false);                         // recogida sin entrega
    expect(esUnaRuta({ c1: [D("a")] })).toBe(false);                         // entrega sin recogida
    expect(esUnaRuta({ c1: [P("a"), P("a"), D("a")] })).toBe(false);         // dos recogidas
    expect(esUnaRuta({ c1: [P("a"), D("a"), D("a")] })).toBe(false);         // dos entregas
  });
});

describe("el movimiento que manda el cliente se comprueba campo a campo", () => {
  it("los cinco que existen pasan, limpios de campos de más", () => {
    expect(movimientoValido({ tipo: "sube", chofer: "c1", indice: 2, extra: 1 })).toEqual({ tipo: "sube", chofer: "c1", indice: 2 });
    expect(movimientoValido({ tipo: "baja", chofer: "c1", indice: 0 })).toEqual({ tipo: "baja", chofer: "c1", indice: 0 });
    expect(movimientoValido({ tipo: "a_chofer", chofer: "c2", orden: "a#b", secuencias: {} })).toEqual({ tipo: "a_chofer", chofer: "c2", orden: "a#b" });
    expect(movimientoValido({ tipo: "fija", orden: "a" })).toEqual({ tipo: "fija", orden: "a" });
    expect(movimientoValido({ tipo: "suelta", orden: "a" })).toEqual({ tipo: "suelta", orden: "a" });
  });

  it("lo demás es null: un tipo inventado, campos que faltan o no son lo que dicen, textos kilométricos", () => {
    const malos: unknown[] = [null, "sube", 7, {}, { tipo: "borra", orden: "a" }, { tipo: "sube", chofer: "c1" }, { tipo: "sube", chofer: "c1", indice: "2" },
      { tipo: "sube", chofer: "c1", indice: 1.5 }, { tipo: "baja", indice: 1 }, { tipo: "a_chofer", chofer: "c2" }, { tipo: "a_chofer", orden: "a" },
      { tipo: "fija" }, { tipo: "fija", orden: "" }, { tipo: "fija", orden: 5 }, { tipo: "fija", orden: "x".repeat(81) }];
    expect(malos.map(movimientoValido)).toEqual(malos.map(() => null));
  });
});

describe("los movimientos", () => {
  const base = estado({ c1: [P("a"), P("b"), D("a"), D("b")], c2: [P("z"), D("z")] });

  it("subir y bajar cambian una parada con su vecina, y la orden movida queda fijada", () => {
    expect(aplicaMovimiento(base, { tipo: "baja", chofer: "c1", indice: 2 }, CHOFERES)).toEqual(estado({ c1: [P("a"), P("b"), D("b"), D("a")], c2: [P("z"), D("z")] }, ["a"]));
    expect(aplicaMovimiento(base, { tipo: "sube", chofer: "c1", indice: 1 }, CHOFERES)).toEqual(estado({ c1: [P("b"), P("a"), D("a"), D("b")], c2: [P("z"), D("z")] }, ["b"]));
  });

  it("lo que no es una ruta se RECHAZA: entregar antes de recoger — y el estado de entrada no se toca", () => {
    expect(aplicaMovimiento(base, { tipo: "sube", chofer: "c1", indice: 2 }, CHOFERES)).toEqual(estado({ c1: [P("a"), D("a"), P("b"), D("b")], c2: [P("z"), D("z")] }, ["a"]));
    const pegadas = estado({ c1: [P("a"), D("a")] });
    expect(aplicaMovimiento(pegadas, { tipo: "sube", chofer: "c1", indice: 1 }, CHOFERES)).toEqual({ error: "entrega_antes_de_recoger" });
    expect(aplicaMovimiento(pegadas, { tipo: "baja", chofer: "c1", indice: 0 }, CHOFERES)).toEqual({ error: "entrega_antes_de_recoger" });
    expect(pegadas).toEqual(estado({ c1: [P("a"), D("a")] }));
  });

  it("los bordes, y lo que no existe", () => {
    expect(aplicaMovimiento(base, { tipo: "sube", chofer: "c1", indice: 0 }, CHOFERES)).toEqual({ error: "en_el_borde" });
    expect(aplicaMovimiento(base, { tipo: "baja", chofer: "c1", indice: 3 }, CHOFERES)).toEqual({ error: "en_el_borde" });
    expect(aplicaMovimiento(base, { tipo: "baja", chofer: "c1", indice: 4 }, CHOFERES)).toEqual({ error: "parada_desconocida" });
    expect(aplicaMovimiento(base, { tipo: "baja", chofer: "c1", indice: -1 }, CHOFERES)).toEqual({ error: "parada_desconocida" });
    expect(aplicaMovimiento(base, { tipo: "baja", chofer: "c1", indice: 0.5 }, CHOFERES)).toEqual({ error: "parada_desconocida" });
    expect(aplicaMovimiento(base, { tipo: "baja", chofer: "nadie", indice: 0 }, CHOFERES)).toEqual({ error: "chofer_desconocido" });
    expect(aplicaMovimiento(base, { tipo: "a_chofer", orden: "a", chofer: "nadie" }, CHOFERES)).toEqual({ error: "chofer_desconocido" });
    expect(aplicaMovimiento(base, { tipo: "a_chofer", orden: "nada", chofer: "c2" }, CHOFERES)).toEqual({ error: "orden_desconocida" });
    expect(aplicaMovimiento(base, { tipo: "a_chofer", orden: "a", chofer: "c1" }, CHOFERES)).toEqual({ error: "ya_esta_ahi" });
    expect(aplicaMovimiento(base, { tipo: "fija", orden: "nada" }, CHOFERES)).toEqual({ error: "orden_desconocida" });
  });

  it("pasar una orden a otro chofer: sale ENTERA de uno y entra al final del otro, recoger y entregar — también a uno sin paradas", () => {
    expect(aplicaMovimiento(base, { tipo: "a_chofer", orden: "a", chofer: "c2" }, CHOFERES)).toEqual(estado({ c1: [P("b"), D("b")], c2: [P("z"), D("z"), P("a"), D("a")] }, ["a"]));
    expect(aplicaMovimiento(base, { tipo: "a_chofer", orden: "z", chofer: "c3" }, CHOFERES)).toEqual(estado({ c1: base.secuencias.c1, c2: [], c3: [P("z"), D("z")] }, ["z"]));
  });

  it("fijar y soltar no mueven nada", () => {
    const fijada = aplicaMovimiento(base, { tipo: "fija", orden: "b" }, CHOFERES);
    expect(fijada).toEqual(estado(base.secuencias, ["b"]));
    expect(aplicaMovimiento(fijada as EstadoDelPlan, { tipo: "suelta", orden: "b" }, CHOFERES)).toEqual(base);
    expect(aplicaMovimiento(estado(base.secuencias, ["a", "b"]), { tipo: "fija", orden: "a" }, CHOFERES)).toEqual(estado(base.secuencias, ["a", "b"]));
  });

  it("de las filas guardadas al estado: por chofer, en orden de `seq`, con lo fijado — y sin las paradas huérfanas", () => {
    const fila = (driver_id: string | null, seq: number, kind: "P" | "D", order_ref: string, pinned = false) => ({ driver_id: driver_id as string, seq, kind, order_ref, pinned });
    expect(estadoDeParadas([fila("c1", 1, "D", "a", true), fila("c2", 0, "P", "z"), fila("c1", 0, "P", "a", true), fila(null, 0, "P", "h"), fila("c2", 1, "D", "z")]))
      .toEqual(estado({ c1: [P("a"), D("a")], c2: [P("z"), D("z")] }, ["a"]));
  });
});

// ---------------------------------------------------------------------------------------------------------------
const AHORA = "2026-03-02T12:00:00.000Z";
const proveedor = (conTrafico: boolean): ProveedorDeTiempos => ({
  nombre: "google", conTrafico,
  async matriz(origenes, destinos) { return origenes.map(() => destinos.map(() => ({ minutos: 10, millas: 5 }))); },
  async tramo() { return { minutos: 14, millas: 5 }; },
});
const datos = (choferes = ["c1", "c2"], ajustes: Partial<DatosDelDia["settings"]> = {}): DatosDelDia => ({
  ordenes: ["a", "b"].map((id, k) => ({
    id, stage: "approved", order_code: id.toUpperCase(), order_type: "ACliente", store: "Tienda Norte", pickup_name: null, delivery_name: null,
    delivery_lat: 26.35 + k / 100, delivery_lng: -98.25, delivery_windows: k === 0 ? "0830-1000" : "0830-1730", est_pallets: 2, actual_pallets: null, pickup_duration: "8 min",
    delivery_duration: k === 0 ? "10 min" : "90 min", assigned_driver: null, input_date: "2026-03-03", input_time: `090${k}`, account: null, customer_type: null,
    is_training: false, updated_at: `2026-03-03T15:00:0${k}.000000+00:00`,
  })),
  choferes: [{ id: "c1", full_name: "Chofer Uno", role: "driver" as const }, { id: "c2", full_name: "Chofer Dos", role: "driver" as const }].filter((c) => choferes.includes(c.id)),
  ajustesDeChofer: choferes.map((profile_id) => ({ profile_id, base_store: "Tienda Norte", capacity_pallets: 10, shift_start: "08:00", shift_end: "17:30", returns_to_base: true, routable: true })),
  settings: { stores: [{ name: "Tienda Norte", address: "1 Calle", lat: 26.3, lng: -98.2 }], order_type_rules: { ACliente: { storeToStore: false } }, route_hard_windows: ["0830-1000"], ...ajustes },
});

describe("revalidar: las secuencias de la persona, con la matriz y el tráfico GUARDADOS", () => {
  const tiendas = datos().settings.stores!;

  it("sin mover nada, revalidar devuelve las MISMAS paradas y los mismos totales que guardó el motor", async () => {
    const b = await planificaElDia(datos(), "2026-03-04", "America/Chicago", { cache: cacheEnMemoria(), proveedores: [proveedor(true)], ahoraISO: AHORA });
    const r = revalida(b.plan, estadoDeParadas(b.paradas), "plan-padre", tiendas);
    expect(b.paradas.length).toBeGreaterThan(0);
    expect(r.paradas).toEqual(b.paradas);
    expect([r.plan.total_minutes, r.plan.total_miles, r.plan.late_minutes, r.plan.writes]).toEqual([b.plan.total_minutes, b.plan.total_miles, b.plan.late_minutes, b.plan.writes]);
    expect([r.violaciones, r.tramosSinTrafico]).toEqual([[], 0]);
  });

  it("revalida con los parámetros con que se HIZO el plan —los pesos del dueño—, no con los de por defecto", async () => {
    const deps = () => ({ cache: cacheEnMemoria(), proveedores: [proveedor(false)], ahoraISO: AHORA });
    const suyo = await planificaElDia(datos(["c1"], { route_weights: { millas: 40, manejo: 7 } }), "2026-03-04", "America/Chicago", deps());
    const porDefecto = await planificaElDia(datos(["c1"]), "2026-03-04", "America/Chicago", deps());
    expect(suyo.plan.result.coste.total).not.toBe(porDefecto.plan.result.coste.total);      // los datos distinguen
    expect(revalida(suyo.plan, estadoDeParadas(suyo.paradas), "p", tiendas).plan.result.coste).toEqual(suyo.plan.result.coste);
  });

  it("el plan ajustado es un plan NUEVO, hijo del anterior, con la misma foto — y lo que el motor dejó fuera sigue contando", async () => {
    const d = datos();
    const conUnaSinPunto = { ...d, ordenes: [...d.ordenes, { ...d.ordenes[1], id: "sin-pin", delivery_lat: null, delivery_lng: null }] };
    const b = await planificaElDia(conUnaSinPunto, "2026-03-04", "America/Chicago", { cache: cacheEnMemoria(), proveedores: [proveedor(false)], ahoraISO: AHORA });
    expect(b.plan.unassigned_count).toBe(1);
    const r = revalida(b.plan, estadoDeParadas(b.paradas), "plan-padre", tiendas);
    expect([r.plan.source, r.plan.parent_plan_id, r.plan.plan_date, r.plan.algorithm_version]).toEqual(["manual_edit", "plan-padre", "2026-03-04", b.plan.algorithm_version]);
    expect(r.plan.input).toBe(b.plan.input);
    expect(r.plan.unassigned_count).toBe(b.plan.unassigned_count);
    expect([r.plan.provider, r.plan.traffic, r.plan.result.sinAsignar, r.plan.result.partes]).toEqual([b.plan.provider, false, b.plan.result.sinAsignar, b.plan.result.partes]);
  });

  it("un ajuste que rompe una ventana dura se GUARDA, con su aviso: advierte, no bloquea", async () => {
    const b = await planificaElDia(datos(), "2026-03-04", "America/Chicago", { cache: cacheEnMemoria(), proveedores: [proveedor(false)], ahoraISO: AHORA });
    const antes = estadoDeParadas(b.paradas);
    const chofer = Object.keys(antes.secuencias).find((c) => antes.secuencias[c].some((p) => p.orden === "a"))!;
    // «a» tiene ventana dura hasta las 10:00 y «b» tarda 90 min en entregarse. A mano: todo lo de «b» por delante.
    const despues = estado({ ...antes.secuencias, [chofer]: [...antes.secuencias[chofer].filter((p) => p.orden !== "a"), P("a"), D("a")] }, ["a"]);
    expect(esUnaRuta(despues.secuencias)).toBe(true);
    const r = revalida(b.plan, despues, "plan-padre", tiendas);
    expect(r.violaciones.map((v) => [v.tipo, v.orden])).toEqual([["ventana_estrecha", "a"]]);
    expect(r.plan.result.violaciones).toEqual(r.violaciones);
    expect(r.plan.late_minutes).toBeGreaterThan(0);
    expect(r.paradas.filter((p) => p.order_ref === "a").map((p) => p.pinned)).toEqual([true, true]);
    expect(r.paradas.filter((p) => p.order_ref !== "a").every((p) => !p.pinned)).toBe(true);
    expect(r.plan.result.fijadas).toEqual(["a"]);
  });

  it("pasar una orden a otro chofer cambia lo que publicar escribirá", async () => {
    const b = await planificaElDia(datos(), "2026-03-04", "America/Chicago", { cache: cacheEnMemoria(), proveedores: [proveedor(false)], ahoraISO: AHORA });
    const antes = estadoDeParadas(b.paradas);
    const de = Object.keys(antes.secuencias).find((c) => antes.secuencias[c].some((p) => p.orden === "b"))!;
    const a = de === "c1" ? "c2" : "c1";
    const movido = aplicaMovimiento(antes, { tipo: "a_chofer", orden: "b", chofer: a }, ["c1", "c2"]) as EstadoDelPlan;
    const r = revalida(b.plan, movido, "plan-padre", tiendas);
    expect(r.plan.writes.find((w) => w.id === "b")?.assigned_driver).toBe(a === "c1" ? "Chofer Uno" : "Chofer Dos");
    expect(b.plan.writes.find((w) => w.id === "b")?.assigned_driver).toBe(de === "c1" ? "Chofer Uno" : "Chofer Dos");
    expect(r.paradas.filter((p) => p.order_ref === "b").map((p) => p.driver_id)).toEqual([a, a]);
  });

  it("con un plan hecho con tráfico, cuenta los tramos nuevos que NO tienen tráfico guardado; sin tráfico, no cuenta nada", async () => {
    const conTrafico = await planificaElDia(datos(["c1"]), "2026-03-04", "America/Chicago", { cache: cacheEnMemoria(), proveedores: [proveedor(true)], ahoraISO: AHORA });
    expect(conTrafico.plan.traffic).toBe(true);
    const antes = estadoDeParadas(conTrafico.paradas);
    const chofer = Object.keys(antes.secuencias).find((c) => antes.secuencias[c].length === 4)!;
    expect(chofer).toBeDefined();
    const alReves = estado({ ...antes.secuencias, [chofer]: [P("b"), P("a"), D("b"), D("a")] });
    expect(revalida(conTrafico.plan, alReves, "p", tiendas).tramosSinTrafico).toBeGreaterThan(0);
    const sin = await planificaElDia(datos(["c1"]), "2026-03-04", "America/Chicago", { cache: cacheEnMemoria(), proveedores: [proveedor(false)], ahoraISO: AHORA });
    const e = estadoDeParadas(sin.paradas);
    const c = Object.keys(e.secuencias).find((x) => e.secuencias[x].length === 4)!;
    expect(revalida(sin.plan, estado({ ...e.secuencias, [c]: [P("b"), P("a"), D("b"), D("a")] }), "p", tiendas).tramosSinTrafico).toBe(0);
  });
});
