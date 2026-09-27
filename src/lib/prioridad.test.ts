import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { mkDelivery } from "./__fixtures";
import {
  PRIORIDADES, conPrioridadSiCabe, etiquetaDePrioridad, laBaseTienePrioridad, prioridadDe, rangoDePrioridad, seDestaca, valorDePrioridad,
} from "./prioridad";
import { comparaCeldas, opcionesDeFiltro, ordenaFilas } from "./orden-y-filtro";
import { autoAssign } from "./dispatch";
import { repartirYOptimizar, resumenDelReparto } from "./auto-asignar";
import { COLUMNAS_DEL_GESTOR, COLUMNAS_DEL_GESTOR_POR_DEFECTO, columnasDeLaTabla } from "./routes-columns";
import { ORDEN_DE_PARTIDA } from "./orden-de-columnas";
import { demoDeliveries, demoSettings } from "./demo-data";
import type { Delivery, OrderPriority } from "./types";

/**
 * Prioridad por orden (D-412, migración 147). El dueño, comparando con OptimoRoute el 2026-09-26: prioridad por orden,
 * «las 3 haz» (la base, la pantalla y el uso en Auto-asignar).
 */

const leer = (p: string) => readFileSync(join(process.cwd(), p), "utf8").split("\r\n").join("\n");
const plano = (s: string) => s.replace(/\s+/g, " ");
const con = (priority: OrderPriority | null | undefined, over: Partial<Delivery> = {}) => mkDelivery({ priority, ...over });

describe("los cuatro niveles y su orden", () => {
  it("baja, normal, alta y crítica, como OptimoRoute; en español y en inglés", () => {
    expect(PRIORIDADES.map((p) => p.key)).toEqual(["critical", "high", "normal", "low"]);
    expect(PRIORIDADES.map((p) => p.es)).toEqual(["Crítica", "Alta", "Normal", "Baja"]);
    expect(etiquetaDePrioridad("critical", "en")).toBe("Critical");
  });
  it("sin valor, con null o con uno que no existe, la orden es NORMAL (una base sin la 147, una orden de antes)", () => {
    expect(prioridadDe(mkDelivery())).toBe("normal");
    expect(prioridadDe(con(null))).toBe("normal");
    expect(prioridadDe({ priority: "urgente" as OrderPriority })).toBe("normal");
    expect(prioridadDe(null)).toBe("normal");
    expect(prioridadDe(con("critical"))).toBe("critical");
  });
  it("el puesto: crítica 0, alta 1, normal 2, baja 3", () => {
    expect((["critical", "high", "normal", "low"] as const).map((p) => rangoDePrioridad(con(p)))).toEqual([0, 1, 2, 3]);
    expect(rangoDePrioridad(mkDelivery())).toBe(2);
  });
  it("solo alta y crítica se destacan; normal y baja no hacen ruido", () => {
    expect(PRIORIDADES.filter((p) => seDestaca(p.key)).map((p) => p.key)).toEqual(["critical", "high"]);
  });
});

describe("ordenar y filtrar la columna «Prioridad»", () => {
  const filas = [con("low"), con("normal"), con("critical"), con("high")];
  it("ascendente es crítica primero, en los dos idiomas (sin el número, «Alta» iría antes que «Crítica»)", () => {
    for (const lang of ["es", "en"] as const) {
      const r = ordenaFilas(filas, (d) => valorDePrioridad(d, lang), "asc").map((d) => prioridadDe(d));
      expect(r, lang).toEqual(["critical", "high", "normal", "low"]);
    }
    expect(comparaCeldas(valorDePrioridad(con("critical"), "es"), valorDePrioridad(con("high"), "es"))).toBeLessThan(0);
  });
  it("el menú de filtro enseña los niveles en ese orden, con su nombre", () => {
    expect(opcionesDeFiltro(filas, (d) => valorDePrioridad(d, "es")).map((o) => o.label)).toEqual(["1 · Crítica", "2 · Alta", "3 · Normal", "4 · Baja"]);
  });
});

