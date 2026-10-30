import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ordenDeCercanas, PERMISO_POOL_PRIVADO, poolsPrivadosVisibles, privadosVisibles, veElPoolPrivado } from "./alcance";
import { almacenDemo, PERSONAS_DEMO } from "./demo";
import type { EstadoLead } from "./reglas";

/** El STXP Pool (D-770, migración 220): por permiso, por tienda, y la más cercana cuando la propia se agota. */

const leer = (r: string) => readFileSync(join(process.cwd(), r), "utf8").split("\r\n").join("\n");
const sinComentarios = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const priv = (id: string, pool: string, status: EstadoLead = "free", holder: string | null = null) => ({ id, pool, status, holder, source: "privado" as const });
const gov = (id: string, pool: string) => ({ id, pool, status: "free" as EstadoLead, holder: null, source: "tdlr" as const });

describe("el permiso", () => {
  it("lo ve el admin siempre; los demás, con la casilla «leads_private_pool»", () => {
    expect(PERMISO_POOL_PRIVADO).toBe("leads_private_pool");
    expect(veElPoolPrivado({ admin: true })).toBe(true);
    expect(veElPoolPrivado({ role: "admin" })).toBe(true);
    expect(veElPoolPrivado({ role: "sales", permissions: ["leads_private_pool"] })).toBe(true);
    expect(veElPoolPrivado({ role: "manager", permissions: ["leads_all_stores"] })).toBe(false);
    expect(veElPoolPrivado({ role: "sales" })).toBe(false);
  });
  it("la casilla se ofrece a cualquier rol en Usuarios › Leads, y el admin la tiene del rol", () => {
    const c = sinComentarios(leer("src/lib/constants.ts"));
    expect(c).toContain('en: "See the STXP Pool", es: "Ver el STXP Pool",');
    expect(c).toContain("capabilitiesFromRole: (key) => (key === \"admin\" ? [PERMISO_OTRAS_TIENDAS, PERMISO_POOL_PRIVADO] : []),");
    expect(c).toContain("capabilityOffered: (cap, key) => key === \"admin\" || cap === PERMISO_POOL_PRIVADO || seOfreceOtrasTiendas(key),");
  });
});

describe("las tiendas cercanas", () => {
  it("cada tienda va primero y después las demás, de la más cercana a la más lejana; las seis en cada lista", () => {
    expect(ordenDeCercanas("RDZ McAllen")).toEqual(["RDZ McAllen", "RDZ Pharr", "RDZ Mission", "RDZ Edinburg", "RDZ Weslaco", "RDZ Brownsville"]);
    expect(ordenDeCercanas("RDZ Brownsville")[1]).toBe("RDZ Weslaco");
    for (const t of ["RDZ Mission", "RDZ McAllen", "RDZ Pharr", "RDZ Edinburg", "RDZ Weslaco", "RDZ Brownsville"]) {
      expect(ordenDeCercanas(t)[0], t).toBe(t);
      expect([...ordenDeCercanas(t)].sort(), t).toEqual(["RDZ Brownsville", "RDZ Edinburg", "RDZ McAllen", "RDZ Mission", "RDZ Pharr", "RDZ Weslaco"]);
    }
    expect(ordenDeCercanas("Otra")).toEqual(["Otra"]);
    expect(ordenDeCercanas(null)).toEqual([]);
  });
  it("la lista de la 220 es la misma, tienda por tienda", () => {
    const sql = leer("supabase/migrations/220_leads_stxp_pool.sql");
    for (const t of Object.keys({ "RDZ Mission": 1, "RDZ McAllen": 1, "RDZ Pharr": 1, "RDZ Edinburg": 1, "RDZ Weslaco": 1, "RDZ Brownsville": 1 })) {
      const esperado = "array[" + ordenDeCercanas(t).map((x) => `'${x}'`).join(", ") + "]";
      expect(sql, t).toContain(`when '${t}'`);
      expect(sql.split(`when '${t}'`)[1].split("\n")[0], t).toContain(esperado);
    }
  });
});

