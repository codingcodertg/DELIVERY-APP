import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { evaluaPlan, parteOrdenesGrandes, planifica, type ChoferEntrada, type Matriz, type OrdenEntrada, type Plan } from "@/lib/route-engine";
import { escriturasAlPublicar } from "@/lib/route-plan/publicar";
import { lecturaDeLaRuta, type OrdenAsignada, type ParadaDelPlanMinima } from "@/lib/route-plan/lectura-de-ruta";
import { aplicaMovimiento, esUnaRuta } from "@/lib/route-plan/ajuste";
import { cuentaDePallets, mueveEnLaLista } from "@/lib/lista-unica";
import { mkDelivery } from "@/lib/__fixtures";
import {
  alJuntar, alRepartir, cargaDe, COLUMNAS_PROPIAS_DE_LA_CARGA, copiaParaLaCarga, esFuncionAusente, etapaDeLaFamilia, etiquetaDeCarga, hermanasDe,
  laOtraCarga, madreAlPartir, particionesDelDia, restoPropuesto, restosParaPartir, sePuedenJuntar, sePuedePartir, siguienteLetra,
} from "./cargas-partidas";
import { parteEnLaBase, hayQueReleer, type ClienteDeCargas } from "./route-plan/partir-antes-de-planificar";
import type { DatosDelDia } from "./route-plan/entrada";

/**
 * Una orden que no cabe en el camión (D-452, migración 157). El dueño, 2026-09-30: «so if we have an order of more than 10
 * pallets that will be devided into 2 those 2 orders should assign as 2 p 2 d».
 *
 * Primero, LO QUE PASA HOY, medido con las funciones de verdad: el motor la parte en cargas virtuales (`g#a`, `g#b`) del
 * MISMO chofer; publicar escribe UNA fila; el Gestor y «Mi ruta» pintan la segunda carga como una fila informativa que no
 * se mueve ni se marca. Ese camino se queda como respaldo (sin la 157), así que estas pruebas siguen valiendo. Después, la
 * regla nueva: las cargas son ÓRDENES hermanas (#Xa, #Xb), y lo que decide cuándo, en cuánto y qué copia cada una.
 */

const leer = (r: string) => readFileSync(join(process.cwd(), r), "utf8").replace(/\r\n/g, "\n");
const punto = (x: number) => `${x},0`;
function matrizDe(xs: number[]): Matriz {
  const m: Matriz = {};
  for (const a of xs) { m[punto(a)] = {}; for (const b of xs) if (a !== b) m[punto(a)][punto(b)] = { minutos: Math.abs(a - b), millas: Math.abs(a - b) * 0.6 }; }
  return m;
}
const orden = (id: string, origen: number, destino: number, extra: Partial<OrdenEntrada> = {}): OrdenEntrada =>
  ({ id, codigo: id, entrada: "2026-01-05 0800", origen: punto(origen), destino: punto(destino), pallets: 1, ventana: null, servicioRecogidaMin: 5, servicioEntregaMin: 10, ...extra });
const c1: ChoferEntrada = { id: "c1", nombre: "Chofer Uno", base: punto(0), capacidad: 10, entrada: 480, salida: 1050, vuelveABase: true };
const c2: ChoferEntrada = { id: "c2", nombre: "Chofer Dos", base: punto(0), capacidad: 10, entrada: 480, salida: 1050, vuelveABase: true };
const guardadas = (plan: Pick<Plan, "rutas">, i = 0): ParadaDelPlanMinima[] =>
  plan.rutas[i].paradas.map((p, seq) => ({ kind: p.tipo, order_ref: p.orden, seq, label: p.etiqueta, load_after: p.cargaAlSalir, place: "Tienda A" }));

