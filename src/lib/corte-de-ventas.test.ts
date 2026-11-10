import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { MENSAJE_DE_LA_237 } from "./corte-de-ventas";
import { AVISO_MISMO_DIA } from "./same-day";

/**
 * La regla VIVA de "mismo día" se mudó a `same-day.ts` (ver `same-day.test.ts`). Aquí solo queda el guardián de la
 * migración 237: EN ESPERA por decisión del dueño, sin aplicar y sin editar (su checksum está congelado).
 */
const leer = (p: string) => readFileSync(p, "utf8").split("\r\n").join("\n");

describe("la migración 237: EN ESPERA por decisión del dueño (sin aplicar, sin editar)", () => {
  const sql = leer("supabase/migrations/237_corte_mediodia_ventas.sql");
  const codigo = sql.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");

  it("la nota de espera vive en corte-de-ventas.ts", () => {
    const regla = leer("src/lib/corte-de-ventas.ts");
    expect(regla).toContain("MIGRACIÓN 237");
    expect(regla).toContain("EN ESPERA por decisión del");
    expect(regla).toContain("NO se aplica hasta que él lo diga");
  });
  it("el archivo sigue como se escribió (hora de Texas, las 12, solo ventas)", () => {
    expect(codigo).toContain("now() at time zone 'America/Chicago'");
    expect(codigo).toContain("extract(hour from ahora_tx) >= 12 and NEW.delivery_date <= ahora_tx::date");
    expect(codigo).toContain("create trigger deliveries_guard_corte_ventas before insert or update on public.deliveries");
  });
  it("su mensaje es MENSAJE_DE_LA_237, que no es el aviso de la pantalla", () => {
    expect(codigo).toContain(`'${MENSAJE_DE_LA_237.en} / ${MENSAJE_DE_LA_237.es}'`);
    expect(MENSAJE_DE_LA_237.en).not.toBe(AVISO_MISMO_DIA.en);
  });
  it("se registra en el libro de migraciones", () => {
    expect(sql).toContain("-- @ledger-below\ninsert into public.schema_migrations (name, checksum)\n  values ('237_corte_mediodia_ventas.sql',");
  });
});
