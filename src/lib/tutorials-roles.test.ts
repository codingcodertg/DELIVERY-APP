import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * La 114 (D-269): la audiencia de un tutorial eran roles de Entregas, y el rol solo contaba con Entregas.
 *
 * Desde D-270 la función vigente es la de la 115 (roles de la app de cada video), y la lógica y la
 * pantalla se prueban en `tutorials-roles-por-app.test.ts`. Aquí queda lo que la 114 hizo, que sigue
 * siendo cierto de ese fichero.
 */

const leer = (r: string) => readFileSync(join(process.cwd(), r), "utf8").split("\r\n").join("\n");
const sinComentarios = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .split("\n").map((l) => (/^\s*(\/\/|--)/.test(l) ? "" : l.replace(/\s(\/\/|--\s).*$/, ""))).join("\n");

// ---- La 114 ----------------------------------------------------------------------------------

describe("114_tutorial_roles.sql: quién ve qué, en la base", () => {
  const sql = leer("supabase/migrations/114_tutorial_roles.sql");
  const ejecutable = sinComentarios(sql);
  const inicio = ejecutable.indexOf("create function public.tutorials()");
  const funcion = ejecutable.slice(inicio, ejecutable.indexOf("$$;", inicio));
  const quien = funcion.slice(funcion.indexOf("with quien as ("), funcion.indexOf("\n  select (t.value->>'id')"));
  const where = funcion.slice(funcion.indexOf("\n   where cfg.id = 1"), funcion.indexOf("order by t.ordinality"));
  const ramas = () => {
    const i = where.indexOf("and ( ");
    if (i < 0) throw new Error("no está el filtro de audiencia");
    const dentro = where.slice(i + "and ( ".length, where.lastIndexOf(")")).trim();
    return dentro.split(/\s+or\s+/).map((r) => r.trim());
  };

  it("la función y sus partes están (control)", () => {
    expect(inicio).toBeGreaterThan(-1);
    expect(quien).toContain("with quien as (");
    expect(where).toContain("where cfg.id = 1");
  });

  it("el admin ve todo; lo sin audiencia, todos; y el rol cuenta solo con Entregas", () => {
    const r = ramas();
    expect(r).toHaveLength(3);
    expect(r.slice(0, 2)).toEqual(["q.admin", "cardinality(a.roles) = 0"]);
    // La tercera: las DOS condiciones juntas, en el orden que sea (and es conmutativo).
    expect(r[2].startsWith("(") && r[2].endsWith(")")).toBe(true);
    expect(r[2].slice(1, -1).split(/\s+and\s+/).map((x) => x.trim()).sort()).toEqual(["q.con_entregas", "q.rol = any(a.roles)"]);
  });

  it("quién mira sale de los helpers que existen, y sin sesión cuenta como no", () => {
    expect(quien).toContain("coalesce(public.is_admin(), false)              as admin");
    expect(quien).toContain("coalesce(public.has_deliveries_access(), false) as con_entregas");
    expect(quien).toContain("public.current_user_role()                      as rol");
  });

  it("la audiencia se lee de cada video, y si no es una lista cuenta como vacía", () => {
    expect(funcion).toMatch(/case when jsonb_typeof\(t\.value->'roles'\) = 'array' then t\.value->'roles' else '\[\]'::jsonb end/);
  });

  it("devuelve las seis columnas, las cinco de la 113 más la audiencia", () => {
    const bloque = funcion.slice(funcion.indexOf("returns table ("), funcion.indexOf(")\nlanguage sql"));
    expect([...bloque.matchAll(/^\s{2}(\w+)\s/gm)].map((m) => m[1])).toEqual(["id", "title", "description", "url", "app", "roles"]);
    expect(funcion).not.toMatch(/added_by|added_at/);
  });

  it("conserva lo de la 113: título y enlace obligatorios, el orden, y security definer", () => {
    expect(where).toContain("nullif(btrim(coalesce(t.value->>'title', '')), '') is not null");
    expect(where).toContain("nullif(btrim(coalesce(t.value->>'url', '')), '') is not null");
    expect(funcion).toContain("order by t.ordinality");
    expect(funcion).toContain("security definer");
    expect(funcion).toContain("set search_path = public, pg_temp");
  });

  it("como la firma cambia, se borra antes de crear y los permisos se dan después", () => {
    const drop = ejecutable.indexOf("drop function if exists public.tutorials();");
    expect(drop).toBeGreaterThan(-1);
    expect(drop).toBeLessThan(inicio);
    expect(ejecutable.indexOf("revoke execute on function public.tutorials() from public, anon;")).toBeGreaterThan(inicio);
    expect(ejecutable.indexOf("grant  execute on function public.tutorials() to authenticated;")).toBeGreaterThan(inicio);
  });

  it("no escribe nada, ni toca perfiles, guards ni políticas", () => {
    expect(ejecutable).not.toMatch(/\bupdate\s+public\.|\binsert\s+into\s+public\.(?!schema_migrations)|alter\s+table/i);
    expect(ejecutable).not.toMatch(/create\s+policy|drop\s+policy|guard_|create\s+trigger/i);
  });

  it("se auto-registra en el ledger y no lleva el marcador sin numerar", () => {
    const [, despues] = sql.split("-- @ledger-below");
    expect(despues).toContain("114_tutorial_roles.sql");
    expect(sql).not.toContain("D-" + "NEXT");
  });
});
