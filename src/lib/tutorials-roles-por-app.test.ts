import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ROLE_ORDER } from "./constants";
import {
  APPS_DE_TUTORIAL, cambiaApp, editaTutorial, nuevoTutorial, ROLES_POR_APP, rolesDesconocidos, rolesParaApp,
  soloLoVeElAdmin, vocabularioDe,
} from "./tutorials-hub";
import type { Tutorial } from "./types";

/**
 * La audiencia de un tutorial son los roles de SU app (D-270, sobre D-269).
 *
 * **Quién ve qué se decide en la base** (`public.tutorials()`, 115), así que esa regla se prueba sobre el
 * `.sql` y no con una copia en TypeScript. El ensayo de verdad, por rol y con ROLLBACK, está al final del
 * propio `.sql`.
 *
 * Aquí, con datos: el vocabulario de cada app —comparado con el `check` vigente de su columna en la base,
 * para que no se separen—, lo que se guarda, y qué pasa al cambiar la app de un video.
 */

const leer = (r: string) => readFileSync(join(process.cwd(), r), "utf8").split("\r\n").join("\n");
const sinComentarios = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .split("\n").map((l) => (/^\s*(\/\/|--)/.test(l) ? "" : l.replace(/\s(\/\/|--\s).*$/, ""))).join("\n");

const video = (id: string, extra: Partial<Tutorial> = {}): Tutorial => ({
  id, title: `Video ${id}`, url: `https://youtu.be/${id}`, added_by: "admin-1", added_at: "2026-09-01T10:00:00.000Z", ...extra,
});

/** La última migración que contiene el patrón manda: es la definición vigente. */
function vigente(patron: RegExp): { fichero: string; m: RegExpMatchArray } {
  const dir = join(process.cwd(), "supabase/migrations");
  const encontrados = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()
    .map((f) => ({ fichero: f, m: sinComentarios(readFileSync(join(dir, f), "utf8").split("\r\n").join("\n")).match(patron) }))
    .filter((x): x is { fichero: string; m: RegExpMatchArray } => x.m !== null);
  if (encontrados.length === 0) throw new Error(`nadie define ${patron}`);
  return encontrados[encontrados.length - 1];
}
const valores = (lista: string) => [...lista.matchAll(/'([^']+)'/g)].map((x) => x[1]).sort();

describe("el vocabulario de cada app es el de su columna en la base", () => {
  it("RR. HH.: el check vigente de recruiting_role", () => {
    const { m } = vigente(/check \(recruiting_role is null or recruiting_role in \(([^)]*)\)\)/);
    expect([...ROLES_POR_APP.recruiting.claves].sort()).toEqual(valores(m[1]));
  });

  it("Time Tracker: el check vigente de timetracker_role", () => {
    const { fichero, m } = vigente(/check \(timetracker_role is null or timetracker_role in \(([^)]*)\)\)/);
    expect(fichero).toBe("089_store_manager.sql"); // control: la vigente tiene los tres niveles
    expect([...ROLES_POR_APP.timetracker.claves].sort()).toEqual(valores(m[1]));
  });

  it("ERP: el check vigente de erp_role", () => {
    const { m } = vigente(/check \(erp_role is null or erp_role in \(([^)]*)\)\)/);
    expect([...ROLES_POR_APP.erp.claves].sort()).toEqual(valores(m[1]));
  });

  it("Fichaje: lo que emite la vista clockin.profiles vigente", () => {
    const { m } = vigente(/create or replace view clockin\.profiles[\s\S]*?case([\s\S]*?)end as role/);
    const emitidos = [...m[1].matchAll(/then '([^']+)'|else '([^']+)'/g)].map((x) => x[1] ?? x[2]).sort();
    expect([...ROLES_POR_APP.clockin.claves].sort()).toEqual(emitidos);
  });

  it("Entregas y General: ROLE_ORDER menos admin, que ya ve todo", () => {
    const esperado = ROLE_ORDER.filter((r) => r !== "admin");
    expect(ROLES_POR_APP.deliveries.claves).toEqual(esperado);
    expect(ROLES_POR_APP.general.claves).toEqual(esperado);
  });

  it("las demás apps SÍ ofrecen su admin: no es el admin del hub", () => {
    for (const app of ["recruiting", "timetracker", "erp"] as const) expect(ROLES_POR_APP[app].claves, app).toContain("admin");
  });

  it("cada rol tiene etiqueta en los dos idiomas", () => {
    for (const app of [...APPS_DE_TUTORIAL, "general"] as const) {
      const v = ROLES_POR_APP[app];
      for (const k of v.claves) {
        expect(v.etiqueta(k, "en"), `${app}/${k}`).not.toBe("");
        expect(v.etiqueta(k, "es"), `${app}/${k}`).not.toBe("");
      }
    }
  });
});