describe("¿la base ya tiene la columna? (se aplica DESPUÉS de fusionar)", () => {
  it("se sabe por las órdenes leídas con select(*): si alguna trae la clave", () => {
    expect(laBaseTienePrioridad([])).toBe(false);
    expect(laBaseTienePrioridad([{ id: "a" }])).toBe(false);
    expect(laBaseTienePrioridad([{ id: "a" }, { id: "b", priority: "normal" }])).toBe(true);
  });
  it("sin la columna, el guardado NO lleva `priority` (fallaría la orden entera); con ella, sí", () => {
    const payload = { account: "X", priority: "high" as OrderPriority };
    expect(conPrioridadSiCabe(payload, [{ id: "a" }])).toEqual({ account: "X" });
    expect("priority" in conPrioridadSiCabe(payload, [{ id: "a" }])).toBe(false);
    expect(conPrioridadSiCabe(payload, [{ priority: "normal" }])).toEqual(payload);
  });
});

describe("Auto-asignar reparte primero lo urgente (D-401 + D-412)", () => {
  // Un chofer, capacidad justa para UNA orden de 6 pallets en un viaje: la segunda no cabe.
  const at = (id: string, priority: OrderPriority, over: Partial<Delivery> = {}) =>
    mkDelivery({ id, order_no: Number(id), priority, est_pallets: 6, delivery_lat: 26.2, delivery_lng: -98.2, ...over });
  it("con capacidad justa, se queda fuera la NORMAL y entra la CRÍTICA, aunque la normal tenga la ventana antes y el número menor", () => {
    const normal = at("1", "normal", { delivery_windows: "0800-0900" });
    const critica = at("2", "critical", { delivery_windows: "1500-1600" });
    const r = autoAssign([normal, critica], ["Ana"], () => 6, { maxTripsPerDay: 1 });
    expect(r.assignments.map((a) => a.orderId)).toEqual(["2"]);
    expect(r.unassigned.map((d) => d.id)).toEqual(["1"]);
  });
  it("el orden entero: crítica, alta, normal, baja — lo que se queda fuera es lo de menos prioridad", () => {
    const ordenes = [at("1", "low"), at("2", "normal"), at("3", "high"), at("4", "critical")];
    const r = autoAssign(ordenes, ["Ana"], () => 12, { maxTripsPerDay: 1 });
    expect(r.assignments.map((a) => a.orderId)).toEqual(["4", "3"]);
    expect(r.unassigned.map((d) => d.id)).toEqual(["2", "1"]);
  });
  it("entre iguales, lo de siempre: la ventana más temprana primero", () => {
    const r = autoAssign([at("1", "high", { delivery_windows: "1300-1400" }), at("2", "high", { delivery_windows: "0800-0900" })], ["Ana"], () => 6, { maxTripsPerDay: 1 });
    expect(r.assignments.map((a) => a.orderId)).toEqual(["2"]);
  });
  it("la ventana también se la queda la urgente: dos que chocan, entra la alta", () => {
    const r = autoAssign([at("1", "normal", { delivery_windows: "0900-1100", est_pallets: 1 }), at("2", "high", { delivery_windows: "0900-1100", est_pallets: 1 })], ["Ana"], () => 12);
    expect(r.assignments.map((a) => a.orderId)).toEqual(["2"]);
  });
  it("el diálogo le pasa a `autoAssign` las órdenes enteras, con su prioridad: la crítica recibe chofer y la normal no", async () => {
    const asignadas: string[] = [];
    const r = await repartirYOptimizar({
      ordenes: [at("1", "normal", { delivery_windows: "0800-0900" }), at("2", "critical", { delivery_windows: "1500-1600" })],
      choferes: ["Ana"], capacidadDe: () => 3, noDisponibles: new Set(), optimizar: false,
      paradasDe: () => [], esDelDia: () => true,
      asigna: async (id) => { asignadas.push(id); }, optimiza: async () => [],
    });
    expect(asignadas).toEqual(["2"]);
    expect(r.reparto.unassigned.map((d) => d.id)).toEqual(["1"]);
  });
  it("el aviso dice aparte si alguna ALTA o CRÍTICA se quedó sin colocar; si solo quedan normales, no", () => {
    const etiqueta = (d: Delivery) => d.id;
    const sinUrgentes = resumenDelReparto({ reparto: { assignments: [], unassigned: [at("1", "normal"), at("2", "low")] }, pedidas: [], optimizadas: [] }, etiqueta, false);
    expect(sinUrgentes.es).not.toContain("‼");
    const conUrgentes = resumenDelReparto({ reparto: { assignments: [], unassigned: [at("1", "critical"), at("2", "high"), at("3", "normal")] }, pedidas: [], optimizadas: [] }, etiqueta, false);
    expect(conUrgentes.es).toContain("‼ 2 alta(s)/crítica(s) sin colocar");
    expect(conUrgentes.en).toContain("‼ 2 high/critical not placed");
  });
});

