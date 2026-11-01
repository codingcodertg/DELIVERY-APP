import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/** Una orden ya entregada se queda en el día real de la entrega aunque le cambien la fecha después (D-783, migración 222). */

const sql = readFileSync(join(process.cwd(), "supabase/migrations/222_entregada_se_queda_en_su_dia.sql"), "utf8").split("\r\n").join("\n");
const cuerpo = sql.slice(sql.indexOf("create or replace function public.entregada_fija_fecha()"), sql.indexOf("$$;") + 3);

describe("la 222", () => {
  it("conserva el caso de la 219 (al PASAR a entregada) tal cual", () => {
    expect(cuerpo).toContain("if NEW.stage = 'delivered' and OLD.stage is distinct from 'delivered' then");
    expect(cuerpo).toContain("v_dia := (coalesce(NEW.pod_delivered_at, now()) at time zone 'America/Chicago')::date;");
    expect(cuerpo).toContain("'Delivered on ' || v_dia::text || '; was scheduled for '");
  });
  it("ya entregada: si el UPDATE cambia la fecha y hay prueba de entrega, la fecha vuelve al día real y queda nota; sin prueba de entrega no decide", () => {
    expect(cuerpo).toContain("elsif NEW.stage = 'delivered' and OLD.stage = 'delivered' and NEW.pod_delivered_at is not null");
    expect(cuerpo).toContain("and NEW.delivery_date is distinct from OLD.delivery_date then");
    expect(cuerpo).toContain("v_dia := (NEW.pod_delivered_at at time zone 'America/Chicago')::date;");
    expect(cuerpo).toContain("'Delivery date kept on ' || v_dia::text || ' (already delivered); '");
    expect(cuerpo.split("NEW.delivery_date := v_dia;")).toHaveLength(3);
  });
  it("no lleva transacción propia y el registro está numerado", () => {
    expect(sql).not.toMatch(/^\s*(begin|commit);/m);
    expect(sql).not.toContain("'PENDIENTE'");
  });
});
