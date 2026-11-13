import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ETAPAS_DE_CONTEO, accionesDeConteo, diferencia, estaAbierto, etapaHecha, faltaDelAlcance, fechaDeEtapaDeConteo, filasDeHojaDeConteo, idDeHoja, ordenarLineas,
  ordenarPorDiferencia, progresoDelConteo, puedeContar, puedeGestionarConteo, resumenDelConteo, siguienteEtapaDeConteo, tituloDeAlcance, totalContado, validarCaptura,
  valorDeLaDiferencia, veConteos, type Conteo, type Linea,
} from "./conteos";
import { faltaLa274 } from "./conteos-datos";
import type { Quien } from "./visibilidad";

/** 274: los conteos de inventario de Roberto: alcance, cinco pasos, cuentas de línea, permisos y la hoja. */
const SQL = readFileSync(join(__dirname, "../../../supabase/migrations/274_conteos_de_inventario.sql"), "utf8");

const linea = (x: Partial<Linea> = {}): Linea => ({
  id: "l", count_id: "c", product_id: 1, sku: "SKU", name: "Prod", size_in: "24x48", system_qty: 100, price: 10, pieces_per_box: 4,
  counted_boxes: null, counted_pieces: null, counted_total: null, counted_by: null, counted_by_name: null, counted_at: null, note: null, photo: null,
  recount_requested: false, recount_note: null, position: 1, ...x,
});
const contada = (total: number, x: Partial<Linea> = {}) => linea({ counted_total: total, counted_at: "2026-11-08T10:00:00Z", counted_by: "p1", counted_by_name: "Ana", ...x });
const conteo = (x: Partial<Conteo> = {}): Conteo => ({
  id: "c", store: "Pharr", scope_kind: "vendor_size", vendor_name: "Daltile", size_in: "24x48", note: null, product_id: null, title: "Daltile · 24x48", stage: "organizing",
  instructions: null, comments: null, created_by: "m", created_by_name: "Gerente", created_at: "2026-11-01T10:00:00Z",
  organized_at: null, organized_by: null, orders_reviewed_at: null, orders_reviewed_by: null, orders_note: null, counting_done_at: null, counting_done_by: null,
  signed_at: null, signed_by: null, signed_by_name: null, signed_sheet: null, adjusted_at: null, adjusted_by: null, adjustment_shots: [], cancelled_at: null, cancelled_by: null, cancel_note: null, ...x,
});

const personal: Quien = { id: "p1", role: "warehouse", store: "Pharr", module_access: ["warehouse_ops"] };
const gerente: Quien = { id: "m", role: "manager", store: "Pharr", module_access: ["warehouse_ops"] };
const gerenteOtra: Quien = { id: "m2", role: "manager", store: "McAllen", module_access: ["warehouse_ops"] };
const admin: Quien = { id: "a", role: "admin" };
const sinApp: Quien = { id: "s", role: "sales" };

describe("el alcance y su título", () => {
  it("proveedor + medida, proveedor + nota, producto (SKU · nombre)", () => {
    expect(tituloDeAlcance({ scope_kind: "vendor_size", vendor_name: " Daltile ", size_in: "24x48" })).toBe("Daltile · 24x48");
    expect(tituloDeAlcance({ scope_kind: "vendor_note", vendor_name: "Daltile", note: "black" })).toBe("Daltile · black");
    expect(tituloDeAlcance({ scope_kind: "product", product_id: 5, product_sku: "PORC-1", product_name: "Porcelain" })).toBe("PORC-1 · Porcelain");
  });
  it("dice qué falta antes de pedir la vista previa", () => {
    expect(faltaDelAlcance({ scope_kind: "vendor_size" })).toBe("vendor");
    expect(faltaDelAlcance({ scope_kind: "vendor_size", vendor_name: "Daltile" })).toBe("size");
    expect(faltaDelAlcance({ scope_kind: "vendor_note", vendor_name: "Daltile", note: "b" })).toBe("note");
    expect(faltaDelAlcance({ scope_kind: "vendor_note", vendor_name: "Daltile", note: "bl" })).toBeNull();
    expect(faltaDelAlcance({ scope_kind: "product" })).toBe("product");
    expect(faltaDelAlcance({ scope_kind: "product", product_id: 1 })).toBeNull();
  });
  it("la base arma el mismo título y exige lo mismo", () => {
    expect(SQL).toContain(`btrim(p_vendor) || ' · ' || btrim(p_size)`);
    expect(SQL).toContain(`p.sku || ' · ' || p.name`);
    expect(SQL).toContain("la nota necesita al menos 2 letras");
  });
});

