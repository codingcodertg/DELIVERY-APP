import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { TIPOS_DE_ACCION } from "./reglas";

/** 328 · Leads por etapas: lo que la migración promete, leído del propio fichero (no se aplica aquí). */
const sql = readFileSync(join(process.cwd(), "supabase/migrations/328_leads_etapas.sql"), "utf8").replace(/\r\n/g, "\n");
const sinComentarios = sql.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
const importador = readFileSync(join(process.cwd(), "scripts/leads/importa-leads-privado.mjs"), "utf8");

describe("328 · la forma del fichero", () => {
  it("va detrás de la 327 y lleva el marcador del registro con su línea justo debajo", () => {
    expect(sql.split("-- @ledger-below")[1].trim().startsWith("insert into public.schema_migrations (name, checksum) values ('328_leads_etapas.sql',")).toBe(true);
  });
  it("sin begin ni commit propios: la transacción la pone quien aplica", () => {
    expect(sinComentarios).not.toMatch(/^\s*(begin|commit|rollback)\s*;/im);
  });
  it("no borra datos ni tablas, y no toca la carga de cupos ni los cierres viejos", () => {
    expect(sinComentarios).not.toMatch(/\bdelete\s+from\b/i);
    expect(sinComentarios).not.toMatch(/\bdrop\s+table\b/i);
    expect(sinComentarios).not.toMatch(/create or replace function public\.(lead_take|lead_close|lead_admin_release|lead_admin_assign|leads_set_cap)\(/);
  });
  it("cada función nueva o redefinida es security definer con search_path fijado", () => {
    const funciones = [...sinComentarios.matchAll(/create or replace function public\.(\w+)\([^)]*\)[\s\S]*?security definer set search_path = public, pg_temp/g)].map((m) => m[1]);
    expect([...funciones].sort()).toEqual(["lead_note", "leads_import_rows", "leads_nota_de_cotizacion", "leads_puede_ver_fila", "leads_registra_nota"]);
    expect(funciones).toContain("leads_registra_nota");
    expect(funciones).toContain("leads_puede_ver_fila");
    expect(funciones).toContain("leads_nota_de_cotizacion");
  });
  it("lead_note conserva la firma de 3 argumentos (la de la 253) y pide poder VERLO, no tenerlo", () => {
    expect(sinComentarios).toContain("create or replace function public.lead_note(p_lead uuid, p_note text, p_action text)");
    expect(sinComentarios).toContain("if not public.leads_puede_ver_fila(p_lead) then");
    expect(sinComentarios).not.toMatch(/where id = p_lead and status = 'taken' and holder = v_uid/);
  });
  it("los grants: las auxiliares no las ejecuta nadie con sesión; lead_note sigue para authenticated", () => {
    expect(sinComentarios).toContain("revoke execute on function public.leads_puede_ver_fila(uuid)                      from public, anon, authenticated;");
    expect(sinComentarios).toContain("grant  execute on function public.lead_note(uuid, text, text)                     to authenticated;");
  });
});

