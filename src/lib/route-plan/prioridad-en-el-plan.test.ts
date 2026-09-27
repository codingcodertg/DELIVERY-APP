import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PARAMETROS_POR_DEFECTO } from "@/lib/route-engine";
import { cacheEnMemoria } from "@/lib/route-times/tiempos";
import type { ProveedorDeTiempos } from "@/lib/route-times/proveedores";
import {
  OPCIONES_DE_REPARTO_POR_DEFECTO, opcionesDeReparto, pesosDeRuta, PESOS_DE_RUTA_POR_DEFECTO, routeWeightsAlGuardar,
} from "@/lib/route-settings";
import { planificaElDia, resumenDelPlan } from "./borrador";
import { COLUMNAS_DE_ORDEN, entradaDelDia, leeOrdenesDelDia, type DatosDelDia } from "./entrada";
import { fraseDePrioridadEnRuta, fraseDePrioridadFuera, fueraConPorque, porQueDelPlan, porQueEstaAqui } from "./porque";

/**
 * La prioridad y las opciones de reparto, de la base a la pantalla (D-NEXT): la consulta que sobrevive a una base sin la
 * 147, lo que entra al motor, lo que guarda Ajustes, y lo que dice «Por qué». Tiendas y choferes inventados.
 */

const leer = (r: string) => readFileSync(join(process.cwd(), r), "utf8").split("\r\n").join("\n");
const plano = (s: string) => s.replace(/\s+/g, " ");

const AHORA = "2026-03-02T12:00:00.000Z";
/** Todo tramo, 10 minutos. Sin red. */
const proveedor: ProveedorDeTiempos = {
  nombre: "osrm", conTrafico: false,
  async matriz(os, ds) { return os.map(() => ds.map(() => ({ minutos: 10, millas: 5 }))); },
  async tramo() { return { minutos: 10, millas: 5 }; },
};
type O = DatosDelDia["ordenes"][number];
const orden = (id: string, k: number, extra: Partial<O> = {}): O => ({
  id, stage: "approved", order_code: id.toUpperCase(), order_type: "ACliente", store: "Tienda Norte", pickup_name: null, delivery_name: null,
  delivery_lat: 26.35 + k / 100, delivery_lng: -98.25, delivery_windows: "0830-1730", est_pallets: 2, actual_pallets: null,
  pickup_duration: "8 min", delivery_duration: "10 min", assigned_driver: null, input_date: "2026-03-03", input_time: `090${k}`, account: null, customer_type: null,
  is_training: false, updated_at: `2026-03-03T15:00:0${k}.000000+00:00`, ...extra,
});
/** Un chofer de 08:00 a 09:00: carga 20, ida 10, entrega 10, vuelta 10 = 50. Cabe UNA orden; dos serían 70. */
const datos = (ordenes: O[], settings: Partial<DatosDelDia["settings"]> = {}): DatosDelDia => ({
  ordenes,
  choferes: [{ id: "c1", full_name: "Chofer Uno", role: "driver" as const }],
  ajustesDeChofer: [{ profile_id: "c1", base_store: "Tienda Norte", capacity_pallets: 10, shift_start: "08:00", shift_end: "09:00", returns_to_base: true, routable: true }],
  settings: { stores: [{ name: "Tienda Norte", address: "1 Calle", lat: 26.3, lng: -98.2 }], order_type_rules: { ACliente: { storeToStore: false } }, ...settings },
});
const planifica = (d: DatosDelDia) => planificaElDia(d, "2026-03-04", "America/Chicago", { cache: cacheEnMemoria(), proveedores: [proveedor], ahoraISO: AHORA });

