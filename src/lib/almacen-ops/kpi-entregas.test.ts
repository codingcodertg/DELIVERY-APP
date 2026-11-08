import { describe, expect, it } from "vitest";
import { colorDelPct, domingoDe, rangoValido, evaluarOrdenes, mediana, peores, porEmpleado, porPeriodo, porTienda, tiendasDelKpi, totalDelKpi, type EntregaDelKpi, type EventoDeOrden } from "./kpi-entregas";

/** KPI de entregas del almacén (Roberto, fase 1): % de órdenes listas antes de que llegue el chofer. */
const orden = (id: string, store: string, invoice_num: string | null = `INV-${id}`): EntregaDelKpi => ({ id, order_code: `C-${id}`, invoice_num, store, pickup_name: store, delivery_date: "2026-11-05" });
const ev = (delivery_id: string, kind: string, created_at: string, created_by: string | null = "u1"): EventoDeOrden => ({ delivery_id, kind, created_at, created_by });

// Todo en una mañana de Texas (CST = UTC−6): 2026-11-05 15:00Z = 09:00 en Texas.
const T = (hhmm: string) => `2026-11-05T${hhmm}:00Z`;

describe("evaluarOrdenes: la regla", () => {
  it("último ready antes del primer picked_up = a tiempo; minutos = recogida − lista", () => {
    const [o] = evaluarOrdenes([orden("a", "Pharr")], [ev("a", "ready", T("14:00")), ev("a", "picked_up", T("14:30"))]);
    expect(o.aTiempo).toBe(true);
    expect(o.minutos).toBe(30);
    expect(o.quienMarco).toBe("u1");
    expect(o.dia).toBe("2026-11-05");
    expect(o.semana).toBe("2026-11-01"); // domingo
    expect(o.factura).toBe("INV-a");
  });
  it("un empate (misma hora) NO cuenta como a tiempo", () => {
    const [o] = evaluarOrdenes([orden("a", "Pharr")], [ev("a", "ready", T("14:00")), ev("a", "picked_up", T("14:00"))]);
    expect(o.aTiempo).toBe(false);
    expect(o.minutos).toBe(0);
  });
  it("recogida sin ningún ready = no lista, sin minutos, de nadie", () => {
    const [o] = evaluarOrdenes([orden("a", "Pharr")], [ev("a", "picked_up", T("14:00"))]);
    expect(o.aTiempo).toBe(false);
    expect(o.minutos).toBeNull();
    expect(o.quienMarco).toBeNull();
  });
  it("varios ready: manda el ÚLTIMO (y quién lo marcó); varios picked_up: manda el PRIMERO", () => {
    const [o] = evaluarOrdenes([orden("a", "Pharr")], [
      ev("a", "ready", T("13:00"), "u1"),
      ev("a", "picked_up", T("14:00")),
      ev("a", "ready", T("14:20"), "u2"), // se volvió a marcar después de recogida: tarde 20 min
      ev("a", "picked_up", T("15:00")),
    ]);
    expect(o.aTiempo).toBe(false);
    expect(o.minutos).toBe(-20);
    expect(o.quienMarco).toBe("u2");
  });
  it("una orden nunca recogida no cuenta; una orden que no está en la lista tampoco", () => {
    const out = evaluarOrdenes([orden("a", "Pharr")], [ev("a", "ready", T("14:00")), ev("zz", "picked_up", T("14:00"))]);
    expect(out).toEqual([]);
  });
  it("el rango va por el día de Texas en que se recogió", () => {
    const evs = [ev("a", "picked_up", "2026-11-06T03:00:00Z")]; // 21:00 del día 5 en Texas
    expect(evaluarOrdenes([orden("a", "Pharr")], evs, { desde: "2026-11-05", hasta: "2026-11-05" })).toHaveLength(1);
    expect(evaluarOrdenes([orden("a", "Pharr")], evs, { desde: "2026-11-06", hasta: "2026-11-06" })).toHaveLength(0);
  });
  it("sin factura usa el código de la orden; sin tienda, «—»", () => {
    const [o] = evaluarOrdenes([{ ...orden("a", "", null) }], [ev("a", "picked_up", T("14:00"))]);
    expect(o.factura).toBe("C-a");
    expect(o.tienda).toBe("—");
  });
});

