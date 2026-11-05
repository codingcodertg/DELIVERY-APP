import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Ventas agrega una nota a SU orden ya aprobada (D-NEXT).
 *
 * Ayuda de un vendedor, 2026-11-05: «trate de agregar una nota a una factura que ya estaba registrada para delivery pero
 * no se guarda». La ficha enseña «Agregar nota» en cualquier etapa, pero `guard_delivery_stage` solo dejaba a ventas
 * editar en draft/pending/rejected: en 'fulfilling' la base contestaba "You cannot edit an order in the % stage".
 */

const RUTA = "supabase/migrations/244_ventas_agrega_nota.sql";
const leer = (r: string) => readFileSync(join(process.cwd(), r), "utf8").split("\r\n").join("\n");
const plano = (s: string) => s.replace(/\s+/g, " ");

describe("244: el guard deja a ventas agregar una nota a su orden aprobada", () => {
  it("la migración existe y redefine el guard", () => {
    expect(existsSync(join(process.cwd(), RUTA))).toBe(true);
    expect(leer(RUTA)).toMatch(/CREATE OR REPLACE FUNCTION public\.guard_delivery_stage\(\)/);
  });

  const sql = () => plano(leer(RUTA));
  const bloque = () => {
    const s = sql();
    const i = s.indexOf("-- 244 (D-NEXT)");
    return s.slice(i, s.indexOf("-- A late GPS fix", i));
  };

  it("solo ventas, solo SU orden, en las etapas aprobadas (pending ya pasaba)", () => {
    const b = bloque();
    expect(b).toContain("if r = 'sales'");
    expect(b).toContain("old_stage in ('approved','fulfilling','ready','picked_up')");
    expect(b).toContain("(OLD.created_by = auth.uid() or OLD.assigned_sales_rep = auth.uid())");
    expect(b).not.toContain("'delivered'");
  });

  it("la lista solo crece, lo de antes queda igual, y cada nota nueva es suya y no vacía", () => {
    const b = bloque();
    expect(b).toContain("jsonb_array_length(NEW.role_notes) > jsonb_array_length(coalesce(OLD.role_notes, '[]'::jsonb))");
    expect(b).toContain("= coalesce(OLD.role_notes, '[]'::jsonb)");
    expect(b).toContain("t.e ->> 'by' is distinct from auth.uid()::text");
    expect(b).toContain("btrim(coalesce(t.e ->> 'text', '')) = ''");
  });

  it("y lo único que cambia son las notas (la copia de NEW con las viejas es OLD)", () => {
    expect(bloque()).toContain(
      "probe := NEW; probe.role_notes := OLD.role_notes; probe.updated_at := OLD.updated_at; if probe is not distinct from OLD then return NEW; end if;",
    );
  });

  it("no pierde los bloques que ya tenía el guard", () => {
    const s = sql();
    for (const k of ["-- 125:", "-- 138:", "-- 169:", "-- 173:", "-- 188:", "rtg.tomar_orden", "rtg.reprogramar_orden",
      "A cancellation reason is history", "Who created an order is history"]) {
      expect([k, s.includes(k)]).toEqual([k, true]);
    }
  });

  it("es la última versión del guard en el repo", () => {
    const dir = join(process.cwd(), "supabase/migrations");
    const conGuard = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()
      .filter((f) => /create or replace function public\.guard_delivery_stage\(\)/i.test(readFileSync(join(dir, f), "utf8")));
    expect(conGuard.at(-1)).toBe("244_ventas_agrega_nota.sql");
  });
});
