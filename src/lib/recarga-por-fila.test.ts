import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  MAX_IDS_POR_RAFAGA, TABLAS_POR_FILA, cumpleFiltroDeLaLista, filasPorEvento, fusionarFilas, planDeRafaga,
  porCreatedAtDesc, porOrderNoDesc, type EventoRealtime,
} from "./recarga-por-fila";

// D-564. Un evento realtime en `deliveries` bajaba la lista entera (~670 filas el 2026-10-15) en cada sesión
// abierta. Ahora baja la fila que cambió. Aquí se mide la decisión (qué leer, qué quitar, cuándo rendirse) y la fusión.

const ev = (table: string, eventType: EventoRealtime["eventType"], fila: Record<string, unknown>): EventoRealtime =>
  eventType === "DELETE" ? { table, eventType, new: {}, old: fila } : { table, eventType, new: fila, old: { id: fila.id } };

describe("la medida: filas que baja un cliente por un UPDATE de una orden", () => {
  it("antes la lista entera (670); después 1", () => {
    expect(filasPorEvento(670, 1)).toEqual({ antes: 670, despues: 1 });
    // 7 sesiones abiertas: 7 × 670 = 4690 filas antes; 7 después.
    expect(7 * filasPorEvento(670, 1).antes).toBe(4690);
    expect(7 * filasPorEvento(670, 1).despues).toBe(7);
  });
});

describe("planDeRafaga: qué hacer con cada payload", () => {
  it("INSERT y UPDATE de deliveries → leer esa fila por id; nada cae a lista", () => {
    const p = planDeRafaga([ev("deliveries", "UPDATE", { id: "a" }), ev("deliveries", "INSERT", { id: "b" })], { meId: "yo" });
    expect(p.listas).toEqual([]);
    expect(p.porFila.deliveries).toEqual({ leer: ["a", "b"], quitar: [] });
  });

  it("DELETE → quitar payload.old.id, sin leer nada", () => {
    const p = planDeRafaga([ev("deliveries", "DELETE", { id: "a" })], { meId: "yo" });
    expect(p.porFila.deliveries).toEqual({ leer: [], quitar: ["a"] });
  });

  it("el último evento de un id manda: UPDATE y luego DELETE = quitar; DELETE y luego INSERT = leer", () => {
    expect(planDeRafaga([ev("deliveries", "UPDATE", { id: "a" }), ev("deliveries", "DELETE", { id: "a" })], { meId: "yo" }).porFila.deliveries)
      .toEqual({ leer: [], quitar: ["a"] });
    expect(planDeRafaga([ev("deliveries", "DELETE", { id: "a" }), ev("deliveries", "INSERT", { id: "a" })], { meId: "yo" }).porFila.deliveries)
      .toEqual({ leer: ["a"], quitar: [] });
  });

  it("el mismo id tres veces en la ráfaga se lee UNA vez", () => {
    const p = planDeRafaga(Array.from({ length: 3 }, () => ev("deliveries", "UPDATE", { id: "a" })), { meId: "yo" });
    expect(p.porFila.deliveries?.leer).toEqual(["a"]);
  });

  it("sin id en el payload → esa tabla cae a la lista entera (red de seguridad)", () => {
    const p = planDeRafaga([ev("deliveries", "UPDATE", { order_no: 5 })], { meId: "yo" });
    expect(p.listas).toEqual(["deliveries"]);
    expect(p.porFila.deliveries).toBeUndefined();
  });

  it(`más de ${MAX_IDS_POR_RAFAGA} ids a leer → lista entera; justo ${MAX_IDS_POR_RAFAGA} → por fila`, () => {
    const n = (k: number) => Array.from({ length: k }, (_, i) => ev("deliveries", "UPDATE", { id: "d" + i }));
    const justo = planDeRafaga(n(MAX_IDS_POR_RAFAGA), { meId: "yo" });
    expect(justo.listas).toEqual([]);
    expect(justo.porFila.deliveries?.leer).toHaveLength(MAX_IDS_POR_RAFAGA);
    const demasiados = planDeRafaga(n(MAX_IDS_POR_RAFAGA + 1), { meId: "yo" });
    expect(demasiados.listas).toEqual(["deliveries"]);
    expect(demasiados.porFila.deliveries).toBeUndefined();
  });

  it("los DELETE no cuentan para el umbral: 30 borrados se quitan sin leer", () => {
    const p = planDeRafaga(Array.from({ length: 30 }, (_, i) => ev("deliveries", "DELETE", { id: "d" + i })), { meId: "yo" });
    expect(p.listas).toEqual([]);
    expect(p.porFila.deliveries?.quitar).toHaveLength(30);
  });

  it("una tabla que no va por fila (settings, profiles, …) sigue cayendo a su consulta entera", () => {
    const p = planDeRafaga([ev("settings", "UPDATE", { id: 1 }), ev("deliveries", "UPDATE", { id: "a" })], { meId: "yo" });
    expect(p.listas).toEqual(["settings"]);
    expect(p.porFila.deliveries).toEqual({ leer: ["a"], quitar: [] });
    expect(TABLAS_POR_FILA).toEqual(["deliveries", "order_events", "notifications"]);
  });

  it("si una tabla ya cayó a lista, sus otros eventos no se leen aparte", () => {
    const p = planDeRafaga([ev("deliveries", "UPDATE", { id: "a" }), ev("deliveries", "UPDATE", {}), ev("deliveries", "UPDATE", { id: "b" })], { meId: "yo" });
    expect(p.listas).toEqual(["deliveries"]);
    expect(p.porFila.deliveries).toBeUndefined();
  });

  it("order_events va por delivery (id de la fila); una ráfaga vacía no hace nada", () => {
    const p = planDeRafaga([ev("order_events", "INSERT", { id: "e1", delivery_id: "a" })], { meId: "yo" });
    expect(p.porFila.order_events).toEqual({ leer: ["e1"], quitar: [] });
    expect(planDeRafaga([], { meId: "yo" })).toEqual({ listas: [], porFila: {} });
  });

  it("notifications: la de OTRO usuario se ignora del todo; la mía se lee; un DELETE (sin user_id) se quita por id", () => {
    const p = planDeRafaga([
      ev("notifications", "INSERT", { id: "n1", user_id: "otro" }),
      ev("notifications", "INSERT", { id: "n2", user_id: "yo" }),
      ev("notifications", "DELETE", { id: "n3" }),
    ], { meId: "yo" });
    expect(p.listas).toEqual([]);
    expect(p.porFila.notifications).toEqual({ leer: ["n2"], quitar: ["n3"] });
    // Solo ajenas: ni se lee ni se recarga.
    expect(planDeRafaga([ev("notifications", "INSERT", { id: "n1", user_id: "otro" })], { meId: "yo" })).toEqual({ listas: [], porFila: {} });
  });
});