describe("qué pools se ven", () => {
  it("con libres en la propia, solo la propia; agotada, la propia y la más cercana; y así hasta la primera con libres", () => {
    const conLibres = [priv("a", "RDZ Brownsville"), priv("b", "RDZ Weslaco")];
    expect(poolsPrivadosVisibles(conLibres, "RDZ Brownsville")).toEqual(["RDZ Brownsville"]);
    const agotada = [priv("a", "RDZ Brownsville", "taken", "x"), priv("b", "RDZ Weslaco")];
    expect(poolsPrivadosVisibles(agotada, "RDZ Brownsville")).toEqual(["RDZ Brownsville", "RDZ Weslaco"]);
    const dosAgotadas = [priv("a", "RDZ Brownsville", "taken", "x"), priv("b", "RDZ Weslaco", "won", "y"), priv("c", "RDZ Pharr")];
    expect(poolsPrivadosVisibles(dosAgotadas, "RDZ Brownsville")).toEqual(["RDZ Brownsville", "RDZ Weslaco", "RDZ Pharr"]);
    expect(poolsPrivadosVisibles([], "RDZ Brownsville")).toHaveLength(6);
    expect(poolsPrivadosVisibles(conLibres, null)).toEqual([]);
  });
  it("privadosVisibles: sin casilla nada; el admin todo; con casilla sus pools y lo suyo de otra tienda; lo del estado nunca", () => {
    const leads = [priv("a", "RDZ Brownsville"), priv("b", "RDZ Weslaco"), priv("m", "RDZ McAllen", "taken", "ana"), gov("g", "RDZ Brownsville")];
    const ana = { id: "ana", role: "sales", permissions: ["leads_private_pool"], store: "RDZ Brownsville" };
    expect(privadosVisibles(leads, { ...ana, permissions: [] })).toEqual([]);
    expect(privadosVisibles(leads, { id: "adm", admin: true }).map((l) => l.id)).toEqual(["a", "b", "m"]);
    expect(privadosVisibles(leads, ana).map((l) => l.id)).toEqual(["a", "m"]);
  });
});

describe("el demo hace lo mismo que la base", () => {
  const hugo = PERSONAS_DEMO.find((p) => p.id === "demo-hugo")!;
  const beto = PERSONAS_DEMO.find((p) => p.id === "demo-beto")!;
  it("Hugo (con casilla) ve los privados de Weslaco; al tomar los tres, le aparece Pharr; Beto (sin casilla) no ve ninguno ni puede tomar", async () => {
    let yo = hugo;
    const a = almacenDemo(() => yo);
    const privados = async () => { const r = await a.leer(); return r.ok ? r.valor.leads.filter((l) => l.source === "privado") : []; };
    const antes = await privados();
    expect(antes).toHaveLength(3);
    expect(new Set(antes.map((l) => l.pool))).toEqual(new Set(["RDZ Weslaco"]));
    for (const l of antes) expect((await a.tomar(l.id)).ok, l.id).toBe(true);
    const despues = await privados();
    expect(new Set(despues.map((l) => l.pool))).toEqual(new Set(["RDZ Weslaco", "RDZ Pharr"]));
    const pharr = despues.filter((l) => l.pool === "RDZ Pharr" && l.status === "free");
    expect(pharr).toHaveLength(2);
    expect((await a.tomar(pharr[0].id)).ok).toBe(true);
    yo = beto;
    expect(await privados()).toEqual([]);
    expect((await a.tomar(pharr[1].id)).ok).toBe(false);
  });
});

describe("la pantalla y la base", () => {
  it("la pestaña y sus filtros los ve quien tiene la casilla; en el STXP Pool de quien no elige tienda, el pool no filtra", () => {
    const p = sinComentarios(leer("src/app/leads/Leads.tsx"));
    expect(p).toContain("const veStxp = !!yo && veElPoolPrivado(yo);");
    expect(p).toContain("const privados = useMemo(() => (yo ? privadosVisibles(leads, yo) : []), [leads, yo]);");
    expect(p).toContain('const poolFiltro = pestana === "privado" && !elige ? null : filtroDePool(pool);');
    expect(p).toContain('data-pool-stxp');
    expect(p).toContain('t("STXP Pool", "STXP Pool")');
    expect(p).not.toContain("Pool General");
    expect(p).not.toContain("General Pool");
    expect(p).not.toContain("Pool privado");
  });
  it("la página manda rol y permisos, y en modo enseñanza abre el demo", () => {
    const p = sinComentarios(leer("src/app/leads/page.tsx"));
    expect(p).toContain('select("full_name, store, role, module_access, permissions")');
    expect(p).toContain("permissions: (data?.permissions as string[] | null) ?? []");
    expect(p).toContain("if (valorDeEnsenanza((await cookies()).get(COOKIE_ENSENANZA)?.value)) return <Leads demo yo={null} cotiza />;");
  });
  it("la 220: el permiso, el orden, los pools, las dos políticas y lead_take; sin transacción propia; registro con su checksum", () => {
    const sql = leer("supabase/migrations/220_leads_stxp_pool.sql");
    expect(sql).toContain("select role = 'admin' or 'leads_private_pool' = any(coalesce(permissions, '{}'))");
    expect(sql).toContain("create or replace function public.leads_private_pools()");
    expect(sql).toContain("if exists (select 1 from public.leads where source = 'privado' and pool = p and status = 'free') then");
    expect(sql).toContain("or pool = any(coalesce((select public.leads_private_pools()), array[]::text[]))");
    expect(sql).toContain("or l.pool = any(coalesce((select public.leads_private_pools()), array[]::text[]))");
    expect(sql).toContain("if not public.is_admin() and not (v_pool = any(coalesce(public.leads_private_pools(), array[]::text[]))) then");
    expect(sql).not.toMatch(/^\s*(begin|commit);/m);
    expect(sql).not.toContain("'PENDIENTE'");
    expect(sql).toMatch(/values \('220_leads_stxp_pool.sql', '[0-9a-f]{64}'\)/);
  });
});
