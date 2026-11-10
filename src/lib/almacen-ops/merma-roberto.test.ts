import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PASOS, costoDelCampo, pasoCompleto, pasosVisibles, primerHueco, productoLibre, productoValido, etiquetaDeOpcion } from "./pasos";
import { productoParaEnviar } from "./datos";
import { personasParaElegir, esDelAlmacen } from "./personas";
import { puedeCorregirMerma } from "./visibilidad";
import { borrarBorrador, clave, guardarBorrador, hayCambios, leerBorrador, listarBorradores, type Almacen, type Borrador } from "./borradores";

const SQL = readFileSync(join(process.cwd(), "supabase/migrations/252_merma_fuera_de_catalogo.sql"), "utf8").replace(/\r\n/g, "\n");

function memoria(limite = Infinity): Almacen & { datos: Map<string, string> } {
  const datos = new Map<string, string>();
  return {
    datos,
    getItem: (k) => datos.get(k) ?? null,
    setItem: (k, v) => { if (v.length > limite) throw new Error("QuotaExceeded"); datos.set(k, v); },
    removeItem: (k) => { datos.delete(k); },
  };
}

const base = { split: { damaged: 4, sample: 0 }, qty: { boxes: 1, piecesPerBox: 4, loosePieces: 0 }, return_type: "internal", reason: "fell", broken_on: "2020-01-01", photo: ["data:image/jpeg;base64,/9j/"] }; // 266: la fecha del daño es obligatoria; 268: y la foto

describe("b158a7a5: producto fuera de catálogo", () => {
  it("vale con nombre y costo opcional; no con nombre corto o costo malo", () => {
    expect(productoValido(productoLibre("Piso de madera 6x36", 3.5))).toBe(true);
    expect(productoValido(productoLibre("Piso raro", null))).toBe(true);
    expect(productoValido(productoLibre("x", 1))).toBe(false);
    expect(productoValido(productoLibre("Piso", Number.NaN))).toBe(false);
    expect(productoValido({ id: 7, sku: "S", name: "N", cost: 1, pieces_per_box: 1 })).toBe(true);
    expect(primerHueco("scrap", { ...base, product: productoLibre("Piso raro", 2) })).toBe(-1);
  });
  it("el costo escrito a mano", () => {
    expect(costoDelCampo("")).toBeNull();
    expect(costoDelCampo("$12.5")).toBe(12.5);
    expect(costoDelCampo("3")).toBe(3);
    expect(costoDelCampo("1.234")).toBeNaN();
    expect(costoDelCampo("-1")).toBeNaN();
  });
  it("se envía sin product_id, con free_name y unit_cost", () => {
    expect(productoParaEnviar(productoLibre(" Piso raro ", 2))).toEqual({ product_id: null, free_name: "Piso raro", unit_cost: 2 });
    expect(productoParaEnviar({ id: 9, sku: "S", name: "N", cost: 1, pieces_per_box: 2 })).toEqual({ product_id: 9 });
  });
  it("la 252 acepta fuera de catálogo, marca la fila y deja corregir solo al gerente de la tienda", () => {
    expect(SQL).toContain("product_not_in_catalog boolean not null default false");
    expect(SQL).toContain("(product_id is not null or (product_not_in_catalog and product_name is not null))");
    expect(SQL).toContain("p_scrap->>'free_name'");
    expect(SQL).toContain("create or replace function public.warehouse_ops_edit_scrap_product(");
    expect(SQL).toContain("'warehouse_ops_supervisor' = any");
    expect(SQL).toContain("-- @ledger-below");
    expect(SQL).not.toContain("D-893");
    expect(SQL).not.toMatch(/create policy [^;]*on public\.warehouse_reports/);
  });
  it("quién corrige la merma (igual que la 252)", () => {
    const r = { kind: "scrap" as const, store: "McAllen" };
    expect(puedeCorregirMerma({ id: "a", role: "admin" }, r)).toBe(true);
    expect(puedeCorregirMerma({ id: "g", role: "manager", store: "McAllen", module_access: ["warehouse_ops"] }, r)).toBe(true);
    expect(puedeCorregirMerma({ id: "g", role: "manager", store: "Edinburg", module_access: ["warehouse_ops"] }, r)).toBe(false);
    // Desde la 265 el rol `warehouse` es «solo merma» si nadie le escribe otro nivel; el supervisor corrige con «full».
    expect(puedeCorregirMerma({ id: "s", role: "warehouse", store: "McAllen", module_access: ["warehouse_ops"], permissions: ["warehouse_ops_supervisor"], warehouse_ops_role: "full" }, r)).toBe(true);
    expect(puedeCorregirMerma({ id: "s", role: "warehouse", store: "McAllen", module_access: ["warehouse_ops"], permissions: ["warehouse_ops_supervisor"] }, r)).toBe(false);
    expect(puedeCorregirMerma({ id: "w", role: "warehouse", store: "McAllen", module_access: ["warehouse_ops"] }, r)).toBe(false);
    expect(puedeCorregirMerma({ id: "a", role: "admin" }, { kind: "safety", store: "McAllen" })).toBe(false);
  });
});

