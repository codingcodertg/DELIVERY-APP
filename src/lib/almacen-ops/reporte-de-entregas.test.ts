import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { claseDeNoLista, noListas, type OrdenEvaluada } from "./kpi-entregas";

// D-1150 (ayuda de Roberto, 2026-11-24): Reportes → Entregas es solo dos filtros y la tabla de sus órdenes.
const orden = (id: string, minutos: number | null, aTiempo: boolean, recogidaEn = "2026-11-20T15:00:00Z"): OrdenEvaluada => ({
  id, factura: id, tienda: "RDZ Pharr", dia: "2026-11-20", semana: "2026-11-15", listaEn: minutos === null ? null : "2026-11-20T15:10:00Z", recogidaEn, minutos, aTiempo, quienMarco: null,
});

describe("las dos clases de «no lista a tiempo»", () => {
  it("marcada después de recogida es «tarde»; recogida sin marca, «sin_marcar»; lista a tiempo no es ninguna", () => {
    expect(claseDeNoLista(orden("a", -12, false))).toBe("tarde");
    expect(claseDeNoLista(orden("b", 0, false))).toBe("tarde");
    expect(claseDeNoLista(orden("c", null, false))).toBe("sin_marcar");
    expect(claseDeNoLista(orden("d", 30, true))).toBeNull();
  });
  it("`noListas` trae TODAS las no listas (no diez), las tardes primero y de más a menos minutos tarde", () => {
    const muchas = Array.from({ length: 14 }, (_, i) => orden(`s${i}`, null, false, `2026-11-${String(10 + i).padStart(2, "0")}T15:00:00Z`));
    const r = noListas([orden("ok", 20, true), orden("t1", -5, false), orden("t2", -40, false), ...muchas]);
    expect(r).toHaveLength(16);
    expect(r.slice(0, 2).map((o) => o.id)).toEqual(["t2", "t1"]);
    expect(r.some((o) => o.id === "ok")).toBe(false);
  });
});

describe("la pantalla y la ruta (D-1150)", () => {
  const pantalla = readFileSync("src/app/operaciones/KpiDeEntregas.tsx", "utf8").replace(/\r\n/g, "\n");
  const ruta = readFileSync("src/app/api/almacen-ops/kpi-entregas/route.ts", "utf8").replace(/\r\n/g, "\n");
  it("el reporte ya no pinta el % ni las tablas por tienda, periodo o empleado", () => {
    for (const fuera of ["data-kpi-total-pct", "kpi-por-tienda", "kpi-por-periodo", "kpi-por-empleado", "kpi-peores", "Median ready"]) expect(pantalla, fuera).not.toContain(fuera);
  });
  it("las dos tarjetas son botones que filtran; pulsar la elegida vuelve a las dos clases", () => {
    expect(pantalla).toContain('{(["tarde", "sin_marcar"] as const).map((c) => (');
    expect(pantalla).toContain("onClick={() => setClase(clase === c ? null : c)}");
    expect(pantalla).toContain("aria-pressed={clase === c}");
    expect(pantalla).toContain('data-tabla="entregas-no-listas" filas={aLaVista}');
  });
  it("la tienda elegida arriba acota las cuentas y la tabla", () => {
    expect(pantalla).toContain('.filter((o) => tienda === "" || o.tienda === tienda)');
  });
  it("la ruta manda la lista entera, y sigue mandando lo de antes (una página abierta de antes no se rompe)", () => {
    expect(ruta).toContain("noListas: noListas(ordenes).map(");
    expect(ruta).toContain("peores: peores(ordenes, 10).map(");
    expect(pantalla).toContain("datos?.noListas ?? datos?.peores ?? []");
  });
});
