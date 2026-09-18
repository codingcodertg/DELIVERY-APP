import { describe, expect, it } from "vitest";
import { planifica, PARAMETROS_POR_DEFECTO } from "@/lib/route-engine";
import { entradaDelDia, filasDeParadas, puntoDeOrden, puntoDeTienda, type DatosDelDia } from "./entrada";
import { escriturasAlPublicar } from "./publicar";
import type { DriverSettings, NamedLocation } from "@/lib/types";

/** De la base al motor y de vuelta (D-320). Tiendas, choferes, cuentas y tipos de orden inventados. */

const tiendas: NamedLocation[] = [
  { name: "Tienda Norte", address: "1 Calle", lat: 26.3, lng: -98.2 },
  { name: "Tienda Sur", address: "2 Calle", lat: 26.1, lng: -98.2 },
  { name: "Tienda Sin Punto", address: "3 Calle" },
];
const settings: DatosDelDia["settings"] = {
  stores: tiendas, accounts: [{ name: "Constructora Uno", contact: "", phone: "", customer_type: "builder" }],
  order_type_rules: { ACliente: { storeToStore: false }, EntreTiendas: { storeToStore: true } },
  route_buckets: ["Ruta Extra"], default_truck_capacity: 12,
};
const fila = (profile_id: string, base_store: string | null, extra: Partial<DriverSettings> = {}): DriverSettings =>
  ({ profile_id, base_store, capacity_pallets: 10, shift_start: "08:00", shift_end: "17:30", returns_to_base: true, routable: true, ...extra });
const choferes = [
  { id: "c-norte", full_name: "Chofer Norte", role: "driver" as const },
  { id: "c-sur", full_name: "Chofer Sur", role: "driver" as const },
  { id: "c-sin-base", full_name: "Chofer Sin Base", role: "driver" as const },
  { id: "c-apagado", full_name: "Chofer Apagado", role: "driver" as const },
  { id: "no-chofer", full_name: "Una Vendedora", role: "sales" as const },
];
const ajustesDeChofer = [fila("c-norte", "Tienda Norte"), fila("c-sur", "tienda sur"), fila("c-apagado", "Tienda Norte", { routable: false })];

type O = DatosDelDia["ordenes"][number];
const orden = (id: string, extra: Partial<O> = {}): O => ({
  id, stage: "approved", order_code: id.toUpperCase(), order_type: "ACliente", store: "Tienda Norte", pickup_name: null, delivery_name: null,
  delivery_lat: 26.35, delivery_lng: -98.25, delivery_windows: "0830-1730", est_pallets: 2.5, actual_pallets: null, pickup_duration: "10 min",
  delivery_duration: "13 min", assigned_driver: null, input_date: "2026-03-03", input_time: "915", account: null, customer_type: null,
  is_training: false, updated_at: "2026-03-03T15:00:00.123456+00:00", ...extra,
});
const datos = (ordenes: O[], extra: Partial<DatosDelDia> = {}): DatosDelDia => ({ ordenes, choferes, ajustesDeChofer, settings, ...extra });

describe("los choferes que entran al motor", () => {
  it("solo quien rutea y tiene por base una tienda con punto; de los demás se dice por qué no", () => {
    const e = entradaDelDia(datos([]));
    expect(e.entrada.choferes).toEqual([
      { id: "c-norte", nombre: "Chofer Norte", base: puntoDeTienda("Tienda Norte"), capacidad: 10, entrada: 480, salida: 1050, vuelveABase: true },
      { id: "c-sur", nombre: "Chofer Sur", base: puntoDeTienda("Tienda Sur"), capacidad: 10, entrada: 480, salida: 1050, vuelveABase: true },
    ]);
    expect(e.choferesFuera).toEqual([
      { id: "c-sin-base", nombre: "Chofer Sin Base", motivo: "base" },
      { id: "c-apagado", nombre: "Chofer Apagado", motivo: "no_rutea" },
    ]);
    expect(e.puntos[puntoDeTienda("Tienda Sur")]).toEqual({ lat: 26.1, lng: -98.2 });
  });

  it("una base sin punto en el mapa, o quien ese día no está, tampoco", () => {
    const sinPunto = entradaDelDia(datos([], { ajustesDeChofer: [fila("c-norte", "Tienda Sin Punto")] }));
    expect(sinPunto.choferesFuera.find((c) => c.id === "c-norte")?.motivo).toBe("base_sin_punto");
    const deVacaciones = entradaDelDia(datos([], { noDisponibles: ["chofer norte "] }));
    expect(deVacaciones.entrada.choferes.map((c) => c.id)).toEqual(["c-sur"]);
    expect(deVacaciones.choferesFuera.find((c) => c.id === "c-norte")?.motivo).toBe("no_disponible");
  });
});