describe("los grupos", () => {
  const entregas = [orden("a", "Pharr"), orden("b", "Pharr"), orden("c", "Pharr"), orden("d", "McAllen"), orden("e", "McAllen")];
  const eventos = [
    ev("a", "ready", T("13:00"), "u1"), ev("a", "picked_up", T("14:00")),               // a tiempo, 60
    ev("b", "ready", T("14:10"), "u1"), ev("b", "picked_up", T("14:00")),               // tarde, −10
    ev("c", "picked_up", T("14:00")),                                                    // sin marcar
    ev("d", "ready", T("13:50"), "u2"), ev("d", "picked_up", T("14:00")),               // a tiempo, 10
    ev("e", "ready", T("13:30"), "u2"), ev("e", "picked_up", "2026-11-09T14:00:00Z"),   // a tiempo, otra semana, 4 días
  ];
  const ordenes = evaluarOrdenes(entregas, eventos);

  it("el total: a tiempo / tarde / sin marcar, % redondeado y mediana sobre las que tienen ready", () => {
    const t = totalDelKpi(ordenes);
    expect(t).toMatchObject({ total: 5, aTiempo: 3, tarde: 1, sinMarcar: 1, pct: 60 });
    // minutos con ready: 60, −10, 10, 5790 → mediana de pares = (10 + 60) / 2 = 35
    expect(t.medianaMin).toBe(35);
  });
  it("por tienda, por nombre", () => {
    const g = porTienda(ordenes);
    expect(g.map((x) => x.clave)).toEqual(["McAllen", "Pharr"]);
    expect(g[1]).toMatchObject({ total: 3, aTiempo: 1, tarde: 1, sinMarcar: 1, pct: 33, medianaMin: 25 });
    expect(g[0]).toMatchObject({ total: 2, aTiempo: 2, pct: 100 });
  });
  it("por día y por semana (domingo)", () => {
    expect(porPeriodo(ordenes, "dia").map((x) => [x.clave, x.total])).toEqual([["2026-11-05", 4], ["2026-11-09", 1]]);
    expect(porPeriodo(ordenes, "semana").map((x) => [x.clave, x.total])).toEqual([["2026-11-01", 4], ["2026-11-08", 1]]);
  });
  it("por empleado: quién marcó el último ready; las sin ready no son de nadie; nombre por profiles", () => {
    const e = porEmpleado(ordenes, { u1: "Ana", u2: "Beto" });
    expect(e.map((x) => [x.nombre, x.total, x.aTiempo, x.pct])).toEqual([["Ana", 2, 1, 50], ["Beto", 2, 2, 100]]);
    expect(e.reduce((n, x) => n + x.total, 0)).toBe(4); // la «c» no cuenta para nadie
    expect(porEmpleado(ordenes, new Map([["u1", "Ana"]])).find((x) => x.clave === "u2")?.nombre).toBe("—");
  });
  it("las peores: primero las marcadas tarde (más tarde primero), luego las nunca marcadas", () => {
    const p = peores(ordenes);
    expect(p.map((x) => x.id)).toEqual(["b", "c"]);
    expect(peores(ordenes, 1).map((x) => x.id)).toEqual(["b"]);
  });
});

describe("ayudas", () => {
  it("mediana: impar, par, vacía", () => {
    expect(mediana([3, 1, 2])).toBe(2);
    expect(mediana([1, 2, 3, 4])).toBe(3); // 2.5 → 3
    expect(mediana([])).toBeNull();
  });
  it("domingo de la semana", () => {
    expect(domingoDe("2026-11-05")).toBe("2026-11-01");
    expect(domingoDe("2026-11-01")).toBe("2026-11-01");
    expect(domingoDe("2026-11-07")).toBe("2026-11-01");
  });
  it("el rango de la ruta: cerrado, bien escrito y de a lo más 62 días", () => {
    expect(rangoValido("2026-11-01", "2026-11-08")).toBe(true);
    expect(rangoValido("2026-11-08", "2026-11-01")).toBe(false);
    expect(rangoValido("2026-09-01", "2026-11-01")).toBe(true); // 61 días
    expect(rangoValido("2026-08-01", "2026-11-01")).toBe(false);
    expect(rangoValido("", "2026-11-01")).toBe(false);
  });
  it("colores", () => {
    expect(colorDelPct(null)).toBe("gris");
    expect(colorDelPct(95)).toBe("verde");
    expect(colorDelPct(75)).toBe("ambar");
    expect(colorDelPct(50)).toBe("rojo");
  });
  it("tiendas que le tocan: admin todas; gerente la suya y las visibles; sin ninguna, todas", () => {
    expect(tiendasDelKpi({ role: "admin" })).toBeNull();
    expect(tiendasDelKpi({ role: "manager", warehouse_ops_role: "admin", store: "Pharr" })).toBeNull();
    expect(tiendasDelKpi({ role: "manager", store: "Pharr", visible_stores: ["McAllen", "Pharr"] })).toEqual(["Pharr", "McAllen"]);
    expect(tiendasDelKpi({ role: "manager" })).toBeNull();
  });
});
