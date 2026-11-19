import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ETAPAS_DE_CONTEO, accionesDeConteo, cuentasDeLinea, diferencia, enCajas, enteroDelCampo, estaAbierto, etapaHecha, faltaDelAlcance,
  fechaDeEtapaDeConteo, filasDeHojaDeConteo, hayDiferencias, idDeHoja, numeroDelCampo, ordenarLineas, ordenarPorDiferencia, pendienteDeLinea,
  progresoDelConteo, puedeContar, puedeGestionarConteo, resumenDelConteo, siguienteEtapaDeConteo, tituloDeAlcance, totalContado, validarCaptura,
  valorDeLaDiferencia, veConteos, type Conteo, type Linea, type OrdenPendiente,
} from "./conteos";
import { faltaLa274, faltaLa333, etapaDeFila } from "./conteos-datos";
import type { Quien } from "./visibilidad";

const SQL274 = readFileSync(join(__dirname, "../../../supabase/migrations/274_conteos_de_inventario.sql"), "utf8");

const linea = (x: Partial<Linea> = {}): Linea => ({
  id: "l", count_id: "c", product_id: 1, sku: "SKU", name: "Prod", size_in: "24x48", system_qty: 100, system_qty_set_by: null, system_qty_set_by_name: null, system_qty_set_at: null,
  price: 10, pieces_per_box: 4, counted_boxes: null, counted_pieces: null, counted_total: null, counted_by: null, counted_by_name: null, counted_at: null, note: null, photo: null,
  recount_requested: false, recount_note: null, position: 1, ...x,
});
const contada = (total: number, x: Partial<Linea> = {}) => linea({ counted_total: total, counted_at: "2026-11-08T10:00:00Z", counted_by: "p1", counted_by_name: "Ana", ...x });
const pendiente = (lineId: string, qty: number): Pick<OrdenPendiente, "line_id" | "qty"> => ({ line_id: lineId, qty });
const conteo = (x: Partial<Conteo> = {}): Conteo => ({
  id: "c", store: "Pharr", scope_kind: "vendor_size", vendor_name: "Daltile", size_in: "24x48", note: null, product_id: null, title: "Daltile · 24x48", stage: "organizing",
  instructions: null, comments: null, created_by: "m", created_by_name: "Gerente", created_at: "2026-11-01T10:00:00Z",
  organized_at: null, organized_by: null, counting_done_at: null, counting_done_by: null, orders_reviewed_at: null, orders_reviewed_by: null, orders_note: null,
  signed_at: null, signed_by: null, signed_by_name: null, signed_sheet: null, sign_note: null, adjusted_at: null, adjusted_by: null, adjustment_shots: [],
  cancelled_at: null, cancelled_by: null, cancel_note: null, ...x,
});

const personal: Quien = { id: "p1", role: "warehouse", store: "Pharr", module_access: ["warehouse_ops"] };
const gerente: Quien = { id: "m", role: "manager", store: "Pharr", module_access: ["warehouse_ops"] };
const gerenteOtra: Quien = { id: "m2", role: "manager", store: "McAllen", module_access: ["warehouse_ops"] };
const admin: Quien = { id: "a", role: "admin" };
const sinApp: Quien = { id: "s", role: "sales" };