describe("las órdenes que entran al motor", () => {
  it("cada campo, de donde sale", () => {
    const e = entradaDelDia(datos([orden("a", { account: "constructora uno", delivery_windows: "0830-1200", actual_pallets: 3.25 })]));
    expect(e.entrada.ordenes).toEqual([{
      id: "a", codigo: "A", entrada: "2026-03-03 0915", origen: puntoDeTienda("Tienda Norte"), destino: puntoDeOrden("a"), pallets: 3.25,
      ventana: [510, 720], estrecha: true, builder: true, servicioRecogidaMin: 10, servicioEntregaMin: 13, choferFijado: null,
    }]);
    expect(e.puntos[puntoDeOrden("a")]).toEqual({ lat: 26.35, lng: -98.25 });
    expect(e.fotos).toEqual([{ id: "a", updated_at: "2026-03-03T15:00:00.123456+00:00" }]);
    expect(e.parametros).toEqual(PARAMETROS_POR_DEFECTO);
  });

  it("lo que alguien eligió en la orden manda sobre la cuenta; una ventana ancha no es dura", () => {
    const [o] = entradaDelDia(datos([orden("a", { account: "Constructora Uno", customer_type: "counter_sale" })])).entrada.ordenes;
    expect([o.builder, o.estrecha, o.ventana]).toEqual([false, false, [510, 1050]]);
  });

  it("la foto guarda `updated_at` TAL CUAL lo da la base, con sus microsegundos", () => {
    // Medido al ensayar la 133: la base compara contra microsegundos. Una foto pasada por `new Date()` los pierde
    // (toISOString da milisegundos) y publicar diría STALE de TODAS las órdenes, siempre.
    const deLaBase = "2026-03-03T15:00:00.123456+00:00";
    const e = entradaDelDia(datos([orden("a", { updated_at: deLaBase })]));
    expect(e.fotos).toEqual([{ id: "a", updated_at: deLaBase }]);
    expect(new Date(deLaBase).toISOString()).not.toBe(deLaBase);      // por qué no vale «normalizarla»
  });

  it("solo las de etapas ruteables, y nunca las de práctica", () => {
    const e = entradaDelDia(datos([orden("viva"), orden("recogida", { stage: "picked_up" }), orden("borrador", { stage: "draft" }), orden("practica", { is_training: true })]));
    expect(e.entrada.ordenes.map((o) => o.id)).toEqual(["viva"]);
    expect(e.fotos.map((f) => f.id)).toEqual(["viva"]);
  });

  it("el origen es la tienda de recogida y, si falta, la que vende; sin punto, no hay origen (y el motor lo dirá)", () => {
    const e = entradaDelDia(datos([orden("a", { pickup_name: "Tienda Sur" }), orden("b", { store: "Tienda Sin Punto" }), orden("c", { store: null })]));
    expect(e.entrada.ordenes.map((o) => o.origen)).toEqual([puntoDeTienda("Tienda Sur"), null, null]);
  });

  it("el destino es el pin de la orden; NO se geocodifica: sin pin no hay destino — salvo entre tiendas, que es la que recibe", () => {
    const sinPin = { delivery_lat: null, delivery_lng: null };
    const e = entradaDelDia(datos([
      orden("cliente", sinPin),
      orden("entre", { ...sinPin, order_type: "EntreTiendas", delivery_name: "Tienda Sur" }),
      orden("entre-con-pin", { order_type: "EntreTiendas", delivery_name: "Tienda Sur" }),
      // Un cliente que se llama como una tienda NO va a la tienda: solo las órdenes entre tiendas.
      orden("cliente-tocayo", { ...sinPin, delivery_name: "Tienda Sur" }),
    ]));
    expect(e.entrada.ordenes.map((o) => o.destino)).toEqual([null, puntoDeTienda("Tienda Sur"), puntoDeOrden("entre-con-pin"), null]);
    const plan = planifica({ ...e.entrada, matriz: {} }, e.parametros);
    expect(plan.sinAsignar.find((s) => s.orden === "cliente")?.motivo).toBe("sin_punto");
  });

  it("una orden en un «route bucket» es un carril manual: queda fuera del plan, y se dice", () => {
    const e = entradaDelDia(datos([orden("a", { assigned_driver: "ruta extra" }), orden("b")]));
    expect(e.entrada.ordenes.map((o) => o.id)).toEqual(["b"]);
    expect(e.fuera).toEqual([{ id: "a", motivo: "en_un_carril_manual" }]);
  });

  it("el chofer que puso una PERSONA se respeta; el que puso el último plan publicado, no", () => {
    const ordenes = [orden("a-mano", { assigned_driver: "Chofer Sur" }), orden("del-motor", { assigned_driver: "Chofer Sur" })];
    const e = entradaDelDia(datos(ordenes, { publicadoAntes: [{ id: "del-motor", assigned_driver: "chofer sur" }] }));
    expect(e.entrada.ordenes.map((o) => [o.id, o.choferFijado])).toEqual([["a-mano", "c-sur"], ["del-motor", null]]);
    // Si después una persona la cambió a OTRO chofer, vuelve a ser de una persona.
    const cambiada = entradaDelDia(datos([orden("del-motor", { assigned_driver: "Chofer Norte" })], { publicadoAntes: [{ id: "del-motor", assigned_driver: "Chofer Sur" }] }));
    expect(cambiada.entrada.ordenes[0].choferFijado).toBe("c-norte");
  });

  it("si la persona la puso con alguien que ese día no rutea, no se le da a otro: queda fuera, y se dice", () => {
    const e = entradaDelDia(datos([orden("a", { assigned_driver: "Chofer Apagado" }), orden("b", { assigned_driver: "Alguien Que No Existe" })]));
    expect(e.entrada.ordenes).toEqual([]);
    expect(e.fuera).toEqual([{ id: "a", motivo: "chofer_no_rutea" }, { id: "b", motivo: "chofer_no_rutea" }]);
  });

  it("lo fijado a mano llega al motor — solo si el chofer rutea hoy y la orden sigue en el plan", () => {
    const P = (o: string) => ({ orden: o, tipo: "P" as const }), D = (o: string) => ({ orden: o, tipo: "D" as const });
    const fijadas = { "c-norte": [P("a"), P("ya-no"), D("a"), D("ya-no"), P("g#b"), D("g#b")], "c-apagado": [P("b"), D("b")] };
    const e = entradaDelDia(datos([orden("a"), orden("b"), orden("g", { est_pallets: 25 })], { fijadas }));
    expect(e.entrada.secuenciaFijada).toEqual({ "c-norte": [P("a"), D("a"), P("g#b"), D("g#b")] });
    expect("secuenciaFijada" in entradaDelDia(datos([orden("a")])).entrada).toBe(false);
    expect("secuenciaFijada" in entradaDelDia(datos([orden("a")], { fijadas: { "c-apagado": [P("a"), D("a")] } })).entrada).toBe(false);
  });

  it("los pesos y el tope salen de Ajustes", () => {
    const e = entradaDelDia(datos([], { settings: { ...settings, route_weights: { builder: 5 }, route_late_cap_min: 30, route_hard_windows: [] } }));
    expect(e.parametros.pesos.builder).toBe(5);
    expect(e.parametros.pesos.manejo).toBe(PARAMETROS_POR_DEFECTO.pesos.manejo);
    expect(e.parametros.topeTardeAnchaMin).toBe(30);
  });
});