describe("0a7e46f3 y 482720a9: dañado/muestra con la cantidad, sin piezas sueltas", () => {
  it("no hay paso aparte de dañado o muestra; la cantidad lo pide (desde faa07047, como reparto)", () => {
    expect(PASOS.scrap.some((p) => p.id === "scrap_type")).toBe(false);
    const qty = PASOS.scrap.find((p) => p.id === "qty")!;
    expect(pasoCompleto(qty, { qty: base.qty })).toBe(false);
    expect(pasoCompleto(qty, { qty: base.qty, split: { damaged: 0, sample: 4 } })).toBe(true);
    expect(etiquetaDeOpcion("scrap", "scrap_type", "damaged", "es")).toBe("Dañado");
  });
});

describe("60bbd7ed: el CRMA solo si es devolución de cliente (el pedido 714584e6 que lo quitaba fue retirado)", () => {
  it("se oculta en interno y aparece en devolución", () => {
    expect(pasosVisibles("scrap", { return_type: "internal" }).some((p) => p.id === "crma")).toBe(false);
    expect(pasosVisibles("scrap", {}).some((p) => p.id === "crma")).toBe(false);
    expect(pasosVisibles("scrap", { return_type: "customer_return" }).some((p) => p.id === "crma")).toBe(true);
  });
});

describe("fec8a78d: el selector solo muestra al almacén de la tienda del reporte", () => {
  const gente = [
    { id: "1", full_name: "Ana", store: "McAllen", role: "warehouse" },
    { id: "2", full_name: "Beto", store: "Edinburg", role: "warehouse" },
    { id: "3", full_name: "Carla", store: "McAllen", role: "sales" },
    { id: "4", full_name: "Dani", store: "McAllen", role: "admin" },
    { id: "5", full_name: "Eva", store: "McAllen", role: "manager", module_access: ["warehouse_ops"] },
    { id: "6", full_name: "Fito", store: "McAllen", role: "warehouse", left_at: "2026-10-01" },
  ];
  it("de la tienda, del almacén y activos", () => {
    expect(personasParaElegir(gente, "McAllen").map((p) => p.id)).toEqual(["1", "5"]);
    expect(personasParaElegir(gente, "Edinburg").map((p) => p.id)).toEqual(["2"]);
    expect(personasParaElegir(gente, "McAllen", "an").map((p) => p.id)).toEqual(["1"]);
    expect(esDelAlmacen({ id: "x", full_name: "x", store: "A", role: "admin", module_access: ["warehouse_ops"] })).toBe(false);
  });
  it("284: un expediente sin cuenta (fuente «expediente») es del almacén y se puede elegir; de baja no", () => {
    const conExpediente = [
      { id: "1", full_name: "Ana", store: "McAllen", role: "warehouse" },
      { id: "e1", full_name: "Zoe", store: "McAllen", fuente: "expediente" as const },
      { id: "e2", full_name: "Yago", store: "McAllen", fuente: "expediente" as const, left_at: "2026-10-01" },
    ];
    expect(esDelAlmacen({ id: "e1", full_name: "Zoe", store: "McAllen", fuente: "expediente" })).toBe(true);
    expect(esDelAlmacen({ id: "e2", full_name: "Yago", store: "McAllen", fuente: "expediente", left_at: "2026-10-01" })).toBe(false);
    expect(personasParaElegir(conExpediente, "McAllen").map((p) => p.id)).toEqual(["1", "e1"]);
  });
});

describe("4a1123bb: borradores por usuario", () => {
  const b = (id: string, extra: Partial<Borrador> = {}): Borrador =>
    ({ id, tipo: "scrap", r: { reason: "fell" }, paso: 2, tienda: "McAllen", guardado: "2026-11-05T10:00:00.000Z", ...extra });
  it("guardar, leer, reemplazar y borrar; cada usuario lo suyo", () => {
    const a = memoria();
    expect(guardarBorrador("u1", b("x"), a)).toBe("ok");
    expect(guardarBorrador("u1", b("y", { guardado: "2026-11-05T11:00:00.000Z" }), a)).toBe("ok");
    expect(guardarBorrador("u1", b("x", { paso: 4, guardado: "2026-11-05T12:00:00.000Z" }), a)).toBe("ok");
    expect(listarBorradores("u1", a).map((x) => x.id)).toEqual(["x", "y"]);
    expect(leerBorrador("u1", "x", a)?.paso).toBe(4);
    expect(listarBorradores("u2", a)).toEqual([]);
    borrarBorrador("u1", "x", a);
    borrarBorrador("u1", "y", a);
    expect(a.datos.has(clave("u1"))).toBe(false);
  });
  it("si no caben las fotos, se guarda sin ellas", () => {
    const a = memoria(500);
    expect(guardarBorrador("u1", b("x", { r: { reason: "fell", photo: ["data:" + "a".repeat(1000)] } }), a)).toBe("sin-fotos");
    expect(leerBorrador("u1", "x", a)?.r.photo).toBeUndefined();
  });
  it("basura en el almacén no rompe; sin almacén no guarda", () => {
    const a = memoria();
    a.setItem(clave("u1"), "{no json");
    expect(listarBorradores("u1", a)).toEqual([]);
    expect(guardarBorrador("u1", b("x"), null)).toBe("error");
  });
  it("hay cambios", () => {
    expect(hayCambios({})).toBe(false);
    expect(hayCambios({ a: 1 })).toBe(true);
    expect(hayCambios({ a: 1 }, { a: 1 })).toBe(false);
  });
});