describe("las etapas", () => {
  it("cinco pasos en el orden de Roberto; adjusted y cancelled no tienen siguiente", () => {
    expect(ETAPAS_DE_CONTEO).toEqual(["organizing", "reviewing_orders", "counting", "review", "adjusted"]);
    expect(siguienteEtapaDeConteo("organizing")).toBe("reviewing_orders");
    expect(siguienteEtapaDeConteo("review")).toBe("adjusted");
    expect(siguienteEtapaDeConteo("adjusted")).toBeNull();
    expect(siguienteEtapaDeConteo("cancelled")).toBeNull();
  });
  it("etapaHecha: la actual y las de antes; nada en un cancelado", () => {
    expect(etapaHecha({ stage: "counting" }, "organizing")).toBe(true);
    expect(etapaHecha({ stage: "counting" }, "counting")).toBe(true);
    expect(etapaHecha({ stage: "counting" }, "review")).toBe(false);
    expect(etapaHecha({ stage: "cancelled" }, "organizing")).toBe(false);
    expect(estaAbierto({ stage: "review" })).toBe(true);
    expect(estaAbierto({ stage: "adjusted" })).toBe(false);
  });
  it("cada etapa lee su fecha y actor de la columna que escribe la base", () => {
    const c = conteo({ stage: "adjusted", organized_at: "o", organized_by: "p1", orders_reviewed_at: "r", counting_done_at: "k", adjusted_at: "a", adjusted_by: "m" });
    expect(fechaDeEtapaDeConteo(c, "organizing")).toEqual({ at: c.created_at, by: "m" });
    expect(fechaDeEtapaDeConteo(c, "reviewing_orders")).toEqual({ at: "o", by: "p1" });
    expect(fechaDeEtapaDeConteo(c, "counting").at).toBe("r");
    expect(fechaDeEtapaDeConteo(c, "review").at).toBe("k");
    expect(fechaDeEtapaDeConteo(c, "adjusted")).toEqual({ at: "a", by: "m" });
    for (const col of ["organized_at", "orders_reviewed_at", "counting_done_at", "signed_at", "adjusted_at", "cancelled_at"]) expect(SQL).toContain(col);
  });
});

