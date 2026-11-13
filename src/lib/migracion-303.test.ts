import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 303 (D-1019): a `anon` se le quita el EXECUTE de 115 funciones SECURITY DEFINER. La migración es una lista EXPLÍCITA,
 * y estas pruebas cuidan lo que la hace segura: nunca le quita nada a quien inició sesión ni al servidor, deja las cinco
 * que las políticas RLS con rol `public` necesitan, y no usa bucles sobre esquemas.
 */
const sql = readFileSync(join(process.cwd(), "supabase/migrations/303_seguridad_anon_search_path_bucket.sql"), "utf8").replace(/\r\n/g, "\n");
const cuerpo = sql.slice(0, sql.indexOf("-- ROLLBACK (comentado)"));
const quitadas = [...cuerpo.matchAll(/^revoke execute on routine (.+) from public, anon;$/gm)].map((m) => m[1]);
const devueltas = [...cuerpo.matchAll(/^grant execute on routine (.+) to authenticated, service_role;$/gm)].map((m) => m[1]);
const seQuedan = [...cuerpo.matchAll(/^-- KEEP: (.+)$/gm)].map((m) => m[1]);

describe("303 · anon ya no ejecuta las SECURITY DEFINER internas", () => {
  it("115 quitadas, cada una con su GRANT a authenticated y service_role (quien inició sesión no pierde nada)", () => {
    expect(quitadas).toHaveLength(115);
    expect(new Set(quitadas).size).toBe(115);
    expect(devueltas).toEqual(quitadas);
  });
  it("solo se le quita a public y anon: ningún revoke toca a authenticated ni a service_role", () => {
    const revokes = [...cuerpo.matchAll(/^revoke .+$/gm)].map((m) => m[0]);
    expect(revokes).toHaveLength(115);
    for (const r of revokes) expect(r).toMatch(/ from public, anon;$/);
    expect(cuerpo).not.toMatch(/^revoke .*\b(authenticated|service_role)\b/m);
  });
  it("las cinco que usan las políticas RLS con rol public se quedan", () => {
    expect(seQuedan).toEqual([
      "clockin.auth_company_id()", "clockin.auth_is_manager()", "clockin.auth_is_owner()",
      "public.current_recruiting_role()", "public.current_user_role()",
    ]);
    for (const f of seQuedan) expect(quitadas).not.toContain(f);
  });
  it("lista explícita, sin bucles sobre el catálogo, y la autocomprobación mira las mismas 115 + 5", () => {
    const antesDelChk = cuerpo.slice(0, cuerpo.indexOf("do $chk$"));
    expect(antesDelChk).not.toMatch(/\bexecute format\b|\bfor \w+ in select\b/i);
    const chk = cuerpo.slice(cuerpo.indexOf("do $chk$"));
    for (const f of [...quitadas, ...seQuedan]) expect(chk).toContain(`'${f}'`);
    expect(chk).toContain("authenticated perdio");
    expect(chk).toContain("service_role perdio");
  });
  it("search_path en las 8, bucket app solo APK (50 MB) y las dos políticas con (select auth.uid())", () => {
    expect([...cuerpo.matchAll(/^alter function .+ set search_path = .+;$/gm)]).toHaveLength(8);
    expect(cuerpo).toContain("allowed_mime_types = array['application/vnd.android.package-archive']");
    expect(cuerpo).toContain("file_size_limit = 52428800");
    expect(cuerpo.match(/= \(select auth\.uid\(\)\)/g)).toHaveLength(2);
    // La vista de la 290 es SECURITY DEFINER a propósito: no se toca.
    expect(cuerpo).not.toMatch(/^(alter|drop|create).* view/im);
  });
  it("trae el rollback (comentado) con un GRANT por cada función quitada", () => {
    const rollback = sql.slice(sql.indexOf("-- ROLLBACK (comentado)"), sql.indexOf("-- @ledger-below"));
    for (const f of quitadas) expect(rollback).toContain(`-- grant execute on routine ${f} to public`);
  });
});
