import { describe, expect, it } from "vitest";
import { productosDemo } from "./demo-data";
import { reiniciarListasDemo, rpcsListasDemo } from "./listas-de-conteo-demo";
import { TOPE_DE_ALTA } from "./listas-de-conteo";

// El flujo completo de las listas de conteo en el demo, con las mismas reglas que la migración 330.
const ahora = new Date("2026-11-19T12:00:00Z");
type Rpc = Record<string, (a?: Record<string, unknown>) => any>;

function nuevo(): Rpc {
  reiniciarListasDemo(ahora);
  return rpcsListasDemo(ahora) as Rpc;
}

describe("listas de conteo en el demo", () => {
  it("la semilla trae una lista abierta y una enviada, abiertas primero", () => {
    const r = nuevo();
    const listas = r.count_lists_list({}) as { status: string; name: string }[];
    expect(listas.map((l) => l.status)).toEqual(["open", "submitted"]);
  });

  it("crear, agregar (sin duplicar), contar y quitar", () => {
    const r = nuevo();
    const [p1, p2] = productosDemo(ahora).map((p) => Number(p.id));
    const id = r.count_list_create({ p_store_id: "T1", p_name: "Conteo prueba" });
    const add = r.count_list_add_products({ p_list_id: id, p_product_ids: [p1, p2, p2, 999999] });
    expect(add).toEqual({ added: 2 });
    const again = r.count_list_add_products({ p_list_id: id, p_product_ids: [p1] });
    expect(again).toEqual({ added: 0 });

    const detalle = r.count_list_detail({ p_list_id: id });
    expect(detalle.lines).toHaveLength(2);
    // Sin contar no sale la existencia del sistema (no sesga el conteo).
    expect(detalle.lines.every((l: { system_qty: unknown }) => l.system_qty === null)).toBe(true);

    const linea = detalle.lines[0];
    const contada = r.count_list_set_qty({ p_line_id: linea.id, p_counted_qty: 5 });
    expect(contada.counted_qty).toBe(5);
    expect(typeof contada.system_qty).toBe("number");

    r.count_list_remove_line({ p_line_id: detalle.lines[1].id });
    expect(r.count_list_detail({ p_list_id: id }).lines).toHaveLength(1);
  });

  it("no se envía con renglones sin contar, y enviar cierra la lista", () => {
    const r = nuevo();
    const [p1, p2] = productosDemo(ahora).map((p) => Number(p.id));
    const id = r.count_list_create({ p_store_id: "T1", p_name: "Envío" });
    r.count_list_add_products({ p_list_id: id, p_product_ids: [p1, p2] });
    expect(() => r.count_list_submit({ p_list_id: id })).toThrow("LIST_HAS_UNCOUNTED");

    for (const l of r.count_list_detail({ p_list_id: id }).lines) {
      r.count_list_set_qty({ p_line_id: l.id, p_counted_qty: 3 });
    }
    const enviada = r.count_list_submit({ p_list_id: id });
    expect(enviada).toEqual({ recorded: 2 });

    const detalle = r.count_list_detail({ p_list_id: id });
    expect(detalle.list.status).toBe("submitted");
    expect(detalle.list.submitted_by_name).toBe("Demo Admin");
    expect(detalle.lines.every((l: { cycle_count_id: unknown }) => l.cycle_count_id !== null)).toBe(true);
    expect(() => r.count_list_set_qty({ p_line_id: detalle.lines[0].id, p_counted_qty: 1 })).toThrow("LIST_CLOSED");
    expect(() => r.count_list_add_products({ p_list_id: id, p_product_ids: [1] })).toThrow("LIST_CLOSED");
  });

  it("una lista vacía no se envía", () => {
    const r = nuevo();
    const id = r.count_list_create({ p_store_id: "T1", p_name: "Vacía" });
    expect(() => r.count_list_submit({ p_list_id: id })).toThrow("LIST_EMPTY");
  });

  it("una cantidad negativa se rechaza, y nunca se guarda", () => {
    const r = nuevo();
    const [p1] = productosDemo(ahora).map((p) => Number(p.id));
    const id = r.count_list_create({ p_store_id: "T1", p_name: "Negativa" });
    r.count_list_add_products({ p_list_id: id, p_product_ids: [p1] });
    const linea = r.count_list_detail({ p_list_id: id }).lines[0];
    expect(() => r.count_list_set_qty({ p_line_id: linea.id, p_counted_qty: -1 })).toThrow("QTY_INVALID");
    expect(r.count_list_detail({ p_list_id: id }).lines[0].counted_qty).toBeNull();
  });

  it("el tope de un alta se aplica en el propio servidor", () => {
    const r = nuevo();
    const id = r.count_list_create({ p_store_id: "T1", p_name: "Muchos" });
    const ids = Array.from({ length: TOPE_DE_ALTA + 1 }, (_, i) => i + 1);
    expect(() => r.count_list_add_products({ p_list_id: id, p_product_ids: ids })).toThrow("LIST_TOO_MANY");
  });

  it("un nombre vacío o una tienda inexistente no crean lista", () => {
    const r = nuevo();
    expect(() => r.count_list_create({ p_store_id: "T1", p_name: "   " })).toThrow("LIST_NAME_INVALID");
    expect(() => r.count_list_create({ p_store_id: "NOEXISTE", p_name: "x" })).toThrow();
  });
});
