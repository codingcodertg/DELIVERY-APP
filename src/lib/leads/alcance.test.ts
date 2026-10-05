import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import type { SupabaseClient } from "@supabase/supabase-js";
import { MODULE_ACCESS } from "@/lib/constants";
import {
  ALCANCE_SIN_REGLA, alcanceDe, alcanceDeLaBase, alcanzaElLead, eligeTienda, esDeSuBanco, leadsDelBanco, PERMISO_OTRAS_TIENDAS,
  seOfreceOtrasTiendas, veOtrasTiendas, type Alcance,
} from "./alcance";
import { almacenDeLaBase, faltaElAlcance } from "./almacen";
import { alcanceDemo, almacenDemo, PERSONAS_DEMO } from "./demo";
import { negativaDeCodigo, negativaTexto, poolsDe, type Lead, type Persona } from "./reglas";

/**
 * «Leads» por tienda (migración 163): quién ve y quién toma los leads de qué tienda. El dueño: «solo el manager puede
 * ver leads de otras tiendas configurable en user permisions, pero sales solo puede ver su tienda».
 * Lo que la 163 HACE se midió con el ensayo (`scripts/leads/ensayo-163.mjs`, con ROLLBACK); aquí se fija la regla
 * escrita en el código, que el demo y la pantalla la usan, y el texto de la migración. Todos los datos son inventados.
 */
const leer = (r: string) => readFileSync(r, "utf8").split("\r\n").join("\n");
const TIENDA_A = "Tienda A";
const TIENDA_B = "Tienda B";
const SOLO_A: Alcance = { todas: false, tienda: TIENDA_A };
const TODAS: Alcance = { todas: true, tienda: TIENDA_A };
const NINGUNA: Alcance = { todas: false, tienda: null };
const l = (pool: string, holder: string | null = null) => ({ pool, holder });

describe("1 · quién ve las otras tiendas", () => {
  it("el admin, siempre: con permiso, sin permiso y sin lista", () => {
    expect(veOtrasTiendas({ role: "admin" })).toBe(true);
    expect(veOtrasTiendas({ role: "admin", permissions: null })).toBe(true);
    expect(veOtrasTiendas({ role: "admin", permissions: [] })).toBe(true);
  });
  it("el manager, solo con el permiso: sin él, o con otros permisos, no", () => {
    expect(veOtrasTiendas({ role: "manager", permissions: [PERMISO_OTRAS_TIENDAS] })).toBe(true);
    expect(veOtrasTiendas({ role: "manager", permissions: ["create", PERMISO_OTRAS_TIENDAS] })).toBe(true);
    expect(veOtrasTiendas({ role: "manager", permissions: [] })).toBe(false);
    expect(veOtrasTiendas({ role: "manager", permissions: null })).toBe(false);
    expect(veOtrasTiendas({ role: "manager" })).toBe(false);
    expect(veOtrasTiendas({ role: "manager", permissions: ["create", "approve"] })).toBe(false);
  });
  it("ventas, oficina y logística NUNCA, ni con la palabra escrita en su lista", () => {
    for (const role of ["sales", "accounting", "logistics", "warehouse", "driver", null, undefined, ""]) {
      expect(veOtrasTiendas({ role, permissions: [PERMISO_OTRAS_TIENDAS] }), String(role)).toBe(false);
      expect(veOtrasTiendas({ role, permissions: [] }), String(role)).toBe(false);
    }
  });
  it("el interruptor se ofrece solo al manager", () => {
    expect(seOfreceOtrasTiendas("manager")).toBe(true);
    for (const role of ["admin", "sales", "accounting", "logistics", "warehouse", "driver", null, undefined]) {
      expect(seOfreceOtrasTiendas(role), String(role)).toBe(false);
    }
  });
  it("el alcance de una persona: si ve todas, y su tienda limpia (en blanco no es una tienda)", () => {
    expect(alcanceDe({ role: "sales", store: TIENDA_A })).toEqual({ todas: false, tienda: TIENDA_A });
    expect(alcanceDe({ role: "manager", permissions: [PERMISO_OTRAS_TIENDAS], store: TIENDA_B })).toEqual({ todas: true, tienda: TIENDA_B });
    expect(alcanceDe({ role: "admin", store: null })).toEqual({ todas: true, tienda: null });
    expect(alcanceDe({ role: "sales", store: "   " })).toEqual({ todas: false, tienda: null });
    expect(alcanceDe({ role: "sales", store: ` ${TIENDA_A} ` })).toEqual({ todas: false, tienda: TIENDA_A });
    expect(alcanceDe({ role: "sales" })).toEqual({ todas: false, tienda: null });
  });
});