describe("lo que se guarda de la audiencia", () => {
  it("solo roles de la app del video, sin repetir, en el orden de la app", () => {
    expect(rolesParaApp("timetracker", ["sales", "employee", "admin", "employee"])).toEqual(["admin", "employee"]);
    expect(rolesParaApp("erp", ["employee", "staff"])).toEqual(["staff"]);
  });

  it("un video de D-269 (sin app, con roles de Entregas) conserva su audiencia: es General", () => {
    expect(rolesParaApp(null, ["sales", "manager"])).toEqual(["manager", "sales"]);
    expect(vocabularioDe(undefined)).toBe(ROLES_POR_APP.general);
    expect(rolesDesconocidos(null, ["sales"])).toEqual([]);
  });

  it("un video nuevo guarda los roles de su app", () => {
    const n = nuevoTutorial({ title: "X", url: "https://youtu.be/x", app: "clockin", roles: ["sales", "manager", "owner"] }, { id: "a" }, new Date(0), "n1");
    expect(n?.roles).toEqual(["owner", "manager"]);
  });
});

describe("cambiar la app de un video no deja roles colgando", () => {
  it("se quitan los que no son de la app nueva, y se dicen", () => {
    expect(cambiaApp(["sales", "warehouse"], "timetracker")).toEqual({ roles: [], quitados: ["sales", "warehouse"] });
  });

  it("los que existen en las dos apps se quedan", () => {
    // `manager` existe en Entregas y en Time Tracker.
    expect(cambiaApp(["manager", "sales"], "timetracker")).toEqual({ roles: ["manager"], quitados: ["sales"] });
  });

  it("editar con otra app guarda solo los roles de la nueva, y conserva id, autor y fecha", () => {
    const lista = [video("v", { app: "deliveries", roles: ["sales"] }), video("otro")];
    const editada = editaTutorial(lista, "v", { title: " Nuevo ", url: "https://youtu.be/n", description: "", app: "timetracker", roles: ["sales", "employee"] });
    expect(editada?.[0]).toEqual({
      id: "v", title: "Nuevo", description: null, url: "https://youtu.be/n", app: "timetracker", roles: ["employee"],
      added_by: "admin-1", added_at: "2026-09-01T10:00:00.000Z",
    });
    expect(editada?.[1]).toBe(lista[1]);
  });

  it("editar sin título o un video que no existe no cambia nada", () => {
    const lista = [video("v")];
    expect(editaTutorial(lista, "v", { title: "", url: "https://youtu.be/n", description: "", app: "general", roles: [] })).toBeNull();
    expect(editaTutorial(lista, "nada", { title: "X", url: "https://youtu.be/n", description: "", app: "general", roles: [] })).toBeNull();
  });
});

describe("el aviso al admin", () => {
  it("roles que no son de la app del video", () => {
    expect(rolesDesconocidos("erp", ["staff", "sales"])).toEqual(["sales"]);
    expect(soloLoVeElAdmin("erp", ["sales"])).toBe(true);
    expect(soloLoVeElAdmin("erp", ["sales", "staff"])).toBe(false);
    expect(soloLoVeElAdmin("erp", [])).toBe(false);
  });
});

// ---- La 115 ----------------------------------------------------------------------------------