describe("la pantalla usa lo de arriba", () => {
  const ficha = leer("src/components/OrderModal.tsx");
  const tabla = leer("src/components/OrdersTable.tsx");
  it("la ficha: selector «Prioridad» con los cuatro niveles, Normal si no hay valor, solo con la columna en la base, y editable con `salesFields`", () => {
    const p = plano(ficha);
    expect(p).toContain("{laBaseTienePrioridad(deliveries) && (");
    expect(p).toContain('<select data-campo="prioridad" value={prioridadDe(d)} disabled={!salesFields} onChange={(e) => set("priority", e.target.value)}>');
    expect(p).toContain("{PRIORIDADES.map((p) => <option key={p.key} value={p.key}>{t(p.en, p.es)}</option>)}");
  });
  it("la ficha: el guardado pasa por `conPrioridadSiCabe` con las órdenes cargadas", () => {
    const p = plano(ficha);
    const guardar = p.slice(p.indexOf("const save = async () => {"), p.indexOf("// Hard rule: pickup and delivery address may never be identical."));
    expect(guardar).toContain("const payload = conRequisitosSiCabe(conPrioridadSiCabe({ ...withDurations(d),");
    expect(guardar).toContain("}, deliveries), deliveries);");
  });
  it("Órdenes: la columna «Prioridad» ordena y filtra por `valorDePrioridad` y solo pinta pastilla a lo que `seDestaca`", () => {
    const c = plano(tabla.slice(tabla.indexOf('{ key: "priority"'), tabla.indexOf('{ key: "type"')));
    expect(c).toContain('key: "priority", en: "Priority", es: "Prioridad", pastillas: true, value: (d, { lang }) => valorDePrioridad(d, lang)');
    expect(c).toContain("if (seDestaca(p)) {");
    expect(c).toContain('return p === "low" ?');
    expect(c).toContain(": null;");
  });
  it("Órdenes: va junto a la etapa en el orden de partida, y nadie la ve por defecto (se elige en ⚙)", () => {
    expect(ORDEN_DE_PARTIDA.indexOf("priority")).toBe(ORDEN_DE_PARTIDA.indexOf("stage") + 1);
    expect(plano(tabla)).not.toMatch(/DEFAULT_COLUMNS = \[[^\]]*"priority"/);
    expect(leer("src/lib/constants.ts")).not.toMatch(/"priority"/);
  });
  it("el Gestor: «Prioridad» en «Sin asignar» y en paradas, con la celda de Órdenes, escondida por defecto y elegible en ⚙", () => {
    expect(COLUMNAS_DEL_GESTOR.find((c) => c.key === "priority")).toMatchObject({ tablas: ["sinAsignar"], deOrdenes: "priority", oculta: true, alFinal: true });
    expect(COLUMNAS_DEL_GESTOR.find((c) => c.key === "p_priority")).toMatchObject({ tablas: ["paradas"], deOrdenes: "priority", oculta: true });
    expect(COLUMNAS_DEL_GESTOR_POR_DEFECTO).not.toContain("priority");
    expect(COLUMNAS_DEL_GESTOR_POR_DEFECTO).not.toContain("p_priority");
    expect(columnasDeLaTabla("sinAsignar", ["priority"]).map((c) => c.key)).toEqual(["invoice", "priority"]);
    expect(columnasDeLaTabla("paradas", ["p_priority"]).map((c) => c.key)).toEqual(["p_priority"]);
  });
  it("el demo trae la columna (si no, la ficha no enseñaría el selector) y una crítica sin chofer que se vea", () => {
    const filas = demoDeliveries(demoSettings());
    expect(filas.every((d) => "priority" in d)).toBe(true);
    expect(laBaseTienePrioridad(filas)).toBe(true);
    expect(filas.some((d) => d.priority === "critical" && !d.assigned_driver && d.stage === "approved")).toBe(true);
  });
});