describe("2 · qué lead alcanza cada alcance", () => {
  it("su banco: el de su tienda; el de otra, no; quien ve todas, cualquiera", () => {
    expect(esDeSuBanco(l(TIENDA_A), SOLO_A)).toBe(true);
    expect(esDeSuBanco(l(TIENDA_B), SOLO_A)).toBe(false);
    expect(esDeSuBanco(l(TIENDA_B), TODAS)).toBe(true);
    expect(esDeSuBanco(l("No store"), TODAS)).toBe(true);
  });
  it("sin tienda y sin permiso no hay banco: ni el de «sin tienda»", () => {
    expect(esDeSuBanco(l(TIENDA_A), NINGUNA)).toBe(false);
    expect(esDeSuBanco(l("No store"), NINGUNA)).toBe(false);
    expect(esDeSuBanco(l(""), NINGUNA)).toBe(false);
  });
  it("leer: lo de su banco, y lo que tiene a su nombre aunque sea de otra tienda; lo de otro en otra tienda, no", () => {
    expect(alcanzaElLead(l(TIENDA_A), SOLO_A, "yo")).toBe(true);
    expect(alcanzaElLead(l(TIENDA_A, "otro"), SOLO_A, "yo")).toBe(true);
    expect(alcanzaElLead(l(TIENDA_B, "yo"), SOLO_A, "yo")).toBe(true);
    expect(alcanzaElLead(l(TIENDA_B), SOLO_A, "yo")).toBe(false);
    expect(alcanzaElLead(l(TIENDA_B, "otro"), SOLO_A, "yo")).toBe(false);
    expect(alcanzaElLead(l(TIENDA_B, "yo"), NINGUNA, "yo")).toBe(true);
    expect(alcanzaElLead(l(TIENDA_B), NINGUNA, "yo")).toBe(false);
    expect(alcanzaElLead(l(TIENDA_B, "otro"), TODAS, "yo")).toBe(true);
  });
  it("el banco de la pantalla: su tienda sola; un lead suyo de otra tienda NO trae el banco de esa tienda ni su contador", () => {
    const leads = [
      { ...l(TIENDA_A), status: "free" as const }, { ...l(TIENDA_A, "otro"), status: "taken" as const },
      { ...l(TIENDA_B, "yo"), status: "taken" as const },
    ];
    expect(leadsDelBanco(leads, SOLO_A)).toHaveLength(2);
    expect(poolsDe(leadsDelBanco(leads, SOLO_A) as unknown as Lead[]).map((p) => p.pool)).toEqual([TIENDA_A]);
    expect(leadsDelBanco(leads, TODAS)).toHaveLength(3);
    expect(leadsDelBanco(leads, NINGUNA)).toEqual([]);
  });
  it("el selector de tienda se enseña solo a quien alcanza más de una", () => {
    expect(eligeTienda(TODAS)).toBe(true);
    expect(eligeTienda(SOLO_A)).toBe(false);
    expect(eligeTienda(NINGUNA)).toBe(false);
  });
});

