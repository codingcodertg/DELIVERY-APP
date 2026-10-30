import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/** Una orden entregada en otro día se queda con la fecha real (D-761, migración 219). */

const sql = readFileSync(join(process.cwd(), "supabase/migrations/219_entregada_en_otra_fecha.sql"), "utf8").split("\r\n").join("\n");
const cuerpo = sql.slice(sql.indexOf("create or replace function public.entregada_fija_fecha()"), sql.indexOf("$$;") + 3);

describe("la 219", () => {
  it("solo al PASAR a entregada, con el día de la prueba de entrega (o de ahora) en hora de Texas, y deja nota", () => {
    expect(cuerpo).toContain("if NEW.stage = 'delivered' and OLD.stage is distinct from 'delivered' then");
    expect(cuerpo).toContain("v_dia := (coalesce(NEW.pod_delivered_at, now()) at time zone 'America/Chicago')::date;");
    expect(cuerpo).toContain("if NEW.delivery_date is distinct from v_dia then");
    expect(cuerpo).toContain("NEW.delivery_date := v_dia;");
    expect(cuerpo).toContain("insert into public.order_events (delivery_id, kind, note, created_by)");
    expect(cuerpo).toContain("'Delivered on ' || v_dia::text || '; was scheduled for '");
  });
  it("corre después del guard (por nombre) y no lleva transacción propia", () => {
    expect(sql).toContain("create trigger deliveries_zz_entregada_fija_fecha before update on public.deliveries");
    expect("deliveries_guard_stage" < "deliveries_zz_entregada_fija_fecha").toBe(true);
    expect(sql).not.toMatch(/^\s*(begin|commit);/m);
    expect(sql).not.toContain("'PENDIENTE'");
  });
});
