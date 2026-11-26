import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";

// El mismo cálculo que scripts/db/ledger.mjs (`checksum`): sha256 del cuerpo ANTES del marcador, con saltos a LF.
const MARK = "-- @ledger-below";
const aLF = (t: string) => t.split("\r\n").join("\n").split("\r").join("\n");
const checksum = (t: string) => createHash("sha256").update(aLF(t).split(MARK)[0], "utf8").digest("hex");

// Migración 352 (fallas de la app, 2026-11-25). Fija que la tabla, la función de escritura y las políticas están como
// se decidió, que el freno y la retención existen, que el registro del final coincide con el checksum del cuerpo, y
// que ninguna columna del cliente puede elegir al usuario.

const leer = (r: string) => readFileSync(r, "utf8").split("\r\n").join("\n");
const m352 = leer("supabase/migrations/352_fallas_de_la_app.sql");
const cuerpo = m352.split(MARK)[0];

describe("352 · fallas de la app", () => {
  it("el registro del final declara el checksum del cuerpo (el que calcula el guarda)", () => {
    const declarado = m352.match(/values \('352_fallas_de_la_app\.sql', '([0-9a-f]{64})'\)/);
    expect(declarado).not.toBeNull();
    expect(declarado![1]).toBe(checksum(m352));
  });

  it("crea app_errors con las columnas pedidas y los límites de tamaño", () => {
    for (const col of ["origen", "app", "ruta", "mensaje", "pila", "componente", "user_id", "rol", "version",
      "navegador", "escritorio", "huella", "veces", "ultima_vez", "usuarios"]) {
      expect(cuerpo).toMatch(new RegExp(`\\n\\s+${col}\\s`));
    }
    expect(cuerpo).toContain("check (origen in ('cliente', 'servidor', 'accion', 'api', 'cron'))");
    expect(cuerpo).toContain("char_length(mensaje) <= 500");
    expect(cuerpo).toContain("char_length(pila) <= 4000");
    expect(cuerpo).toContain("char_length(navegador) <= 300");
  });

  it("tiene los dos índices: por huella y por fecha descendente", () => {
    expect(cuerpo).toContain("create index if not exists app_errors_huella_idx on public.app_errors (huella);");
    expect(cuerpo).toContain("create index if not exists app_errors_created_at_desc_idx on public.app_errors (created_at desc);");
  });

  it("RLS: escribir solo el propio usuario (o nadie), leer solo el admin, sin UPDATE ni DELETE para clientes", () => {
    expect(cuerpo).toContain("enable row level security");
    expect(cuerpo).toContain("for insert to authenticated\n  with check (user_id is null or user_id = auth.uid())");
    expect(cuerpo).toContain("for select to authenticated\n  using (public.is_admin())");
    expect(cuerpo).toContain("revoke all on table public.app_errors from anon;");
    expect(cuerpo).toMatch(/revoke update, delete, truncate on table public\.app_errors from authenticated;/);
    expect(cuerpo).not.toMatch(/create policy[^;]*for (update|delete)/);
  });

  it("registrar_falla es SECURITY DEFINER y saca el usuario de auth.uid(), no del cliente", () => {
    expect(cuerpo).toContain("language plpgsql security definer set search_path = public");
    expect(cuerpo).toContain("case when auth.role() = 'service_role' then p_usuario else auth.uid() end");
    expect(cuerpo).not.toMatch(/v_usuario\s*:=\s*p_usuario\s*;/);
  });

  it("el freno: 50 por usuario y hora (300 sin usuario), descartando en silencio", () => {
    expect(cuerpo).toContain("v_tope := case when v_usuario is null then 300 else 50 end;");
    expect(cuerpo).toContain("created_at > now() - interval '1 hour') >= v_tope then\n    return;");
  });

  it("agrupa por huella dentro del mismo día (suma veces, no duplica)", () => {
    expect(cuerpo).toContain("and created_at >= date_trunc('day', now())");
    expect(cuerpo).toContain("veces = veces + 1");
  });

  it("concede la función solo a authenticated y service_role", () => {
    expect(cuerpo).toMatch(/revoke all on function public\.registrar_falla\([^)]*\)\s+from public, anon;/);
    expect(cuerpo).toMatch(/grant execute on function public\.registrar_falla\([^)]*\)\s+to authenticated, service_role;/);
  });

  it("la retención: un cron diario que borra lo de más de 60 días", () => {
    expect(cuerpo).toContain("cron.schedule('limpia-fallas-de-la-app', '30 9 * * *'");
    expect(cuerpo).toContain("created_at < now() - interval '60 days'");
  });

  it("se comprueba a sí misma al final, y es idempotente", () => {
    expect(cuerpo).toMatch(/do \$\$[\s\S]*raise exception[\s\S]*end \$\$;\s*$/);
    expect(cuerpo).toContain("create table if not exists public.app_errors");
    expect(cuerpo).toContain("create or replace function public.registrar_falla");
    expect(cuerpo).toContain("drop policy if exists app_errors_select_admin");
  });
});