describe("el alcance y su título", () => {
  it("proveedor + medida (nota opcional), proveedor + nota, producto (SKU · nombre)", () => {
    expect(tituloDeAlcance({ scope_kind: "vendor_size", vendor_name: "Daltile", size_in: "24x48" })).toBe("Daltile · 24x48");
    expect(tituloDeAlcance({ scope_kind: "vendor_size", vendor_name: "Daltile", size_in: "24x48", note: "black" })).toBe("Daltile · 24x48 · black");
    expect(tituloDeAlcance({ scope_kind: "vendor_note", vendor_name: "Daltile", note: "black" })).toBe("Daltile · black");
    expect(tituloDeAlcance({ scope_kind: "product", product_sku: "PORC-1", product_name: "Porcelain" })).toBe("PORC-1 · Porcelain");
  });
  it("dice qué falta: la medida con proveedor+medida, la nota solo si escribió algo de una letra en proveedor+medida o falta en proveedor+nota", () => {
    expect(faltaDelAlcance({ scope_kind: "vendor_size", vendor_name: null, size_in: "24x48" })).toBe("vendor");
    expect(faltaDelAlcance({ scope_kind: "vendor_size", vendor_name: "Daltile", size_in: null })).toBe("size");
    expect(faltaDelAlcance({ scope_kind: "vendor_size", vendor_name: "Daltile", size_in: "24x48" })).toBeNull();
    expect(faltaDelAlcance({ scope_kind: "vendor_size", vendor_name: "Daltile", size_in: "24x48", note: "" })).toBeNull();
    expect(faltaDelAlcance({ scope_kind: "vendor_size", vendor_name: "Daltile", size_in: "24x48", note: "b" })).toBe("note");
    expect(faltaDelAlcance({ scope_kind: "vendor_note", vendor_name: "Daltile", note: "" })).toBe("note");
    expect(faltaDelAlcance({ scope_kind: "vendor_note", vendor_name: "Daltile", note: "bl" })).toBeNull();
    expect(faltaDelAlcance({ scope_kind: "product", product_id: null })).toBe("product");
  });
});

describe("las etapas: Organize, Count, Review, Sign off, Adjust", () => {
  it("cinco pasos en el orden de Roberto; adjusted y cancelled no tienen siguiente", () => {
    expect(ETAPAS_DE_CONTEO).toEqual(["organizing", "counting", "review", "sign_off", "adjusted"]);
    expect(siguienteEtapaDeConteo("organizing")).toBe("counting");
    expect(siguienteEtapaDeConteo("review")).toBe("sign_off");
    expect(siguienteEtapaDeConteo("adjusted")).toBeNull();
    expect(siguienteEtapaDeConteo("cancelled")).toBeNull();
  });
  it("etapaHecha: la actual y las de antes; nada en un cancelado; la revisión va DESPUÉS de contar", () => {
    expect(etapaHecha(conteo({ stage: "counting" }), "organizing")).toBe(true);
    expect(etapaHecha(conteo({ stage: "counting" }), "review")).toBe(false);
    expect(etapaHecha(conteo({ stage: "review" }), "counting")).toBe(true);
    expect(etapaHecha(conteo({ stage: "sign_off" }), "review")).toBe(true);
    expect(etapaHecha(conteo({ stage: "cancelled" }), "organizing")).toBe(false);
    expect(estaAbierto(conteo({ stage: "sign_off" }))).toBe(true);
    expect(estaAbierto(conteo({ stage: "adjusted" }))).toBe(false);
  });
  it("cada etapa lee la fecha y el actor que ENTRÓ en ella (la columna que escribe la base)", () => {
    const c = conteo({ organized_at: "a", organized_by: "x", counting_done_at: "b", counting_done_by: "y", orders_reviewed_at: "c", orders_reviewed_by: "z", adjusted_at: "d", adjusted_by: "w" });
    expect(fechaDeEtapaDeConteo(c, "counting")).toEqual({ at: "a", by: "x" });
    expect(fechaDeEtapaDeConteo(c, "review")).toEqual({ at: "b", by: "y" });
    expect(fechaDeEtapaDeConteo(c, "sign_off")).toEqual({ at: "c", by: "z" });
    expect(fechaDeEtapaDeConteo(c, "adjusted")).toEqual({ at: "d", by: "w" });
  });
  it("las filas de antes de la 333 se leen como la conversión de la migración", () => {
    expect(etapaDeFila("reviewing_orders", null)).toBe("counting");
    expect(etapaDeFila("review", null)).toBe("review");
    expect(etapaDeFila("review", "2026-11-01T00:00:00Z")).toBe("sign_off");
    expect(etapaDeFila("sign_off", null)).toBe("sign_off");
    expect(etapaDeFila("adjusted", "x")).toBe("adjusted");
    expect(etapaDeFila("cancelled", null)).toBe("cancelled");
  });
});