describe("3 · lo que dice la base", () => {
  it("leads_my_scope() se lee tal cual; una respuesta rara es lo más estrecho, nunca «todas»", () => {
    expect(alcanceDeLaBase({ all: true, store: null })).toEqual({ todas: true, tienda: null });
    expect(alcanceDeLaBase({ all: false, store: TIENDA_A })).toEqual({ todas: false, tienda: TIENDA_A });
    expect(alcanceDeLaBase({ all: "true", store: 7 })).toEqual({ todas: false, tienda: null });
    expect(alcanceDeLaBase({ all: 1, store: "  " })).toEqual({ todas: false, tienda: null });
    expect(alcanceDeLaBase(null)).toEqual({ todas: false, tienda: null });
    expect(alcanceDeLaBase("all")).toEqual({ todas: false, tienda: null });
    expect(alcanceDeLaBase({})).toEqual({ todas: false, tienda: null });
  });
  it("«falta la 163» es solo que la función no exista; un permiso negado no lo es", () => {
    expect(faltaElAlcance({ code: "PGRST202" })).toBe(true);
    expect(faltaElAlcance({ code: "42883" })).toBe(true);
    for (const code of ["42501", "PGRST205", "42P01", "57014", "", null]) expect(faltaElAlcance({ code }), String(code)).toBe(false);
    expect(faltaElAlcance(null)).toBe(false);
  });
  it("LD005 se traduce a «es de otra tienda», en los dos idiomas", () => {
    expect(negativaDeCodigo("LD005")).toBe("otra_tienda");
    expect(negativaTexto("otra_tienda", "es")).toMatch(/otra tienda/);
    expect(negativaTexto("otra_tienda", "en")).toMatch(/another store/);
  });

  /** Una base de mentira: lo justo de la forma de supabase-js que usa `leer()`. Anota cada llamada. */
  function baseFalsa(alcance: { data: unknown; error: { code: string; message: string } | null }) {
    const llamadas: string[] = [];
    const filas = [{ id: "1", tabs_project: "T1", pool: TIENDA_A, status: "free" }];
    const cliente = {
      rpc: async (fn: string) => { llamadas.push(`rpc:${fn}`); return alcance; },
      from: (tabla: string) => ({
        select: () => ({
          maybeSingle: async () => { llamadas.push(`ajustes:${tabla}`); return { data: { max_open: 7 }, error: null }; },
          order: () => ({ range: async () => { llamadas.push(`filas:${tabla}`); return { data: filas, error: null }; } }),
        }),
      }),
    };
    return { cliente: cliente as unknown as SupabaseClient, llamadas };
  }
  it("leer() le PREGUNTA el alcance a la base y lo devuelve con los leads", async () => {
    const b = baseFalsa({ data: { all: false, store: TIENDA_A }, error: null });
    const r = await almacenDeLaBase(b.cliente).leer();
    expect(b.llamadas).toContain("rpc:leads_my_scope");
    expect(r.ok && r.valor.alcance).toEqual({ todas: false, tienda: TIENDA_A });
    expect(r.ok && r.valor.leads).toHaveLength(1);
    expect(r.ok && r.valor.tope).toBe(7);
  });
  it("sin la 163 (la función no existe) NO se rompe: se comporta como antes, sin regla por tienda", async () => {
    const b = baseFalsa({ data: null, error: { code: "PGRST202", message: "Could not find the function public.leads_my_scope" } });
    const r = await almacenDeLaBase(b.cliente).leer();
    expect(r.ok && r.valor.alcance).toEqual(ALCANCE_SIN_REGLA);
    expect(ALCANCE_SIN_REGLA).toEqual({ todas: true, tienda: null });
    expect(r.ok && r.valor.leads).toHaveLength(1);
  });
  it("cualquier otro fallo del alcance se dice: ni se abre todo ni se pintan leads", async () => {
    const b = baseFalsa({ data: null, error: { code: "57014", message: "timeout" } });
    const r = await almacenDeLaBase(b.cliente).leer();
    expect(r).toMatchObject({ ok: false, sinTabla: false, error: "timeout" });
    expect(b.llamadas).not.toContain("filas:leads");
  });
});

