import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * D-NEXT: una ronda cerrada solo la ve el admin. Lo decide la base (224): las cuatro políticas de select miran la
 * ronda además del módulo. La pantalla no filtra nada: a quien no es admin, la consulta ya no le trae la cerrada.
 */
const sql = readFileSync(join(process.cwd(), "supabase/migrations/224_promos_cerradas_solo_admin.sql"), "utf8").replace(/\r\n/g, "\n");
const politica = (tabla: string) => {
  const i = sql.indexOf(`create policy "${tabla} select"`);
  expect(i, tabla).toBeGreaterThan(0);
  return sql.slice(i, sql.indexOf(";", i));
};

describe("rondas cerradas solo para el admin (224)", () => {
  it("promo_rounds: el módulo Y (admin o abierta)", () => {
    const p = politica("promo_rounds");
    expect(p).toContain("has_promos_access()");
    expect(p).toMatch(/is_admin\(\)\)\s+or\s+closed_at is null/);
  });
  it("productos, sugerencias y decisiones: el módulo Y la ronda visible", () => {
    for (const t of ["promo_products", "promo_suggestions", "promo_decisions"]) {
      const p = politica(t);
      expect(p, t).toContain("has_promos_access()");
      expect(p, t).toContain("promo_round_visible(round_id)");
    }
  });
  it("el helper es definer (no pasa por la RLS de promo_rounds) y admin o abierta", () => {
    const i = sql.indexOf("create or replace function public.promo_round_visible");
    const f = sql.slice(i, sql.indexOf("$$;", i));
    expect(f).toContain("security definer");
    expect(f).toContain("public.is_admin()");
    expect(f).toContain("r.closed_at is null");
  });
});
