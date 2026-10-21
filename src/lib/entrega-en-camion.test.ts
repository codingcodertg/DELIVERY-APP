import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { ETAPAS_FIJAS, estaEnElCamion, hechasDelChofer } from "./mover-parada";
import { pendientesDelDia } from "./recogida-y-ruta-del-dia";
import { cuentaDePallets, listaDelChofer } from "./lista-unica";
import { filasConLoHecho, type OrdenHecha } from "./hechas-del-gestor";
import { lecturaConLoHecho } from "./route-plan/lectura-del-gestor";
import { llegadaEnLasOrdenes } from "./valores-del-gestor";

// D-621 (2026-10-20) · Roberto (admin): «Doesnt let me move D5 down, it shouldnt be the next delivery. Its picked up which is
// fine but the delivery is after other ones». La entrega de lo YA RECOGIDO es una parada pendiente: se mueve, se mide y cuenta
// su carga a bordo; solo su recogida queda fija.

type O = OrdenHecha & { stage: string; store?: string | null; est_pallets?: number | null; actual_pallets?: number | null; route_seq?: number | null; pickup_seq?: number | null; delivery_address?: string | null };
const o = (id: string, stage: string, seq: number | null, pallets = 2): O =>
  ({ id, stage, route_seq: seq, pickup_seq: null, est_pallets: pallets, actual_pallets: null, store: "RDZ Pharr", delivery_address: `${id} Main St` } as O);

describe("la entrega de una orden en el camión es una parada pendiente", () => {
  it("lo fijo es lo ENTREGADO; lo recogido está en el camión y su entrega sigue pendiente (se mide y se mueve)", () => {
    expect([...ETAPAS_FIJAS]).toEqual(["delivered"]);
    expect(estaEnElCamion("picked_up")).toBe(true);
    expect(estaEnElCamion("ready")).toBe(false);
    const todas = [o("a", "picked_up", 0), o("b", "delivered", 1), o("c", "ready", 2)];
    expect(hechasDelChofer(todas.map((x) => ({ ...x, assigned_driver: "Ana", delivery_date: "d" })), "Ana", new Set(["d"])).map((x) => x.id)).toEqual(["b"]);
    expect(pendientesDelDia(todas).map((x) => x.id)).toEqual(["a", "c"]);
  });

  it("la lista del chofer no pinta la recogida de lo que ya va a bordo, pero sí su entrega; la cuenta arranca con esa carga", () => {
    const ordenes = [o("a", "picked_up", 0, 3), o("c", "ready", 1, 2)];
    const etiquetas = (l: ReturnType<typeof listaDelChofer>) => l.map((p) => (p.tipo === "P" ? `P${p.ordenes.join()}` : `D${p.orden}`));
    const sin = etiquetas(listaDelChofer(ordenes, 10));
    expect(sin).toContain("Pa");
    expect(sin.filter((x) => x.startsWith("D"))).toEqual(["Da", "Dc"]);
    const con = etiquetas(listaDelChofer(ordenes, 10, new Set(["a"])));
    expect(con).not.toContain("Pa");
    expect(con).toEqual(["Da", "Pc", "Dc"]);
    const cuenta = cuentaDePallets([-3, 2, -2], 10, 3);
    expect(cuenta.salida.despues).toBe(3);
    expect(cuenta.paradas.map((f) => f.despues)).toEqual([0, 2, 0]);
    expect(cuenta.totales.cargaMaxima).toBe(3);
    expect(cuentaDePallets([-3, 2, -2], 10).paradas[0].despues).toBe(-3);
  });

  it("el Gestor: la recogida de lo recogido se pinta hecha y su entrega es una fila pendiente con índice (se mueve)", () => {
    const pendientes = [o("a", "picked_up", 0, 3), o("c", "ready", 1, 2)];
    const hechas = [o("a", "picked_up", 0, 3)];
    const lectura = lecturaConLoHecho(pendientes, 10, null, []);
    expect(lectura.filas.map((f) => (f.tipo === "P" ? `P${f.ordenes.join()}` : `D${f.orden}`))).toEqual(["Da", "Pc", "Dc"]);
    const pintadas = filasConLoHecho(lectura, pendientes, hechas, 10, null);
    const texto = pintadas.map((fp) => (fp.hecha ? `✓${fp.tipo}:${fp.orden}:${fp.estado}` : `${fp.fila.tipo}#${fp.i}`));
    expect(texto).toEqual(["✓P:a:hecho", "D#0", "P#1", "D#2"]);
  });

  it("si la pantalla NO metió esa entrega entre las pendientes, se sigue pintando fija «en camino» (lo que lee solo con hechas no cambia)", () => {
    const pendientes = [o("c", "ready", 1, 2)];
    const hechas = [o("a", "picked_up", 0, 3)];
    const lectura = lecturaConLoHecho(pendientes, 10, null, []);
    const pintadas = filasConLoHecho(lectura, pendientes, hechas, 10, null);
    const texto = pintadas.map((fp) => (fp.hecha ? `✓${fp.tipo}:${fp.orden}:${fp.estado}` : `${fp.fila.tipo}#${fp.i}`));
    expect(texto.filter((x) => x.startsWith("✓")).sort()).toEqual(["✓D:a:en_camino", "✓P:a:hecho"]);
    expect(texto.filter((x) => !x.startsWith("✓"))).toEqual(["P#0", "D#1"]);
  });

  it("la llegada de una entrega en el camión es la medida si la hay", () => {
    const d = { assigned_driver: "Ana", stage: "picked_up", pod_delivered_at: null } as Parameters<typeof llegadaEnLasOrdenes>[0];
    expect(llegadaEnLasOrdenes(d, "12:52", false)).toBe("12:52");
    expect(llegadaEnLasOrdenes(d, null, false)).toBe("🚚 on its way");
  });

  it("puerta: los carriles del Gestor incluyen lo recogido, la cuenta arranca con lo a bordo, y una entrega en el camión no se pasa a otro chofer; la 187 deja a logística mover su puesto", () => {
    const pagina = readFileSync(new URL("../app/(app)/routes/page.tsx", import.meta.url), "utf8");
    expect(pagina).toContain("const byDriver = useMemo(() => rutasPorChofer([...dayOrders, ...enElCamion.filter((d) => !dayOrders.some((x) => x.id === d.id))]), [dayOrders, enElCamion]);");
    expect(pagina).toContain("const cuenta = cuentaDePallets(lectura.filas.map((f) => f.cambio), capacity, aBordoDe(stops));");
    expect(pagina).toContain("const pasar = acciones && movible && !enCamion && lanes.length > 1 && (");
    const sql = readFileSync(new URL("../../supabase/migrations/187_mover_entrega_en_camion.sql", import.meta.url), "utf8");
    expect(sql).toContain("if TG_OP = 'UPDATE' and old_stage = 'picked_up' and new_stage = 'picked_up'");
    expect(sql).toContain("probe.route_seq  := OLD.route_seq;");
    expect(sql).toContain("probe.pickup_seq := OLD.pickup_seq;");
    expect(sql).toContain("La letra de una carga es un nombre, no historia (185");
    expect(sql).not.toContain("'PENDIENTE'");
  });
});
