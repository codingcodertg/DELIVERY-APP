import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";

// El mismo cálculo que scripts/db/ledger.mjs (`checksum`): sha256 del cuerpo ANTES del marcador, con saltos a LF.
const MARK = "-- @ledger-below";
const aLF = (t: string) => t.split("\r\n").join("\n").split("\r").join("\n");
const checksum = (t: string) => createHash("sha256").update(aLF(t).split(MARK)[0], "utf8").digest("hex");

// Migración 357 (carga parcial en un paso, lote 2 de la auditoría 2026-11-27). Fija que la función es SECURITY INVOKER
// (RLS y guards aplican al chofer), que su permiso es solo para authenticated, que bloquea la orden antes de mirar la
// clave, que la clave se guarda en la misma transacción, y que el registro del final coincide con el checksum del cuerpo.

const leer = (r: string) => readFileSync(r, "utf8").split("\r\n").join("\n");
const m357 = leer("supabase/migrations/357_carga_parcial_en_un_paso.sql");
const cuerpo = m357.split(MARK)[0];
const funcion = cuerpo.slice(cuerpo.indexOf("create or replace function public.carga_parcial("));

describe("357 · carga parcial en un paso", () => {
  it("el registro del final declara el checksum del cuerpo (el que calcula el guarda)", () => {
    const declarado = m357.match(/values \('357_carga_parcial_en_un_paso\.sql', '([0-9a-f]{64})'\)/);
    expect(declarado).not.toBeNull();
    expect(declarado![1]).toBe(checksum(m357));
    expect(declarado![1]).not.toBe("__SUM__");
  });

  it("la función es SECURITY INVOKER: no salta RLS ni los guards", () => {
    expect(funcion).toContain("security invoker");
    expect(funcion).not.toMatch(/security definer/i);
    expect(funcion).toContain("set search_path = public");
  });

  it("solo authenticated la ejecuta: se quita de public y de anon", () => {
    expect(cuerpo).toContain("revoke all on function public.carga_parcial(uuid, numeric, uuid, jsonb, text, text) from public, anon;");
    expect(cuerpo).toContain("grant execute on function public.carga_parcial(uuid, numeric, uuid, jsonb, text, text) to authenticated;");
  });

  it("se niega sin sesión y sin clave", () => {
    expect(funcion).toContain("if auth.uid() is null then");
    expect(funcion).toContain("if p_clave is null then");
  });

  it("bloquea la orden original ANTES de mirar la clave (un reintento concurrente espera y ve el resto)", () => {
    const bloqueo = funcion.indexOf("for update");
    const mirarClave = funcion.indexOf("from public.carga_parcial_intentos i where i.clave = p_clave and i.orden_id = p_orden");
    expect(bloqueo).toBeGreaterThan(-1);
    expect(mirarClave).toBeGreaterThan(bloqueo);
  });

  it("si la clave ya partió esta orden devuelve el resto existente, antes de cualquier escritura", () => {
    const devuelve = funcion.indexOf("return ya;");
    const primeraEscritura = funcion.indexOf("insert into public.deliveries");
    expect(devuelve).toBeGreaterThan(-1);
    expect(devuelve).toBeLessThan(primeraEscritura);
  });

  it("una clave que pertenece a OTRA orden se rechaza, no se reusa", () => {
    expect(funcion).toContain("that split key belongs to another order");
  });

  it("aplica las mismas reglas de partición que el cliente: relevo, etapa y recuento", () => {
    expect(funcion).toContain("RELEVO_FIJO");
    expect(funcion).toMatch(/madre\.stage not in \('approved', 'fulfilling', 'ready'\)/);
    expect(funcion).toContain("p_pallets_cargados >= total");
    expect(funcion).toContain("coalesce(madre.actual_pallets, madre.est_pallets, 0)");
  });

  it("el resto nace en 'ready', sin chofer, con la letra siguiente y sin copiar el puesto ni el GPS de la original", () => {
    expect(funcion).toContain("'stage', 'ready'");
    expect(funcion).toContain("'assigned_driver', null");
    expect(funcion).toContain("'order_suffix', nueva");
    for (const col of ["'route_seq'", "'pickup_lat'", "'pickup_lng'", "'pickup_gps_at'", "'departed_at'", "'relay_step'", "'id'"]) {
      expect(funcion).toContain(col);
    }
  });

  it("la original solo cambia etapa, letra, recuento y los campos de la recogida (allowlist)", () => {
    expect(funcion).toContain("permitidos text[] := array['pickup_lat', 'pickup_lng', 'pickup_gps_at', 'assigned_driver']");
    expect(funcion).toContain("is not a field a load split can set");
    expect(funcion).toContain("set stage          = 'picked_up'");
    expect(funcion).not.toMatch(/est_pallets\s*=\s*total/);
  });

  it("la clave queda guardada en la misma transacción que las dos escrituras", () => {
    const ultimaEscritura = funcion.indexOf("insert into public.order_events");
    const guardaClave = funcion.indexOf("insert into public.carga_parcial_intentos");
    expect(guardaClave).toBeGreaterThan(ultimaEscritura);
    expect(funcion).toContain("return nueva_id;");
  });

  it("la tabla de intentos tiene RLS y solo deja leer y crear las filas propias", () => {
    expect(cuerpo).toContain("alter table public.carga_parcial_intentos enable row level security;");
    expect(cuerpo).toContain("using (created_by = (select auth.uid()));");
    expect(cuerpo).toContain("with check (created_by = (select auth.uid()));");
    expect(cuerpo).toContain("revoke all on public.carga_parcial_intentos from anon, public;");
    expect(cuerpo).not.toMatch(/grant\s+(update|delete|all)[^;]*carga_parcial_intentos/);
  });

  it("no lleva transacción propia ni cambia la columna de deliveries (la clave va aparte, no se copia en cada partición)", () => {
    expect(cuerpo).not.toMatch(/^\s*(begin|commit);/im);
    expect(cuerpo).not.toMatch(/alter table public\.deliveries/i);
  });

  it("es idempotente: create if not exists, create or replace, drop policy if exists", () => {
    expect(cuerpo).toContain("create table if not exists public.carga_parcial_intentos");
    expect(cuerpo).toContain("create or replace function public.carga_parcial(");
    expect(cuerpo.match(/^drop policy if exists/gim)?.length).toBe(2);
  });

  it("su autocomprobación revisa invoker, permisos y RLS", () => {
    expect(cuerpo).toContain("if f.prosecdef then");
    expect(cuerpo).toContain("has_function_privilege('anon', f.oid, 'execute')");
    expect(cuerpo).toContain("has_function_privilege('authenticated', f.oid, 'execute')");
    expect(cuerpo).toContain("relrowsecurity");
  });
});