describe("las cuentas de una línea", () => {
  it("cajas × piezas por caja + sueltas; sin piezas por caja, solo el total", () => {
    expect(totalContado({ pieces_per_box: 4 }, 3, 2, null)).toBe(14);
    expect(totalContado({ pieces_per_box: 4 }, null, null, 9)).toBe(9);
    expect(totalContado({ pieces_per_box: null }, 3, 2, null)).toBeNull();
    expect(totalContado({ pieces_per_box: null }, null, null, 7)).toBe(7);
  });
  it("diferencia = contado − sistema; $ = precio × diferencia, con signo y a 2 decimales", () => {
    expect(diferencia(contada(97))).toBe(-3);
    expect(valorDeLaDiferencia(contada(97))).toBe(-30);
    expect(valorDeLaDiferencia(contada(103, { price: 9.4 }))).toBe(28.2);
    expect(diferencia(linea())).toBeNull();
    expect(diferencia(contada(5, { system_qty: null }))).toBeNull();
    expect(valorDeLaDiferencia(contada(5, { price: null }))).toBeNull();
  });
  it("validarCaptura: enteros ≥ 0; por cajas basta uno de los dos campos; sin cajas, el total", () => {
    expect(validarCaptura(linea(), "3", "2", "")).toEqual({ ok: true, cajas: 3, sueltas: 2, total: 14 });
    expect(validarCaptura(linea(), "3", "", "")).toEqual({ ok: true, cajas: 3, sueltas: 0, total: 12 });
    expect(validarCaptura(linea(), "", "", "")).toEqual({ ok: false, motivo: "vacio" });
    expect(validarCaptura(linea(), "3.5", "", "")).toEqual({ ok: false, motivo: "numero" });
    expect(validarCaptura(linea(), "-1", "", "")).toEqual({ ok: false, motivo: "numero" });
    expect(validarCaptura(linea({ pieces_per_box: null }), "", "", "9")).toEqual({ ok: true, cajas: null, sueltas: null, total: 9 });
    expect(validarCaptura(linea({ pieces_per_box: null }), "", "", "")).toEqual({ ok: false, motivo: "vacio" });
  });
  it("progreso y resumen: exactas, con diferencia, sin sistema, $ absoluto y neto, exactitud", () => {
    const ls = [contada(100), contada(97), contada(105, { price: 2 }), contada(8, { system_qty: null }), linea({ id: "x" })];
    expect(progresoDelConteo(ls)).toEqual({ hechas: 4, total: 5, pct: 80 });
    const r = resumenDelConteo(ls);
    expect(r).toMatchObject({ lineas: 5, contadas: 4, exactas: 1, conDiferencia: 2, sinSistema: 1, piezasDeDiferencia: 8, valorNeto: -20, valorAbsoluto: 40, exactitudPct: 33 });
    expect(resumenDelConteo([]).exactitudPct).toBeNull();
  });
  it("orden al contar: recontar primero, luego las que faltan, luego por posición; en revisión, la mayor diferencia en $", () => {
    const ls = [contada(100, { id: "a", position: 1 }), linea({ id: "b", position: 2 }), contada(90, { id: "c", position: 3 }), linea({ id: "d", position: 4, recount_requested: true })];
    expect(ordenarLineas(ls).map((l) => l.id)).toEqual(["d", "b", "a", "c"]);
    expect(ordenarPorDiferencia(ls).map((l) => l.id)).toEqual(["c", "a", "b", "d"]);
  });
});

describe("quién hace qué (la misma regla que la base)", () => {
  it("ve la sección cualquiera con nivel en la app; cuenta en su tienda; gestiona el gerente de la tienda y el admin", () => {
    expect(veConteos(personal)).toBe(true);
    expect(veConteos(sinApp)).toBe(false);
    expect(puedeContar(personal, "Pharr")).toBe(true);
    expect(puedeContar(personal, "McAllen")).toBe(false);
    expect(puedeGestionarConteo(personal, "Pharr")).toBe(false);
    expect(puedeGestionarConteo(gerente, "Pharr")).toBe(true);
    expect(puedeGestionarConteo(gerenteOtra, "Pharr")).toBe(false);
    expect(puedeGestionarConteo(admin, "Pharr")).toBe(true);
  });
  it("personal: pasos 1→2→3→4; en 3 captura y solo cierra con todo contado; nada en revisión", () => {
    expect(accionesDeConteo(personal, conteo({ stage: "organizing" }), [])).toEqual(["organizado"]);
    expect(accionesDeConteo(personal, conteo({ stage: "reviewing_orders" }), [])).toEqual(["ordenes_revisadas"]);
    expect(accionesDeConteo(personal, conteo({ stage: "counting" }), [contada(1), linea()])).toEqual(["contar_linea"]);
    expect(accionesDeConteo(personal, conteo({ stage: "counting" }), [contada(1)])).toEqual(["contar_linea", "terminar_conteo"]);
    expect(accionesDeConteo(personal, conteo({ stage: "review" }), [contada(1)])).toEqual([]);
    expect(accionesDeConteo(sinApp, conteo(), [])).toEqual([]);
  });
  it("gerente: además recontar (3–4), firmar (4), ajustar solo firmado, cancelar mientras está abierto", () => {
    expect(accionesDeConteo(gerente, conteo({ stage: "counting" }), [contada(1)])).toEqual(["contar_linea", "terminar_conteo", "recontar", "cancelar"]);
    expect(accionesDeConteo(gerente, conteo({ stage: "review" }), [contada(1)])).toEqual(["recontar", "firmar", "cancelar"]);
    expect(accionesDeConteo(gerente, conteo({ stage: "review", signed_at: "x" }), [contada(1)])).toEqual(["recontar", "ajustar", "cancelar"]);
    expect(accionesDeConteo(gerente, conteo({ stage: "adjusted" }), [])).toEqual([]);
    expect(accionesDeConteo(gerente, conteo({ stage: "cancelled" }), [])).toEqual([]);
    expect(accionesDeConteo(gerenteOtra, conteo({ stage: "review" }), [])).toEqual([]);
  });
  it("la base guarda las mismas puertas: in_store para contar y avanzar, can_manage para crear / recontar / firmar / ajustar / cancelar; ajustar pide la firma", () => {
    expect(SQL).toContain("warehouse_ops_can_manage(p_store)");
    // Cuatro RPC (recontar, firmar, ajustar, cancelar) + la autocomprobación que lo verifica.
    expect((SQL.match(/warehouse_ops_can_manage\(c\.store\)/g) ?? []).length).toBe(5);
    expect(SQL).toContain("primero hay que firmar el conteo");
    expect(SQL).toContain("faltan % lineas por contar");
    expect(SQL).toContain("if c.stage <> 'counting' then raise exception");
    expect(SQL).toMatch(/counting_done_at = null, counting_done_by = null, signed_at = null/);
  });
});

