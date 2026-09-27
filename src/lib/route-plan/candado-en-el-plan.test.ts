import { describe, expect, it } from "vitest";
import { planifica } from "@/lib/route-engine";
import { entradaDelDia, puntoDeOrden, puntoDeTienda, type DatosDelDia } from "./entrada";
import { avisosAlPublicar, choferesConRutaBloqueada, escriturasAlPublicar, type PlanParaAvisar } from "./publicar";
import type { DriverSettings, NamedLocation } from "@/lib/types";

/**
 * 🔒 «Planificar el día» respeta las rutas bloqueadas (149, D-NEXT): el chofer bloqueado no entra al motor, sus órdenes
 * quedan fuera del plan tal como están, publicar no las escribe, y al chofer no se le avisa «te quedaste sin paradas».
 * Tiendas y choferes inventados.
 */

const tiendas: NamedLocation[] = [
  { name: "Tienda Norte", address: "1 Calle", lat: 26.3, lng: -98.2 },
  { name: "Tienda Sur", address: "2 Calle", lat: 26.1, lng: -98.2 },
];
const settings: DatosDelDia["settings"] = { stores: tiendas, accounts: [], order_type_rules: { ACliente: { storeToStore: false } }, route_buckets: ["Ruta Extra"], default_truck_capacity: 12 };
const fila = (profile_id: string, base_store: string): DriverSettings =>
  ({ profile_id, base_store, capacity_pallets: 10, shift_start: "08:00", shift_end: "17:30", returns_to_base: true, routable: true });
const choferes = [
  { id: "c-norte", full_name: "Chofer Norte", role: "driver" as const },
  { id: "c-sur", full_name: "Chofer Sur", role: "driver" as const },
];
type O = DatosDelDia["ordenes"][number];
const orden = (id: string, extra: Partial<O> = {}): O => ({
  id, stage: "approved", order_code: id.toUpperCase(), order_type: "ACliente", store: "Tienda Norte", pickup_name: null, delivery_name: null,
  delivery_lat: 26.35, delivery_lng: -98.25, delivery_windows: "0830-1730", est_pallets: 2, actual_pallets: null, pickup_duration: "10 min",
  delivery_duration: "10 min", assigned_driver: null, input_date: "2026-03-03", input_time: "915", account: null, customer_type: null,
  is_training: false, updated_at: "2026-03-03T15:00:00+00:00", ...extra,
});
const datos = (ordenes: O[], extra: Partial<DatosDelDia> = {}): DatosDelDia =>
  ({ ordenes, choferes, ajustesDeChofer: [fila("c-norte", "Tienda Norte"), fila("c-sur", "Tienda Sur")], settings, ...extra });
const matrizDe = (e: ReturnType<typeof entradaDelDia>) => {
  const p = [puntoDeTienda("Tienda Norte"), puntoDeTienda("Tienda Sur"), ...e.entrada.ordenes.map((o) => puntoDeOrden(o.id))];
  return Object.fromEntries(p.map((x) => [x, Object.fromEntries(p.filter((y) => y !== x).map((y) => [y, { minutos: 10, millas: 5 }]))]));
};

