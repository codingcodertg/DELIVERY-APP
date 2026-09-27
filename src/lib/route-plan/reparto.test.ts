import { beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import DIAS_REALES from "./dias-reales-anon.json";
import { mkDelivery } from "@/lib/__fixtures";
import { cacheEnMemoria, type CacheDeTiempos } from "@/lib/route-times/tiempos";
import { proveedorEstimado } from "@/lib/route-times/proveedores";
import { repartirConElMotor, resumenDelReparto } from "@/lib/auto-asignar";
import type { Delivery } from "@/lib/types";
import { DEMO_USERS, demoDeliveries, demoSettings } from "@/lib/demo-data";
import { planificaElDia, type Borrador } from "./borrador";
import { pideAlServidor, pideElReparto, pideEnElNavegador } from "./reparto-cliente";
import {
  cacheSoloLectura, datosParaElReparto, repartoConDetalle, repartoDelDia, textoDelMotivo,
  type DiaParaElReparto, type EscrituraDelReparto, type FilaDelReparto, type RespuestaDelReparto,
} from "./reparto";

/**
 * «✨ Auto-asignar» con el motor (D-NEXT), contra DÍAS REALES congelados: 2026-09-18..28 de producción, anonimizados
 * (`dias-reales-anon.json`: tiendas «Tienda A…G», choferes «Chofer A…D», órdenes `o-N`, pins a 2 decimales, sin
 * clientes, cuentas, direcciones ni facturas). Tiempos con la estimación en línea recta: sin red.
 *
 * Los choferes, como en producción ese día: A (base Tienda C, 12 pallets), B (Tienda D, 12), C (Tienda A, 10) y D, que
 * NO rutea y no tiene base — el que el `autoAssign` de antes cargaba igual que a los demás.
 *
 * Lo que se midió con `autoAssign` sobre estos mismos días (investigación de T-0410): un clic colocaba 40 de 178 —una
 * por chofer y día, porque trataba cualquier solape de ventanas como choque—, y repitiendo clics se llegaba a 42,5
 * pallets en un chofer con tope 20.
 */

type Fixture = { settings: DiaParaElReparto["settings"]; drivers: DiaParaElReparto["choferes"]; driver_settings: DiaParaElReparto["ajustesDeChofer"]; orders: Record<string, unknown>[] };
const F = DIAS_REALES as unknown as Fixture;
const ZONA = "America/Chicago";
const TODOS = F.drivers.map((d) => String(d.full_name));
const deps = () => ({ cache: cacheEnMemoria(), proveedores: [proveedorEstimado()], ahoraISO: "2026-09-27T12:00:00.000Z" });

/** Las órdenes de un día como las vería el Gestor por la mañana: todas sin chofer, aprobadas (menos anuladas y borradores). */
const ordenesDe = (fecha: string): FilaDelReparto[] => F.orders
  .filter((o) => o.delivery_date === fecha && !["canceled", "draft"].includes(String(o.stage)))
  .map((o) => ({
    ...o, stage: "approved", assigned_driver: null, route_seq: null, load_no: null, is_training: false,
    updated_at: "2026-09-27T00:00:00.000Z", order_code: null, delivery_name: null, account: null, invoice_num: null,
  }) as unknown as FilaDelReparto);
const diaCon = (ordenes: readonly FilaDelReparto[], extra: Partial<DiaParaElReparto> = {}): DiaParaElReparto => ({
  ordenes, choferes: F.drivers, ajustesDeChofer: F.driver_settings, settings: F.settings, noDisponibles: [], bloqueadas: [], ...extra,
});
/** Lo que haría la pantalla con las escrituras: ponerlas en la orden (y la base le cambia `updated_at`). */
const aplica = (ordenes: readonly FilaDelReparto[], esc: readonly EscrituraDelReparto[]): FilaDelReparto[] =>
  ordenes.map((o) => { const w = esc.find((e) => e.id === o.id); return w ? { ...o, ...w.patch, updated_at: "2026-09-27T01:00:00.000Z" } : o; });
const unClic = (fecha: string, ordenes = ordenesDe(fecha), choferes = TODOS, extra: Partial<DiaParaElReparto> = {}) =>
  repartoConDetalle(diaCon(ordenes, extra), { fecha, ordenes: ordenes.filter((o) => !o.assigned_driver).map((o) => o.id), choferes }, ZONA, deps());

const DIAS = [...new Set(F.orders.map((o) => String(o.delivery_date)))].sort();
/** Días en que el motor, planificando el día entero, coloca todo: medido con este fichero (2026-09-27). */
const LIGEROS = ["2026-09-18", "2026-09-21", "2026-09-22", "2026-09-23", "2026-09-25", "2026-09-26", "2026-09-27", "2026-09-28"];

// Un clic por día, y «Planificar el día» (la línea base) con las mismas órdenes: se calculan una vez para todas las pruebas.
const CLIC: Record<string, { respuesta: RespuestaDelReparto; borrador: Borrador | null }> = {};
const BASE: Record<string, Borrador> = {};
beforeAll(async () => {
  for (const fecha of DIAS) {
    CLIC[fecha] = await unClic(fecha);
    BASE[fecha] = await planificaElDia({ ...diaCon(ordenesDe(fecha)), publicadoAntes: [] }, fecha, ZONA, deps());
  }
}, 120_000);

const capacidadDe = (nombre: string) => {
  const id = F.drivers.find((d) => d.full_name === nombre)!.id;
  return Number(F.driver_settings.find((s) => s.profile_id === id)!.capacity_pallets);
};

describe("días reales: un clic", () => {
  it("el fichero es el esperado: 10 días, 178 órdenes que repartir, 4 choferes", () => {
    expect(DIAS).toHaveLength(10);
    expect(DIAS.reduce((n, f) => n + ordenesDe(f).length, 0)).toBe(178);
    expect(TODOS).toEqual(["Chofer A", "Chofer B", "Chofer C", "Chofer D"]);
  });

  it("1 clic coloca el 100 % en los días ligeros (18, 21, 22, 23, 25, 26, 27 y 28)", () => {
    for (const fecha of LIGEROS) {
      const r = CLIC[fecha].respuesta;
      expect({ fecha, sinColocar: r.sinColocar }).toEqual({ fecha, sinColocar: [] });
      expect(r.escrituras.filter((e) => e.nueva)).toHaveLength(ordenesDe(fecha).length);
    }
  });

  it("los dos días pesados (19 y 24) colocan lo mismo que «Planificar el día», y lo que no cabe dice por qué", () => {
    for (const fecha of ["2026-09-19", "2026-09-24"]) {
      const r = CLIC[fecha].respuesta;
      expect(r.escrituras.filter((e) => e.nueva).length).toBe(BASE[fecha].plan.writes.length);
      expect(r.sinColocar.length).toBeGreaterThan(0);
      expect(new Set(r.sinColocar.map((s) => s.motivo))).toEqual(new Set(["no_cabe_con_el_resto"]));
    }
    // En total: 153 de 178, como el motor (el `autoAssign` de antes: 40).
    expect(DIAS.reduce((n, f) => n + CLIC[f].respuesta.escrituras.filter((e) => e.nueva).length, 0)).toBe(153);
  });

  it("millas estimadas ≤ línea base del motor + 10 %", () => {
    for (const fecha of DIAS) {
      expect(CLIC[fecha].respuesta.millas).toBeLessThanOrEqual(BASE[fecha].plan.total_miles * 1.1 + 0.01);
    }
  });

  it("0 ventanas estrechas rotas", () => {
    for (const fecha of DIAS) {
      const rotas = CLIC[fecha].borrador!.paradas.filter((p) => p.kind === "D" && p.is_hard && p.late_min > 0);
      expect({ fecha, rotas: rotas.length }).toEqual({ fecha, rotas: 0 });
    }
  });

  it("nada al chofer que no rutea (D, sin base): sale en `choferesFuera` y no recibe ninguna orden", () => {
    for (const fecha of DIAS) {
      const r = CLIC[fecha].respuesta;
      expect(r.escrituras.some((e) => e.chofer === "Chofer D")).toBe(false);
      expect(r.choferesFuera).toContainEqual({ nombre: "Chofer D", motivo: "base" });
    }
  });

  it("órdenes con ventanas que se solapan van con el MISMO chofer (el choque de ventanas de `autoAssign` era el fallo)", () => {
    // El 09-27: 18 órdenes 08:30–17:30 y 12 08:30–15:30. Un chofer se lleva varias.
    const porChofer = new Map<string, number>();
    for (const e of CLIC["2026-09-27"].respuesta.escrituras) porChofer.set(e.chofer, (porChofer.get(e.chofer) ?? 0) + 1);
    expect(Math.max(...porChofer.values())).toBeGreaterThan(5);
  });

  it("cada escritura lleva chofer, viaje y puesto, y la `updated_at` con la que se planificó", () => {
    const e = CLIC["2026-09-18"].respuesta.escrituras;
    expect(e.every((w) => w.nueva && w.patch.assigned_driver === w.chofer && w.patch.load_auto === true && Number.isInteger(w.patch.route_seq))).toBe(true);
    expect(e.every((w) => w.updated_at === "2026-09-27T00:00:00.000Z")).toBe(true);
    // Viaje 1 es `null`, como lo escribe el Gestor.
    expect(e.some((w) => w.patch.load_no === 1)).toBe(false);
  });
});

describe("días reales: lo que ya lleva cada chofer", () => {
  it("nadie pasa de su capacidad en ningún viaje, contando lo que ya llevaba (dos tandas, los diez días)", async () => {
    for (const fecha of DIAS) {
      const todas = ordenesDe(fecha);
      const primera = todas.slice(0, Math.ceil(todas.length / 2));
      const r1 = await repartoConDetalle(diaCon(todas), { fecha, ordenes: primera.map((o) => o.id), choferes: TODOS }, ZONA, deps());
      const tras1 = aplica(todas, r1.respuesta.escrituras);
      const r2 = await unClic(fecha, tras1);
      if (!r2.borrador) continue;
      // Lo de la primera tanda sigue en el plan de la segunda: cuenta. Salvo el chofer «lleno», que no entra y no se toca.
      const llenos = new Set(r2.respuesta.choferesFuera.filter((c) => c.motivo === "lleno").map((c) => c.nombre));
      expect(r2.respuesta.escrituras.some((e) => llenos.has(e.chofer))).toBe(false);
      const enElPlan = new Set(r2.borrador.paradas.map((p) => p.delivery_id));
      for (const o of tras1.filter((x) => x.assigned_driver && x.assigned_driver !== "Chofer D" && !llenos.has(x.assigned_driver))) {
        expect({ fecha, id: o.id, enElPlan: enElPlan.has(o.id) }).toEqual({ fecha, id: o.id, enElPlan: true });
      }
      for (const p of r2.borrador.paradas) expect(p.load_after).toBeLessThanOrEqual(capacidadDe(p.driver_name) + 1e-9);
      // Y ninguna de la primera tanda cambia de chofer.
      for (const w of r2.respuesta.escrituras.filter((x) => !x.nueva)) expect(w.patch.assigned_driver).toBeUndefined();
    }
  }, 120_000);

  it("a lo que ya llevaba el que recibe solo se le reescribe lo que cambió (puesto o viaje), y nunca el chofer", async () => {
    const fecha = "2026-09-18";
    const todas = ordenesDe(fecha);
    const ultima = todas[todas.length - 1];
    const r1 = await unClic(fecha, todas.filter((o) => o.id !== ultima.id).concat([{ ...ultima, assigned_driver: "Nadie" }]));
    const tras = aplica(todas, r1.respuesta.escrituras);
    const r2 = (await unClic(fecha, tras)).respuesta;
    expect(r2.escrituras.filter((e) => e.nueva).map((e) => e.id)).toEqual([ultima.id]);
    const receptor = r2.escrituras.find((e) => e.nueva)!.chofer;
    const suyasAntes = tras.filter((o) => o.assigned_driver === receptor);
    expect(suyasAntes.length).toBeGreaterThan(1);
    for (const w of r2.escrituras.filter((e) => !e.nueva)) {
      const antes = tras.find((o) => o.id === w.id)!;
      expect(w.patch.assigned_driver).toBeUndefined();
      expect(antes.route_seq !== w.patch.route_seq || (antes.load_no ?? 1) !== (w.patch.load_no ?? 1)).toBe(true);
    }
    // Las que no cambiaron de sitio no se escriben: menos escrituras que órdenes en su ruta.
    expect(r2.escrituras.filter((e) => !e.nueva).length).toBeLessThan(suyasAntes.length);
  });

  it("con la lista de choferes en otro orden, el mismo resultado", async () => {
    const fecha = "2026-09-25";
    const al = await unClic(fecha, ordenesDe(fecha), [...TODOS].reverse());
    expect(al.respuesta.escrituras).toEqual(CLIC[fecha].respuesta.escrituras);
  });
});

describe("a quién no se le reparte", () => {
  it("nada a choferes que no rutean, no disponibles o con la ruta 🔒: solo recibe quien queda, y se dice", async () => {
    const fecha = "2026-09-25";
    const r = (await unClic(fecha, ordenesDe(fecha), TODOS, { noDisponibles: ["Chofer B"], bloqueadas: ["Chofer C"] })).respuesta;
    expect(new Set(r.escrituras.map((e) => e.chofer))).toEqual(new Set(["Chofer A"]));
    expect(r.choferesFuera).toEqual(expect.arrayContaining([
      { nombre: "Chofer B", motivo: "no_disponible" }, { nombre: "Chofer C", motivo: "ruta_bloqueada" }, { nombre: "Chofer D", motivo: "base" },
    ]));
  });

  it("solo los choferes elegidos: con A y C, B no recibe nada aunque rutee", () => {
    const r = CLIC["2026-09-21"].respuesta;
    expect(new Set(r.escrituras.map((e) => e.chofer)).has("Chofer B")).toBe(true); // control: con todos, B recibe
    return unClic("2026-09-21", ordenesDe("2026-09-21"), ["Chofer A", "Chofer C"]).then((x) => {
      expect(x.respuesta.escrituras.some((e) => e.chofer === "Chofer B")).toBe(false);
    });
  });

  it("una orden de otro día, ya con chofer o que ya no se rutea, no entra, y se dice por qué", () => {
    const fecha = "2026-09-18";
    const [a, b, c, ...resto] = ordenesDe(fecha);
    const otra = ordenesDe("2026-09-21")[0];
    const dia = diaCon([{ ...a, assigned_driver: "Chofer B" }, { ...b, stage: "delivered" }, c, ...resto, otra]);
    const p = datosParaElReparto(dia, { fecha, ordenes: [a.id, b.id, c.id, otra.id], choferes: TODOS });
    expect(p.elegidas).toEqual([c.id]);
    expect(p.descartadas).toEqual([
      { id: a.id, motivo: "ya_tiene_chofer" }, { id: b.id, motivo: "no_ruteable" }, { id: otra.id, motivo: "no_encontrada" },
    ]);
  });

  it("lo del día que no es de los elegidos ni está marcado no entra al motor", () => {
    const fecha = "2026-09-18";
    const [a, b, c] = ordenesDe(fecha);
    const dia = diaCon([{ ...a, assigned_driver: "Chofer B" }, { ...b, assigned_driver: "Chofer A" }, c]);
    const p = datosParaElReparto(dia, { fecha, ordenes: [c.id], choferes: ["Chofer A"] });
    expect(p.datos.ordenes.map((o) => o.id).sort()).toEqual([b.id, c.id].sort());
    expect(p.datos.choferes.map((x) => x.full_name)).toEqual(["Chofer A"]);
    // Lo que ya lleva A entra con A: el reparto no lo mueve de chofer.
    expect(p.datos.publicadoAntes).toEqual([]);
  });
});

/**
 * Un caso pequeño y medido (2026-09-27) para lo que no sale solo con los días reales: Chofer C (10 pallets, base Tienda A)
 * con el turno hasta las 12:00, y órdenes de 6 pallets desde Tienda A a ~30 millas. Cabe UNA por turno: la segunda
 * sale «no_cabe_con_el_resto». Control: con las dos normales entra `b`.
 */
const CASO = "2026-09-18";
const [OA, OB, OC] = ordenesDe(CASO);
const seis = (o: FilaDelReparto, priority: string, input_date: string, extra: Partial<FilaDelReparto> = {}) => ({
  ...o, est_pallets: 6, actual_pallets: 6, priority, input_date, pickup_name: "Tienda A", store: "Tienda A", delivery_windows: null,
  delivery_lat: 26.3, delivery_lng: -97.8, ...extra,
}) as FilaDelReparto;
const turnoCorto = F.driver_settings.map((x) => (x.profile_id === "d-3" ? { ...x, shift_end: "12:00:00" } : x));
const soloC = (ordenes: FilaDelReparto[], marcadas: FilaDelReparto[], d: Parameters<typeof repartoConDetalle>[3] = deps()) =>
  repartoConDetalle(diaCon(ordenes, { ajustesDeChofer: turnoCorto }), { fecha: CASO, ordenes: marcadas.map((o) => o.id), choferes: ["Chofer C"] }, ZONA, d);

describe("prioridad (D-412/D-415): con sitio para una, entra la urgente", () => {
  it("control: dos normales, entra una y la otra dice «no_cabe_con_el_resto»", async () => {
    const a = seis(OA, "normal", "2026-09-01"), b = seis(OB, "normal", "2026-09-10");
    const r = (await soloC([a, b], [a, b])).respuesta;
    expect(r.escrituras.map((e) => e.id)).toEqual([b.id]);
    expect(r.sinColocar).toEqual([{ id: a.id, motivo: "no_cabe_con_el_resto" }]);
  });
  it("la crítica entra aunque la normal sea la que entraría sola", async () => {
    const a = seis(OA, "critical", "2026-09-01"), b = seis(OB, "normal", "2026-09-10");
    const r = (await soloC([a, b], [a, b])).respuesta;
    expect(r.escrituras.map((e) => e.id)).toEqual([a.id]);
  });
  it("una sin punto no se coloca y lo dice con el motivo del motor («sin_punto»), no con uno genérico", async () => {
    const a = seis(OA, "normal", "2026-09-01", { pickup_name: "Tienda que no existe", store: "Tienda que no existe" });
    const r = (await soloC([a], [a])).respuesta;
    expect(r.sinColocar).toEqual([{ id: a.id, motivo: "sin_punto" }]);
  });
  it("el aviso dice aparte las altas y críticas que se quedaron sin colocar", () => {
    const a = { ...(seis(OA, "critical", "2026-09-01") as unknown as Delivery) };
    const r = { colocadas: [], sinColocar: [{ id: a.id, motivo: "no_cabe_con_el_resto" as const }], noEscritas: [], reordenadas: 0, choferesFuera: [], dias: [CASO] };
    expect(resumenDelReparto(r, () => a, (d) => String(d.order_no)).es).toContain("‼ 1 alta(s)/crítica(s) sin colocar");
    expect(resumenDelReparto(r, () => ({ ...a, priority: "normal" }), (d) => String(d.order_no)).es).not.toContain("‼");
  });
});

describe("requisitos del camión (D-418): el motor los respeta también al auto-asignar", () => {
  it("una orden que pide «Liftgate» va al único camión que lo tiene; sin ninguno, «falta_requisito»", async () => {
    const fecha = "2026-09-25";
    const ordenes = ordenesDe(fecha).map((o, i) => (i === 0 ? { ...o, requirements: ["Liftgate"] } as FilaDelReparto : o));
    const conCatalogo = { settings: { ...F.settings, delivery_requirements: ["Liftgate"] } as DiaParaElReparto["settings"] };
    const soloB = F.driver_settings.map((x) => (x.profile_id === "d-2" ? { ...x, features: ["Liftgate"] } : x));
    const r = (await unClic(fecha, ordenes, TODOS, { ...conCatalogo, ajustesDeChofer: soloB })).respuesta;
    expect(r.escrituras.find((e) => e.id === ordenes[0].id)?.chofer).toBe("Chofer B");
    const nadie = (await unClic(fecha, ordenes, TODOS, conCatalogo)).respuesta;
    expect(nadie.sinColocar).toContainEqual({ id: ordenes[0].id, motivo: "falta_requisito" });
    expect(textoDelMotivo("falta_requisito", "es")).toBe("ningún camión que rutea tiene lo que pide");
  });
});

describe("lo que YA lleva un chofer no se cae por lo nuevo", () => {
  it("una crítica nueva no le quita el sitio a la normal que el chofer ya llevaba: su ruta se congela y la crítica no entra", async () => {
    // `route_seq: 3`: si se le reescribiera la ruta a quien no recibe nada, pasaría a 0 y se vería aquí.
    const suya = seis(OA, "normal", "2026-09-01", { assigned_driver: "Chofer C", route_seq: 3 });
    const nueva = seis(OB, "critical", "2026-09-10");
    const r = await soloC([suya, nueva], [nueva]);
    expect(r.respuesta.escrituras).toEqual([]);
    expect(r.respuesta.sinColocar).toEqual([{ id: nueva.id, motivo: "no_cabe_con_el_resto" }]);
    expect(r.borrador!.paradas.map((p) => p.delivery_id)).toContain(suya.id);
  });
  it("un chofer al que ni lo suyo le cabe queda «lleno»: no recibe nada, no se le toca nada, y se dice", async () => {
    const suya1 = seis(OA, "normal", "2026-09-01", { assigned_driver: "Chofer C" });
    const suya2 = seis(OC, "normal", "2026-09-02", { assigned_driver: "Chofer C" });
    const nueva = seis(OB, "critical", "2026-09-10");
    const r = await soloC([suya1, suya2, nueva], [nueva]);
    expect(r.respuesta.escrituras).toEqual([]);
    expect(r.respuesta.choferesFuera).toContainEqual({ nombre: "Chofer C", motivo: "lleno" });
  });
  it("si hay que dar otra vuelta, no se le vuelve a preguntar al proveedor lo que ya contestó", async () => {
    const suya = seis(OA, "normal", "2026-09-01", { assigned_driver: "Chofer C" });
    const nueva = seis(OB, "critical", "2026-09-10");
    let llamadas = 0;
    const base = proveedorEstimado();
    // Se hace pasar por OSRM, para que su respuesta cuente como la del proveedor bueno y se guarde (en memoria).
    const contado = { ...base, nombre: "osrm" as const, matriz: async (o: Parameters<typeof base.matriz>[0], d: Parameters<typeof base.matriz>[1]) => { llamadas++; return base.matriz(o, d); } };
    const r = await soloC([suya, nueva], [nueva], { cache: cacheSoloLectura(cacheEnMemoria()), proveedores: [contado], ahoraISO: "2026-09-17T12:00:00.000Z" });
    expect(r.borrador!.paradas.map((p) => p.delivery_id)).toContain(suya.id); // hubo vuelta: la ruta se congeló
    expect(llamadas).toBe(Object.keys(r.borrador!.plan.input.puntos).length); // una por origen, no dos
  });
  it("un segundo clic con la misma selección no cambia nada", async () => {
    for (const fecha of ["2026-09-18", "2026-09-24"]) {
      const todas = ordenesDe(fecha);
      const tras = aplica(todas, CLIC[fecha].respuesta.escrituras);
      const otra = await repartoDelDia(diaCon(tras), { fecha, ordenes: todas.map((o) => o.id), choferes: TODOS }, ZONA, deps());
      // Las que ya se colocaron vuelven como «ya tiene chofer», no se reescriben.
      const colocadas = new Set(CLIC[fecha].respuesta.escrituras.filter((e) => e.nueva).map((e) => e.id));
      expect(otra.escrituras.some((e) => colocadas.has(e.id))).toBe(false);
      expect(otra.sinColocar.filter((x) => colocadas.has(x.id)).every((x) => x.motivo === "ya_tiene_chofer")).toBe(true);
      expect(otra.sinColocar.filter((x) => colocadas.has(x.id))).toHaveLength(colocadas.size);
    }
  }, 60_000);
});

describe("tiempos de viaje: nada de pago, nada guardado", () => {
  it("`cacheSoloLectura` lee y NO escribe", async () => {
    const debajo = cacheEnMemoria();
    const c = cacheSoloLectura(debajo);
    await c.escribe([{ origen: "a", destino: "b", dia: null, bloque: null, trafico: false, minutos: 1, millas: 1, proveedor: "osrm", pedidoEl: "2026-09-27T00:00:00Z" } as never]);
    expect(debajo.filas.size).toBe(0);
  });
  it("el reparto no llama a ningún proveedor de pago: la ruta usa OSRM y la estimación, con la caché de solo lectura", () => {
    const ruta = readFileSync(join(process.cwd(), "src/app/api/route-plan/reparto/route.ts"), "utf8");
    expect(ruta).toContain("proveedores: [proveedorOSRM(fetch as unknown as FetchFn), proveedorEstimado()]");
    expect(ruta).toContain("const cache = cacheSoloLectura(cacheEnSupabase(");
    expect(ruta).not.toMatch(/proveedorGoogle|GOOGLE_MAPS_API_KEY/);
    // Y no escribe nada: ni órdenes ni planes.
    expect(ruta).not.toMatch(/\.insert\(|\.update\(|\.upsert\(|\.delete\(|\.rpc\(/);
  });
  it("la ruta lee ausencias y candados 🔒 del día y se los pasa al motor", () => {
    const ruta = readFileSync(join(process.cwd(), "src/app/api/route-plan/reparto/route.ts"), "utf8").replace(/\s+/g, " ");
    expect(ruta).toContain("noDisponibles: [...unavailableDriverNames(");
    expect(ruta).toContain("bloqueadas: candados.fuente === \"base\" ? candados.rutas : [],");
    expect(ruta).toContain("if (candados.fuente === \"error\") return NextResponse.json(");
    // Y los requisitos del camión (D-418), con las mismas lecturas opcionales que «Planificar el día».
    expect(ruta).toContain("COLUMNAS_DE_AJUSTES, [\"delivery_requirements\"])");
    expect(ruta).toContain("COLUMNAS_DE_CHOFER, [\"features\"])");
    expect(ruta).toContain("leeOrdenesDelDia((columnas) => supabase.from(\"deliveries\").select(`${columnas}, ${COLUMNAS_EXTRA}`)");
  });
});

describe("la pantalla: un día por petición, y escribe solo si no cambió", () => {
  const orden = (id: string, fecha: string | null) => mkDelivery({ id, delivery_date: fecha as string, order_no: 1000 + Number(id.replace(/\D/g, "") || 0) });

  it("no se mezclan días: cada petición lleva SOLO las órdenes de su fecha, y sin fecha no se reparte", async () => {
    const pedidas: { fecha: string; ordenes: string[] }[] = [];
    const r = await repartirConElMotor({
      ordenes: [orden("o1", "2026-09-19"), orden("o2", "2026-09-18"), orden("o3", "2026-09-19"), orden("o4", null)],
      choferes: ["Chofer A"],
      pide: async (p) => { pedidas.push({ fecha: p.fecha, ordenes: p.ordenes }); return { fecha: p.fecha, escrituras: [], sinColocar: [], choferesFuera: [], millas: 0, proveedor: "cache" }; },
      escribe: async () => true,
    });
    expect(pedidas).toEqual([{ fecha: "2026-09-18", ordenes: ["o2"] }, { fecha: "2026-09-19", ordenes: ["o1", "o3"] }]);
    expect(r.sinColocar).toEqual([{ id: "o4", motivo: "sin_fecha" }]);
    expect(r.dias).toEqual(["2026-09-18", "2026-09-19"]);
  });

  it("días reales mezclados: el 18 y el 21 juntos colocan lo mismo que cada uno por su lado", async () => {
    const d18 = ordenesDe("2026-09-18"), d21 = ordenesDe("2026-09-21");
    const todas = [...d18, ...d21];
    const r = await repartirConElMotor({
      ordenes: todas as unknown as Delivery[], choferes: TODOS,
      pide: (p) => repartoDelDia(diaCon(todas), p, ZONA, deps()),
      escribe: async () => true,
    });
    expect(r.colocadas).toHaveLength(d18.length + d21.length);
    const d = new Map(todas.map((o) => [o.id, o.delivery_date]));
    // Ningún chofer recibe en un día lo que es del otro: cada escritura es de una orden de la fecha pedida.
    expect(new Set(r.colocadas.map((c) => d.get(c.id)))).toEqual(new Set(["2026-09-18", "2026-09-21"]));
  });

  it("lo que la base no acepta (cambió entretanto) no cuenta como colocado, y el aviso lo dice", async () => {
    const w = (id: string, nueva: boolean): EscrituraDelReparto => ({ id, chofer: "Chofer A", nueva, updated_at: "x", patch: { route_seq: 0, load_no: null } });
    const r = await repartirConElMotor({
      ordenes: [orden("o1", "2026-09-18"), orden("o2", "2026-09-18")], choferes: ["Chofer A"],
      pide: async (p) => ({ fecha: p.fecha, escrituras: [w("o1", true), w("o2", true), w("o9", false)], sinColocar: [], choferesFuera: [], millas: 0, proveedor: "cache" }),
      escribe: async (x) => x.id !== "o2",
    });
    expect(r.colocadas.map((c) => c.id)).toEqual(["o1"]);
    expect(r.noEscritas).toEqual(["o2"]);
    expect(r.reordenadas).toBe(1);
    expect(resumenDelReparto(r, () => undefined, (d) => String(d.order_no)).es).toContain("1 sin escribir (cambiaron entretanto o la base las rechazó)");
  });

  it("si el servidor falla, las órdenes de ese día quedan sin colocar con «error», y los demás días siguen", async () => {
    const r = await repartirConElMotor({
      ordenes: [orden("o1", "2026-09-18"), orden("o2", "2026-09-19")], choferes: ["Chofer A"],
      pide: async (p) => { if (p.fecha === "2026-09-18") throw new Error("500"); return { fecha: p.fecha, escrituras: [{ id: "o2", chofer: "Chofer A", nueva: true, updated_at: "x", patch: { assigned_driver: "Chofer A", route_seq: 0, load_no: null, load_auto: true } }], sinColocar: [], choferesFuera: [], millas: 0, proveedor: "cache" }; },
      escribe: async () => true,
    });
    expect(r.sinColocar).toEqual([{ id: "o1", motivo: "error" }]);
    expect(r.colocadas).toEqual([{ id: "o2", chofer: "Chofer A" }]);
  });
});

describe("quién reparte para la pantalla", () => {
  it("con base, el servidor: manda fecha, órdenes y choferes, y un error se lanza (no se da por repartido)", async () => {
    const llamadas: { url: string; cuerpo: unknown }[] = [];
    const ok = (async (url: string, init?: RequestInit) => {
      llamadas.push({ url, cuerpo: JSON.parse(String(init?.body)) });
      return new Response(JSON.stringify({ fecha: "2026-09-18", escrituras: [], sinColocar: [], choferesFuera: [], millas: 0, proveedor: "cache" }), { status: 200 });
    }) as unknown as typeof fetch;
    await pideAlServidor({ fecha: "2026-09-18", ordenes: ["o-1"], choferes: ["Chofer A"] }, ok);
    expect(llamadas).toEqual([{ url: "/api/route-plan/reparto", cuerpo: { date: "2026-09-18", order_ids: ["o-1"], drivers: ["Chofer A"] } }]);
    const mal = (async () => new Response(JSON.stringify({ error: "Only admin" }), { status: 403 })) as unknown as typeof fetch;
    await expect(pideAlServidor({ fecha: "2026-09-18", ordenes: ["o-1"], choferes: ["Chofer A"] }, mal)).rejects.toThrow("Only admin");
  });

  const delDemo = () => {
    const settings = demoSettings();
    const deliveries = demoDeliveries(settings);
    const libres = deliveries.filter((d) => !d.assigned_driver && ["pending", "approved", "fulfilling", "ready"].includes(d.stage) && d.delivery_lat != null);
    const fecha = [...new Set(libres.map((d) => d.delivery_date))].sort().at(-1)!;
    return { settings, deliveries, fecha, delDia: libres.filter((d) => d.delivery_date === fecha), choferes: DEMO_USERS.filter((u) => u.role === "driver") };
  };

  it("`pideElReparto`: con base va al servidor; sin base, al navegador (y no llama a la red)", async () => {
    const antes = globalThis.fetch;
    const urls: string[] = [];
    globalThis.fetch = (async (u: string) => { urls.push(u); return new Response(JSON.stringify({ fecha: "x", escrituras: [], sinColocar: [], choferesFuera: [], millas: 0, proveedor: "cache" }), { status: 200 }); }) as unknown as typeof fetch;
    try {
      const { settings, deliveries, fecha, delDia, choferes } = delDemo();
      const datos = () => ({ deliveries, users: DEMO_USERS, settings, availability: [], bloqueadas: () => [] });
      const p = { fecha, ordenes: delDia.map((d) => d.id), choferes: choferes.map((u) => u.full_name) };
      await pideElReparto(false, datos)(p);
      expect(urls).toEqual(["/api/route-plan/reparto"]);
      const local = await pideElReparto(true, datos)(p);
      expect(urls).toHaveLength(1);
      expect(local.escrituras.length).toBeGreaterThan(0);
    } finally { globalThis.fetch = antes; }
  });

  it("en el demo, el mismo motor en el navegador: reparte las libres del último día del demo entre sus choferes, sin red", async () => {
    const { settings, deliveries, fecha, delDia, choferes } = delDemo();
    expect(delDia.length).toBeGreaterThan(3);
    const r = await pideEnElNavegador({ fecha, ordenes: delDia.map((d) => d.id), choferes: choferes.map((u) => u.full_name) }, { deliveries, users: DEMO_USERS, settings, availability: [], bloqueadas: () => [] });
    expect(r.escrituras.filter((e) => e.nueva).length).toBeGreaterThan(delDia.length / 2);
    expect(r.proveedor).toBe("estimado");
  });

  it("en el demo, un chofer con la ruta 🔒 o de vacaciones ese día no recibe nada", async () => {
    const { settings, deliveries, fecha, delDia, choferes } = delDemo();
    const [a, b] = choferes;
    const r = await pideEnElNavegador({ fecha, ordenes: delDia.map((d) => d.id), choferes: choferes.map((u) => u.full_name) }, {
      deliveries, users: DEMO_USERS, settings, availability: [{ driver_id: a.id, start_date: fecha, end_date: fecha }], bloqueadas: () => [b.full_name],
    });
    expect(r.escrituras.some((e) => e.chofer === a.full_name || e.chofer === b.full_name)).toBe(false);
    expect(r.escrituras.length).toBeGreaterThan(0);
    expect(r.choferesFuera).toEqual(expect.arrayContaining([{ nombre: a.full_name, motivo: "no_disponible" }, { nombre: b.full_name, motivo: "ruta_bloqueada" }]));
  });
});

describe("la ruta del reparto: quién puede pedirlo", () => {
  // Mutante del orquestador: añadir `sales` a la lista sobrevivía a todas las pruebas. La ruta no escribe, pero el plan
  // que devuelve dice de TODAS las tiendas qué chofer lleva qué: la puerta es la misma que la del Gestor y el mapa.
  it("solo admin, logística y gerente; nadie más", () => {
    const ruta = readFileSync(join(process.cwd(), "src/app/api/route-plan/reparto/route.ts"), "utf8").replace(/\s+/g, " ");
    expect(ruta).toContain('if (!yo || !["admin", "logistics", "manager"].includes(String(yo.role))) return NextResponse.json(');
    expect(ruta).toContain("{ status: 403 }");
  });
});

describe("un solo camino: el Gestor y el mapa reparten con el motor", () => {
  const leer = (p: string) => readFileSync(join(process.cwd(), p), "utf8").replace(/\s+/g, " ");
  it("`autoAssign` ya no existe (nada de dos lógicas vivas)", () => {
    expect(leer("src/lib/dispatch.ts")).not.toMatch(/export function autoAssign/);
    for (const p of ["src/app/(app)/routes/page.tsx", "src/app/(app)/map/page.tsx"]) expect(leer(p)).not.toMatch(/autoAssign\(/);
  });
  it("el mapa: «Auto-asignar selección» pasa por `repartirConElMotor`, con ausencias y 🔒, y escribe solo si no cambió", () => {
    const mapa = leer("src/app/(app)/map/page.tsx");
    const cuerpo = mapa.slice(mapa.indexOf("const autoAssignSelected = async"), mapa.indexOf("// Las órdenes que tienen punto"));
    expect(cuerpo).toContain("const r = await repartirConElMotor({ ordenes: pool, choferes: drivers, pide: pideElReparto(SIN_BASE, () => ({ deliveries, users, settings, availability,");
    expect(cuerpo).toContain("const ok = await updateDelivery(w.id, w.patch, { quiet: true, siNoCambioDesde: w.updated_at || undefined });");
    expect(cuerpo).toContain("const resumen = resumenDelReparto(r, (id) => porId.get(id), orderLabel);");
  });
  it("`updateDelivery` con `siNoCambioDesde` filtra por `updated_at` y pide la fila de vuelta: cero filas = no escrito", () => {
    const p = leer("src/lib/data-provider.tsx");
    expect(p).toContain('if (opts?.siNoCambioDesde) { const { data, error } = await supabase.from("deliveries").update(patch).eq("id", id).eq("updated_at", opts.siNoCambioDesde).select("id");');
    expect(p).toContain("if (!data?.length) return false;");
  });
});