describe("la hoja y la lectura", () => {
  it("las filas de la hoja en orden de posición, con «—» donde no hay dato y la diferencia con signo", () => {
    const f = filasDeHojaDeConteo([contada(97, { position: 2, sku: "B" }), linea({ position: 1, sku: "A" }), contada(103, { position: 3, sku: "C", price: null })]);
    expect(f.map((x) => x.sku)).toEqual(["A", "B", "C"]);
    expect(f[0]).toMatchObject({ sistema: "100", contado: "—", diferencia: "—", valor: null, conto: "" });
    expect(f[1]).toMatchObject({ diferencia: "-3", valor: -30, conto: "Ana" });
    expect(f[2]).toMatchObject({ diferencia: "+3", valor: null });
  });
  it("el id de la hoja solo si es un uuid", () => {
    expect(idDeHoja("0e6d3c6a-2a5b-4a8a-9d3e-1b2c3d4e5f60")).toBe("0e6d3c6a-2a5b-4a8a-9d3e-1b2c3d4e5f60");
    expect(idDeHoja(["0e6d3c6a-2a5b-4a8a-9d3e-1b2c3d4e5f60"])).toBeTruthy();
    expect(idDeHoja("abc")).toBeNull();
    expect(idDeHoja(undefined)).toBeNull();
  });
  it("faltaLa274: solo cuando la TABLA de conteos no existe (D-1021)", () => {
    expect(faltaLa274({ code: "42P01", message: 'relation "public.warehouse_counts" does not exist' })).toBe(true);
    expect(faltaLa274({ code: "PGRST205", message: "Could not find the table 'public.warehouse_counts' in the schema cache" })).toBe(true);
    expect(faltaLa274({ code: "42P01", message: 'relation "public.warehouse_count_lines" does not exist' })).toBe(true);
    expect(faltaLa274({ message: "relation \"public.warehouse_counts\" does not exist" })).toBe(true);
    // Lo que antes daba un «Muy pronto» falso, con la 274 ya aplicada:
    expect(faltaLa274({ code: "42P01" })).toBe(false);
    expect(faltaLa274({ code: "42P01", message: 'relation "public.otra_tabla" does not exist' })).toBe(false);
    expect(faltaLa274({ code: "PGRST202", message: "Could not find the function public.warehouse_ops_count_line" })).toBe(false);
    expect(faltaLa274({ code: "42883", message: "operator does not exist: uuid = text" })).toBe(false);
    expect(faltaLa274({ code: "42703", message: "column warehouse_counts.stage does not exist" })).toBe(false);
    expect(faltaLa274({ code: "42501", message: "warehouse_ops: sin acceso" })).toBe(false);
    expect(faltaLa274({ message: "TypeError: Failed to fetch" })).toBe(false);
    expect(faltaLa274(null)).toBe(false);
  });
});