describe("fusionarFilas: la fila leída entra en el estado", () => {
  type F = { id: string; order_no: number; v?: string };
  const prev: F[] = [{ id: "c", order_no: 30 }, { id: "b", order_no: 20 }, { id: "a", order_no: 10 }];
  const todas = () => true;

  it("UPDATE: reemplaza la fila en su sitio, sin reordenar lo demás", () => {
    const out = fusionarFilas(prev, [{ id: "b", order_no: 20, v: "nueva" }], { leer: ["b"], quitar: [] }, todas, porOrderNoDesc);
    expect(out.map((f) => f.id)).toEqual(["c", "b", "a"]);
    expect(out[1].v).toBe("nueva");
  });

  it("INSERT: la fila nueva entra donde la deja el orden (order_no desc)", () => {
    const out = fusionarFilas(prev, [{ id: "n", order_no: 25 }], { leer: ["n"], quitar: [] }, todas, porOrderNoDesc);
    expect(out.map((f) => f.id)).toEqual(["c", "n", "b", "a"]);
    const arriba = fusionarFilas(prev, [{ id: "n", order_no: 99 }], { leer: ["n"], quitar: [] }, todas, porOrderNoDesc);
    expect(arriba[0].id).toBe("n");
    const abajo = fusionarFilas(prev, [{ id: "n", order_no: 1 }], { leer: ["n"], quitar: [] }, todas, porOrderNoDesc);
    expect(abajo[3].id).toBe("n");
  });

  it("DELETE: se quita del estado", () => {
    const out = fusionarFilas(prev, [], { leer: [], quitar: ["b"] }, todas, porOrderNoDesc);
    expect(out.map((f) => f.id)).toEqual(["c", "a"]);
  });

  it("pedida y no devuelta (RLS, o borrada entre el eco y la lectura) → se quita", () => {
    const out = fusionarFilas(prev, [], { leer: ["b"], quitar: [] }, todas, porOrderNoDesc);
    expect(out.map((f) => f.id)).toEqual(["c", "a"]);
  });

  it("devuelta pero ya no cumple el filtro de la lista → se quita; una nueva que no cumple no entra", () => {
    const cumple = (f: F) => f.v !== "fuera";
    const out = fusionarFilas(prev, [{ id: "b", order_no: 20, v: "fuera" }, { id: "n", order_no: 5, v: "fuera" }], { leer: ["b", "n"], quitar: [] }, cumple, porOrderNoDesc);
    expect(out.map((f) => f.id)).toEqual(["c", "a"]);
  });

  it("no toca lo que no estaba en la ráfaga, y no muta el estado anterior", () => {
    const copia = prev.map((f) => ({ ...f }));
    fusionarFilas(prev, [{ id: "b", order_no: 20, v: "x" }], { leer: ["b"], quitar: ["c"] }, todas, porOrderNoDesc);
    expect(prev).toEqual(copia);
  });

  it("con `max` recorta por el final (eventos: limit 1000; campana: 50)", () => {
    type E = { id: string; created_at: string };
    const eventos: E[] = [{ id: "e2", created_at: "2026-10-15T10:00:00Z" }, { id: "e1", created_at: "2026-10-15T09:00:00Z" }];
    const out = fusionarFilas(eventos, [{ id: "e3", created_at: "2026-10-15T11:00:00Z" }], { leer: ["e3"], quitar: [] }, () => true, porCreatedAtDesc, 2);
    expect(out.map((e) => e.id)).toEqual(["e3", "e2"]);
  });
});