describe("la 147", () => {
  const sql = leer("supabase/migrations/147_prioridad_de_la_orden.sql");
  const codigo = (s: string) => s.split("\n").filter((l) => !/^\s*--/.test(l)).join("\n").replace(/\s+/g, " ");
  it("la columna: texto, NOT NULL, 'normal' por defecto, y un check con los cuatro valores", () => {
    const c = codigo(sql);
    expect(c).toContain("alter table public.deliveries add column if not exists priority text not null default 'normal';");
    expect(c).toContain("add constraint deliveries_priority_allowed check (priority in ('low', 'normal', 'high', 'critical'));");
  });
  it("no toca filas, ni el guard, ni el disparador de la 146, ni políticas", () => {
    const c = codigo(sql);
    expect(c).not.toMatch(/\bupdate public\.deliveries\b/i);
    expect(c).not.toMatch(/create or replace function/i);
    expect(c).not.toMatch(/create policy|alter policy|drop policy|\bgrant\b|\brevoke\b/i);
    expect(c).not.toMatch(/create trigger|drop trigger/i);
  });
  it("el guard de la 145 y el de la 146 no miran la prioridad (la premisa de «mismas reglas»)", () => {
    const g145 = leer("supabase/migrations/145_gerente_hace_bodega.sql");
    const g146 = leer("supabase/migrations/146_customer_siempre_con_factura.sql");
    const cuerpo = (s: string, f: string) => codigo(s.slice(s.indexOf(`create or replace function public.${f}()`), s.indexOf("end $function$")));
    expect(cuerpo(g145, "guard_delivery_stage")).not.toContain("priority");
    expect(cuerpo(g146, "guard_factura_obligatoria")).not.toContain("priority");
    // Y la autocomprobación lo exige al aplicar.
    expect(sql).toContain("if position('priority' in guard) > 0 then");
    expect(sql).toContain("if position('priority' in factura) > 0 then");
  });
  it("la autocomprobación busca la rama de la 145 que de verdad está en su guard", () => {
    const g145 = leer("supabase/migrations/145_gerente_hace_bodega.sql");
    const guard = codigo(g145.slice(g145.indexOf("create or replace function public.guard_delivery_stage()"), g145.indexOf("end $function$")));
    expect(guard).toContain("if r = 'manager' and ((old_stage = 'approved' and new_stage = 'fulfilling')");
    expect(sql).toContain("if position('if r = ''manager'' and ((old_stage = ''approved'' and new_stage = ''fulfilling'')' in guard) = 0 then");
  });
  it("sin begin/commit propios, sin D-412 (numerar cambiaría el checksum), con reversión y con su fila del registro al día", () => {
    expect(codigo(sql)).not.toMatch(/(^|;)\s*(begin|commit|rollback)\s*;/i);
    expect(sql).not.toContain("D-412");
    expect(sql).toContain("--   alter table public.deliveries drop column if exists priority;");
    const [cuerpo, registro] = sql.split("-- @ledger-below");
    const sha = createHash("sha256").update(cuerpo, "utf8").digest("hex");
    expect(registro.trim()).toBe(`insert into public.schema_migrations (name, checksum) values ('147_prioridad_de_la_orden.sql', '${sha}') on conflict (name) do nothing;`);
  });
});
