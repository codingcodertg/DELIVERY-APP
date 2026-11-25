import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";

/**
 * La migración 237 (el corte de las 12 en la base) se DESCARTÓ por decisión del dueño, 2026-11-24: nunca se aplicó y su
 * archivo se retiró del repo. Esta prueba pina esa decisión: que no vuelva a aparecer un 237 ni el disparador descartado.
 */
describe("la migración 237 se DESCARTÓ por decisión del dueño (2026-11-24): nunca se aplicó y no está en el repo", () => {
  const ficheros = readdirSync("supabase/migrations");

  it("no hay ningún fichero 237_ en supabase/migrations", () => {
    expect(ficheros.filter((f) => f.startsWith("237_"))).toEqual([]);
  });
  it("ninguna migración define el disparador descartado deliveries_guard_corte_ventas", () => {
    const con = ficheros
      .filter((f) => f.endsWith(".sql"))
      .filter((f) => readFileSync(`supabase/migrations/${f}`, "utf8").includes("deliveries_guard_corte_ventas"));
    expect(con).toEqual([]);
  });
});