describe("de la base al motor", () => {
  it("la prioridad de la orden entra al motor; normal, o sin la columna, no se escribe (la entrada es la de siempre)", () => {
    const e = entradaDelDia(datos([orden("a", 0, { priority: "critical" }), orden("b", 1, { priority: "normal" }), orden("c", 2)]));
    expect(e.entrada.ordenes.map((o) => o.prioridad)).toEqual(["critical", undefined, undefined]);
    expect(e.entrada.ordenes.map((o) => "prioridad" in o)).toEqual([true, false, false]);
    // Un valor que la 147 no admite se lee normal, como en el resto de la app (`prioridadDe`).
    expect("prioridad" in entradaDelDia(datos([orden("x", 0, { priority: "urgente" as never })])).entrada.ordenes[0]).toBe(false);
  });

  it("las opciones de reparto de Ajustes llegan a los parámetros del motor, y se guardan con el plan", async () => {
    expect(entradaDelDia(datos([])).parametros).toEqual(PARAMETROS_POR_DEFECTO);
    const d = datos([], { route_weights: { ...PESOS_DE_RUTA_POR_DEFECTO, balance_por: "ordenes", usar_todos: true } });
    expect(entradaDelDia(d).parametros).toMatchObject({ balancePor: "ordenes", usarTodos: true });
    expect((await planifica(d)).plan.params).toMatchObject({ balancePor: "ordenes", usarTodos: true });
  });
});

describe("la consulta del servidor, con y sin la 147 aplicada", () => {
  it("pide `priority`; si la base aún no la tiene, vuelve a leer sin ella en vez de quedarse sin órdenes", async () => {
    const pedidas: string[] = [];
    const sinLa147 = async (cols: string) => {
      pedidas.push(cols);
      return cols.includes("priority")
        ? { data: null, error: { code: "42703", message: "column deliveries.priority does not exist" } }
        : { data: [{ id: "a" }], error: null };
    };
    expect(await leeOrdenesDelDia(sinLa147)).toEqual({ data: [{ id: "a" }], error: null });
    expect(pedidas).toEqual([`${COLUMNAS_DE_ORDEN}, priority`, COLUMNAS_DE_ORDEN]);
  });

  it("con la columna, una sola lectura; y cualquier otro error se devuelve tal cual, sin reintentar", async () => {
    let n = 0;
    const conLa147 = async () => { n++; return { data: [{ id: "a", priority: "high" }], error: null }; };
    expect((await leeOrdenesDelDia(conLa147)).data).toEqual([{ id: "a", priority: "high" }]);
    expect(n).toBe(1);
    const otro = { code: "42501", message: "permission denied for table deliveries" };
    let m = 0;
    expect(await leeOrdenesDelDia(async () => { m++; return { data: null, error: otro }; })).toEqual({ data: null, error: otro });
    expect(m).toBe(1);
    // Un 42703 de OTRA columna tampoco es cosa de la prioridad.
    let k = 0;
    const deOtra = { code: "42703", message: "column deliveries.invoice_num does not exist" };
    expect((await leeOrdenesDelDia(async () => { k++; return { data: null, error: deOtra }; })).error).toBe(deOtra);
    expect(k).toBe(1);
  });

  it("la ruta de «Planificar el día» lee las órdenes por ahí", () => {
    expect(plano(leer("src/app/api/route-plan/route.ts"))).toContain('leeOrdenesDelDia((columnas) => supabase.from("deliveries").select(columnas)');
    expect(COLUMNAS_DE_ORDEN).not.toContain("priority");
  });
});

