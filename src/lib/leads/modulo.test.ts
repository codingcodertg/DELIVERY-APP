import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { accessibleModules, knownModules, landingRoute, MODULES, MODULE_ACCESS } from "@/lib/constants";
import { appForPath } from "@/lib/app-for-path";
import { APP_VERSIONS } from "@/lib/app-versions";
import { securityLabel } from "@/lib/security-log";
import { COLUMNAS } from "./almacen";
import { RESULTADOS } from "./reglas";

/**
 * «Leads» existe como módulo igual que Encuestas (migración 162): tarjeta, casilla, puerta, versión propia, la palabra
 * de la base igual que la del código; y la 162 dice lo que promete sobre el tope, tomar, cerrar y quién lee.
 * Lo que la 162 HACE se midió con el ensayo del plan (docs/PLAN-162-leads.md, sección 6); aquí se fija su texto.
 */
const leer = (r: string) => readFileSync(r, "utf8").split("\r\n").join("\n");
const enModulos = MODULES.find((m) => m.key === "leads");
const enAcceso = MODULE_ACCESS.find((m) => m.key === "leads");
const SQL = "supabase/migrations/162_leads.sql";

describe("la tarjeta y la casilla", () => {
  it("es una tarjeta del hub hacia /leads", () => {
    expect(enModulos?.href).toBe("/leads");
    expect(accessibleModules(["leads"]).map((m) => m.key)).toEqual(["leads"]);
    expect(accessibleModules(["surveys"]).map((m) => m.key)).not.toContain("leads");
  });
  it("una casilla en module_access, sin escalafón, y la nota avisa de que se ven nombre y teléfono de todas las tiendas", () => {
    expect(enAcceso?.accessColumn).toBe("module_access");
    expect(enAcceso?.roleColumn).toBeUndefined();
    expect(enAcceso?.roleKeys).toEqual([]);
    expect(enAcceso?.alwaysOn).toBe(false);
    expect(enAcceso?.roleNote?.es).toMatch(/todas las tiendas, con nombre y teléfono/);
  });
  it("knownModules no la tira al escribir (D-217)", () => {
    expect(knownModules(["clockin", "leads"])).toEqual(["leads"]);
  });
  it("con solo Leads se entra directo; con dos, al hub", () => {
    expect(landingRoute({ role: "sales", module_access: ["leads"] })).toBe("/leads");
    expect(landingRoute({ role: "sales", module_access: ["deliveries", "leads"] })).toBe("/home");
  });
  it("el diálogo de Usuarios escribe por su propia función y no reclama rol", () => {
    const dialogo = leer("src/components/UserDialog.tsx");
    expect(dialogo).toContain("updateUserLeadsAccess(u.id, { granted });");
    expect(dialogo.match(/case "leads":/g) ?? []).toHaveLength(2);
    const prov = leer("src/lib/data-provider.tsx");
    expect(prov).toContain('void logSecurityClient(userId, "leads_access_changed"');
    expect(prov).toContain('? Array.from(new Set([...actuales, "leads"]))');
    expect(prov).toContain(': actuales.filter((m) => m !== "leads");');
    expect(securityLabel("leads_access_changed", "es")).toBe("Acceso a Leads cambiado");
    expect(securityLabel("leads_access_changed", "en")).toBe("Leads access changed");
  });
});

describe("la versión y la ruta", () => {
  it("versión propia, y /leads no cae en deliveries", () => {
    expect(APP_VERSIONS.leads).toMatch(/^\d+\.\d+\.\d+$/);
    expect(appForPath("/leads")).toBe("leads");
    expect(appForPath("/leadsx")).toBe("deliveries");
  });
});

describe("la puerta", () => {
  const layout = leer("src/app/leads/layout.tsx");
  it("comprueba el acceso en el servidor; el admin siempre entra", () => {
    expect(layout).toContain('const tieneLeads = role === "admin" || !!profile?.module_access?.includes("leads");');
    expect(layout).toContain("if (!tieneLeads) {");
    expect(layout).toContain('redirect("/login?next=/leads")');
  });
  it("un fallo de lectura del perfil no redirige (D-234)", () => {
    const desde = layout.indexOf('=== "fallo"');
    const hasta = layout.indexOf("const role =");
    expect(desde).toBeGreaterThan(0);
    expect(hasta).toBeGreaterThan(desde);
    expect(layout.slice(desde, hasta)).not.toContain("redirect(");
  });
  it("la página dice quién mira con su tienda y si es admin, y no lee los leads en el servidor", () => {
    const page = leer("src/app/leads/page.tsx");
    expect(page).toContain('.select("full_name, store, role")');
    expect(page).toContain('admin: data?.role === "admin"');
    expect(page).toContain("store: data?.store ?? null");
    expect(page).not.toContain('.from("leads")');
  });
});

