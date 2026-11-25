import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";

// Migración 351 (fichar desde el hub, 2026-11-25). Fija que la guardia de `employee_settings` es la de la 316 con
// SOLO las líneas de `hub_clock` añadidas, que la comprobación del final lista los fragmentos de la 316, y que el
// registro del final coincide con el checksum del fichero (el mismo que calcula scripts/db/ledger.mjs).

const leer = (r: string) => readFileSync(r, "utf8").split("\r\n").join("\n");
const m351 = leer("supabase/migrations/351_fichar_desde_el_hub.sql");
const m316 = leer("supabase/migrations/316_tt_multitienda.sql");
const cuerpo351 = m351.split("-- @ledger-below")[0];

/** El `create or replace function` de la guardia, desde su cabecera hasta el `$$;` que la cierra. */
function funcion(texto: string): string {
  const ini = texto.indexOf("create or replace function timetracker.guard_employee_settings_privilege_columns()");
  expect(ini).toBeGreaterThan(-1);
  const fin = texto.indexOf("end $$;", ini);
  expect(fin).toBeGreaterThan(ini);
  return texto.slice(ini, fin + "end $$;".length);
}

const LINEAS_NUEVAS = [
  "      new.hub_clock := false;\n",
  "      if new.hub_clock is distinct from old.hub_clock then\n        raise exception 'Only a timetracker admin can change the hub clock-in';\n      end if;\n",
];

describe("351 · la guardia es la de la 316 más las líneas de hub_clock, nada más", () => {
  it("parte del cuerpo de la 316 (la definición más nueva de esa función)", () => {
    expect(funcion(m316)).toContain("raise exception 'Only a timetracker admin can change multi-store';");
    expect(funcion(cuerpo351)).toContain("raise exception 'Only a timetracker admin can change multi-store';");
  });

  it("quitando las líneas nuevas, queda byte a byte la función de la 316", () => {
    let sinNuevas = funcion(cuerpo351);
    for (const linea of LINEAS_NUEVAS) {
      expect(sinNuevas.split(linea).length - 1, `una vez: ${linea.trim().slice(0, 50)}`).toBe(1);
      sinNuevas = sinNuevas.replace(linea, "");
    }
    expect(sinNuevas).toBe(funcion(m316));
  });

  it("la columna se añade con la forma pedida, idempotente", () => {
    expect(cuerpo351).toContain("alter table timetracker.employee_settings\n  add column if not exists hub_clock boolean not null default false;");
    expect(cuerpo351).toContain("comment on column timetracker.employee_settings.hub_clock is 'true = this person clocks in, takes the break and ends the shift from the hub''s desktop app';");
  });

  it("no lleva transacción propia (quien aplica la envuelve)", () => {
    expect(cuerpo351).not.toMatch(/^\s*(begin|commit|rollback)\s*;/im);
  });

  it("no toca el disparador ni la función de clockin (la 318 es otra función)", () => {
    const sql = cuerpo351.split("\n").filter((l) => !l.trimStart().startsWith("--")).join("\n");
    expect(sql).not.toContain("create trigger");
    expect(sql).not.toContain("clockin.guard_employee_settings_privilege_columns");
  });
});

describe("351 · la comprobación del final falla si la guardia pierde algún fragmento de la 316", () => {
  const bloque = cuerpo351.slice(cuerpo351.indexOf("do $$"));

  it("existe un bloque do que mira el cuerpo que quedó", () => {
    expect(bloque).toContain("select p.prosrc into cuerpo");
    expect(bloque).toContain("foreach fragmento in array distintivos loop");
  });

  it("lista los fragmentos distintivos de la 316 y los de hub_clock", () => {
    for (const f of [
      "if not public.is_timetracker_admin() and coalesce(auth.role(), '''') not in ('''', ''service_role'') then",
      "new.multi_store := false;",
      "if tg_op = ''INSERT'' then",
      "if new.active is distinct from old.active then",
      "raise exception ''Only a timetracker admin can change active status'';",
      "if new.multi_store is distinct from old.multi_store then",
      "raise exception ''Only a timetracker admin can change multi-store'';",
      "new.hub_clock := false;",
      "if new.hub_clock is distinct from old.hub_clock then",
      "raise exception ''Only a timetracker admin can change the hub clock-in'';",
    ]) {
      expect(bloque, f).toContain(f);
    }
  });
});

describe("351 · registro y checksum", () => {
  it("la línea de registro lleva el checksum del texto antes del marcador (LF)", () => {
    const partes = m351.replace(/\r\n/g, "\n").split("-- @ledger-below");
    expect(partes).toHaveLength(2);
    const sum = createHash("sha256").update(partes[0], "utf8").digest("hex");
    expect(partes[1]).toContain(`insert into public.schema_migrations (name, checksum) values ('351_fichar_desde_el_hub.sql', '${sum}') on conflict (name) do nothing;`);
  });

  it("la migración no se aplica sola: el texto dice «sin aplicar»", () => {
    expect(m351).toContain("SIN APLICAR");
  });
});