describe("4 · el demo aplica la misma regla que la base", () => {
  const [ana, beto, admin, gema, hugo] = PERSONAS_DEMO;
  const leeComo = async (p: Persona) => {
    const r = await almacenDemo(() => p).leer();
    if (!r.ok) throw new Error("no lee");
    return r.valor;
  };
  it("el reparto: dos de ventas, un admin, una manager con el permiso y otro sin él", () => {
    expect([ana, beto, admin, gema, hugo].map((p) => p.role)).toEqual(["sales", "sales", "admin", "manager", "manager"]);
    expect(alcanceDemo(ana)).toEqual({ todas: false, tienda: "RDZ Brownsville" });
    expect(alcanceDemo(admin)).toEqual({ todas: true, tienda: null });
    expect(alcanceDemo(gema)).toEqual({ todas: true, tienda: "RDZ McAllen" });
    expect(alcanceDemo(hugo)).toEqual({ todas: false, tienda: "RDZ Weslaco" });
  });
  it("ventas: lee solo el banco de su tienda y lo que tiene a su nombre en otras", async () => {
    const v = await leeComo(ana);
    expect(v.alcance).toEqual({ todas: false, tienda: "RDZ Brownsville" });
    expect(v.leads.length).toBeGreaterThan(0);
    expect(v.leads.length).toBeLessThan(44);
    for (const x of v.leads) expect(x.pool === "RDZ Brownsville" || x.holder === ana.id, x.id).toBe(true);
    // Ana tiene leads de otras tiendas a su nombre: se leen, pero el banco de esas tiendas no aparece ni se cuenta.
    expect(v.leads.some((x) => x.pool !== "RDZ Brownsville" && x.holder === ana.id)).toBe(true);
    expect(poolsDe(leadsDelBanco(v.leads, v.alcance)).map((p) => p.pool)).toEqual(["RDZ Brownsville"]);
  });
  it("admin y manager con permiso: todo; manager sin permiso: solo su tienda", async () => {
    expect((await leeComo(admin)).leads).toHaveLength(44);
    expect((await leeComo(gema)).leads).toHaveLength(44);
    const v = await leeComo(hugo);
    expect(v.leads.length).toBeGreaterThan(0);
    for (const x of v.leads) expect(x.pool, x.id).toBe("RDZ Weslaco");
  });
  it("tomar un lead de otra tienda se rechaza con «otra_tienda»; el de la suya, no; quien ve todas, cualquiera", async () => {
    let yo = admin;
    const a = almacenDemo(() => yo);
    const todo = await a.leer();
    if (!todo.ok) throw new Error("no lee");
    const libreDe = (pool: string, salto = 0) => todo.valor.leads.filter((x) => x.pool === pool && x.status === "free")[salto];
    yo = beto;
    expect(await a.tomar(libreDe("RDZ Brownsville").id)).toMatchObject({ ok: false, motivo: "otra_tienda" });
    expect((await a.tomar(libreDe("RDZ Edinburg").id)).ok).toBe(true);
    yo = hugo;
    expect(await a.tomar(libreDe("RDZ McAllen").id)).toMatchObject({ ok: false, motivo: "otra_tienda" });
    yo = gema;
    expect((await a.tomar(libreDe("RDZ Weslaco").id)).ok).toBe(true);
    expect((await a.tomar(libreDe("RDZ Brownsville", 1).id)).ok).toBe(true);
  });
  it("el historial de un lead que no alcanza sale vacío; el de uno que sí, no", async () => {
    let yo = admin;
    const a = almacenDemo(() => yo);
    const todo = await a.leer();
    if (!todo.ok) throw new Error("no lee");
    const conHistoria = todo.valor.leads.find((x) => x.pool === "RDZ Brownsville" && x.last_outcome && x.status === "free")!;
    const propio = await a.historial(conHistoria.id);
    expect(propio.ok && propio.valor.length).toBeGreaterThan(0);
    yo = hugo;
    expect(await a.historial(conHistoria.id)).toEqual({ ok: true, valor: [] });
    yo = ana;
    const deAna = await a.historial(conHistoria.id);
    expect(deAna.ok && deAna.valor.length).toBeGreaterThan(0);
  });
});