describe("la 162", () => {
  const sql = leer(SQL);
  const [cuerpo] = sql.split("-- @ledger-below");
  const sinComentarios = cuerpo.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
  const fn = (nombre: string) => new RegExp(`create or replace function public\\.${nombre}\\([\\s\\S]*?\\nend \\$\\$;`).exec(cuerpo)![0];

  it("es la ÚLTIMA migración que define profiles_module_access_known, y su lista es MODULE_ACCESS entero", () => {
    const definen = readdirSync("supabase/migrations")
      .filter((f) => f.endsWith(".sql"))
      .sort()
      .filter((f) => leer(`supabase/migrations/${f}`).includes("add constraint profiles_module_access_known"));
    expect(definen[definen.length - 1]).toBe("162_leads.sql");
    const lista = /module_access <@ array\[([^\]]+)\]\)\n  not valid;/.exec(cuerpo)![1];
    expect(lista).not.toContain("clockin");
    expect(lista.split(",").sort()).toEqual(MODULE_ACCESS.map((m) => `'${m.key}'`).sort());
  });

  it("el tope vive en la base y vale 10 de partida, entre 1 y 100", () => {
    expect(cuerpo).toContain("max_open    integer not null default 10,");
    expect(cuerpo).toContain("constraint lead_settings_tope check (max_open between 1 and 100)");
  });

  it("tomar: mira el módulo, pone en fila a la persona, cuenta SUS abiertos contra el tope y solo entonces toma lo libre", () => {
    const f = fn("lead_take");
    expect(f).toContain("language plpgsql volatile security definer set search_path = public, pg_temp");
    const modulo = f.indexOf("if v_uid is null or not public.has_leads_access() then");
    const candado = f.indexOf("perform pg_advisory_xact_lock(hashtextextended('leads:take:' || v_uid::text, 0));");
    const cuenta = f.indexOf("select count(*) into v_open from public.leads where holder = v_uid and status = 'taken';");
    const rechazo = f.indexOf("if v_open >= v_cap then");
    const toma = f.indexOf("where id = p_lead and status = 'free'");
    for (const i of [modulo, candado, cuenta, rechazo, toma]) expect(i).toBeGreaterThan(0);
    expect(modulo).toBeLessThan(candado);
    expect(candado).toBeLessThan(cuenta);
    expect(cuenta).toBeLessThan(rechazo);
    expect(rechazo).toBeLessThan(toma);
    expect(f).toContain("using errcode = 'LD001';");
    expect(f).toContain("using errcode = 'LD002';");
    expect(f).toContain("values (p_lead, 'taken', v_uid, v_name, v_uid, v_name);");
  });

  it("cerrar: nota obligatoria, solo lo tuyo y abierto, y cada resultado va a su sitio", () => {
    const f = fn("lead_close");
    expect(f).toContain(`if p_outcome is null or p_outcome not in (${RESULTADOS.map((r) => `'${r}'`).join(", ")}) then`);
    expect(f).toContain("v_note := public.lead_clean_note(p_note, true);");
    expect(f).toContain("set status = case p_outcome when 'sale' then 'won' when 'review' then 'review' else 'free' end,");
    expect(f).toContain("holder = case when p_outcome = 'sale' then holder else null end,");
    expect(f).toContain("where id = p_lead and status = 'taken' and holder = v_uid");
    expect(f).toContain("last_outcome = p_outcome, last_note = v_note, last_by = v_uid, last_by_name = v_name, last_at = now(),");
    expect(f).toContain("using errcode = 'LD004';");
    expect(f).toContain("values (p_lead, 'closed', p_outcome, v_note, v_uid, v_name, v_uid, v_name);");
  });

  it("la nota de avance no cambia el estado ni el dueño: no libera puesto", () => {
    const f = fn("lead_note");
    expect(f).toContain("v_note := public.lead_clean_note(p_note, true);");
    expect(f).toContain("set follow_up_note = v_note, follow_up_at = now(), touched_at = now(), updated_at = now()");
    expect(f).toContain("where id = p_lead and status = 'taken' and holder = v_uid");
    const pone = f.slice(f.indexOf("update public.leads"), f.indexOf("where id = p_lead"));
    expect(pone).not.toMatch(/\b(status|holder|holder_name|taken_at)\b/);
  });

  it("sin nota: LD003, y la limpia recorta", () => {
    const f = fn("lead_clean_note");
    expect(f).toContain("v text := nullif(btrim(coalesce(p_note, '')), '');");
    expect(f).toContain("if v is null and p_required then");
    expect(f).toContain("using errcode = 'LD003';");
  });

  it("lo del admin comprueba is_admin() antes de tocar nada", () => {
    for (const nombre of ["lead_admin_release", "lead_admin_assign", "lead_admin_archive", "leads_set_cap", "leads_import"]) {
      const f = fn(nombre);
      const guarda = f.indexOf("not public.is_admin() then");
      expect(guarda, nombre).toBeGreaterThan(0);
      // Y la guarda RECHAZA: lo siguiente es un raise con 42501, no un comentario ni un aviso.
      expect(f, nombre).toMatch(/not public\.is_admin\(\) then\n\s+raise exception 'leads: only an admin [^']+' using errcode = '42501';/);
      for (const escritura of ["update public.", "insert into public.", "public.leads_import_rows("]) {
        const i = f.indexOf(escritura);
        if (i >= 0) expect(guarda, `${nombre}: ${escritura}`).toBeLessThan(i);
      }
    }
  });

  it("las tres tablas: una política cada una, de SELECT y mirando el módulo; authenticated solo lee; anon nada", () => {
    const politicas = [...cuerpo.matchAll(/create policy "([^"]+)" on public\.(\w+) for (\w+) to authenticated\n  using \(\(select public\.has_leads_access\(\)\)\);/g)];
    expect(politicas.map((m) => `${m[2]}:${m[3]}`)).toEqual(["leads:select", "lead_events:select", "lead_settings:select"]);
    expect([...cuerpo.matchAll(/create policy /g)]).toHaveLength(3);
    for (const tabla of ["leads", "lead_events", "lead_settings"]) {
      expect(cuerpo).toMatch(new RegExp(`revoke all on public\\.${tabla}\\s+from public, anon, authenticated;`));
      expect(cuerpo).toMatch(new RegExp(`grant select on public\\.${tabla}\\s+to authenticated;`));
      expect(cuerpo).toMatch(new RegExp(`alter table public\\.${tabla}\\s+enable row level security;`));
    }
    expect(sinComentarios).not.toMatch(/grant [^;]*(insert|update|delete|all)[^;]* on public\.lead/i);
    expect(sinComentarios).not.toMatch(/to anon/i);
  });

  it("el historial solo se añade, y la carga interna no la ejecuta nadie con sesión", () => {
    expect(cuerpo).toContain("create trigger lead_events_no_cambia before update or delete on public.lead_events");
    expect(cuerpo).toContain("create trigger lead_events_no_trunca before truncate on public.lead_events");
    expect(cuerpo).toMatch(/revoke execute on function public\.leads_import_rows\(jsonb, uuid\)\s+from public, anon, authenticated;/);
    expect(cuerpo).toMatch(/grant execute on function public\.leads_import_rows\(jsonb, uuid\)\s+to service_role;/);
  });

  it("la carga dedupe por TABS y al actualizar NO toca estado, dueño, etiqueta ni historial", () => {
    const f = fn("leads_import_rows");
    expect(f).toContain("on conflict (tabs_project) do update set");
    const actualiza = f.slice(f.indexOf("on conflict (tabs_project) do update set"), f.indexOf("returning l.id"));
    for (const intocable of ["status", "holder", "holder_name", "taken_at", "last_outcome", "last_note", "last_by", "follow_up_note", "touched_at"]) {
      expect(actualiza, intocable).not.toMatch(new RegExp(`\\b${intocable} = `));
    }
    expect(f).toContain("if v_new then");
  });

  it("la tabla tiene las columnas que la pantalla pide", () => {
    const tabla = /create table if not exists public\.leads \(([\s\S]*?)\n\);/.exec(cuerpo)![1];
    for (const col of COLUMNAS.split(",").map((c) => c.trim())) {
      expect(tabla, col).toMatch(new RegExp(`\\n  ${col}\\s`));
    }
  });

  it("no concede el módulo a nadie, sin begin/commit propios y sin D-NNN dentro", () => {
    expect(sinComentarios).not.toMatch(/update public\.profiles/i);
    expect(sinComentarios).not.toMatch(/^\s*(begin|commit)\s*;/im);
    expect(sql).not.toMatch(/D-\d{3}/);
  });

  it("el checksum del registro es el del cuerpo", () => {
    const sha = createHash("sha256").update(cuerpo).digest("hex");
    expect(sql).toContain(`values ('162_leads.sql', '${sha}')`);
  });
});

describe("el guion de carga", () => {
  const g = leer("scripts/leads/importa-leads.mjs");
  it("sin bandera no toca la base; la carga va por leads_import_rows y solo hace commit con --aplicar", () => {
    expect(g).toContain("if (!aplicar && !ensayo) {");
    expect(g).toContain('select public.leads_import_rows($1::jsonb, null) as r');
    expect(g).toContain('if (aplicar) { await c.query("commit");');
    expect(g).toContain('else { await c.query("rollback");');
  });
});
