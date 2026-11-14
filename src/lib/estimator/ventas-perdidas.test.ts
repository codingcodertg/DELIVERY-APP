import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  almacenDePerdidasDemo, csvDePerdidas, faltaEnPerdida, filaDePerdida, filtraPerdidas, masNuevaPrimero,
  metaDePerdidaVacia, puedeQuitarPerdida, resumenDePerdidas, type MetaDePerdida, type VentaPerdida,
} from "./ventas-perdidas";

const HOY = "2026-11-14";

function venta(over: Partial<VentaPerdida> = {}): VentaPerdida {
  return {
    id: "v1", created_at: "2026-11-14T15:00:00Z", created_by: "u-sales", created_by_name: "Sam Sales",
    store: "Edinburg", sale_date: HOY, item: "Porcelain tile 12x24", quantity: 240, unit: "SF",
    est_value: 1450, reason: "out_of_stock", customer: null, notes: null, ...over,
  };
}

function meta(over: Partial<MetaDePerdida> = {}): MetaDePerdida {
  return { ...metaDePerdidaVacia("Edinburg", HOY), item: "Cement board 3x5", ...over };
}

describe("faltaEnPerdida", () => {
  it("pide el artículo y la fecha, y nada más", () => {
    expect(faltaEnPerdida(meta({ item: "   " }))).toBe("articulo");
    expect(faltaEnPerdida(meta({ sale_date: "" }))).toBe("fecha");
    expect(faltaEnPerdida(meta())).toBeNull();
  });
});

describe("filaDePerdida", () => {
  it("recorta el texto, redondea el dinero y deja null lo vacío", () => {
    const f = filaDePerdida(meta({ item: "  Tile  ", customer: " ", notes: "", est_value: 10.456, quantity: -3, unit: "" }));
    expect(f.item).toBe("Tile");
    expect(f.customer).toBeNull();
    expect(f.notes).toBeNull();
    expect(f.est_value).toBe(10.46);
    expect(f.quantity).toBeNull();
    expect(f.unit).toBeNull();
  });

  it("no manda quién la anota: lo pone el disparador de la base", () => {
    const f = filaDePerdida(meta()) as Record<string, unknown>;
    expect(f).not.toHaveProperty("created_by");
    expect(f).not.toHaveProperty("created_by_name");
    expect(f).not.toHaveProperty("created_at");
  });
});

describe("puedeQuitarPerdida", () => {
  it("quita quien la anotó o el admin, y a nadie más", () => {
    expect(puedeQuitarPerdida(venta(), { id: "u-sales", admin: false })).toBe(true);
    expect(puedeQuitarPerdida(venta(), { id: "u-sales2", admin: false })).toBe(false);
    expect(puedeQuitarPerdida(venta(), { id: "u-admin", admin: true })).toBe(true);
    expect(puedeQuitarPerdida(venta({ created_by: null }), { id: "", admin: false })).toBe(false);
  });
});

describe("filtraPerdidas", () => {
  const lista = [
    venta({ id: "a", sale_date: "2026-11-01", store: "Edinburg" }),
    venta({ id: "b", sale_date: "2026-11-14", store: "Weslaco" }),
    venta({ id: "c", sale_date: "2026-10-20", store: null }),
  ];
  it("incluye las fechas de los dos extremos", () => {
    expect(filtraPerdidas(lista, { desde: "2026-11-01", hasta: "2026-11-14", tienda: "" }).map((p) => p.id)).toEqual(["a", "b"]);
  });
  it("filtra por tienda; una fila sin tienda no sale con una tienda", () => {
    expect(filtraPerdidas(lista, { desde: "", hasta: "", tienda: "Weslaco" }).map((p) => p.id)).toEqual(["b"]);
    expect(filtraPerdidas(lista, { desde: "", hasta: "", tienda: "" })).toHaveLength(3);
  });
});

describe("masNuevaPrimero", () => {
  it("ordena por fecha de venta y, dentro del día, por hora de anotación", () => {
    const lista = [
      venta({ id: "viejo", sale_date: "2026-11-10", created_at: "2026-11-10T09:00:00Z" }),
      venta({ id: "mismoDiaTemprano", sale_date: "2026-11-14", created_at: "2026-11-14T09:00:00Z" }),
      venta({ id: "mismoDiaTarde", sale_date: "2026-11-14", created_at: "2026-11-14T18:00:00Z" }),
    ];
    expect(masNuevaPrimero(lista).map((p) => p.id)).toEqual(["mismoDiaTarde", "mismoDiaTemprano", "viejo"]);
  });
});

describe("resumenDePerdidas", () => {
  it("suma el dinero (las filas sin valor no suman), agrupa por tienda y cuenta artículos", () => {
    const lista = [
      venta({ id: "1", store: "Edinburg", item: "Tile 12x24", est_value: 100 }),
      venta({ id: "2", store: "Edinburg", item: "tile 12x24 ", est_value: null }),
      venta({ id: "3", store: "Weslaco", item: "Cement board", est_value: 50.5 }),
      venta({ id: "4", store: null, item: "Tile 12x24", est_value: 0 }),
    ];
    const r = resumenDePerdidas(lista);
    expect(r.filas).toBe(4);
    expect(r.dinero).toBe(150.5);
    expect(r.conValor).toBe(3);
    expect(r.porTienda[0]).toEqual({ tienda: "Edinburg", filas: 2, dinero: 100 });
    expect(r.porTienda.find((s) => s.tienda === "—")?.filas).toBe(1);
    expect(r.topArticulos[0]).toEqual({ articulo: "Tile 12x24", filas: 3 });
    expect(r.topArticulos[1]).toEqual({ articulo: "Cement board", filas: 1 });
  });

  it("con nada, todo en cero", () => {
    expect(resumenDePerdidas([])).toEqual({ filas: 0, dinero: 0, conValor: 0, porTienda: [], topArticulos: [] });
  });
});