describe("las cuentas: contado − pendiente = real; diferencia = real − sistema; $ = diferencia × precio", () => {
  it("el ejemplo de Roberto: contó 100, 20 vendidos (7+8+5), sistema 105 → real 80, diferencia −25 cajas", () => {
    const l = contada(100, { id: "L", system_qty: 105, price: 2, pieces_per_box: null });
    const p = [pendiente("L", 7), pendiente("L", 8), pendiente("L", 5)];
    const pend = pendienteDeLinea(p, "L");
    expect(pend).toBe(20);
    const c = cuentasDeLinea(l, pend);
    expect(c).toEqual({ contado: 100, pendiente: 20, real: 80, sistema: 105, diferencia: -25, valor: -50 });
  });
  it("sin pendientes, real = contado; sin sistema la diferencia es null; sin precio el $ es null", () => {
    expect(cuentasDeLinea(contada(12, { system_qty: 10, price: null }), 0)).toMatchObject({ real: 12, diferencia: 2, valor: null });
    expect(cuentasDeLinea(contada(12, { system_qty: null }), 0)).toMatchObject({ diferencia: null, valor: null });
  });
  it("cajas = piezas ÷ piezas por caja (2 decimales); sin piezas por caja, null", () => {
    expect(enCajas(-50, 4)).toBe(-12.5);
    expect(enCajas(-20, 8)).toBe(-2.5);
    expect(enCajas(-25, null)).toBeNull();
  });
  it("diferencia SIN pendientes (la captura) sigue como contado − sistema; el valor con signo a 2 decimales", () => {
    expect(diferencia(contada(90, { system_qty: 100 }))).toBe(-10);
    expect(valorDeLaDiferencia(contada(90, { system_qty: 100, price: 1.005 }))).toBe(-10.05);
  });
  it("totalContado: cajas × piezas por caja + sueltas; sin piezas por caja, solo el total", () => {
    expect(totalContado({ pieces_per_box: 4 }, 3, 2, null)).toBe(14);
    expect(totalContado({ pieces_per_box: null }, null, null, 9)).toBe(9);
    expect(totalContado({ pieces_per_box: null }, 3, 2, null)).toBeNull();
  });
  it("validarCaptura: enteros ≥ 0; por cajas basta uno de los dos campos; sin cajas, el total", () => {
    expect(validarCaptura({ pieces_per_box: 4 }, "3", "", "")).toMatchObject({ ok: true, total: 12, cajas: 3, sueltas: 0 });
    expect(validarCaptura({ pieces_per_box: 4 }, "", "", "")).toEqual({ ok: false, motivo: "vacio" });
    expect(validarCaptura({ pieces_per_box: null }, "", "", "12")).toMatchObject({ ok: true, total: 12 });
    expect(validarCaptura({ pieces_per_box: null }, "", "", "1.5")).toEqual({ ok: false, motivo: "numero" });
  });
  it("los campos a mano: enteros para contar; con decimales para el sistema", () => {
    expect(enteroDelCampo("")).toBeNull();
    expect(enteroDelCampo("12")).toBe(12);
    expect(enteroDelCampo("1.5")).toBeNaN();
    expect(numeroDelCampo("105")).toBe(105);
    expect(numeroDelCampo("104,5")).toBe(104.5);
    expect(numeroDelCampo("-1")).toBeNaN();
  });
  it("progreso: contadas / total y el porcentaje entero", () => {
    expect(progresoDelConteo([contada(1), linea(), linea()])).toEqual({ hechas: 1, total: 3, pct: 33 });
  });
});