describe("328 · las etapas", () => {
  it("la restricción de la etapa y la del historial aceptan las mismas ocho que la app", () => {
    const lista = (nombre: string) => {
      const m = new RegExp(`constraint ${nombre} check \\(([\\s\\S]*?)\\);`).exec(sinComentarios);
      if (!m) throw new Error(`falta ${nombre}`);
      // En el historial, 'progress' es el tipo de evento (kind), no una etapa: se quita.
      return [...m[1].matchAll(/'(\w+)'/g)].map((x) => x[1]).filter((x) => x !== "progress");
    };
    expect([...new Set(lista("leads_follow_up_action"))].sort()).toEqual([...TIPOS_DE_ACCION].sort());
    expect([...new Set(lista("lead_events_action"))].sort()).toEqual([...TIPOS_DE_ACCION].sort());
  });
  it("la etapa se guarda en follow_up_action (la de la 253) y no en una columna nueva", () => {
    expect(sinComentarios).not.toMatch(/add column if not exists (stage|etapa)\b/i);
    expect(sinComentarios).toMatch(/follow_up_action = coalesce\(p_action, l\.follow_up_action\)/);
  });
  it("closed deja won a nombre de quien anota; las demás dejan free sin dueño; sin etapa no cambia nada de eso", () => {
    expect(sinComentarios).toMatch(/when p_action = 'closed' then 'won' else 'free' end/);
    expect(sinComentarios).toMatch(/holder\s+= case when p_action is null then l\.holder when p_action = 'closed' then p_uid else null end/);
  });
  it("quién hizo el último contacto y cuándo: last_by, last_by_name, last_at (los de la 162)", () => {
    expect(sinComentarios).toMatch(/last_by\s+= p_uid/);
    expect(sinComentarios).toMatch(/last_at\s+= now\(\)/);
  });
  it("la conversión: tomados a libres con su etapa, revisión a libre, bad_lead y lost desde el último cierre, venta a closed", () => {
    expect(sinComentarios).toMatch(/where status = 'taken' and holder is not null;/);
    expect(sinComentarios).toMatch(/when last_outcome = 'bad_lead' then 'bad_lead'/);
    expect(sinComentarios).toMatch(/when last_outcome = 'nothing' then 'lost'/);
    expect(sinComentarios).toMatch(/when status = 'won' then 'closed'/);
    expect(sinComentarios).toMatch(/where status in \('taken', 'review'\);/);
  });
  it("la conversión no toca los archivados", () => {
    expect(sinComentarios.match(/status <> 'archived'/g)?.length).toBeGreaterThanOrEqual(3);
  });
  it("las comprobaciones al final deshacen todo si la conversión no cuadra", () => {
    expect(sinComentarios).toContain("raise exception '328: quedan leads tomados o en revisión';");
    expect(sinComentarios).toContain("raise exception '328: hay ventas sin dueño o sin etapa closed';");
  });
});

describe("328 · las cotizaciones y el historial", () => {
  it("el disparador anota «Quote #n» solo cuando la cotización sale de un lead, después de insertar", () => {
    expect(sinComentarios).toContain("create trigger estimator_quotes_nota_de_lead after insert on public.estimator_quotes");
    expect(sinComentarios).toContain("when (new.lead_id is not null)");
    expect(sinComentarios).toContain("'Quote #' || new.estimate_num");
  });
  it("si quien guarda no ve el lead, la cotización se guarda igual y no se anota nada", () => {
    expect(sinComentarios).toMatch(/if not public\.leads_puede_ver_fila\(new\.lead_id\) then return new; end if;/);
  });
  it("las cotizaciones de antes se anotan en el historial, sin cambiar la etapa del lead", () => {
    const bloque = sinComentarios.slice(sinComentarios.indexOf("insert into public.lead_events (lead_id, kind, note, action, actor, actor_name, subject, subject_name, at)"));
    expect(bloque.slice(0, 900)).toContain("'quote'");
    expect(bloque.slice(0, 900)).not.toMatch(/update public\.leads/);
  });
});

describe("328 · visto en varias cargas", () => {
  it("times_seen (default 1, >= 1) y last_seen_at, sin valor en lo viejo", () => {
    expect(sinComentarios).toContain("add column if not exists times_seen integer not null default 1");
    expect(sinComentarios).toContain("check (times_seen >= 1)");
    expect(sinComentarios).toMatch(/add column if not exists last_seen_at timestamptz;/);
  });
  it("la carga de la 162 se redefine: suma una vez por carga (no dos si la carga trae el lead dos veces)", () => {
    expect(sinComentarios).toContain("create or replace function public.leads_import_rows(p_rows jsonb, p_actor uuid)");
    expect(sinComentarios).toContain("times_seen = case when l.last_seen_at is distinct from now() then l.times_seen + 1 else l.times_seen end, last_seen_at = now()");
  });
  it("el importador privado hace lo mismo al actualizar y pone la fecha al insertar", () => {
    expect(importador).toContain("times_seen = case when l.last_seen_at is distinct from now() then l.times_seen + 1 else l.times_seen end, last_seen_at = now()");
    expect(importador).toContain("customer_matched_at, last_seen_at)");
    expect(importador).toContain("else now() end, now())");
  });
});
