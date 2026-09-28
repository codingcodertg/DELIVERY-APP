import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { mkDelivery } from "./__fixtures";
import {
  PRIORIDADES, conPrioridadSiCabe, etiquetaDePrioridad, laBaseTienePrioridad, prioridadDe, rangoDePrioridad, seDestaca, valorDePrioridad,
} from "./prioridad";
import { comparaCeldas, opcionesDeFiltro, ordenaFilas } from "./orden-y-filtro";
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

// «Auto-asignar reparte primero lo urgente» (D-412) probaba el orden de `autoAssign`, que se quitó en D-419: Auto-asignar
// reparte ahora con el motor, que ya coloca por prioridad (D-415). Sus pruebas, con la crítica que entra y la normal que
// no, y el aviso de las urgentes sin colocar, están en `route-plan/reparto.test.ts`.

describe("la pantalla usa lo de arriba", () => {
  const ficha = leer("src/components/OrderModal.tsx");
  const tabla = leer("src/components/OrdersTable.tsx");
  it("la ficha ya NO enseña el selector «Prioridad» (D-436); la prioridad sigue en la base y en el motor", () => {
    const p = plano(ficha);
    expect(p).not.toContain("laBaseTienePrioridad(deliveries)");
    expect(p).not.toContain('data-campo="prioridad"');
  });
  it("la ficha: el guardado pasa por `conPrioridadSiCabe` con las órdenes cargadas", () => {
    const p = plano(ficha);
    const guardar = p.slice(p.indexOf("const save = async () => {"), p.indexOf("// Hard rule: pickup and delivery address may never be identical."));
    // Desde D-416 (150) lo envuelve `conAvisosSiCabe`, y desde D-418 (151) `conRequisitosSiCabe`, con las mismas órdenes: las tres columnas viajan solo si caben.
    expect(guardar).toContain("const payload = conRequisitosSiCabe(conAvisosSiCabe(conPrioridadSiCabe({ ...withDurations(d),");
    expect(guardar).toContain("}, deliveries), deliveries), deliveries);");
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