describe("la firma: resumen y razón DESPUÉS de las órdenes pendientes", () => {
  it("resumen: exactas, con diferencia, faltan y sobran en piezas y $, pendientes, exactitud", () => {
    const ls = [
      contada(10, { id: "a", system_qty: 10, price: 2 }),
      contada(8, { id: "b", system_qty: 10, price: 2 }),          // falta 2
      contada(15, { id: "c", system_qty: 10, price: 1 }),         // sobra 5
      contada(20, { id: "d", system_qty: 12, price: 1 }),         // 20 contado, 5 vendidos → real 15 → sobra 3
      linea({ id: "e", system_qty: null }),                        // no contada: ignorada
    ];
    const ps = [pendiente("d", 5)];
    const r = resumenDelConteo(ls, ps);
    expect(r).toMatchObject({ lineas: 5, contadas: 4, exactas: 1, conDiferencia: 3, pendientePiezas: 5, faltanPiezas: 2, faltanValor: 4, sobranPiezas: 8, sobranValor: 8, valorNeto: 4, exactitudPct: 25 });
  });
  it("una línea que cuadra SOLO gracias a las pendientes queda exacta", () => {
    const ls = [contada(100, { id: "a", system_qty: 80 })];
    expect(resumenDelConteo(ls, [pendiente("a", 20)]).exactas).toBe(1);
    expect(resumenDelConteo(ls, []).conDiferencia).toBe(1);
  });
  it("hayDiferencias: sí si alguna línea con sistema no cuadra después de pendientes", () => {
    const ls = [contada(100, { id: "a", system_qty: 80 })];
    expect(hayDiferencias(ls, [pendiente("a", 20)])).toBe(false);
    expect(hayDiferencias(ls, [])).toBe(true);
    expect(hayDiferencias([linea({ id: "x", system_qty: null })], [])).toBe(false);
  });
  it("orden de la firma: la diferencia más grande en $ primero (después de pendientes)", () => {
    const a = contada(10, { id: "a", system_qty: 10, price: 1, position: 1 });   // 0
    const b = contada(5, { id: "b", system_qty: 10, price: 1, position: 2 });    // −5 $
    const c = contada(30, { id: "c", system_qty: 10, price: 1, position: 3 });   // +20 $ si sin pendientes
    const d = contada(30, { id: "d", system_qty: 10, price: 1, position: 4 });   // +20 $ con 20 pendientes → 0
    expect(ordenarPorDiferencia([a, b, c, d], [pendiente("d", 20)]).map((l) => l.id)).toEqual(["c", "b", "a", "d"]);
  });
  it("ordenar al contar: recontar primero, luego las que faltan, luego por posición", () => {
    const x = linea({ id: "x", position: 1 });
    const y = contada(1, { id: "y", position: 2 });
    const z = linea({ id: "z", position: 3, recount_requested: true });
    expect(ordenarLineas([x, y, z]).map((l) => l.id)).toEqual(["z", "x", "y"]);
  });
});

