import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { AnySupabase } from "@/lib/clockin/supabase/types";
import { canManageEmployee, type Me } from "@/lib/clockin/mgrScope";
import { delEquipo, perfilesDeMiEquipo, personaDeMiEquipo, type PersonaDeEquipo } from "./equipo";

// 358 · la lista de gente que un gerente puede gestionar. La 291 (pendiente) cierra la lectura de
// `public.profiles`; sin esta función Time Tracker perdería a la cuadrilla. Estas pruebas fijan tres
// cosas: la migración (definer, search_path, permisos, checksum), que el helper filtra por id y por
// alcance, y que cae a la lectura de antes mientras la 358 no esté aplicada.

const SQL = readFileSync(join(__dirname, "../../../supabase/migrations/358_perfiles_de_mi_equipo.sql"), "utf8").replace(/\r\n/g, "\n");

const EMPRESA = "c0000000-0000-0000-0000-00000000000c";
const OTRA_EMPRESA = "c9999999-9999-9999-9999-99999999999c";
const TIENDA_A = "a0000000-0000-0000-0000-00000000000a";
const TIENDA_B = "b0000000-0000-0000-0000-00000000000b";

const persona = (p: Partial<PersonaDeEquipo> & { id: string }): PersonaDeEquipo => ({
  full_name: null,
  role: "employee",
  company_id: EMPRESA,
  store_id: null,
  extra_store_ids: [],
  active: true,
  position: null,
  default_schedule: null,
  custom_schedule: null,
  is_runner: false,
  vehicle_id: null,
  timetracker_role: null,
  ...p,
});

/** Cliente de mentira: `rpc` responde lo que se le diga y `from(...)` lista la tabla de la lectura vieja. */
function clienteFalso(opts: {
  rpc?: { data: unknown; error: unknown } | "ausente";
  tablas?: Record<string, Record<string, unknown>[]>;
}) {
  const llamadas: string[] = [];
  const from = (tabla: string) => {
    const filtros: [string, unknown][] = [];
    let cols: string[] = [];
    const filas = () => (opts.tablas?.[tabla] ?? []).filter((f) => filtros.every(([c, v]) => f[c] === v));
    const q = {
      select(c: string) { cols = c.split(",").map((x) => x.trim()); return q; },
      eq(col: string, val: unknown) { filtros.push([col, val]); return q; },
      async maybeSingle() {
        llamadas.push(`${tabla}.maybeSingle`);
        const f = filas()[0];
        return f ? { data: Object.fromEntries(cols.map((c) => [c, f[c]])), error: null } : { data: null, error: null };
      },
      then(ok: (r: { data: unknown; error: null }) => unknown) {
        llamadas.push(`${tabla}.lista`);
        return Promise.resolve({ data: filas().map((f) => Object.fromEntries(cols.map((c) => [c, f[c]]))), error: null }).then(ok);
      },
    };
    return q;
  };
  const cliente = {
    from,
    schema: () => cliente,
    rpc: async (fn: string) => {
      llamadas.push(`rpc ${fn}`);
      if (!opts.rpc || opts.rpc === "ausente") {
        return { data: null, error: { code: "PGRST202", message: `Could not find the function clockin.${fn} in the schema cache` } };
      }
      return opts.rpc;
    },
  };
  return { cliente: cliente as unknown as AnySupabase, llamadas };
}

describe("358 · migración: la función es definer, fija su search_path y solo la usa quien tiene sesión", () => {
  it("es SECURITY DEFINER con search_path fijo y devuelve las columnas de Time Tracker", () => {
    expect(SQL).toContain("create or replace function clockin.perfiles_de_mi_equipo()");
    expect(SQL).toMatch(/"position"\s+text,/);
    expect(SQL).toMatch(/security definer\s+set search_path = clockin, public/);
    // El `returns table (...)` va con los tipos alineados en columnas: se busca «nombre  tipo» con espacios libres.
    for (const [col, tipo] of [["id", "uuid"], ["full_name", "text"], ["role", "text"], ["company_id", "uuid"], ["store_id", "uuid"],
      ["extra_store_ids", "uuid\\[\\]"], ["active", "boolean"], ["default_schedule", "text"], ["custom_schedule", "jsonb"],
      ["is_runner", "boolean"], ["vehicle_id", "uuid"], ["timetracker_role", "text"]] as const) {
      expect(SQL, `falta la columna ${col}`).toMatch(new RegExp(`\\b${col}\\s+${tipo}(?![\\w])`));
    }
  });

  it("aplica el alcance del código: dueño = empresa, gerente = su tienda y las concedidas, sin tienda nadie", () => {
    expect(SQL).toContain("where (a.role = 'owner' and t.company_id = a.company_id)");
    expect(SQL).toContain("or (a.role = 'manager' and t.company_id = a.company_id and t.store_id = any (a.tiendas))");
    expect(SQL).toContain("when y.role = 'manager' and y.store_id is not null");
    expect(SQL).toContain("array[y.store_id] || coalesce(y.extra_store_ids, '{}'::uuid[])");
    // Un admin del hub sin fila de Time Tracker usa la misma empresa que managerCtx.
    expect(SQL).toContain("clockin.auth_company_id()");
    // Sin sesión no hay filas.
    expect(SQL).toContain("where v.id = (select auth.uid())");
  });

  it("permisos: fuera public y anon, a authenticated y service_role", () => {
    expect(SQL).toContain("revoke execute on function clockin.perfiles_de_mi_equipo() from public, anon;");
    expect(SQL).toContain("grant execute on function clockin.perfiles_de_mi_equipo() to authenticated, service_role;");
  });

  it("no abre transacción propia, es idempotente y se autocomprueba", () => {
    const cuerpo = SQL.split("-- @ledger-below")[0];
    expect(cuerpo).not.toMatch(/^\s*(begin|commit)\s*;/im);
    expect(SQL).toContain("do $chk$");
    expect(SQL).toContain("has_function_privilege('anon'");
  });

  it("el checksum del registro es el sha256 del texto ANTES del marcador (LF)", () => {
    const cuerpo = SQL.split("-- @ledger-below")[0];
    const sha = createHash("sha256").update(cuerpo, "utf8").digest("hex");
    expect(SQL).toContain(`insert into public.schema_migrations (name, checksum) values ('358_perfiles_de_mi_equipo.sql', '${sha}')`);
  });
});