describe("csvDePerdidas", () => {
  const rotulos = {
    motivo: (m: string) => `motivo ${m}`,
    cabeceras: ["Fecha", "Tienda", "Vendedor", "Artículo", "Cantidad", "Unidad", "Motivo", "Valor", "Cliente", "Notas"],
  };
  it("pone cabeceras y escapa comas, comillas y fórmulas", () => {
    const { nombre, csv } = csvDePerdidas(
      [venta({ item: 'Tile, "12x24"', notes: "=HYPERLINK()", customer: null, unit: "SF" })],
      rotulos, HOY,
    );
    expect(nombre).toBe("ventas-perdidas-2026-11-14.csv");
    const [cab, fila] = csv.split("\r\n");
    expect(cab.startsWith("Fecha,Tienda,Vendedor")).toBe(true);
    expect(fila).toContain('"Tile, ""12x24"""');
    expect(fila).toContain("'=HYPERLINK()");
    expect(fila).toContain("motivo out_of_stock");
  });
});

describe("almacenDePerdidasDemo", () => {
  const yo: { id: string; name: string; admin: boolean; store?: string | null } = { id: "u-sales", name: "Sam Sales", admin: false, store: "Edinburg" };
  const otra: typeof yo = { id: "u-sales2", name: "Sofia Ventas", admin: false, store: "Weslaco" };
  const admin: typeof yo = { id: "u-admin", name: "Admin", admin: true, store: null };

  it("trae filas inventadas y anota con el nombre y la tienda de quien la anota", async () => {
    let quien = yo;
    const a = almacenDePerdidasDemo(() => quien, false, HOY);
    const antes = await a.listar({ desde: "", hasta: "", tienda: "" });
    expect(antes.ok && antes.valor.length).toBeGreaterThanOrEqual(3);

    const nueva = await a.anotar(meta({ store: "" }));
    expect(nueva.ok).toBe(true);
    if (!nueva.ok) return;
    expect(nueva.valor.created_by_name).toBe("Sam Sales");
    expect(nueva.valor.store).toBe("Edinburg");

    quien = admin;
    const despues = await a.listar({ desde: "", hasta: "", tienda: "" });
    expect(despues.ok && despues.valor.some((p) => p.id === nueva.valor.id)).toBe(true);
  });

  it("quita solo la propia (o todo si es admin)", async () => {
    let quien = yo;
    const a = almacenDePerdidasDemo(() => quien, false, HOY);
    const r = await a.anotar(meta());
    if (!r.ok) throw new Error("no anotó");
    quien = otra;
    expect((await a.quitar(r.valor)).ok).toBe(false);
    quien = admin;
    expect((await a.quitar(r.valor)).ok).toBe(true);
    const lista = await a.listar({ desde: "", hasta: "", tienda: "" });
    expect(lista.ok && lista.valor.some((p) => p.id === r.valor.id)).toBe(false);
  });

  it("con sinTabla se comporta como la base sin la 308", async () => {
    const a = almacenDePerdidasDemo(() => yo, true, HOY);
    const r = await a.listar({ desde: "", hasta: "", tienda: "" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.sinTabla).toBe(true);
  });

  it("filtra por rango y tienda como la base", async () => {
    const a = almacenDePerdidasDemo(() => yo, false, HOY);
    const r = await a.listar({ desde: HOY, hasta: HOY, tienda: "Edinburg" });
    expect(r.ok && r.valor.every((p) => p.sale_date === HOY && p.store === "Edinburg")).toBe(true);
  });
});

describe("migración 308", () => {
  const sql = readFileSync(join(process.cwd(), "supabase/migrations/308_ventas_perdidas.sql"), "utf8");

  it("crea la tabla con el motivo y la unidad acotados, y sin DELETE para nadie", () => {
    expect(sql).toMatch(/create table if not exists public\.estimator_lost_sales/);
    expect(sql).toMatch(/reason\s+text not null default 'out_of_stock'/);
    expect(sql).toMatch(/'out_of_stock','not_enough_stock','discontinued','other'/);
    expect(sql).toMatch(/'SF','boxes','pieces','bags','other'/);
    expect(sql).toMatch(/grant select, insert, update on public\.estimator_lost_sales to authenticated;/);
    expect(sql).not.toMatch(/grant[^;]*delete/i);
  });

  it("RLS: ver con el módulo y no borradas; anotar a su nombre; corregir solo quien anotó o admin", () => {
    expect(sql).toMatch(/for select to authenticated\s+using \(\(select public\.has_estimator_access\(\)\) and deleted_at is null\)/);
    expect(sql).toMatch(/for insert to authenticated\s+with check \(\(select public\.has_estimator_access\(\)\) and created_by = \(select auth\.uid\(\)\)\)/);
    expect(sql).toMatch(/for update to authenticated/);
    expect(sql).toMatch(/created_by = \(select auth\.uid\(\)\)+\s+with check/);
  });

  it("es idempotente y no tiene begin/commit propios", () => {
    expect(sql).toMatch(/drop policy if exists "estimator_lost_sales select"/);
    expect(sql).toMatch(/drop trigger if exists estimator_lost_sales_guard/);
    expect(sql).not.toMatch(/^\s*(begin|commit);/im);
  });
});