describe("Ajustes: las opciones de reparto viven en `route_weights`, y guardar una cosa no borra la otra", () => {
  it("lo que se lee: por defecto, tiempo y sin forzar; un valor que no existe cae al de por defecto", () => {
    expect(opcionesDeReparto({})).toEqual(OPCIONES_DE_REPARTO_POR_DEFECTO);
    expect(OPCIONES_DE_REPARTO_POR_DEFECTO).toEqual({ balancePor: "tiempo", usarTodos: false });
    expect(opcionesDeReparto({ route_weights: { balance_por: "ordenes", usar_todos: true } })).toEqual({ balancePor: "ordenes", usarTodos: true });
    expect(opcionesDeReparto({ route_weights: { balance_por: "pallets" as never, usar_todos: "si" as never } })).toEqual(OPCIONES_DE_REPARTO_POR_DEFECTO);
    // Y los pesos no se enteran de que hay claves de más en el mismo jsonb.
    expect(pesosDeRuta({ route_weights: { balance_por: "ordenes", usar_todos: true } })).toEqual(PESOS_DE_RUTA_POR_DEFECTO);
  });

  it("guardar un peso conserva las opciones; guardar una opción conserva los pesos", () => {
    const guardado = { route_weights: { ...PESOS_DE_RUTA_POR_DEFECTO, balance: 0.4, balance_por: "ordenes" as const, usar_todos: true } };
    expect(routeWeightsAlGuardar(guardado, { manejo: 3 })).toEqual({ ...PESOS_DE_RUTA_POR_DEFECTO, balance: 0.4, manejo: 3, balance_por: "ordenes", usar_todos: true });
    expect(routeWeightsAlGuardar(guardado, { usar_todos: false })).toEqual({ ...PESOS_DE_RUTA_POR_DEFECTO, balance: 0.4, balance_por: "ordenes", usar_todos: false });
    // Sin nada guardado, el primer cambio deja los cinco pesos escritos, como hacía la pantalla.
    expect(routeWeightsAlGuardar({}, { balance_por: "ordenes" })).toEqual({ ...PESOS_DE_RUTA_POR_DEFECTO, balance_por: "ordenes" });
  });

  it("la pantalla de Ajustes guarda por ahí, pesos y opciones", () => {
    const pantalla = plano(leer("src/components/RouteEngineSettings.tsx"));
    expect(pantalla).toContain("saveSettings({ route_weights: routeWeightsAlGuardar(settings, { [k]: v }) }");
    expect(pantalla).toContain("saveSettings({ route_weights: routeWeightsAlGuardar(settings, cambio) }");
    expect(pantalla).toContain("onChange={() => guardaReparto({ balance_por: v })}");
    expect(pantalla).toContain("onChange={() => guardaReparto({ usar_todos: !reparto.usarTodos })}");
    expect(pantalla).toContain("const reparto = opcionesDeReparto(settings);");
    expect(pantalla).not.toContain("{ ...pesos, [k]: v }");
  });
});