describe("358 · helper: usa la función y cae a la lectura de antes si aún no existe", () => {
  it("con la función, devuelve lo que devuelve y no hace la lectura vieja", async () => {
    const lista = [persona({ id: "e1", full_name: "Ana" })];
    const { cliente, llamadas } = clienteFalso({ rpc: { data: lista, error: null } });
    expect(await perfilesDeMiEquipo(cliente)).toEqual(lista);
    expect(llamadas).toEqual(["rpc perfiles_de_mi_equipo"]);
  });

  it("si la función no existe (PGRST202), cae a la lectura de antes sin timetracker_role", async () => {
    const { cliente, llamadas } = clienteFalso({
      rpc: "ausente",
      tablas: { profiles: [{ id: "e1", full_name: "Ana", company_id: EMPRESA, store_id: TIENDA_A, extra_store_ids: [], active: true, role: "employee" }] },
    });
    const lista = await perfilesDeMiEquipo(cliente);
    expect(llamadas).toEqual(["rpc perfiles_de_mi_equipo", "profiles.lista"]);
    expect(lista).toHaveLength(1);
    expect(lista[0]).toMatchObject({ id: "e1", store_id: TIENDA_A, timetracker_role: null });
  });

  it("ante otro error devuelve lista vacía: el alcance se acota, nunca se amplía", async () => {
    const { cliente } = clienteFalso({ rpc: { data: null, error: { code: "42501", message: "permission denied" } } });
    expect(await perfilesDeMiEquipo(cliente)).toEqual([]);
  });

  it("personaDeMiEquipo filtra por id dentro de la lista, y nulo si no está", async () => {
    const lista = [
      persona({ id: "e1", full_name: "Ana", store_id: TIENDA_A }),
      persona({ id: "e2", full_name: "Beto", store_id: TIENDA_B }),
    ];
    const { cliente } = clienteFalso({ rpc: { data: lista, error: null } });
    expect(await personaDeMiEquipo(cliente, "e2")).toMatchObject({ id: "e2", full_name: "Beto" });
    expect(await personaDeMiEquipo(cliente, "nadie")).toBeNull();
  });
});

describe("delEquipo: los mismos filtros que tenían las consultas de antes", () => {
  const lista = [
    persona({ id: "d", full_name: "Dueña", role: "owner", store_id: null }),
    persona({ id: "a", full_name: "Ana", store_id: TIENDA_A }),
    persona({ id: "b", full_name: "Beto", store_id: TIENDA_B }),
    persona({ id: "i", full_name: "Inactivo", store_id: TIENDA_A, active: false }),
    persona({ id: "x", full_name: "Otra empresa", company_id: OTRA_EMPRESA, store_id: TIENDA_A }),
  ];

  it("empresa, activos, sin dueños y tiendas, y ordenado por nombre", () => {
    const r = delEquipo(lista, { companyId: EMPRESA, tiendas: [TIENDA_A, TIENDA_B], soloActivos: true, sinDuenos: true });
    expect(r.map((p) => p.id)).toEqual(["a", "b"]);
  });

  it("sin tiendas (dueño) ve toda la empresa, y el dueño sale solo si se pide", () => {
    expect(delEquipo(lista, { companyId: EMPRESA, tiendas: null }).map((p) => p.id)).toEqual(["a", "b", "d", "i"]);
    expect(delEquipo(lista, { companyId: EMPRESA, tiendas: null, sinDuenos: true }).map((p) => p.id)).toEqual(["a", "b", "i"]);
  });

  it("una lista de tiendas vacía o imposible no deja pasar a nadie", () => {
    expect(delEquipo(lista, { companyId: EMPRESA, tiendas: [] })).toEqual([]);
  });
});

describe("canManageEmployee sobre la lista acotada (358)", () => {
  const GERENTE_A: Me = { role: "manager", company_id: EMPRESA, store_id: TIENDA_A };
  const gente = [
    persona({ id: "mia", store_id: TIENDA_A }),
    persona({ id: "suya", store_id: TIENDA_B }),
    persona({ id: "ajena", company_id: OTRA_EMPRESA, store_id: TIENDA_A }),
  ];

  it("consulta la función y decide con la persona encontrada en su lista", async () => {
    // La función ya devuelve solo lo que el gerente puede gestionar; aquí solo entra «mia».
    const { cliente, llamadas } = clienteFalso({ rpc: { data: [gente[0]], error: null } });
    expect(await canManageEmployee(cliente, GERENTE_A, "mia")).toBe(true);
    expect(await canManageEmployee(cliente, GERENTE_A, "suya")).toBe(false);
    expect(llamadas[0]).toBe("rpc perfiles_de_mi_equipo");
  });

  it("con la función ausente usa la lectura de antes y la misma regla de tienda", async () => {
    const { cliente } = clienteFalso({ tablas: { profiles: gente as unknown as Record<string, unknown>[] } });
    expect(await canManageEmployee(cliente, GERENTE_A, "mia")).toBe(true);
    expect(await canManageEmployee(cliente, GERENTE_A, "suya")).toBe(false);
    expect(await canManageEmployee(cliente, GERENTE_A, "ajena")).toBe(false);
  });
});
