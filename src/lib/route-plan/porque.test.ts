import { describe, expect, it } from "vitest";
import type { Desglose, Explicacion } from "@/lib/route-engine";
import { cacheEnMemoria } from "@/lib/route-times/tiempos";
import type { ProveedorDeTiempos } from "@/lib/route-times/proveedores";
import { planificaElDia, resumenDelPlan } from "./borrador";
import { aplicaMovimiento, estadoDeParadas, revalida, type EstadoDelPlan } from "./ajuste";
import { fueraConPorque, porQueDelPlan, porQueEstaAqui } from "./porque";
import type { DatosDelDia } from "./entrada";

/** «¿Por qué está aquí?» y «¿por qué se quedó fuera?» (D-NEXT). Las cuentas son del motor; aquí se elige qué decir. */

const d = (total: number, extra: Partial<Desglose> = {}): Desglose => ({ builder: 0, manejoMin: 0, millas: 0, tardeMin: 0, balanceMin: 0, total, ...extra });
const CHOFERES = [{ id: "c1", nombre: "Uno" }, { id: "c2", nombre: "Dos" }, { id: "c3", nombre: "Tres" }, { id: "c4", nombre: "Cuatro" }];

describe("por qué está aquí", () => {
  const e: Explicacion = {
    orden: "a", chofer: "c1", aporta: d(900, { manejoMin: 18, millas: 7.256, tardeMin: 4 }),
    alternativas: [
      { chofer: "c4", diferencia: null, motivo: "capacidad" },
      { chofer: "c3", diferencia: d(700, { manejoMin: 25, millas: 11.004, tardeMin: 12, builder: 30 }) },
      { chofer: "c2", diferencia: d(120, { manejoMin: 6, millas: 2.5 }) },
    ],
  };

  it("lo que aporta, y los demás choferes del que MENOS empeora al que más; al final, con los que no se puede", () => {
    const q = porQueEstaAqui([e], CHOFERES, { a: "c1" }).a;
    expect(q).toEqual({
      orden: "a", quien: "motor", aporta: { manejoMin: 18, millas: 7.26, tardeMin: 4 },
      otras: [
        { choferId: "c2", chofer: "Dos", noPuede: null, masManejoMin: 6, masMillas: 2.5, masTardeMin: 0, masBuilderMin: 0 },
        { choferId: "c3", chofer: "Tres", noPuede: null, masManejoMin: 25, masMillas: 11, masTardeMin: 12, masBuilderMin: 30 },
        { choferId: "c4", chofer: "Cuatro", noPuede: "capacidad", masManejoMin: 0, masMillas: 0, masTardeMin: 0, masBuilderMin: 0 },
      ],
    });
  });

  it("el orden lo decide el TOTAL ponderado, no los minutos: los pesos del dueño mandan", () => {
    const pocosMinutosPeroCaro: Explicacion = { ...e, alternativas: [{ chofer: "c2", diferencia: d(500, { manejoMin: 1 }) }, { chofer: "c3", diferencia: d(50, { manejoMin: 40 }) }] };
    expect(porQueEstaAqui([pocosMinutosPeroCaro], CHOFERES, { a: "c1" }).a.otras.map((o) => o.choferId)).toEqual(["c3", "c2"]);
  });

  it("sin motivo escrito, «no se puede» sigue siendo no se puede", () => {
    const sinMotivo: Explicacion = { ...e, alternativas: [{ chofer: "c2", diferencia: null }] };
    expect(porQueEstaAqui([sinMotivo], CHOFERES, { a: "c1" }).a.otras[0].noPuede).toBe("no_permitido");
  });

  it("si una persona la fijó, o ya no va con quien decía el motor, NO se enseñan cuentas que describen otro plan", () => {
    const persona = { orden: "a", quien: "persona", aporta: null, otras: [] };
    expect(porQueEstaAqui([e], CHOFERES, { a: "c1" }, ["a"]).a).toEqual(persona);          // fijada
    expect(porQueEstaAqui([e], CHOFERES, { a: "c2" }).a).toEqual(persona);                  // movida a otro chofer
    expect(porQueEstaAqui([], CHOFERES, { nueva: "c1" }).nueva).toEqual({ ...persona, orden: "nueva" });   // el motor no dijo nada de ella
    expect(porQueEstaAqui(null, CHOFERES, {})).toEqual({});
  });

  it("de una orden que ya no está en ninguna ruta no se dice nada", () => {
    expect(porQueEstaAqui([e], CHOFERES, {})).toEqual({});
  });

  it("desde lo guardado: dónde está cada orden sale de las paradas, y las huérfanas no cuentan", () => {
    const paradas = [{ driver_id: "c1", order_ref: "a" }, { driver_id: null, order_ref: "h" }];
    expect(Object.keys(porQueDelPlan({ explicaciones: [e] }, CHOFERES, paradas))).toEqual(["a"]);
    expect(porQueDelPlan({ explicaciones: [e], fijadas: ["a"] }, CHOFERES, paradas).a.quien).toBe("persona");
    expect(porQueDelPlan(null, null, paradas).a.quien).toBe("persona");
  });
});