describe("5 · la pantalla pinta lo que el alcance dice", () => {
  const p = leer("src/app/leads/Leads.tsx");
  it("guarda el alcance que devolvió el almacén, y de entrada no supone ninguna regla", () => {
    expect(p).toContain("useState<Alcance>(ALCANCE_SIN_REGLA)");
    expect(p).toContain("setAlcance(r.valor.alcance);");
  });
  it("el banco, sus contadores y sus filtros salen de leadsDelBanco, no de todos los leads leídos", () => {
    expect(p).toContain("const delBanco = useMemo(() => leadsDelBanco(leads, alcance), [leads, alcance]);");
    expect(p).toContain("const pools = useMemo(() => poolsDe(delBanco), [delBanco]);");
    expect(p).toContain("const delPool = useMemo(() => delBanco.filter((l) => l.pool === pool), [delBanco, pool]);");
    expect(p).toContain("ordenar(filtrar(delBanco, { pool, vista, categoria, tipo, ciudad, busca, situacion }), orden)");
  });
  it("el selector de tienda solo se dibuja si eligeTienda; si no, su tienda fija y sin los otros bancos", () => {
    expect(p).toContain("const elige = eligeTienda(alcance);");
    const desde = p.indexOf("{elige ? (");
    const medio = p.indexOf(") : (", desde);
    const fijo = p.indexOf("data-pool-fijo", desde);
    expect(desde).toBeGreaterThan(0);
    expect(p.slice(desde, medio)).toContain("<select data-pool ");
    expect(fijo).toBeGreaterThan(medio);
    expect(p.match(/<select data-pool /g)).toHaveLength(1);
    expect(p).toContain("{!elige && !alcance.tienda && (");
    expect(p).toContain("data-aviso-sin-tienda");
  });
  it("en el demo, cambiar de persona relee: cada una alcanza leads distintos", () => {
    expect(p).toContain("useEffect(() => { void cargar(); }, [cargar, idDemo]);");
  });
  it("el conjunto de leads libres de una tienda se llama «Pool General» / «General Pool»; «Mi pool» no cambia", () => {
    expect(p).toContain('{t("General Pool", "Pool General")}');
    expect(p).toContain('t("Release to General Pool", "Liberar al Pool General")');
    expect(p).toContain('{t("My pool", "Mi pool")}');
    const visibles = [...p.matchAll(/t\(\s*"([^"]*)",\s*"([^"]*)",?\s*\)/g)].map((m) => `${m[1]} | ${m[2]}`);
    expect(visibles.length).toBeGreaterThan(40);
    for (const texto of visibles) expect(texto).not.toMatch(/\bbanco\b|\bbank\b/i);
  });
});

describe("6 · el interruptor en Usuarios", () => {
  const leads = MODULE_ACCESS.find((m) => m.key === "leads")!;
  it("es UN permiso del módulo Leads, guardado en la lista de permisos por persona con la palabra de la base", () => {
    expect(leads.capabilities?.map((c) => c.key)).toEqual([PERMISO_OTRAS_TIENDAS]);
    expect(PERMISO_OTRAS_TIENDAS).toBe("leads_all_stores");
    expect(leads.capabilities?.[0].es).toBe("Ver leads de otras tiendas");
    expect(leads.capabilities?.[0].en).toBe("See leads of other stores");
    expect(leads.capabilitiesRole).toBe("role");
    expect(leads.roleColumn).toBeUndefined();
  });
  it("se ofrece al manager (apagable) y al admin (fijo, del rol); a ventas, oficina y logística no se les dibuja", () => {
    expect(leads.capabilityOffered?.(PERMISO_OTRAS_TIENDAS, "manager")).toBe(true);
    expect(leads.capabilitiesFromRole?.("manager")).toEqual([]);
    expect(leads.capabilityOffered?.(PERMISO_OTRAS_TIENDAS, "admin")).toBe(true);
    expect(leads.capabilitiesFromRole?.("admin")).toEqual([PERMISO_OTRAS_TIENDAS]);
    for (const role of ["sales", "accounting", "logistics", "warehouse", "driver"]) {
      expect(leads.capabilityOffered?.(PERMISO_OTRAS_TIENDAS, role), role).toBe(false);
      expect(leads.capabilitiesFromRole?.(role), role).toEqual([]);
    }
  });
  it("los otros módulos no cambian: Entregas sigue ofreciendo todos sus permisos y con su propio rol", () => {
    const entregas = MODULE_ACCESS.find((m) => m.key === "deliveries")!;
    expect(entregas.capabilityOffered).toBeUndefined();
    expect(entregas.capabilitiesRole).toBeUndefined();
  });
  it("el diálogo dibuja solo los permisos ofrecidos a ESE rol, y los escribe sin pisar los demás de la lista", () => {
    const d = leer("src/components/UserDialog.tsx");
    expect(d).toContain('const capRole = m.capabilitiesRole === "role" ? u.role : (currentRole ?? defaultRole);');
    expect(d).toContain("const caps = (m.capabilities ?? []).filter((c) => m.capabilityOffered?.(c.key, capRole) ?? true);");
    expect(d).toContain("{caps.length > 0 && (");
    expect(d).toContain("{caps.map((c) => {");
    expect(d).toContain("const fromRole = m.capabilitiesFromRole?.(capRole).includes(c.key) ?? false;");
    expect(d).not.toContain("m.capabilities.map(");
    expect(d).toContain("const cur = (u.permissions ?? []).filter((p) => p !== c.key);");
    expect(d).toContain("updateUserPermissions(u.id, e.target.checked ? [...cur, c.key] : cur);");
  });
});

