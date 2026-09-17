import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ROLE_INFO, ROLE_ORDER } from "./constants";
import {
  alternaRolDeTutorial, limpiaRoles, nuevoTutorial, quitaRolesDesconocidos, ROLES_DE_AUDIENCIA,
  rolesDesconocidos, soloLoVeElAdmin,
} from "./tutorials-hub";
import type { Tutorial } from "./types";

/**
 * Para quién es cada tutorial (D-269): roles de Entregas, puestos en el video.
 *
 * **Quién ve qué se decide en la base** (`public.tutorials()`, 114), así que esa regla se prueba sobre
 * el `.sql` y no con una copia en TypeScript, que pasaría aunque la función dijera otra cosa. El ensayo
 * de verdad, por rol y con ROLLBACK, está al final del propio `.sql`.
 *
 * Aquí, con datos: lo que se guarda en la audiencia de un video, y el aviso al admin de los roles que no
 * existen.
 */

const leer = (r: string) => readFileSync(join(process.cwd(), r), "utf8").split("\r\n").join("\n");
const sinComentarios = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .split("\n").map((l) => (/^\s*(\/\/|--)/.test(l) ? "" : l.replace(/\s(\/\/|--\s).*$/, ""))).join("\n");

const video = (id: string, roles?: string[]): Tutorial => ({
  id, title: `Video ${id}`, url: `https://youtu.be/${id}`, added_by: "admin-1", added_at: "2026-09-01T10:00:00.000Z",
  ...(roles ? { roles } : {}),
});

describe("la audiencia que se puede elegir", () => {
  it("son los roles de ROLE_ORDER menos el admin, que ya lo ve todo", () => {
    expect(ROLES_DE_AUDIENCIA).toEqual(ROLE_ORDER.filter((r) => r !== "admin"));
    expect(ROLES_DE_AUDIENCIA).not.toContain("admin");
    // Control: cada uno tiene etiqueta en ROLE_INFO, que es de donde sale lo que se pinta.
    for (const r of ROLES_DE_AUDIENCIA) expect(ROLE_INFO[r], r).toBeDefined();
  });

  it("al guardar un video nuevo: solo roles elegibles, sin repetir, en el orden de siempre", () => {
    // Llegan desordenados y con basura, como los manda un formulario tocado a mano.
    expect(limpiaRoles(["warehouse", "sales", "admin", "no-existe", "sales"])).toEqual(["sales", "warehouse"]);
    const n = nuevoTutorial({ title: "X", url: "https://youtu.be/x", app: "general", roles: ["warehouse", "sales"] }, { id: "a" }, new Date(0), "n1");
    expect(n?.roles).toEqual(["sales", "warehouse"]);
  });

  it("sin roles, el video es para todos", () => {
    expect(nuevoTutorial({ title: "X", url: "https://youtu.be/x", app: "general" }, { id: "a" }, new Date(0), "n1")?.roles).toEqual([]);
  });
});

describe("cambiar la audiencia de un video", () => {
  it("poner y quitar un rol", () => {
    const lista = [video("v", ["sales"]), video("otro", ["sales"])];
    expect(alternaRolDeTutorial(lista, "v", "manager").map((t) => t.roles)).toEqual([["sales", "manager"], ["sales"]]);
    expect(alternaRolDeTutorial(lista, "v", "sales")[0].roles).toEqual([]);
  });

  it("el admin no es una audiencia: no se añade", () => {
    const lista = [video("v")];
    expect(alternaRolDeTutorial(lista, "v", "admin")).toBe(lista);
  });

  it("cambiar un rol conserva los desconocidos, para no esconder el problema", () => {
    const lista = [video("v", ["rol-borrado"])];
    expect(alternaRolDeTutorial(lista, "v", "sales")[0].roles).toEqual(["rol-borrado", "sales"]);
  });
});

describe("un rol que no existe se le enseña al admin", () => {
  it("se detectan los roles fuera de ROLE_INFO", () => {
    expect(rolesDesconocidos(["sales", "rol-borrado", "rol-borrado", "otro"])).toEqual(["rol-borrado", "otro"]);
    expect(rolesDesconocidos(["sales", "manager"])).toEqual([]);
    expect(rolesDesconocidos(undefined)).toEqual([]);
  });

  it("si TODOS sus roles son desconocidos, solo lo ve el admin", () => {
    expect(soloLoVeElAdmin(["rol-borrado"])).toBe(true);
    expect(soloLoVeElAdmin(["rol-borrado", "sales"])).toBe(false);
    // Sin audiencia es para todos, no «solo admin».
    expect(soloLoVeElAdmin([])).toBe(false);
    expect(soloLoVeElAdmin(undefined)).toBe(false);
    // «admin» como audiencia no añade a nadie: también se queda solo para admins.
    expect(soloLoVeElAdmin(["admin"])).toBe(true);
  });

  it("quitar los desconocidos deja los que existen, y sin ninguno vuelve a ser para todos", () => {
    expect(quitaRolesDesconocidos([video("v", ["rol-borrado", "sales"])], "v")[0].roles).toEqual(["sales"]);
    expect(quitaRolesDesconocidos([video("v", ["rol-borrado"])], "v")[0].roles).toEqual([]);
  });
});

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

describe("la pantalla", () => {
  const hub = sinComentarios(leer("src/components/tutorials/TutorialsHub.tsx"));

  it("cambiar la audiencia y ver los avisos es solo para quien gestiona", () => {
    expect(hub).toContain("onAlternarRol={puedeGestionar ? (rol) => guardar((actual) => alternaRolDeTutorial(actual, tut.id, rol)) : undefined}");
    expect(hub).toContain("{onAlternarRol && desconocidos.length > 0 && (");
  });

  it("las etiquetas de rol salen de ROLE_INFO en el idioma de quien mira", () => {
    expect(hub).toContain("roleLabel(r, lang)");
    expect(hub).not.toMatch(/"(Salesperson|Vendedor|Office Manager|Gerente de Oficina)"/);
  });

  it("el formulario de añadir manda la audiencia elegida", () => {
    expect(hub).toContain("nuevoTutorial({ title, url, description: desc, app, roles }, { id: yo }, new Date(), id)");
  });

  it("nada del diseño descartado: ni columna en perfiles ni casillas en el diálogo de usuario", () => {
    expect(sinComentarios(leer("src/components/UserDialog.tsx"))).not.toMatch(/tutorial/i);
    expect(sinComentarios(leer("src/lib/data-provider.tsx"))).not.toContain("tutorial_categories");
  });
});
