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

  it("RLS: leer solo el admin; ningún rol escribe la tabla directamente (ni INSERT, ni UPDATE, ni DELETE)", () => {
    expect(cuerpo).toContain("enable row level security");
    expect(cuerpo).toContain("for select to authenticated\n  using (public.is_admin())");
    expect(cuerpo).not.toMatch(/create policy[^;]*for (insert|update|delete)/);
    // La política de INSERT de la primera versión se borra si existe; no se vuelve a crear.
    expect(cuerpo.split("create policy").length - 1).toBe(1);
    expect(cuerpo).toContain("revoke all on table public.app_errors from anon, authenticated;");
    expect(cuerpo).toContain("grant select on table public.app_errors to authenticated;");
  });

  it("registrar_falla es SECURITY DEFINER y NO lee el usuario de auth.uid(): lo pone quien la llama desde la sesión", () => {
    expect(cuerpo).toContain("language plpgsql security definer set search_path = public");
    expect(cuerpo).not.toContain("auth.uid()");
    expect(cuerpo).not.toContain("auth.role()");
  });

  it("valida el origen, el formato de la huella y los textos (recortados a su tope)", () => {
    expect(cuerpo).toContain("if p_origen is null or p_origen not in ('cliente', 'servidor', 'accion', 'api', 'cron') then return; end if;");
    expect(cuerpo).toContain("if p_huella is null or p_huella !~ '^[0-9a-f]{16}$' then return; end if;");
    expect(cuerpo).toContain("left(p_componente, 120)");
    expect(cuerpo).toContain("left(coalesce(nullif(p_app, ''), 'deliveries'), 40)");
  });

  it("CHECKs de longitud en la tabla para app, ruta, componente, rol, versión y huella", () => {
    expect(cuerpo).toContain("app         text not null check (char_length(app) <= 40)");
    expect(cuerpo).toContain("ruta        text not null check (char_length(ruta) <= 300)");
    expect(cuerpo).toContain("componente  text check (componente is null or char_length(componente) <= 120)");
    expect(cuerpo).toContain("rol         text check (rol is null or char_length(rol) <= 40)");
    expect(cuerpo).toContain("version     text check (version is null or char_length(version) <= 40)");
    expect(cuerpo).toContain("huella      text not null check (huella ~ '^[0-9a-f]{16}$')");
  });

  it("frenos separados: cliente 50 por usuario y hora; servidor 100 por persona y 1000 en total por hora", () => {
    expect(cuerpo).toContain("if v_cliente >= 50 then return; end if;");
    expect(cuerpo).toContain("if v_servidor >= 100 then return; end if;");
    expect(cuerpo).toContain("if v_servidor >= 1000 then return; end if;");
    expect(cuerpo).toContain("where origen <> 'cliente' and user_id is not distinct from p_usuario and created_at > now() - interval '1 hour'");
    expect(cuerpo).toContain("where origen = 'cliente' and user_id = p_usuario and created_at > now() - interval '1 hour'");
    expect(cuerpo).toContain("where origen <> 'cliente' and created_at > now() - interval '1 hour'");
  });

  it("agrupa por huella dentro del mismo día (suma veces, no duplica)", () => {
    expect(cuerpo).toContain("and created_at >= date_trunc('day', now())");
    expect(cuerpo).toContain("veces = veces + 1");
  });

  it("EXECUTE solo para service_role: ni public, ni anon, ni authenticated", () => {
    expect(cuerpo).toMatch(/revoke all on function public\.registrar_falla\([^)]*\)\s+from public, anon, authenticated;/);
    expect(cuerpo).toMatch(/grant execute on function public\.registrar_falla\([^)]*\)\s+to service_role;/);
    expect(cuerpo).not.toMatch(/to authenticated, service_role/);
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