describe("cumpleFiltroDeLaLista: el mismo filtro que deliveriesQuery", () => {
  const floor = "2026-06-17";
  const base = { is_training: false, delivery_date: "2026-10-15", input_date: "2026-10-14", stage: "pending" };

  it("una orden de enseñanza nunca entra en la lista real", () => {
    expect(cumpleFiltroDeLaLista({ ...base, is_training: true }, floor)).toBe(false);
    expect(cumpleFiltroDeLaLista({ ...base, is_training: null }, floor)).toBe(false);
    expect(cumpleFiltroDeLaLista(base, floor)).toBe(true);
  });

  it("vieja y terminada → fuera; vieja pero abierta → dentro; sin fecha → dentro; input_date reciente → dentro", () => {
    const vieja = { ...base, delivery_date: "2026-01-02", input_date: "2026-01-01" };
    expect(cumpleFiltroDeLaLista({ ...vieja, stage: "delivered" }, floor)).toBe(false);
    expect(cumpleFiltroDeLaLista({ ...vieja, stage: "canceled" }, floor)).toBe(false);
    expect(cumpleFiltroDeLaLista({ ...vieja, stage: "ready" }, floor)).toBe(true);
    expect(cumpleFiltroDeLaLista({ ...vieja, stage: "delivered", delivery_date: null }, floor)).toBe(true);
    expect(cumpleFiltroDeLaLista({ ...vieja, stage: "delivered", input_date: "2026-10-01" }, floor)).toBe(true);
    expect(cumpleFiltroDeLaLista({ ...vieja, stage: "delivered", delivery_date: floor }, floor)).toBe(true);
  });

  it("sin suelo (una pantalla pidió todo el histórico) entra cualquier orden real", () => {
    expect(cumpleFiltroDeLaLista({ ...base, delivery_date: "2020-01-01", input_date: "2020-01-01", stage: "delivered" }, null)).toBe(true);
  });
});

describe("el proveedor (data-provider.tsx) engancha la ráfaga a la lectura por fila", () => {
  const src = readFileSync(new URL("./data-provider.tsx", import.meta.url), "utf8");

  it("el temporizador de la ráfaga aplica el plan por fila, no la recarga por tabla", () => {
    expect(src).toMatch(/void aplicarRafaga\(eventos\)/);
    expect(src).not.toMatch(/void reloadTables\(tables\)/);
  });

  it("`.in(\"id\", …)` nunca se llama con una lista vacía: cada una va tras `if (plan.leer.length)`", () => {
    const ins = src.match(/\.in\("id", plan\.leer\)/g) ?? [];
    const guardas = src.match(/if \(plan\.leer\.length\) \{/g) ?? [];
    expect(ins.length).toBe(TABLAS_POR_FILA.length);
    expect(guardas.length).toBe(ins.length);
    // Y cada guarda precede a su `.in` (no una guarda suelta en otro sitio).
    const trozos = src.split(/if \(plan\.leer\.length\) \{/).slice(1);
    for (const t of trozos) expect(t.indexOf('.in("id", plan.leer)')).toBeGreaterThanOrEqual(0);
  });
});