describe("«Planificar el día» con una ruta bloqueada", () => {
  const ordenes = [
    orden("suya", { assigned_driver: "Chofer Norte" }),           // la puso una persona en la ruta bloqueada
    orden("libre-1"), orden("libre-2"),                           // sin chofer: el motor las reparte
    orden("de-sur", { assigned_driver: "Chofer Sur" }),            // de otra ruta, sin candado
  ];

  it("el chofer bloqueado no entra al motor, y se dice por qué", () => {
    const e = entradaDelDia(datos(ordenes, { bloqueadas: ["chofer norte "] }));
    expect(e.entrada.choferes.map((c) => c.id)).toEqual(["c-sur"]);
    expect(e.choferesFuera).toEqual([{ id: "c-norte", nombre: "Chofer Norte", motivo: "ruta_bloqueada" }]);
  });

  it("sus órdenes quedan FUERA del plan, tal como están; las demás entran como siempre", () => {
    const e = entradaDelDia(datos(ordenes, { bloqueadas: ["Chofer Norte"] }));
    expect(e.fuera).toEqual([{ id: "suya", motivo: "en_ruta_bloqueada" }]);
    expect(e.entrada.ordenes.map((o) => o.id)).toEqual(["libre-1", "libre-2", "de-sur"]);
    // Aunque la hubiera puesto el motor en el último publicado (antes era «libre»): con candado, se queda.
    const puestaPorElMotor = entradaDelDia(datos(ordenes, { bloqueadas: ["Chofer Norte"], publicadoAntes: [{ id: "suya", assigned_driver: "Chofer Norte" }] }));
    expect(puestaPorElMotor.fuera).toEqual([{ id: "suya", motivo: "en_ruta_bloqueada" }]);
  });

  it("lo fijado a mano en el borrador anterior para el chofer bloqueado no se arrastra", () => {
    const e = entradaDelDia(datos(ordenes, { bloqueadas: ["Chofer Norte"], fijadas: { "c-norte": [{ orden: "libre-1", tipo: "P" }, { orden: "libre-1", tipo: "D" }] } }));
    expect(e.entrada.secuenciaFijada).toBeUndefined();
  });

  it("publicar ese plan no escribe NADA en la ruta bloqueada: ni sus órdenes, ni órdenes nuevas para ella", () => {
    const e = entradaDelDia(datos(ordenes, { bloqueadas: ["Chofer Norte"] }));
    const plan = planifica({ ...e.entrada, matriz: matrizDe(e) }, e.parametros);
    const escrituras = escriturasAlPublicar(plan, e.entrada.choferes);
    expect(escrituras.map((w) => w.id).sort()).toEqual(["de-sur", "libre-1", "libre-2"]);
    expect(escrituras.every((w) => w.assigned_driver === "Chofer Sur")).toBe(true);
  });

  it("sin candados, el mismo día se planifica como antes (el chofer Norte entra y se lleva lo suyo)", () => {
    const e = entradaDelDia(datos(ordenes));
    expect(e.entrada.choferes.map((c) => c.id)).toEqual(["c-norte", "c-sur"]);
    expect(e.fuera).toEqual([]);
    expect(e.entrada.ordenes.find((o) => o.id === "suya")?.choferFijado).toBe("c-norte");
  });

  it("un candado sobre una ruta temporal no cambia nada: ya era un carril manual", () => {
    const e = entradaDelDia(datos([orden("en-extra", { assigned_driver: "Ruta Extra" })], { bloqueadas: ["Ruta Extra"] }));
    expect(e.fuera).toEqual([{ id: "en-extra", motivo: "en_un_carril_manual" }]);
    expect(e.entrada.choferes).toHaveLength(2);
  });
});

describe("al publicar, al chofer bloqueado no se le dice «te quedaste sin paradas»", () => {
  const ruta = (chofer: string, n: number) => ({ chofer, paradas: Array.from({ length: n }, (_, k) => ({ tipo: "D" as const, orden: `${chofer}-${k}`, llegada: 480 + k })) });
  const antes: PlanParaAvisar = { rutas: [ruta("c-norte", 2), ruta("c-sur", 2)] };
  const ahora: PlanParaAvisar = { rutas: [ruta("c-sur", 2)] };

  it("sin candado, sí (ese es el aviso de siempre)", () => {
    expect(avisosAlPublicar(ahora, antes).map((a) => [a.chofer, a.motivo])).toEqual([["c-norte", "sin_ruta"]]);
  });
  it("con su ruta bloqueada, no", () => {
    expect(avisosAlPublicar(ahora, antes, new Set(["c-norte"]))).toEqual([]);
  });
  it("quién tiene la ruta bloqueada sale del propio plan (`choferesFuera`), y lo raro se ignora", () => {
    expect(choferesConRutaBloqueada([{ id: "c-norte", nombre: "Chofer Norte", motivo: "ruta_bloqueada" }, { id: "c-x", nombre: "X", motivo: "no_disponible" }]))
      .toEqual(new Set(["c-norte"]));
    expect(choferesConRutaBloqueada(null)).toEqual(new Set());
    expect(choferesConRutaBloqueada([null, 3, { motivo: "ruta_bloqueada" }])).toEqual(new Set());
  });
});