describe("por qué se quedó fuera, y qué se puede hacer", () => {
  it("lo que el motor no pudo asignar y lo que ni le llegó, juntos, una fila por ORDEN y en orden estable", () => {
    expect(fueraConPorque(
      [{ orden: "z#b", motivo: "supera_capacidad" }, { orden: "z#a", motivo: "supera_capacidad" }, { orden: "m", motivo: "sin_punto" }],
      [{ id: "b", motivo: "en_un_carril_manual" }, { id: "k", motivo: "chofer_no_rutea" }],
    )).toEqual([
      { id: "b", orden: "b", motivo: "en_un_carril_manual", remedio: "quitar_del_carril", laDejoFuera: "entrada" },
      { id: "k", orden: "k", motivo: "chofer_no_rutea", remedio: "cambiar_chofer_fijado", laDejoFuera: "entrada" },
      { id: "m", orden: "m", motivo: "sin_punto", remedio: "poner_pin", laDejoFuera: "motor" },
      { id: "z", orden: "z#b", motivo: "supera_capacidad", remedio: "partir_o_camion_mayor", laDejoFuera: "motor" },
    ]);
  });

  it("cada motivo del motor tiene su siguiente paso; uno desconocido no rompe nada", () => {
    const motivos = ["sin_punto", "sin_chofer_disponible", "supera_capacidad", "ventana_imposible", "retraso_sobre_el_tope", "fuera_de_turno", "chofer_fijado_sin_hueco", "no_cabe_con_el_resto"];
    expect(fueraConPorque(motivos.map((motivo, k) => ({ orden: `o${k}`, motivo })), []).map((f) => f.remedio)).toEqual(
      ["poner_pin", "revisar_choferes", "partir_o_camion_mayor", "cambiar_ventana", "cambiar_ventana", "otro_dia_o_mas_choferes", "cambiar_chofer_fijado", "otro_dia_o_mas_choferes"]);
    expect(fueraConPorque([{ orden: "x", motivo: "algo_nuevo" }], null)[0].remedio).toBe("ninguno");
    expect(fueraConPorque(null, null)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------------------------
const AHORA = "2026-03-02T12:00:00.000Z";
const proveedor: ProveedorDeTiempos = {
  nombre: "osrm", conTrafico: false,
  async matriz(os, ds) { return os.map(() => ds.map(() => ({ minutos: 10, millas: 5 }))); },
  async tramo() { return { minutos: 10, millas: 5 }; },
};
const datos = (): DatosDelDia => ({
  ordenes: ["a", "b", "sin-pin"].map((id, k) => ({
    id, stage: "approved", order_code: id.toUpperCase(), order_type: "ACliente", store: "Tienda Norte", pickup_name: null, delivery_name: null,
    delivery_lat: id === "sin-pin" ? null : 26.35 + k / 100, delivery_lng: id === "sin-pin" ? null : -98.25, delivery_windows: "0830-1730", est_pallets: 2, actual_pallets: null,
    pickup_duration: "8 min", delivery_duration: "10 min", assigned_driver: null, input_date: "2026-03-03", input_time: `090${k}`, account: null, customer_type: null,
    is_training: false, updated_at: `2026-03-03T15:00:0${k}.000000+00:00`,
  })),
  choferes: [{ id: "c1", full_name: "Chofer Uno", role: "driver" as const }, { id: "c2", full_name: "Chofer Dos", role: "driver" as const }],
  ajustesDeChofer: ["c1", "c2"].map((profile_id) => ({ profile_id, base_store: "Tienda Norte", capacity_pallets: 10, shift_start: "08:00", shift_end: "17:30", returns_to_base: true, routable: true })),
  settings: { stores: [{ name: "Tienda Norte", address: "1 Calle", lat: 26.3, lng: -98.2 }], order_type_rules: { ACliente: { storeToStore: false } } },
});

describe("con un plan de verdad, salido del motor", () => {
  it("cada orden asignada trae su porqué con el OTRO chofer, y la que quedó fuera sale con su remedio en el resumen", async () => {
    const b = await planificaElDia(datos(), "2026-03-04", "America/Chicago", { cache: cacheEnMemoria(), proveedores: [proveedor], ahoraISO: AHORA });
    const q = porQueDelPlan(b.plan.result, b.plan.input.entrada.choferes, b.paradas);
    expect(Object.keys(q).sort()).toEqual(["a", "b"]);
    for (const orden of ["a", "b"]) {
      const suChofer = b.paradas.find((p) => p.order_ref === orden)!.driver_id;
      expect(q[orden].quien).toBe("motor");
      expect(q[orden].otras.map((o) => o.choferId)).toEqual([suChofer === "c1" ? "c2" : "c1"]);
      expect(q[orden].otras[0].chofer).toBe(suChofer === "c1" ? "Chofer Dos" : "Chofer Uno");
    }
    expect(resumenDelPlan(b.plan, b.paradas.length).fueraConPorque).toEqual([{ id: "sin-pin", orden: "sin-pin", motivo: "sin_punto", remedio: "poner_pin", laDejoFuera: "motor" }]);
  });

  it("tras moverla a mano, esa orden pasa a «la puso una persona»; las que nadie tocó conservan sus cuentas", async () => {
    const b = await planificaElDia(datos(), "2026-03-04", "America/Chicago", { cache: cacheEnMemoria(), proveedores: [proveedor], ahoraISO: AHORA });
    const antes = estadoDeParadas(b.paradas);
    const de = Object.keys(antes.secuencias).find((c) => antes.secuencias[c].some((p) => p.orden === "b"))!;
    const movido = aplicaMovimiento(antes, { tipo: "a_chofer", orden: "b", chofer: de === "c1" ? "c2" : "c1" }, ["c1", "c2"]) as EstadoDelPlan;
    const r = revalida(b.plan, movido, "padre", datos().settings.stores!);
    const q = porQueDelPlan(r.plan.result, r.plan.input.entrada.choferes, r.paradas);
    expect([q.a.quien, q.b.quien]).toEqual(["motor", "persona"]);
    expect(q.b.otras).toEqual([]);
  });
});
