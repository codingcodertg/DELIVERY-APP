import { describe, expect, it } from "vitest";
import type { Conteo, Linea, OrdenPendiente } from "./conteos";
import { filaDeConteo } from "./conteos-filas";

const conteo = { id: "c1", store: "Pharr", stage: "sign_off", created_at: "2026-11-20T10:00:00Z" } as unknown as Conteo;
const linea = (x: Partial<Linea> & { id: string }): Linea => ({
  count_id: "c1", product_id: 1, sku: "S", name: "N", size_in: null, system_qty: null, system_qty_set_by: null, system_qty_set_by_name: null, system_qty_set_at: null,
  price: 9.4, pieces_per_box: 1, counted_boxes: null, counted_pieces: null, counted_total: null, counted_by: null, counted_by_name: null, counted_at: null,
  note: null, photo: null, recount_requested: false, recount_note: null, position: 1, unit_of_measure: "box", lots: [], ...x,
});
const orden = (x: Partial<OrdenPendiente> & { line_id: string; qty: number }): OrdenPendiente => ({
  id: "p1", count_id: "c1", invoice_no: "F1", note: null, entered_by: null, entered_by_name: null, entered_at: "2026-11-20T10:00:00Z", edited_by_name: null, edited_at: null, ...x,
});

describe("filaDeConteo", () => {
  it("contado 11, pendiente 3, sistema 12: real 8 y diferencia −4 (en cajas, ppb 1), y cuenta las órdenes", () => {
    const l = linea({ id: "a", counted_total: 11, counted_at: "2026-11-20T11:00:00Z", system_qty: 12 });
    const f = filaDeConteo(conteo, [l], [orden({ line_id: "a", qty: 3 })]);
    expect(f.faltanCajas).toBe(4);
    expect(f.sobranCajas).toBe(0);
    expect(f.ordenes).toBe(1);
    expect(f.hechas).toBe(1);
    expect(f.total).toBe(1);
  });

  it("las líneas no comparables (bolsas) no entran en cajas", () => {
    const l = linea({ id: "b", unit_of_measure: "bag", counted_total: 5, counted_at: "2026-11-20T11:00:00Z", system_qty: 9 });
    const f = filaDeConteo(conteo, [l], []);
    expect(f.faltanCajas).toBe(0);
    expect(f.sobranCajas).toBe(0);
  });

  it("sobran: la diferencia positiva va a sobranCajas", () => {
    const l = linea({ id: "c", counted_total: 14, counted_at: "2026-11-20T11:00:00Z", system_qty: 12, pieces_per_box: 2 });
    const f = filaDeConteo(conteo, [l], []);
    expect(f.sobranCajas).toBe(1);
    expect(f.faltanCajas).toBe(0);
  });
});
