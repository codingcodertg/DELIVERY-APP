import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

// D-550. El traspaso del ERP (§4.1) dijo, y se midió en producción el 2026-10-14, que el esquema `erp` tenía CERO
// triggers: la 064 creó las funciones y nadie las ató. La 174 los pone. Esta prueba falla si falta uno de los doce o
// si cambia su momento (el de solo-añadir tiene que ir ANTES de escribir; la caché, DESPUÉS de insertar).
const sql = readFileSync("supabase/migrations/174_erp_triggers.sql", "utf8").replace(/\s+/g, " ");
const DOCE: [string, string][] = [
  ["audit_products", "after insert or update or delete on erp.products for each row execute function erp.audit_row()"],
  ["audit_sku_aliases", "after insert or update or delete on erp.sku_aliases for each row execute function erp.audit_row()"],
  ["price_history_capture", "after insert or update of price, cost on erp.products for each row execute function erp.capture_price_history()"],
  ["store_price_history_capture", "after insert or update of store_price, store_cost on erp.store_products for each row execute function erp.capture_store_price_history()"],
  ["audit_product_requests", "after insert or update or delete on erp.product_requests for each row execute function erp.audit_row()"],
  ["audit_purchase_orders", "after insert or update or delete on erp.purchase_orders for each row execute function erp.audit_row()"],
  ["audit_po_lines", "after insert or update or delete on erp.po_lines for each row execute function erp.audit_row()"],
  ["audit_order_acknowledgments", "after insert or update or delete on erp.order_acknowledgments for each row execute function erp.audit_row()"],
  ["audit_ack_lines", "after insert or update or delete on erp.ack_lines for each row execute function erp.audit_row()"],
  ["audit_product_relations", "after insert or update or delete on erp.product_relations for each row execute function erp.audit_row()"],
  ["trg_movements_append_only", "before update or delete on erp.inventory_movements for each row execute function erp.prevent_movement_mutation()"],
  ["trg_movement_cache", "after insert on erp.inventory_movements for each row execute function erp.apply_movement_to_cache()"],
];

describe("174 · los doce triggers del ERP", () => {
  for (const [nombre, cuerpo] of DOCE) {
    it(`${nombre}: ${cuerpo.split(" for each row")[0]}`, () => {
      expect(sql).toContain(`create trigger ${nombre} ${cuerpo};`);
    });
  }
  it("y la migración se comprueba a sí misma: si no hay 12, aborta", () => {
    expect(sql).toContain("if n <> 12 then raise exception");
  });
});
