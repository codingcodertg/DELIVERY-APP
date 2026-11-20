import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/** 337 · Llamadas de RingCentral en los leads y estadísticas: lo que la migración promete, leído del fichero (no se aplica aquí). */
const leer = (ruta: string) => readFileSync(join(process.cwd(), ruta), "utf8").replace(/\r\n/g, "\n");
const sql = leer("supabase/migrations/337_leads_estadisticas_y_llamadas.sql");
const sinComentarios = sql.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");

describe("337 · la forma del fichero", () => {
  it("no lleva línea de registro (la pone quien la aplica)", () => {
    expect(sql).not.toContain("@ledger-below");
    expect(sinComentarios).not.toMatch(/schema_migrations/);
  });
  it("sin begin ni commit propios: la transacción la pone quien aplica", () => {
    expect(sinComentarios).not.toMatch(/^\s*(begin|commit|rollback)\s*;/im);
  });
  it("no borra datos ni tablas existentes", () => {
    expect(sinComentarios).not.toMatch(/\bdelete\s+from\b/i);
    expect(sinComentarios).not.toMatch(/\bdrop\s+table\b/i);
    expect(sinComentarios).not.toMatch(/\btruncate\b/i);
  });
  it("no redefine lo que ya existe de 162, 163, 218, 253, 328 o 335", () => {
    expect(sinComentarios).not.toMatch(/create or replace function public\.(lead_note|leads_import_rows|leads_registra_nota|leads_puede_ver_fila|lead_set_phone|lead_take|lead_close)\(/);
  });
});

describe("337 · las funciones y su puerta", () => {
  it("las funciones con security definer son las dos de lectura, y ninguna más", () => {
    // La cabecera de cada función llega hasta su «as $$»: ahí se ve si es security definer, sin mirar la siguiente.
    const cabeceras = [...sinComentarios.matchAll(/create or replace function public\.(\w+)\([\s\S]*?\bas \$\$/g)];
    const definer = cabeceras.filter((m) => /security definer set search_path = public, pg_temp/.test(m[0])).map((m) => m[1]);
    expect(cabeceras.map((m) => m[1]).sort()).toEqual(["leads_clave_de_telefono", "leads_estadisticas_de_llamadas", "leads_llamadas_de_lead"]);
    expect(definer.sort()).toEqual(["leads_estadisticas_de_llamadas", "leads_llamadas_de_lead"]);
  });
  it("la lectura de las llamadas de un lead exige el módulo y que el lead se vea", () => {
    const cuerpo = sinComentarios.slice(sinComentarios.indexOf("function public.leads_llamadas_de_lead"));
    expect(cuerpo).toMatch(/has_leads_access\(\)/);
    expect(cuerpo).toMatch(/leads_puede_ver_fila\(p_lead\)/);
  });
  it("una llamada de un teléfono que comparte un lead no visible NO se devuelve (regla de visibilidad por clave)", () => {
    const cuerpo = sinComentarios.slice(sinComentarios.indexOf("function public.leads_llamadas_de_lead"), sinComentarios.indexOf("function public.leads_estadisticas_de_llamadas"));
    expect(cuerpo).toMatch(/claves_ocultas as \(/);
    expect(cuerpo).toMatch(/where not public\.leads_puede_ver_fila\(l\.id\)/);
    expect(cuerpo).toMatch(/c\.phone_key not in \(select o\.clave from claves_ocultas o/);
    // Las cuatro columnas cuentan, también la de a mano.
    expect(cuerpo).toMatch(/\(l\.owner_phone_manual\), \(l\.tenant_phone\), \(l\.tenant_phone_manual\)/);
  });
  it("las estadísticas solo para admin y gerente", () => {
    const cuerpo = sinComentarios.slice(sinComentarios.indexOf("function public.leads_estadisticas_de_llamadas"));
    expect(cuerpo).toMatch(/p\.role in \('admin', 'manager'\)/);
  });
  it("la clave de teléfono de SQL usa la misma regla que TypeScript (claveDeTelefono)", () => {
    // Si una cambia, la otra también: esta prueba pilla que se olvidó la otra.
    expect(sql).toContain("'\\s*(ext\\.?|x|#).*$'");
    expect(sql).toMatch(/length\(v_digitos\) = 11 and left\(v_digitos, 1\) = '1'/);
  });
});

describe("337 · la seguridad de las tablas nuevas", () => {
  it("las dos tablas nuevas no tienen políticas: solo las leen las funciones y las escribe el servidor", () => {
    expect(sinComentarios).not.toMatch(/create policy/i);
    expect(sinComentarios).toMatch(/revoke all on public\.rc_lead_calls from anon, authenticated/);
    expect(sinComentarios).toMatch(/revoke all on public\.rc_lead_sync_state from anon, authenticated/);
  });
  it("el bucket de las grabaciones es privado", () => {
    expect(sinComentarios).toMatch(/'rc-lead-recordings', 'rc-lead-recordings', false/);
  });
});

describe("337 · las estadísticas filtran por lo que quien pide ve (alcance de tienda)", () => {
  const cuerpo = () => sinComentarios.slice(sinComentarios.indexOf("function public.leads_estadisticas_de_llamadas"));
  it("el recuento sin filtro solo con el alcance de todas las tiendas (leads_scope_all)", () => {
    expect(cuerpo()).toMatch(/if public\.leads_scope_all\(\) then/);
  });
  it("con alcance de tienda cuenta solo claves de leads visibles y excluye las de leads ocultos", () => {
    const c = cuerpo();
    expect(c).toMatch(/claves_visibles as \(/);
    expect(c).toMatch(/claves_ocultas as \(/);
    expect(c).toMatch(/where public\.leads_puede_ver_fila\(l\.id\)/);
    expect(c).toMatch(/where not public\.leads_puede_ver_fila\(l\.id\)/);
    expect(c).toMatch(/c\.phone_key in \(select v\.clave from claves_visibles v/);
    expect(c).toMatch(/c\.phone_key not in \(select o\.clave from claves_ocultas o/);
  });
});

describe("337 · la ruta de la grabación pasa por la misma comprobación", () => {
  const ruta = leer("src/app/api/leads/llamadas/grabacion/route.ts");
  it("pide la lista con la sesión de quien llama a leads_llamadas_de_lead del lead pedido", () => {
    expect(ruta).toMatch(/supabase\.rpc\("leads_llamadas_de_lead", \{ p_lead: lead \}\)/);
  });
  it("solo firma si la llamada pedida aparece en esa lista con grabación", () => {
    expect(ruta).toMatch(/\.find\(\(c\) => c\.id === id\)/);
    expect(ruta).toMatch(/visible\?\.has_recording/);
  });
  it("el cliente con llave de servicio se crea solo después de esa comprobación", () => {
    const pos = ruta.indexOf("createAdminClient()");
    expect(pos).toBeGreaterThan(ruta.indexOf("leads_llamadas_de_lead"));
    expect(pos).toBeGreaterThan(ruta.indexOf("visible?.has_recording"));
  });
});
