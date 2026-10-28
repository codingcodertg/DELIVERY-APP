import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { COLUMNAS_OPCIONALES_DE_ORDEN, entradaDelDia, type DatosDelDia } from "./entrada";

/**
 * El arranque numerado (D-722, 208), de la base a la pantalla: la columna entra al motor como \`puesto\`, el Gestor la pone,
 * el plan la enseña y publicar la gasta. Qué hace el motor con ella lo mide \`route-engine/arranque-numerado.test.ts\`.
 */
const leer = (r: string) => readFileSync(join(process.cwd(), r), "utf8").split("\r\n").join("\n");

const dia = (ordenes: DatosDelDia["ordenes"]): DatosDelDia => ({
  ordenes,
  choferes: [{ id: "c1", full_name: "Chofer Uno", role: "driver" }],
  ajustesDeChofer: [{ profile_id: "c1", routes: true, base_store: "Tienda A" } as unknown as DatosDelDia["ajustesDeChofer"][number]],
  settings: { stores: [{ name: "Tienda A", lat: 26, lng: -97 }], accounts: [], order_type_rules: {}, route_buckets: [], driver_capacity: {}, default_truck_capacity: 10 } as unknown as DatosDelDia["settings"],
});
const orden = (id: string, extra: Record<string, unknown> = {}) => ({
  id, stage: "approved", order_code: id, order_type: "delivery", store: "Tienda A", pickup_name: "Tienda A", delivery_name: "x",
  delivery_lat: 26.1, delivery_lng: -97.1, delivery_windows: null, est_pallets: 1, actual_pallets: null, pickup_duration: null,
  delivery_duration: null, assigned_driver: null, input_date: "2026-10-27", input_time: "0800", account: null, customer_type: null,
  is_training: false, updated_at: "2026-10-27T12:00:00Z", ...extra,
}) as unknown as DatosDelDia["ordenes"][number];

describe("D-722: el arranque numerado entra al motor", () => {
  it("plan_rank se lee como columna opcional (una base sin la 208 no tumba la lectura)", () => {
    expect(COLUMNAS_OPCIONALES_DE_ORDEN).toContain("plan_rank");
  });

  it("un número positivo es el puesto; null, 0 o ausente no ponen nada", () => {
    const e = entradaDelDia(dia([orden("a", { plan_rank: 2 }), orden("b", { plan_rank: null }), orden("c", { plan_rank: 0 }), orden("d")]));
    const puesto = (id: string) => e.entrada.ordenes.find((o) => o.id === id)?.puesto;
    expect(puesto("a")).toBe(2);
    expect(puesto("b")).toBeUndefined();
    expect(puesto("c")).toBeUndefined();
    expect(puesto("d")).toBeUndefined();
    expect("puesto" in e.entrada.ordenes.find((o) => o.id === "d")!).toBe(false);
  });

  it("la migración 208 crea la columna, nula, con su tope, sin tocar nada más, y con su registro", () => {
    const sql = leer("supabase/migrations/208_arranque_del_plan.sql");
    expect(sql).toContain("alter table public.deliveries add column if not exists plan_rank smallint;");
    expect(sql).toContain("check (plan_rank is null or (plan_rank between 1 and 99))");
    const cuerpo = sql.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
    expect(cuerpo).not.toMatch(/\b(begin|commit)\s*;/i);
    expect(cuerpo).not.toMatch(/create policy|drop policy|\bgrant\b|create (or replace )?function|create trigger|not null/i);
    expect(sql.split("-- @ledger-below")[1]).toContain("208_arranque_del_plan.sql");
  });

  it("el Gestor numera lo marcado con 🔢 (en el orden en que se marcó) y enseña el número en la fila", () => {
    const gestor = leer("src/app/(app)/routes/page.tsx");
    expect(gestor).toContain("const numeros = numerosDeArranque(marcadas, dayOrders);");
    expect(gestor).toContain("const marcadas = [...selectedOrders].filter((id) => filasAsignables.some((d) => d.id === id));");
    expect(gestor).toContain("await updateDelivery(n.id, { plan_rank: n.plan_rank }, { quiet: true })");
    expect(gestor).toContain('data-arranque-del-plan disabled={asignando}');
    expect(gestor).toContain('<span className="sema" data-arranque={d.plan_rank}');
    // No asigna a nadie: el botón no llama a bulkAssign.
    const fn = gestor.slice(gestor.indexOf("const numeraElArranque = async () => {"), gestor.indexOf("const bulkAssign = async"));
    expect(fn).not.toContain("bulkAssign");
    expect(fn).not.toContain("assigned_driver");
  });

  it("el plan enseña cuántas hay numeradas, con ✕ para vaciarlas; y publicar bien las gasta desde la pantalla", () => {
    const plan = leer("src/components/PlanDelDia.tsx");
    expect(plan).toContain("const numeradas = numeradasDelDia(ordenesDelDia(deliveries, date, \"dia\", ETAPAS_RUTEABLES));");
    expect(plan).toContain('data-arranque-del-plan');
    expect(plan).toContain("await updateDelivery(d.id, { plan_rank: null }, { quiet: true });");
    // Al publicar BIEN (dentro del else del res.ok), no antes ni al fallar: si publicar falla, los números se quedan.
    const publica = plan.slice(plan.indexOf("const publica = async () => {"));
    const vacia = publica.indexOf("for (const d of numeradas) void updateDelivery(d.id, { plan_rank: null }, { quiet: true });");
    expect(vacia).toBeGreaterThan(publica.indexOf("} else {"));
    expect(vacia).toBeGreaterThan(publica.indexOf('fetch("/api/route-plan/publish"'));
    // La ruta de publicar sigue sin escribir nada por su cuenta.
    expect(leer("src/app/api/route-plan/publish/route.ts")).not.toContain("plan_rank");
  });
});