describe("del plan a las filas que se guardan", () => {
  it("una fila por parada, con su chofer por id y por nombre, su hora, su carga y su ventana", () => {
    const e = entradaDelDia(datos([orden("a", { delivery_windows: "0830-1000" })]));
    const p = [puntoDeTienda("Tienda Norte"), puntoDeTienda("Tienda Sur"), puntoDeOrden("a")];
    const matriz = Object.fromEntries(p.map((x) => [x, Object.fromEntries(p.filter((y) => y !== x).map((y) => [y, { minutos: 12, millas: 7.5 }]))]));
    const entrada = { ...e.entrada, matriz };
    const plan = planifica(entrada, e.parametros);
    const filas = filasDeParadas(plan, entrada, e.puntos, tiendas);
    expect(filas).toEqual([
      { driver_id: "c-norte", driver_name: "Chofer Norte", seq: 0, kind: "P", delivery_id: "a", order_ref: "a", label: "P1", visit: 1, place: "Tienda Norte",
        lat: 26.3, lng: -98.2, window_start: null, window_end: null, is_hard: false, eta: 480, etd: 500, wait_min: 0, service_min: 20, late_min: 0,
        load_after: 2.5, leg_minutes: 0, leg_miles: 0, pinned: false },
      { driver_id: "c-norte", driver_name: "Chofer Norte", seq: 1, kind: "D", delivery_id: "a", order_ref: "a", label: "D1", visit: 2, place: null,
        lat: 26.35, lng: -98.25, window_start: 510, window_end: 600, is_hard: true, eta: 512, etd: 525, wait_min: 0, service_min: 13, late_min: 0,
        load_after: 0, leg_minutes: 12, leg_miles: 7.5, pinned: false },
    ]);
    expect(escriturasAlPublicar(plan, entrada.choferes)).toEqual([{ id: "a", assigned_driver: "Chofer Norte", load_no: 1, route_seq: 0, load_auto: true }]);
  });

  it("`seq` es la posición DENTRO de la ruta de cada chofer: cada uno empieza en 0", () => {
    const e = entradaDelDia(datos([orden("n"), orden("s", { store: "Tienda Sur", pickup_name: "Tienda Sur" })]));
    const p = [puntoDeTienda("Tienda Norte"), puntoDeTienda("Tienda Sur"), puntoDeOrden("n"), puntoDeOrden("s")];
    const entrada = { ...e.entrada, matriz: Object.fromEntries(p.map((x) => [x, Object.fromEntries(p.filter((y) => y !== x).map((y) => [y, { minutos: 30, millas: 20 }]))])) };
    const filas = filasDeParadas(planifica(entrada, e.parametros), entrada, e.puntos, tiendas);
    expect(filas.map((f) => [f.driver_id, f.seq, f.label])).toEqual([["c-norte", 0, "P1"], ["c-norte", 1, "D1"], ["c-sur", 0, "P1"], ["c-sur", 1, "D1"]]);
  });

  it("una orden partida guarda sus partes como paradas, todas apuntando a la MISMA orden", () => {
    const e = entradaDelDia(datos([orden("g", { est_pallets: 25 })]));
    const p = [puntoDeTienda("Tienda Norte"), puntoDeTienda("Tienda Sur"), puntoDeOrden("g")];
    const entrada = { ...e.entrada, matriz: Object.fromEntries(p.map((x) => [x, Object.fromEntries(p.filter((y) => y !== x).map((y) => [y, { minutos: 5, millas: 3 }]))])) };
    const filas = filasDeParadas(planifica(entrada, e.parametros), entrada, e.puntos, tiendas);
    expect(new Set(filas.map((f) => f.delivery_id))).toEqual(new Set(["g"]));
    expect(filas.filter((f) => f.kind === "D").map((f) => f.order_ref).sort()).toEqual(["g#a", "g#b", "g#c"]);
  });
});