describe("HOY (medido): una orden de 15 pallets en un camión de 10", () => {
  // La orden del dueño: 15 pallets, camión de 10. Y una orden normal al lado.
  const entrada = { ordenes: [orden("g", 0, 20, { pallets: 15 }), orden("h", 0, 25, { pallets: 2 })], choferes: [c1], matriz: matrizDe([0, 20, 25]) };
  const plan = planifica(entrada);

  it("el motor la parte en DOS cargas virtuales del MISMO chofer: g#a (10) y g#b (5), cada una con su P y su D", () => {
    expect(plan.partes).toEqual({ g: ["g#a", "g#b"] });
    const partes = parteOrdenesGrandes(entrada.ordenes, [c1]).ordenes.filter((o) => o.id.startsWith("g#"));
    expect(partes.map((o) => [o.id, o.pallets])).toEqual([["g#a", 10], ["g#b", 5]]);
    const deG = plan.rutas[0].paradas.filter((p) => p.orden.startsWith("g#")).map((p) => `${p.tipo}:${p.orden}`);
    expect(deG.sort()).toEqual(["D:g#a", "D:g#b", "P:g#a", "P:g#b"]);
    expect(plan.rutas.length).toBe(1);
  });

  it("publicar escribe UNA sola fila para la orden: el chofer y el puesto de su PRIMERA carga; la segunda carga no escribe nada", () => {
    const escrituras = escriturasAlPublicar(plan, [c1]);
    expect(escrituras.map((e) => e.id)).toEqual(["g", "h"]);
    expect(escrituras.filter((e) => e.id.includes("#"))).toEqual([]);
  });

  it("leída con el plan: la 2ª recogida y la 2ª entrega salen como filas que NO se mueven (`indice: null`, `otraCarga`)", () => {
    const paradas = guardadas(plan);
    const tras: OrdenAsignada[] = escriturasAlPublicar(plan, [c1]).map((e) => ({ id: e.id, store: "Tienda A", est_pallets: e.id === "g" ? 15 : 2, route_seq: e.route_seq, pickup_seq: e.pickup_seq ?? null, load_no: null }));
    const l = lecturaDeLaRuta(tras, 10, paradas);
    expect(l.fuente).toBe("plan");
    const deG = l.filas.filter((f) => (f.tipo === "P" ? f.ordenes.includes("g") : f.orden === "g"));
    expect(deG.length).toBe(4);                                                  // 2 P + 2 D pintadas…
    expect(deG.filter((f) => f.indice == null).length).toBe(2);                  // …pero dos no tienen índice: no se mueven
    expect(deG.filter((f) => f.tipo === "D" && f.otraCarga).length).toBe(1);
    expect(l.paradas.filter((p) => (p.tipo === "P" ? p.ordenes.includes("g") : p.orden === "g")).length).toBe(2);   // en la lista movible, UNA P y UNA D
  });

  it("si alguien mueve algo a mano, la lista guardada ya no conoce la segunda carga: una P y una D de 15, y la cuenta se pasa (⚠ 5 de 10)", () => {
    const tras: OrdenAsignada[] = [{ id: "g", store: "Tienda A", est_pallets: 15, route_seq: 0, pickup_seq: -0.5, load_no: null }, { id: "h", store: "Tienda A", est_pallets: 2, route_seq: 1, pickup_seq: 0.5, load_no: null }];
    const l = lecturaDeLaRuta(tras, 10, null);
    expect(l.fuente).toBe("derivada");
    expect(l.filas.map((f) => f.etiqueta)).toEqual(["P1", "D1", "P2", "D2"]);
    const cuenta = cuentaDePallets(l.filas.map((f) => f.cambio), 10);
    expect(cuenta.paradas[0]).toMatchObject({ cambio: 15, despues: 15, exceso: 5 });
    // Y mover la P1 abajo (sobre su propia D1) no se deja; no hay «otra carga» que mover.
    expect(mueveEnLaLista(l.paradas, 0, 1)).toEqual({ ok: false, motivo: "precedencia", orden: "g" });
  });

  it("en el plan (ajuste a mano), g#b sí puede pasar a otro chofer —pero al publicar, g se escribe una vez, con el chofer de su primera carga", () => {
    const estado = { secuencias: { c1: plan.rutas[0].paradas.map((p) => ({ orden: p.orden, tipo: p.tipo })), c2: [] as { orden: string; tipo: "P" | "D" }[] }, fijadas: [] as string[] };
    const r = aplicaMovimiento(estado, { tipo: "a_chofer", orden: "g#b", chofer: "c2" }, ["c1", "c2"]);
    expect("error" in r).toBe(false);
    const secuencias = (r as { secuencias: Record<string, { orden: string; tipo: "P" | "D" }[]> }).secuencias;
    expect(esUnaRuta(secuencias)).toBe(true);
    const dosRutas = evaluaPlan({ secuencias, ordenes: parteOrdenesGrandes(entrada.ordenes, [c1, c2]).ordenes, choferes: [c1, c2], matriz: matrizDe([0, 20, 25]) });
    expect(escriturasAlPublicar(dosRutas, [c1, c2]).filter((x) => x.id === "g").map((x) => x.assigned_driver)).toEqual(["Chofer Uno"]);
  });

  it("«Mi ruta» pinta la segunda carga como «Entregar otra carga de», sin botón: no se marca por separado", () => {
    const pagina = leer("src/app/(app)/my-route/page.tsx");
    expect(pagina).toContain("Entregar otra carga de");
    expect(pagina).toContain("if (f.tipo === \"P\" || f.otraCarga) return (");
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// La regla nueva: las cargas son órdenes hermanas.

const carga = (over: Partial<ReturnType<typeof mkDelivery>>) => mkDelivery({ order_no: 500, order_code: "FA500", stage: "ready", ...over });
const a = carga({ id: "a", order_suffix: "a", est_pallets: 10 });
const b = carga({ id: "b", order_suffix: "b", est_pallets: 5 });
const otra = carga({ id: "z", order_no: 501, order_code: "FA501", est_pallets: 3 });
const entrenamiento = carga({ id: "t", order_suffix: "c", is_training: true });

describe("la familia: quiénes son hermanas y cuál carga es cada una", () => {
  it("hermanas = misma order_no y mismo is_training, por letra; una orden de otro número no entra, ni la de entrenamiento", () => {
    expect(hermanasDe([b, otra, entrenamiento, a], a).map((x) => x.id)).toEqual(["a", "b"]);
    expect(hermanasDe([otra], otra).map((x) => x.id)).toEqual(["z"]);
  });
  it("«carga 1 de 2» / «load 2 of 2»; una orden sola no es carga de nada", () => {
    const h = hermanasDe([b, a], a);
    expect(cargaDe(a, h)).toEqual({ numero: 1, de: 2 });
    expect(cargaDe(b, h)).toEqual({ numero: 2, de: 2 });
    expect(cargaDe(otra, hermanasDe([otra, a, b], otra))).toBeNull();
    expect(etiquetaDeCarga({ numero: 1, de: 2 }, true)).toBe("carga 1 de 2");
    expect(etiquetaDeCarga({ numero: 2, de: 2 }, false)).toBe("load 2 of 2");
  });
  it("la letra nueva es la siguiente a la mayor de la familia; una orden nunca partida cuenta como «a»", () => {
    expect(siguienteLetra([otra])).toBe("b");
    expect(siguienteLetra([a, b])).toBe("c");
    expect(siguienteLetra([carga({ order_suffix: "z" })])).toBeNull();
  });
  it("la otra carga: solo en familias de DOS", () => {
    expect(laOtraCarga(a, [a, b])?.id).toBe("b");
    expect(laOtraCarga(a, [a, b, carga({ id: "c", order_suffix: "c" })])).toBeNull();
    expect(laOtraCarga(otra, [otra])).toBeNull();
  });
});

describe("cuándo se parte y en cuánto: lo propone el sistema (llena el camión, el resto a la otra), y una que cabe no se parte nunca", () => {
  it("15 en un camión de 10: el resto es 5; 10 en 10 cabe: null; 10.5 en 10: 0.5 (centésimas, sin cola)", () => {
    expect(restoPropuesto(15, 10)).toBe(5);
    expect(restoPropuesto(10, 10)).toBeNull();
    expect(restoPropuesto(10.5, 10)).toBe(0.5);
    expect(restoPropuesto(15.3, 10)).toBe(5.3);                                    // en coma flotante daría 5.300000000000001 (medido)
    expect(restoPropuesto(0, 10)).toBeNull();
    expect(restoPropuesto(15, 0)).toBeNull();
  });
  it("se puede partir solo pendiente de ruta, con pallets y sin caber; no una recogida ni una entregada", () => {
    expect(sePuedePartir(carga({ est_pallets: 15, stage: "pending" }), 10)).toBe(true);
    expect(sePuedePartir(carga({ est_pallets: 15, stage: "picked_up" }), 10)).toBe(false);
    expect(sePuedePartir(carga({ est_pallets: 15, stage: "delivered" }), 10)).toBe(false);
    expect(sePuedePartir(carga({ est_pallets: 10, stage: "ready" }), 10)).toBe(false);
    expect(sePuedePartir(carga({ est_pallets: null, actual_pallets: null, stage: "ready" }), 10)).toBe(false);
  });
  it("los restos para partir como el motor: [10, 5] → pide 5 a la madre; [10, 10, 5] → 15 a la madre y después 5 a la nueva", () => {
    expect(restosParaPartir([{ pallets: 10 }, { pallets: 5 }])).toEqual([5]);
    expect(restosParaPartir([{ pallets: 10 }, { pallets: 10 }, { pallets: 5 }])).toEqual([15, 5]);
    expect(restosParaPartir([{ pallets: 4 }])).toEqual([]);
  });
  it("del día entero: con la regla del motor, solo las que no caben en el camión más grande que puede llevarlas", () => {
    const ordenes = [orden("g", 0, 20, { pallets: 15 }), orden("h", 0, 25, { pallets: 2 }), orden("k", 0, 25, { pallets: 25 })];
    expect(particionesDelDia(ordenes, [c1, c2])).toEqual([{ id: "g", restos: [5] }, { id: "k", restos: [15, 5] }]);
    expect(particionesDelDia([orden("h", 0, 25, { pallets: 10 })], [c1])).toEqual([]);
  });
});

describe("juntar y repartir", () => {
  it("se juntan si son hermanas, las dos pendientes de ruta y la suma cabe en ese camión", () => {
    expect(sePuedenJuntar(a, b, 15)).toBe(true);
    expect(sePuedenJuntar(a, b, 10)).toBe(false);                                  // 10 + 5 no cabe en 10
    // El borde exacto (D-452, mutante del orquestador): justo lleno cabe; una centésima más, no.
    expect(sePuedenJuntar(a, b, 15.01)).toBe(true);
    expect(sePuedenJuntar(a, b, 14.99)).toBe(false);
    expect(sePuedenJuntar(a, { ...b, stage: "picked_up" }, 15)).toBe(false);       // b ya salió
    expect(sePuedenJuntar(a, otra, 15)).toBe(false);                               // no son hermanas
    expect(sePuedenJuntar(a, { ...b, is_training: true }, 15)).toBe(false);
    expect(sePuedenJuntar(a, a, 15)).toBe(false);
    expect(sePuedenJuntar({ ...a, order_suffix: null }, b, 15)).toBe(false);       // sin letra no es una carga
  });
  it("al juntar, a suma los pallets de b en el campo que usa, y pierde la letra solo si no queda otra hermana", () => {
    expect(alJuntar(a, b, 1)).toEqual({ est_pallets: 15, order_suffix: null });
    expect(alJuntar(a, b, 2)).toEqual({ est_pallets: 15, order_suffix: "a" });
    expect(alJuntar({ ...a, actual_pallets: 9 }, { ...b, actual_pallets: 4.5 }, 1)).toEqual({ actual_pallets: 13.5, order_suffix: null });
  });
  it("al repartir, a se queda con lo pedido y b con el resto del total; fuera de (0, total) no vale", () => {
    expect(alRepartir(a, b, 12)).toEqual({ a: { est_pallets: 12 }, b: { est_pallets: 3 } });
    expect(alRepartir({ ...a, actual_pallets: 10 }, { ...b, actual_pallets: 5 }, 7.5)).toEqual({ a: { actual_pallets: 7.5 }, b: { actual_pallets: 7.5 } });
    expect(alRepartir(a, b, 15)).toBeNull();
    expect(alRepartir(a, b, 0)).toBeNull();
  });
});

describe("la copia: qué lleva una carga nueva y qué se queda la madre", () => {
  const madre = carga({ id: "m", order_suffix: null, est_pallets: 15, actual_pallets: null, invoice_num: "INV-9", delivery_address: "1 Main St", store: "Pharr", assigned_driver: "Diego Driver", route_seq: 3, pickup_seq: 2.5, photos: ["x"], pod_signature: "sig", delivery_notes: "frágil", created_by: "u-ventas" });
  const hija = copiaParaLaCarga(madre, { id: "h", letra: "b", resto: 5, ahora: "2026-09-30T10:00:00Z", creador: "u-log" });

  it("copia cliente, dirección, factura, tienda, chofer y etapa; lo suyo: id, letra, 5 pallets, sin puesto, sin sellos, sin comprobante", () => {
    expect(hija).toMatchObject({ id: "h", order_no: 500, order_code: "FA500", order_suffix: "b", est_pallets: 5, actual_pallets: null, invoice_num: "INV-9", delivery_address: "1 Main St", store: "Pharr", assigned_driver: "Diego Driver", stage: "ready" });
    expect(hija).toMatchObject({ route_seq: null, pickup_seq: null, load_no: null, load_auto: false, photos: null, pod_signature: null, created_by: "u-log", created_at: "2026-09-30T10:00:00Z" });
    expect(hija.delivery_notes).toBe("frágil\nSplit of #FA500a at planning: 5 of 15 pallets.");
  });
  it("la madre: letra «a» y 10 en el campo que usa (estimación); con recuento, el recuento y la estimación se queda como historia", () => {
    expect(madreAlPartir(madre, 5)).toEqual({ order_suffix: "a", est_pallets: 10 });
    expect(madreAlPartir({ ...madre, actual_pallets: 14 }, 4)).toEqual({ order_suffix: "a", actual_pallets: 10 });
    expect(copiaParaLaCarga({ ...madre, actual_pallets: 14 }, { id: "h", letra: "b", resto: 4, ahora: "", creador: null })).toMatchObject({ est_pallets: 4, actual_pallets: 4 });
    expect(madreAlPartir(madre, 15)).toBeNull();
    expect(madreAlPartir(madre, 0)).toBeNull();
    expect(madreAlPartir({ ...madre, order_suffix: "b" }, 5)?.order_suffix).toBe("b");
  });
  it("las columnas que NO se copian son las mismas en la app y en `partir_carga` (157)", () => {
    const sql = leer("supabase/migrations/157_partes_de_orden.sql");
    const i = sql.indexOf("fila := to_jsonb(madre) || jsonb_build_object(");
    const bloque = sql.slice(i, sql.indexOf(");", i));
    const claves = [...bloque.matchAll(/'([a-z_]+)',/g)].map((m) => m[1]);
    expect(new Set(claves)).toEqual(new Set(COLUMNAS_PROPIAS_DE_LA_CARGA));
  });
});

describe("la etapa de la familia (decisión 2, leída por familia: no hay fila madre)", () => {
  it("entregada cuando TODAS las vivas lo están; en reparto si alguna salió; si no, pendiente; una anulada no cuenta", () => {
    expect(etapaDeLaFamilia([{ stage: "delivered" }, { stage: "delivered" }])).toBe("entregada");
    expect(etapaDeLaFamilia([{ stage: "delivered" }, { stage: "ready" }])).toBe("en_reparto");
    expect(etapaDeLaFamilia([{ stage: "picked_up" }, { stage: "pending" }])).toBe("en_reparto");
    expect(etapaDeLaFamilia([{ stage: "ready" }, { stage: "pending" }])).toBe("pendiente");
    expect(etapaDeLaFamilia([{ stage: "delivered" }, { stage: "canceled" }])).toBe("entregada");
    expect(etapaDeLaFamilia([{ stage: "canceled" }])).toBe("pendiente");
  });
});

describe("«Armar rutas» parte EN LA BASE antes de planificar, y sin la 157 planifica como hoy", () => {
  const tiendas = [{ name: "Tienda A", address: "", lat: 0, lng: 0 }];
  const fila = (id: string, pallets: number) => ({
    id, stage: "ready", order_code: id, order_type: "Delivery", store: "Tienda A", pickup_name: "Tienda A", delivery_name: null, delivery_lat: 26, delivery_lng: -98,
    delivery_windows: null, est_pallets: pallets, actual_pallets: null, pickup_duration: null, delivery_duration: null, assigned_driver: null, input_date: "2026-09-30", input_time: "0800",
    account: null, customer_type: null, is_training: false, updated_at: "2026-09-30T00:00:00Z", invoice_num: null, delivery_address: "x",
  });
  const datos = (): DatosDelDia => ({
    ordenes: [fila("g", 15), fila("h", 2), fila("k", 25)] as unknown as DatosDelDia["ordenes"],
    choferes: [{ id: "c1", full_name: "Chofer Uno", role: "driver" }],
    ajustesDeChofer: [{ profile_id: "c1", base_store: "Tienda A", capacity_pallets: 10, shift_start: "08:00", shift_end: "17:30", returns_to_base: true, routable: true }],
    settings: { stores: tiendas, accounts: [], order_type_rules: {}, route_buckets: [], driver_capacity: { "Chofer Uno": 10 }, default_truck_capacity: 10, route_weights: null, route_hard_windows: null, route_late_cap_min: null, delivery_requirements: null } as unknown as DatosDelDia["settings"],
  });
  const cliente = (respuestas: ((args: { p_id: string; p_resto: number }) => { data: unknown; error: { code?: string; message: string } | null })) => {
    const llamadas: { p_id: string; p_resto: number }[] = [];
    const c: ClienteDeCargas = { rpc: async (_fn, args) => { llamadas.push(args); return respuestas(args); } };
    return { c, llamadas };
  };

  it("pide a `partir_carga` cada resto, encadenando la carga recién nacida; devuelve qué partió, y hay que releer", async () => {
    let n = 0;
    const { c, llamadas } = cliente(() => ({ data: `nueva-${++n}`, error: null }));
    const r = await parteEnLaBase(c, datos());
    expect(llamadas).toEqual([{ p_id: "g", p_resto: 5 }, { p_id: "k", p_resto: 15 }, { p_id: "nueva-2", p_resto: 5 }]);
    expect(r).toEqual({ fuente: "base", partidas: [{ id: "g", nuevas: ["nueva-1"] }, { id: "k", nuevas: ["nueva-2", "nueva-3"] }] });
    expect(hayQueReleer(r)).toBe(true);
  });
  it("sin la 157 (PGRST202 en la primera llamada): no parte nada, «sin_funcion», y no hay que releer", async () => {
    const { c, llamadas } = cliente(() => ({ data: null, error: { code: "PGRST202", message: "Could not find the function public.partir_carga" } }));
    const r = await parteEnLaBase(c, datos());
    expect(r).toEqual({ fuente: "sin_funcion", partidas: [] });
    expect(llamadas.length).toBe(1);
    expect(hayQueReleer(r)).toBe(false);
  });
  it("un error a medias (la base rechaza una): se para ahí, lo partido queda, y se dice cuál falló", async () => {
    const { c } = cliente((args) => (args.p_id === "k" ? { data: null, error: { code: "P0001", message: "INVOICE_REQUIRED: a Delivery order needs its Invoice #" } } : { data: "nueva-g", error: null }));
    const r = await parteEnLaBase(c, datos());
    expect(r).toEqual({ fuente: "error", detalle: "INVOICE_REQUIRED: a Delivery order needs its Invoice #", partidas: [{ id: "g", nuevas: ["nueva-g"] }] });
    expect(hayQueReleer(r)).toBe(true);
  });
  it("sin órdenes grandes no llama a nadie", async () => {
    const { c, llamadas } = cliente(() => ({ data: "x", error: null }));
    const d = datos();
    const r = await parteEnLaBase(c, { ...d, ordenes: [d.ordenes[1]] });
    expect(r).toEqual({ fuente: "base", partidas: [] });
    expect(llamadas).toEqual([]);
  });
  it("«función ausente» es PGRST202, 42883 o su mensaje; cualquier otro error no lo es", () => {
    expect(esFuncionAusente({ code: "PGRST202", message: "x" })).toBe(true);
    expect(esFuncionAusente({ code: "42883", message: "x" })).toBe(true);
    expect(esFuncionAusente({ code: null, message: "function public.partir_carga(uuid, numeric) does not exist" })).toBe(true);
    expect(esFuncionAusente({ code: "P0001", message: "CARGA_FORBIDDEN" })).toBe(false);
    expect(esFuncionAusente(null)).toBe(false);
  });
});

describe("las pantallas usan la regla (la prueba se alimenta de quien llama)", () => {
  const api = leer("src/app/api/route-plan/route.ts");
  const gestor = leer("src/app/(app)/routes/page.tsx");
  const miRuta = leer("src/app/(app)/my-route/page.tsx");
  const real = leer("src/lib/data-provider.tsx");
  const demo = leer("src/lib/local-data-provider.tsx");

  it("«Armar rutas» parte antes de planificar, relee el día si partió, y devuelve `particion`", () => {
    expect(api).toContain("const particion = await parteEnLaBase(supabase as unknown as ClienteDeCargas, dia.datos);");
    expect(api).toContain("const releido = hayQueReleer(particion) ? await leeElDia(supabase, fecha) : dia;");
    expect(api).toContain("const datos: DatosDelDia = { ...releido.datos, fijadas:");
    expect(api).toMatch(/\n\s+particion,\n/);
    expect(leer("src/components/PlanDelDia.tsx")).toContain("data-plan-partidas");
  });
  it("el proveedor real llama a las tres funciones de la base por su nombre, y el demo hace la misma copia", () => {
    expect(real).toContain("supabase.rpc(\"partir_carga\", { p_id: id, p_resto: resto })");
    expect(real).toContain("supabase.rpc(\"reparte_cargas\", { p_a: a, p_b: b, p_pallets_a: palletsA })");
    expect(real).toContain("supabase.rpc(\"juntar_cargas\", { p_a: a, p_b: b })");
    expect(real).toContain("esFuncionAusente(error)");
    expect(demo).toContain("copiaParaLaCarga(madre, { id: uid(), letra, resto, ahora, creador: me.id })");
    expect(demo).toContain("alJuntar(a, b, hermanasDe(s.deliveries, a).length - 1)");
  });
  it("el Gestor: «carga 1 de 2» en las filas P y D, y ✂ ✎ ⤵ en la fila D con la capacidad de ESE camión", () => {
    expect(gestor).toContain("<td className=\"ordno\">{enlaceConElId(d)}{etiquetaDeLaCarga(d)}</td>");
    expect(gestor).toContain("{enlaceConElId(x)}{etiquetaDeLaCarga(x)}</Fragment>");
    expect(gestor).toContain("{flechas}{pasar}{botonesDeCarga(d, capacity)}");
    expect(gestor).toContain("data-partir onClick={() => void parteLaOrden(d, capacidad)}");
    expect(gestor).toContain("{sePuedePartir(d, capacidad) && (");
    expect(gestor).toContain("{carga && otra && sePuedenJuntar(d, otra, capacidad) && (");
    expect(gestor).toContain("data-juntar onClick={() => void juntaLaOrden(d, otra)}");
    expect(gestor).toContain("data-reparte onClick={() => void reparteLaOrden(d, otra)}");
    expect(gestor).toContain("const id = await partirCarga(d.id, resto);");
  });
  it("«Mi ruta»: «carga 1 de 2» en la siguiente parada y en cada fila; el botón de marcar es el de siempre, por carga", () => {
    expect(miRuta).toContain("{facturasDeLaOrden(next).join(\", \") || `#${orderLabel(next)}`}{etiquetaDeLaCarga(next)}");
    expect(miRuta).toContain("{facturasDeLaOrden(d).join(\", \") || `#${orderLabel(d)}`}{etiquetaDeLaCarga(d)}");
    expect(miRuta).toContain("cargaDe(d, hermanasDe(deliveries, d))");
  });
});

describe("la migración 157 (escrita, NO aplicada: la aplica el orquestador tras el merge)", () => {
  const sql = leer("supabase/migrations/157_partes_de_orden.sql");
  const codigo = sql.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
  const guard = (t: string) => { const i = t.indexOf("create or replace function public.guard_delivery_stage()"); const fin = "end $function$\n;\n"; return t.slice(i, t.indexOf(fin, i) + fin.length); };

  it("el guard es el de la 145 letra por letra, con UNA lista cambiada: una carga partida puede nacer en pending", () => {
    const de145 = guard(leer("supabase/migrations/145_gerente_hace_bodega.sql"));
    const de157 = guard(sql);
    expect(de145.length).toBeGreaterThan(10000);
    const l145 = de145.split("\n"), l157 = de157.split("\n");
    expect(l145.filter((l) => !l157.includes(l)).map((l) => l.trim())).toEqual(["if r in ('warehouse','driver','logistics','manager','accounting') and new_stage in ('ready','approved','fulfilling') then"]);
    const nuevas = l157.filter((l) => !l145.includes(l)).map((l) => l.trim());
    expect(nuevas.filter((l) => !l.startsWith("--"))).toEqual(["if r in ('warehouse','driver','logistics','manager','accounting') and new_stage in ('ready','approved','fulfilling','pending') then"]);
    expect(nuevas.filter((l) => l.startsWith("--")).every((l) => l.includes("157") || l.includes("012"))).toBe(true);
  });
  it("tres funciones de la app (partir y repartir invoker, juntar definer) y nada más: ni tabla, ni columna, ni política, ni dato", () => {
    expect(codigo).toContain("create or replace function public.partir_carga(p_id uuid, p_resto numeric)\n  returns uuid language plpgsql set search_path = public as $$");
    expect(codigo).toContain("create or replace function public.reparte_cargas(p_a uuid, p_b uuid, p_pallets_a numeric)\n  returns void language plpgsql set search_path = public as $$");
    expect(codigo).toContain("create or replace function public.juntar_cargas(p_a uuid, p_b uuid)\n  returns void language plpgsql security definer set search_path = public as $$");
    expect(codigo).not.toMatch(/create table|alter table|add column|drop column|create policy|drop policy|alter policy|create trigger|update public\.deliveries set .* where order_no|delete from public\.deliveries where order_no/i);
    expect(codigo).not.toContain("publish_route_plan");
    for (const f of ["partir_carga(uuid, numeric)", "reparte_cargas(uuid, uuid, numeric)", "juntar_cargas(uuid, uuid)", "puede_partir_cargas()"]) {
      expect(codigo).toContain(`revoke execute on function public.${f} from public, anon;`);
      expect(codigo).toContain(`grant execute on function public.${f} to authenticated;`);
    }
    expect(codigo).toContain("revoke execute on function public.la_ve_quien_llama(public.deliveries) from public, anon, authenticated;");
  });
  it("sin begin/commit propios, sin el número de la decisión dentro (numerar cambiaría el checksum), con reversión y su fila del registro al día", () => {
    expect(codigo).not.toMatch(/(^|;)\s*(begin|commit|rollback)\s*;/im);
    expect(sql).not.toContain("D-" + "NEXT");
    expect(sql).not.toMatch(/D-4\d\d/);
    expect(sql).toContain("--   2. drop function if exists public.juntar_cargas(uuid, uuid);");
    const [cuerpo, registro] = sql.split("-- @ledger-below");
    const sha = createHash("sha256").update(cuerpo, "utf8").digest("hex");
    expect(registro.trim()).toBe(`insert into public.schema_migrations (name, checksum) values ('157_partes_de_orden.sql', '${sha}') on conflict (name) do nothing;`);
    expect(leer("docs/PLAN-157-partes-de-orden.md")).toContain(`Checksum del registro: \`${sha}\``);
  });
});