describe("«Por qué» dice la prioridad", () => {
  it("de punta a punta: con UN hueco, entra la crítica, y la normal que se queda fuera dice a quién cedió el sitio", async () => {
    const b = await planifica(datos([orden("normal", 0), orden("critica", 1, { priority: "critical" })]));
    expect(b.plan.result.sinAsignar.map((s) => s.orden)).toEqual(["normal"]);
    const ordenes = b.plan.input.entrada.ordenes;
    const fuera = resumenDelPlan(b.plan, b.paradas.length, ordenes).fueraConPorque;
    expect(fuera).toEqual([{ id: "normal", orden: "normal", motivo: "no_cabe_con_el_resto", remedio: "otro_dia_o_mas_choferes", laDejoFuera: "motor", masPrioritariasDentro: 1 }]);
    expect(fraseDePrioridadFuera(fuera[0], "es")).toBe("El sitio se le dio antes a 1 orden de más prioridad.");
    const q = porQueDelPlan(b.plan.result, b.plan.input.entrada.choferes, b.paradas, ordenes);
    expect(q.critica.prioridad).toBe("critical");
    expect(fraseDePrioridadEnRuta(q.critica, "es")).toBe("Prioridad Crítica: se colocó antes que las de menos prioridad, y a igual coste va antes en su ruta.");
  });

  it("sin prioridades, nada nuevo que decir: las filas y los porqués son los de siempre", async () => {
    const b = await planifica(datos([orden("a", 0), orden("b", 1)]));
    const ordenes = b.plan.input.entrada.ordenes;
    expect(resumenDelPlan(b.plan, b.paradas.length, ordenes).fueraConPorque).toEqual(resumenDelPlan(b.plan, b.paradas.length).fueraConPorque);
    expect(resumenDelPlan(b.plan, b.paradas.length, ordenes).fueraConPorque[0]).not.toHaveProperty("masPrioritariasDentro");
    const q = porQueDelPlan(b.plan.result, b.plan.input.entrada.choferes, b.paradas, ordenes);
    for (const x of Object.values(q)) { expect(x).not.toHaveProperty("prioridad"); expect(fraseDePrioridadEnRuta(x, "es")).toBeNull(); }
  });

  it("cuántas de más prioridad van dentro: solo cuando se quedó sin sitio, y contando solo las de MÁS", () => {
    const ordenes = [
      { id: "c1", prioridad: "critical" as const }, { id: "a1", prioridad: "high" as const }, { id: "n1" }, { id: "n2", prioridad: "normal" as const },
      { id: "fuera-baja", prioridad: "low" as const }, { id: "fuera-alta", prioridad: "high" as const }, { id: "sin-pin", prioridad: "low" as const },
    ];
    const f = fueraConPorque([{ orden: "fuera-baja", motivo: "no_cabe_con_el_resto" }, { orden: "fuera-alta", motivo: "chofer_fijado_sin_hueco" }, { orden: "sin-pin", motivo: "sin_punto" }], [], ordenes);
    expect(f.map((x) => [x.id, x.prioridad, x.masPrioritariasDentro])).toEqual([
      ["fuera-alta", "high", 1],        // solo la crítica; la otra alta no es «más»
      ["fuera-baja", "low", 4],         // crítica, alta y las dos normales
      ["sin-pin", "low", undefined],    // sin punto: la prioridad no tuvo nada que ver
    ]);
    expect(fraseDePrioridadFuera(f[1], "en")).toBe("Low priority. The room went first to 4 higher-priority orders.");
    expect(fraseDePrioridadFuera(f[2], "es")).toBe("Prioridad Baja.");
    expect(fraseDePrioridadFuera({}, "es")).toBeNull();
  });

  it("la prioridad solo se dice de lo que decidió el motor; lo que movió una persona no la lleva, y la baja avisa de lo suyo", () => {
    const e = { orden: "a", chofer: "c1", aporta: { builder: 0, manejoMin: 1, millas: 1, tardeMin: 0, balanceMin: 0, total: 1 }, alternativas: [] };
    const choferes = [{ id: "c1", nombre: "Uno" }];
    expect(porQueEstaAqui([e], choferes, { a: "c1" }, [], [{ id: "a", prioridad: "high" }]).a.prioridad).toBe("high");
    expect(porQueEstaAqui([e], choferes, { a: "c1" }, ["a"], [{ id: "a", prioridad: "high" }]).a).not.toHaveProperty("prioridad");
    // Una parte de una orden partida lleva la prioridad de su orden.
    expect(porQueEstaAqui([{ ...e, orden: "a#b" }], choferes, { "a#b": "c1" }, [], [{ id: "a", prioridad: "critical" }])["a#b"].prioridad).toBe("critical");
    expect(fraseDePrioridadEnRuta({ quien: "motor", prioridad: "low" }, "es")).toBe("Prioridad Baja: es de lo primero en quedarse fuera si no cabe todo.");
    expect(fraseDePrioridadEnRuta({ quien: "persona", prioridad: "critical" }, "es")).toBeNull();
  });

  it("las pantallas pintan esas frases, y la ruta de servidor les pasa las órdenes del plan en las tres respuestas", () => {
    expect(plano(leer("src/components/PlanDelDia.tsx"))).toContain("{fraseDePrioridadFuera(x, lang) && <> {fraseDePrioridadFuera(x, lang)}</>}");
    expect(plano(leer("src/components/RutaDelPlan.tsx"))).toContain("{fraseDePrioridadEnRuta(q, lang) && <> {fraseDePrioridadEnRuta(q, lang)}</>}");
    const ruta = plano(leer("src/app/api/route-plan/route.ts"));
    for (const x of ["borrador.plan.input.entrada.ordenes", "plan.ordenes", "ajustado.plan.input.entrada.ordenes"]) {
      expect(ruta).toContain(`resumenDelPlan(${x.startsWith("plan.") ? "plan, filas.length" : x.startsWith("borrador") ? "borrador.plan, borrador.paradas.length" : "ajustado.plan, ajustado.paradas.length"}, ${x})`);
      expect(ruta).toMatch(new RegExp(`porQueDelPlan\\([^)]*, ${x.replace(/\./g, "\\.")}\\)`));
    }
  });
});