describe("115_tutorial_roles_per_app.sql: el rol de quien mira, en la app del video", () => {
  const sql = leer("supabase/migrations/115_tutorial_roles_per_app.sql");
  const ejecutable = sinComentarios(sql);
  const inicio = ejecutable.indexOf("create or replace function public.tutorials()");
  const funcion = ejecutable.slice(inicio, ejecutable.indexOf("$$;", inicio));
  const quien = funcion.slice(funcion.indexOf("with quien as ("), funcion.indexOf("\n  select (t.value->>'id')"));
  const caso = funcion.slice(funcion.indexOf("select case t.value->>'app'"), funcion.indexOf("end as coincide"));

  it("la función y sus partes están (control)", () => {
    expect(inicio).toBeGreaterThan(-1);
    expect(quien.length).toBeGreaterThan(100);
    expect(caso).toContain("else");
  });

  it("cada app compara SU rol, y solo con acceso a esa app", () => {
    // Cada rama: sus dos condiciones, en el orden que sea (`and` es conmutativo).
    const ramas = Object.fromEntries(
      [...caso.matchAll(/when '(\w+)'\s+then ([^\n]+)/g)].map((x) => [x[1], x[2].split(/\s+and\s+/).map((c) => c.replace(/\s+/g, " ").trim()).sort()]),
    );
    expect(ramas).toEqual({
      recruiting: ["q.con_rrhh", "q.rol_rrhh = any(a.roles)"],
      timetracker: ["q.con_tt", "q.rol_tt = any(a.roles)"],
      clockin: ["q.con_fichaje", "q.rol_fichaje = any(a.roles)"],
      erp: ["q.con_erp", "q.rol_erp = any(a.roles)"],
    });
    // Entregas, sin app o desconocida: el else, con Entregas.
    expect(caso).toMatch(/else\s+q\.con_entregas and q\.rol_entregas = any\(a\.roles\)/);
    // Y el TS no tiene ninguna app que el SQL no sepa tratar.
    expect([...APPS_DE_TUTORIAL].filter((a) => a !== "deliveries" && !(a in ramas))).toEqual([]);
  });

  it("cada rol y cada acceso salen de su columna y de su helper", () => {
    for (const linea of [
      "coalesce(public.is_admin(), false)               as admin",
      "coalesce(public.has_deliveries_access(), false)  as con_entregas",
      "coalesce(public.has_recruiting_access(), false)  as con_rrhh",
      "coalesce(public.has_timetracker_access(), false) as con_tt",
      "coalesce(public.has_clockin_access(), false)     as con_fichaje",
      "coalesce(public.has_erp_access(), false)         as con_erp",
      "p.role                                           as rol_entregas",
      "p.recruiting_role                                as rol_rrhh",
      "p.timetracker_role                               as rol_tt",
      "(select c.role from clockin.profiles c where c.id = auth.uid()) as rol_fichaje",
      "p.erp_role                                       as rol_erp",
    ]) {
      expect(quien, linea).toContain(linea);
    }
    expect(quien).toContain("left join public.profiles p on p.id = auth.uid()");
  });

  it("el admin ve todo, lo sin audiencia lo ven todos, y si no, la coincidencia", () => {
    const where = funcion.slice(funcion.indexOf("\n   where cfg.id = 1"), funcion.indexOf("order by t.ordinality"));
    const i = where.indexOf("and ( ");
    const ramas = where.slice(i + "and ( ".length, where.lastIndexOf(")")).trim().split(/\s+or\s+/).map((r) => r.trim());
    expect(ramas).toEqual(["q.admin", "cardinality(a.roles) = 0", "coalesce(m.coincide, false)"]);
  });

  it("la firma es la de la 114, así que basta create or replace y no hay drop", () => {
    const bloque = funcion.slice(funcion.indexOf("returns table ("), funcion.indexOf(")\nlanguage sql"));
    expect([...bloque.matchAll(/^\s{2}(\w+)\s/gm)].map((x) => x[1])).toEqual(["id", "title", "description", "url", "app", "roles"]);
    expect(ejecutable).not.toMatch(/drop\s+function/i);
  });

  it("conserva lo anterior: título y enlace, orden, security definer, permisos, nada de added_by", () => {
    expect(funcion).toContain("nullif(btrim(coalesce(t.value->>'title', '')), '') is not null");
    expect(funcion).toContain("nullif(btrim(coalesce(t.value->>'url', '')), '') is not null");
    expect(funcion).toContain("order by t.ordinality");
    expect(funcion).toContain("security definer");
    expect(funcion).toContain("set search_path = public, pg_temp");
    expect(funcion).not.toMatch(/added_by|added_at/);
    expect(ejecutable).toContain("revoke execute on function public.tutorials() from public, anon;");
    expect(ejecutable).toContain("grant  execute on function public.tutorials() to authenticated;");
  });

  it("no escribe nada, ni toca políticas o guards", () => {
    expect(ejecutable).not.toMatch(/\bupdate\s+public\.|alter\s+table|create\s+policy|guard_|create\s+trigger/i);
  });

  it("se auto-registra en el ledger y no lleva el marcador sin numerar", () => {
    const [, despues] = sql.split("-- @ledger-below");
    expect(despues).toContain("115_tutorial_roles_per_app.sql");
    expect(sql).not.toContain("D-" + "NEXT");
  });
});

describe("la pantalla", () => {
  const hub = sinComentarios(leer("src/components/tutorials/TutorialsHub.tsx"));

  it("las casillas son los roles de la app elegida, y cambiar la app pasa por cambiaApp", () => {
    expect(hub).toContain("const vocabulario = vocabularioDe(app);");
    expect(hub).toContain("vocabulario.claves.map((r) =>");
    expect(hub).toContain("const r = cambiaApp(roles, nueva);");
    expect(hub).toContain('onChange={(e) => elegirApp(e.target.value as TutorialApp | "general")}');
  });

  it("editar usa el mismo formulario, sobre lo que hay en la base, y solo para quien gestiona", () => {
    expect(hub).toContain("<FormularioTutorial inicial={tut} onGuardar={(e) => editar(tut.id, e)}");
    expect(hub).toContain("editaTutorial(actual, id, e) ?? actual");
    expect(hub).toContain("gestion={puedeGestionar ? {");
  });

  it("ya no hay botones sueltos de rol (D-269)", () => {
    expect(hub).not.toMatch(/alternaRolDeTutorial|onAlternarRol|quitaRolesDesconocidos/);
  });

  it("compacto: el reproductor se abre al tocar, uno a la vez, con ancho máximo", () => {
    expect(hub).toContain("const [abierto, setAbierto] = useState<string | null>(null);");
    expect(hub).toContain("setAbierto((a) => (a === tut.id ? null : tut.id))");
    expect(hub).toContain("{abierto && <Reproductor tut={tut} />}");
    expect(hub).toMatch(/maxWidth: 560/);
  });
});