describe("7 · la 163", () => {
  const sql = leer("supabase/migrations/163_leads_por_tienda.sql");
  const [cuerpo] = sql.split("-- @ledger-below");
  const sinComentarios = cuerpo.split("\n").filter((x) => !x.trim().startsWith("--")).join("\n");
  const fn = (nombre: string) => new RegExp(`create or replace function public\\.${nombre}\\([\\s\\S]*?\\n(end \\$\\$|\\$\\$);`).exec(sinComentarios)![0];

  it("ve todas: admin, o manager CON la palabra; ningún otro rol aparece", () => {
    const f = fn("leads_scope_all");
    expect(f).toContain("select role = 'admin'");
    expect(f).toContain(`or (role = 'manager' and '${PERMISO_OTRAS_TIENDAS}' = any(coalesce(permissions, '{}')))`);
    expect(f).toContain("from public.profiles where id = auth.uid()");
    expect(f).toContain("), false);");
    expect(f).not.toMatch(/'(sales|accounting|logistics)'/);
  });
  it("la política de leads: el módulo Y (todas, o suyo, o de su tienda)", () => {
    expect(sinComentarios).toContain(`create policy "leads select" on public.leads for select to authenticated
  using (
    (select public.has_leads_access())
    and (
      (select public.leads_scope_all())
      or holder = (select auth.uid())
      or pool = (select public.leads_my_store())
    )
  );`);
  });
  it("la del historial: el módulo Y (todas, o el lead es suyo o de su tienda)", () => {
    expect(sinComentarios).toContain(`create policy "lead_events select" on public.lead_events for select to authenticated
  using (
    (select public.has_leads_access())
    and (
      (select public.leads_scope_all())
      or exists (
        select 1 from public.leads l
         where l.id = lead_events.lead_id
           and (l.holder = (select auth.uid()) or l.pool = (select public.leads_my_store()))
      )
    )
  );`);
  });
  it("sigue habiendo una política por tabla, solo de SELECT, y la del tope no se toca", () => {
    expect([...sinComentarios.matchAll(/create policy /g)]).toHaveLength(2);
    expect(sinComentarios).not.toMatch(/lead_settings select/);
    expect(sinComentarios).not.toMatch(/for (insert|update|delete|all) /i);
    expect(sinComentarios).not.toMatch(/grant [^;]* on (table )?public\.lead/i);
    expect(sinComentarios).not.toMatch(/to anon/i);
  });
  it("lead_take comprueba la tienda después del módulo y ANTES de tocar nada, con LD005", () => {
    const f = fn("lead_take");
    const modulo = f.indexOf("if v_uid is null or not public.has_leads_access() then");
    const tienda = f.indexOf("if not public.leads_scope_all() and v_pool is distinct from public.leads_my_store() then");
    const rechaza = f.indexOf("raise exception 'leads: this lead belongs to another store' using errcode = 'LD005';");
    const candado = f.indexOf("perform pg_advisory_xact_lock(");
    const toma = f.indexOf("update public.leads");
    for (const i of [modulo, tienda, rechaza, candado, toma]) expect(i).toBeGreaterThan(0);
    expect(modulo).toBeLessThan(tienda);
    expect(rechaza).toBe(tienda + "if not public.leads_scope_all() and v_pool is distinct from public.leads_my_store() then\n    ".length);
    expect(rechaza).toBeLessThan(candado);
    expect(candado).toBeLessThan(toma);
    expect(f).toContain("select pool into v_pool from public.leads where id = p_lead;");
    // Lo de la 162 sigue dentro: el tope, solo lo libre, y el evento.
    expect(f).toContain("using errcode = 'LD001';");
    expect(f).toContain("where id = p_lead and status = 'free'");
    expect(f).toContain("values (p_lead, 'taken', v_uid, v_name, v_uid, v_name);");
    expect(f).toContain("security definer set search_path = public, pg_temp");
  });
  it("lo que la pantalla pregunta: sin módulo, nada; con él, lo mismo que usa la política", () => {
    const f = fn("leads_my_scope");
    expect(f).toContain("select case when public.has_leads_access()");
    expect(f).toContain("then jsonb_build_object('all', public.leads_scope_all(), 'store', public.leads_my_store())");
    expect(f).toContain("else jsonb_build_object('all', false, 'store', null)");
  });
  it("el interruptor nace encendido SOLO para los managers, y sin duplicar la palabra", () => {
    const cambios = [...sinComentarios.matchAll(/update public\.profiles[\s\S]*?;/g)].map((m) => m[0]);
    expect(cambios).toHaveLength(1);
    expect(cambios[0]).toContain(`set permissions = array_append(coalesce(permissions, '{}'), '${PERMISO_OTRAS_TIENDAS}')`);
    expect(cambios[0]).toContain("where role = 'manager'");
    expect(cambios[0]).toContain(`and not ('${PERMISO_OTRAS_TIENDAS}' = any(coalesce(permissions, '{}')));`);
  });
  it("anon no ejecuta nada nuevo; sin begin/commit propios y sin D-NNN dentro", () => {
    for (const f of ["leads_scope_all()", "leads_my_store()", "leads_my_scope()", "lead_take(uuid)"]) {
      expect(sinComentarios).toMatch(new RegExp(`revoke execute on function public\\.${f.replace(/[()]/g, "\\$&")}\\s+from public, anon;`));
      expect(sinComentarios).toMatch(new RegExp(`grant execute on function public\\.${f.replace(/[()]/g, "\\$&")}\\s+to authenticated;`));
    }
    expect(sinComentarios).not.toMatch(/^\s*(begin|commit)\s*;/im);
    expect(sql).not.toMatch(/D-\d{3}/);
  });
  it("trae su reversión, que deja las políticas como la 162", () => {
    expect(cuerpo).toContain("--     using ((select public.has_leads_access()));");
    expect(cuerpo).toContain("--   drop function if exists public.leads_my_scope();");
    expect(cuerpo).toContain("--   delete from public.schema_migrations where name = '163_leads_por_tienda.sql';");
  });
  it("el checksum del registro es el del cuerpo", () => {
    const sha = createHash("sha256").update(cuerpo).digest("hex");
    expect(sql).toContain(`values ('163_leads_por_tienda.sql', '${sha}')`);
  });
  it("el ensayo siempre termina en ROLLBACK y nunca hace commit", () => {
    const g = leer("scripts/leads/ensayo-163.mjs");
    expect(g).toContain('finally {\n  try { await c.query("rollback");');
    expect(g).not.toMatch(/query\(\s*["'`]commit/i);
  });
});
