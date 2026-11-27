import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";

// El mismo cálculo que scripts/db/ledger.mjs (`checksum`): sha256 del cuerpo ANTES del marcador, con saltos a LF.
const MARK = "-- @ledger-below";
const aLF = (t: string) => t.split("\r\n").join("\n").split("\r").join("\n");
const checksum = (t: string) => createHash("sha256").update(aLF(t).split(MARK)[0], "utf8").digest("hex");

// Migración 356 (revisión de fallas de los crons, 2026-11-27). Fija que la función corre como SECURITY DEFINER con
// search_path fijo, que nadie fuera de la base la ejecuta, que se programa cada 15 minutos, que registra las fallas
// SOLO por registrar_falla (origen 'cron'), que la huella es de 16 hex y que llama_cron guarda la ruta de cada petición.

const leer = (r: string) => aLF(readFileSync(r, "utf8"));
const m356 = leer("supabase/migrations/356_revisa_fallas_de_cron.sql");
const cuerpo = m356.split(MARK)[0];

// Solo el texto de revisa_fallas_de_cron (de su create a su fin de función), para afirmar sobre ella y no sobre llama_cron.
const inicioRevisa = cuerpo.indexOf("create or replace function public.revisa_fallas_de_cron()");
const finRevisa = cuerpo.indexOf("end $$;", inicioRevisa);
const revisa = cuerpo.slice(inicioRevisa, finRevisa);

describe("356 · revisión de fallas de los crons", () => {
  it("el registro del final declara el checksum del cuerpo (el que calcula el guarda)", () => {
    const declarado = m356.match(/values \('356_revisa_fallas_de_cron\.sql', '([0-9a-f]{64})'\)/);
    expect(declarado).not.toBeNull();
    expect(declarado![1]).toBe(checksum(m356));
  });

  it("revisa_fallas_de_cron es SECURITY DEFINER con search_path fijo y vacío", () => {
    expect(inicioRevisa).toBeGreaterThan(-1);
    expect(revisa).toContain("language plpgsql security definer set search_path = '' as $$");
  });

  it("no ejecutable por public, anon ni authenticated (solo el cron de la base)", () => {
    expect(cuerpo).toContain("revoke all on function public.revisa_fallas_de_cron() from public, anon, authenticated;");
  });

  it("se programa cada 15 minutos y es idempotente (desprograma si ya existe)", () => {
    expect(cuerpo).toContain("if exists (select 1 from cron.job where jobname = 'revisa-fallas-de-cron') then");
    expect(cuerpo).toContain("perform cron.unschedule('revisa-fallas-de-cron');");
    expect(cuerpo).toContain(
      "select cron.schedule('revisa-fallas-de-cron', '*/15 * * * *', $cron$select public.revisa_fallas_de_cron()$cron$);",
    );
  });

  it("registra cada falla con public.registrar_falla, origen 'cron' y app 'cron'", () => {
    expect(revisa).toContain("perform public.registrar_falla(");
    expect(revisa).toContain("'cron'::text, 'cron'::text,");
    // Ninguna escritura directa a app_errors: la única puerta es registrar_falla.
    expect(revisa).not.toMatch(/insert\s+into\s+public\.app_errors/i);
  });

  it("mira los dos orígenes de falla: job_run_details con status 'failed' y net._http_response con error", () => {
    expect(revisa).toContain("from cron.job_run_details d");
    expect(revisa).toContain("where d.status = 'failed'");
    expect(revisa).toContain("from net._http_response h");
    expect(revisa).toContain("(h.status_code >= 400 or h.timed_out or h.error_msg is not null)");
  });

  it("la huella es md5 recortado a 16 caracteres (formato que valida registrar_falla)", () => {
    expect(revisa).toContain("left(md5('job|' || r.nombre || '|' || r.motivo), 16)");
    expect(revisa).toContain("left(md5('http|' || r.ruta || '|' || r.tipo), 16)");
  });

  it("agrupa por trabajo o ruta y tipo: una llamada por grupo, con el conteo en el mensaje (no una por falla)", () => {
    expect(revisa).toContain("group by x.nombre, x.motivo");
    expect(revisa).toContain("group by x.ruta, x.tipo");
    expect(revisa).toContain("(x' || r.veces || ' en 15 min)'");
  });

  it("ventana sin solape: la marca se guarda y se avanza solo al final, con margen de 2 minutos", () => {
    expect(cuerpo).toContain("create table if not exists public.cron_revision_fallas");
    expect(revisa).toContain("v_hasta   timestamptz := now() - interval '2 minutes';");
    expect(revisa).toContain("v_desde := greatest(v_marca, now() - interval '2 hours');");
    expect(revisa).toContain("update public.cron_revision_fallas set revisado_hasta = v_hasta where id = 1;");
  });

  it("no filtra el boleto ni el token: el texto del error se limpia antes de guardarlo", () => {
    expect(revisa).toContain("regexp_replace(h.error_msg, 'Bearer\\s+\\S+', '[oculto]', 'gi')");
    expect(revisa).toContain("'boleto:\\S+', '[oculto]', 'g'");
  });

  it("no usa auth.uid(): los crons no tienen usuario", () => {
    expect(cuerpo).not.toContain("auth.uid()");
    expect(revisa).toContain("null::uuid");
  });

  it("llama_cron conserva la validación de rutas de la 343 y guarda la ruta de cada petición", () => {
    expect(cuerpo).toContain("if p_ruta !~ '^/api/cron/[a-z0-9/-]+$' and p_ruta <> '/timetracker/clock-in/api/cron' then");
    expect(cuerpo).toContain("v_peticion := net.http_get(");
    expect(cuerpo).toContain("insert into public.cron_peticiones (request_id, ruta) values (v_peticion, p_ruta);");
    expect(cuerpo).toContain("revoke all on function public.llama_cron(text) from public, anon, authenticated;");
  });

  it("la tabla de peticiones y la marca tienen RLS sin políticas y sin permisos para anon/authenticated", () => {
    expect(cuerpo).toContain("alter table public.cron_peticiones enable row level security;");
    expect(cuerpo).toContain("revoke all on table public.cron_peticiones from public, anon, authenticated;");
    expect(cuerpo).toContain("alter table public.cron_revision_fallas enable row level security;");
    expect(cuerpo).toContain("revoke all on table public.cron_revision_fallas from public, anon, authenticated;");
    expect(cuerpo).not.toMatch(/create policy/);
  });
});
