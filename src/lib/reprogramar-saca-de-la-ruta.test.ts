import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

// D-NEXT. El dueño, 2026-10-14: «invoice 170992 got rescheduled for saturday. since it was programmed for todays route Max
// sees it on his phone but it should be automatically removed from the route if a delivery gets rescheduled». La regla vive
// en la base (172): aquí se fija su forma; el comportamiento se ensayó contra producción con ROLLBACK (8/8, ver D-NEXT).
const sql = readFileSync("supabase/migrations/172_reprogramar_saca_de_la_ruta.sql", "utf8").split("\r\n").join("\n");
const plano = sql.replace(/\s+/g, " ");

describe("172 · reprogramar saca la orden de la ruta", () => {
  it("solo si cambia la fecha, tenía chofer, el chofer no cambió en la misma escritura y no se ha recogido", () => {
    expect(plano).toContain("if NEW.delivery_date is distinct from OLD.delivery_date and OLD.assigned_driver is not null and NEW.assigned_driver is not distinct from OLD.assigned_driver and NEW.stage in ('pending', 'approved', 'fulfilling', 'ready') then");
  });
  it("quita chofer, posición y orden de recogida, y deja un evento", () => {
    expect(plano).toContain("NEW.assigned_driver := null; NEW.route_seq := null; NEW.pickup_seq := null;");
    expect(plano).toContain("insert into public.order_events (delivery_id, kind, note, created_by)");
  });
  it("corre después de los guardias: su nombre es el último BEFORE por orden alfabético, y lo comprueba", () => {
    expect(plano).toContain("create trigger deliveries_zz_reprogramar_saca_de_la_ruta before update of delivery_date on public.deliveries");
    expect(["deliveries_guard_invoice", "deliveries_guard_stage", "deliveries_guardar_borrada", "deliveries_touch", "deliveries_zz_reprogramar_saca_de_la_ruta"].sort().at(-1))
      .toBe("deliveries_zz_reprogramar_saca_de_la_ruta");
    expect(plano).toContain("if ultimo <> 'deliveries_zz_reprogramar_saca_de_la_ruta' then");
  });
  it("sin begin/commit propio, y con su línea de registro", () => {
    expect(sql).not.toMatch(/^\s*(begin|commit)\s*;/im);
    expect(sql).toMatch(/insert into public\.schema_migrations \(name, checksum\) values \('172_reprogramar_saca_de_la_ruta\.sql', '[0-9a-f]{64}'\)/);
  });
});