describe("quién hace qué (la misma regla que la base)", () => {
  it("el personal con nivel (no Associate) ve la sección y cuenta en su tienda; el Associate no ve ni cuenta (17 nov); gestiona el gerente y el admin", () => {
    const personalConNivel: Quien = { ...personal, warehouse_ops_role: "full" };
    expect(veConteos(personalConNivel)).toBe(true);
    expect(veConteos(personal)).toBe(false);
    expect(veConteos(sinApp)).toBe(false);
    expect(puedeContar(personalConNivel, "Pharr")).toBe(true);
    expect(puedeContar(personalConNivel, "McAllen")).toBe(false);
    expect(puedeContar(personal, "Pharr")).toBe(false);
    expect(puedeGestionarConteo(personalConNivel, "Pharr")).toBe(false);
    expect(puedeGestionarConteo(gerente, "Pharr")).toBe(true);
    expect(puedeGestionarConteo(gerenteOtra, "Pharr")).toBe(false);
    expect(puedeGestionarConteo(admin, "Pharr")).toBe(true);
  });
  it("personal con nivel: organiza, cuenta, revisa órdenes pendientes y pasa a firmar; no firma ni ajusta", () => {
    const pers: Quien = { ...personal, warehouse_ops_role: "full" };
    expect(accionesDeConteo(pers, conteo({ stage: "organizing" }), [])).toEqual(["organizado"]);
    expect(accionesDeConteo(pers, conteo({ stage: "counting" }), [contada(1), linea()])).toEqual(["contar_linea"]);
    expect(accionesDeConteo(pers, conteo({ stage: "counting" }), [contada(1)])).toEqual(["contar_linea", "terminar_conteo"]);
    expect(accionesDeConteo(pers, conteo({ stage: "review" }), [contada(1)])).toEqual(["pendiente", "terminar_revision"]);
    expect(accionesDeConteo(pers, conteo({ stage: "sign_off" }), [contada(1)])).toEqual([]);
    expect(accionesDeConteo(personal, conteo({ stage: "organizing" }), [])).toEqual([]);
    expect(accionesDeConteo(sinApp, conteo(), [])).toEqual([]);
  });
  it("gerente: recontar (2–4), firmar (4, sin firma), ajustar (4, firmado), volver a revisar (4), cancelar (abierto)", () => {
    expect(accionesDeConteo(gerente, conteo({ stage: "counting" }), [contada(1)])).toEqual(["contar_linea", "terminar_conteo", "recontar", "cancelar"]);
    expect(accionesDeConteo(gerente, conteo({ stage: "sign_off" }), [contada(1)])).toEqual(["recontar", "volver", "firmar", "cancelar"]);
    expect(accionesDeConteo(gerente, conteo({ stage: "sign_off", signed_at: "x" }), [contada(1)])).toEqual(["recontar", "volver", "ajustar", "cancelar"]);
    expect(accionesDeConteo(gerente, conteo({ stage: "adjusted" }), [])).toEqual([]);
    expect(accionesDeConteo(gerente, conteo({ stage: "cancelled" }), [])).toEqual([]);
    expect(accionesDeConteo(gerenteOtra, conteo({ stage: "sign_off" }), [])).toEqual([]);
  });
  it("la base guarda las mismas puertas (274 y 333): can_manage en crear / recontar / poner sistema / firmar / volver / ajustar / cancelar", () => {
    expect(SQL274).toContain("warehouse_ops_can_manage(p_store)");
    expect(SQL274).toContain("primero hay que firmar el conteo");
  });
});

describe("la hoja y la lectura", () => {
  it("las filas de la hoja en orden de posición, con la diferencia DESPUÉS de pendientes y «—» donde no hay dato", () => {
    const ls = [contada(100, { id: "b", position: 2, system_qty: 105, price: 2 }), linea({ id: "a", position: 1, sku: "A", system_qty: null })];
    const filas = filasDeHojaDeConteo(ls, [pendiente("b", 20)]);
    expect(filas.map((f) => f.sku)).toEqual(["A", "SKU"]);
    expect(filas[1]).toMatchObject({ contado: "100", pendiente: "20", diferencia: "-25", valor: -50 });
    expect(filas[0]).toMatchObject({ sistema: "—", contado: "—", diferencia: "—", pendiente: "0" });
  });
  it("el id de la hoja solo si es un uuid", () => {
    expect(idDeHoja("0bd7b5c2-1b9e-4f8a-9d2a-3c4e5f6a7b8c")).toBe("0bd7b5c2-1b9e-4f8a-9d2a-3c4e5f6a7b8c");
    expect(idDeHoja("no")).toBeNull();
  });
  it("faltaLa274 y faltaLa333: solo cuando la TABLA que nombran no existe (D-1021)", () => {
    expect(faltaLa274({ code: "42P01", message: 'relation "public.warehouse_counts" does not exist' })).toBe(true);
    expect(faltaLa274({ code: "42883", message: "function warehouse_counts does not exist" })).toBe(false);
    expect(faltaLa333({ code: "42P01", message: 'relation "public.warehouse_count_pending" does not exist' })).toBe(true);
    expect(faltaLa333({ code: "42P01", message: 'relation "public.warehouse_counts" does not exist' })).toBe(false);
    expect(faltaLa333({ code: "42501", message: "warehouse_count_pending permission denied" })).toBe(false);
  });
});
