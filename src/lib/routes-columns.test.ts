import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { COLUMNAS_DEL_GESTOR, COLUMNAS_DEL_GESTOR_POR_DEFECTO, alternaColumna, columnasDeLaTabla } from "./routes-columns";
import { CLAVES_DE_PREFERENCIA, CLAVE_DE_COLUMNAS_DEL_GESTOR, guardaColumnas, leeColumnas, type ClienteDePrefs } from "./user-prefs";

/** La factura y el selector de columnas del Gestor de Rutas (D-331): el catálogo, la página y la 137. */

const leer = (r: string) => readFileSync(join(process.cwd(), r), "utf8").split("\r\n").join("\n");
const plano = (s: string) => s.replace(/\s+/g, " ");
const sinComentarios = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").split("\n").map((l) => l.replace(/^\s*\/\/.*$/, "")).join("\n");

describe("las columnas del Gestor", () => {
  it("la FACTURA está, en las dos tablas, y se ve por defecto — que es lo que el dueño pidió y no aparecía", () => {
    expect(COLUMNAS_DEL_GESTOR.find((c) => c.key === "invoice")).toMatchObject({ en: "Invoice #", es: "Factura #", tablas: ["programadas", "sinAsignar"] });
    expect(COLUMNAS_DEL_GESTOR_POR_DEFECTO).toContain("invoice");
    expect(columnasDeLaTabla("programadas", COLUMNAS_DEL_GESTOR_POR_DEFECTO)[0].key).toBe("invoice");
    expect(columnasDeLaTabla("sinAsignar", COLUMNAS_DEL_GESTOR_POR_DEFECTO)[0].key).toBe("invoice");
  });
  it("por defecto cada tabla enseña lo que ya enseñaba, en el mismo orden, con la factura delante", () => {
    expect(columnasDeLaTabla("programadas", COLUMNAS_DEL_GESTOR_POR_DEFECTO).map((c) => c.key)).toEqual(["invoice", "account", "driver", "load", "stop", "windows", "pallets"]);
    expect(columnasDeLaTabla("sinAsignar", COLUMNAS_DEL_GESTOR_POR_DEFECTO).map((c) => c.key)).toEqual(["invoice", "account", "store", "pallets", "date", "windows", "status"]);
  });
  it("el orden es el de la tabla, no el de quien marca; una clave que ya no existe se ignora; y cada columna sale solo en SU tabla", () => {
    expect(columnasDeLaTabla("programadas", ["pallets", "columna_retirada", "invoice", "store", "status"]).map((c) => c.key)).toEqual(["invoice", "pallets"]);
    expect(columnasDeLaTabla("sinAsignar", ["driver", "load", "stop"])).toEqual([]);
    expect(columnasDeLaTabla("programadas", [])).toEqual([]);
  });
  it("todas las columnas del catálogo salen en alguna tabla, y toda la que sale en una tabla está en el catálogo", () => {
    const enTablas = new Set([...columnasDeLaTabla("programadas", COLUMNAS_DEL_GESTOR_POR_DEFECTO), ...columnasDeLaTabla("sinAsignar", COLUMNAS_DEL_GESTOR_POR_DEFECTO)].map((c) => c.key));
    expect([...enTablas].sort()).toEqual(COLUMNAS_DEL_GESTOR.map((c) => c.key).sort());
    for (const c of COLUMNAS_DEL_GESTOR) for (const tabla of ["programadas", "sinAsignar"] as const) expect(columnasDeLaTabla(tabla, [c.key]).length === 1, `${c.key} en ${tabla}`).toBe(c.tablas.includes(tabla));
  });
  it("marcar y desmarcar: en orden canónico, sin repetidas y sin claves desconocidas", () => {
    expect(alternaColumna(["pallets", "invoice"], "account")).toEqual(["invoice", "account", "pallets"]);
    expect(alternaColumna(["invoice", "account"], "invoice")).toEqual(["account"]);
    expect(alternaColumna(["invoice", "invoice", "no_existe"], "stop")).toEqual(["invoice", "stop"]);
    expect(alternaColumna([], "no_existe")).toEqual([]);
  });
});

describe("se guarda por persona, en su propia clave", () => {
  it("lee y guarda `routes_columns`, no `order_columns`", async () => {
    const llamadas: unknown[][] = [];
    const cliente: ClienteDePrefs = { from: () => ({
      select: () => ({ eq: (_c1, v1) => ({ eq: (_c2, v2) => ({ maybeSingle: async () => { llamadas.push(["lee", v1, v2]); return { data: { value: { logistics: ["invoice"] } }, error: null }; } }) }) }),
      upsert: (fila) => ({ select: async () => { llamadas.push(["guarda", fila.key, fila.value]); return { data: [{ user_id: fila.user_id }], error: null }; } }),
    }) };
    expect(await leeColumnas(cliente, "yo", CLAVE_DE_COLUMNAS_DEL_GESTOR)).toEqual({ leida: true, hayFila: true, columnas: { logistics: ["invoice"] }, orden: {}, anchos: {} });
    expect(await guardaColumnas(cliente, "yo", { logistics: ["invoice", "account"] }, CLAVE_DE_COLUMNAS_DEL_GESTOR)).toBe(true);
    expect(llamadas).toEqual([["lee", "yo", "routes_columns"], ["guarda", "routes_columns", { logistics: ["invoice", "account"] }]]);
  });
});

describe("la página del Gestor", () => {
  const pagina = plano(sinComentarios(leer("src/app/(app)/routes/page.tsx")));
  it("las dos tablas se pintan desde el catálogo, con la factura leída de la orden", () => {
    expect(pagina).toContain('const colsProgramadas = columnasDeLaTabla("programadas", colsGestor);');
    expect(pagina).toContain('const colsSinAsignar = columnasDeLaTabla("sinAsignar", colsGestor);');
    expect(pagina.split('c.key === "invoice" ? (d.invoice_num || "—")').length - 1).toBe(2);
    expect(pagina).toContain("{colsProgramadas.map((c) => <th key={c.key}>");
    expect(pagina).toContain("{colsSinAsignar.map((c) => <th key={c.key}>");
    // La tercera tabla (paradas por ruta) la enseña bajo el código, si la columna está elegida.
    expect(pagina).toContain('{colsGestor.includes("invoice") && d.invoice_num && <div');
  });
  it("el selector marca y desmarca con la función probada, se cierra al hacer clic fuera, y nace con el defecto", () => {
    expect(pagina).toContain("const [colsGestor, setColsGestor] = useState<string[]>([...COLUMNAS_DEL_GESTOR_POR_DEFECTO]);");
    expect(pagina).toContain("const next = alternaColumna(colsGestor, key);");
    expect(pagina).toContain("useCierraAlSalir(verColumnas, () => setVerColumnas(false), () => [cajaDeColumnas.current]);");
    expect(pagina).toContain("onChange={() => alternaColumnaDelGestor(c.key)}");
  });
  it("lee y guarda en `routes_columns`; guarda solo si antes se pudo leer, y sin pisar lo de otros roles; aquí no se siembra nada", () => {
    expect(pagina).toContain("leeColumnas(createClient() as unknown as ClienteDePrefs, me.id, CLAVE_DE_COLUMNAS_DEL_GESTOR)");
    expect(pagina).toContain("if (!me || SIN_BASE || prefsDelGestor.current === null) return;");
    expect(pagina).toContain("const todas: ColumnasPorRol = { ...prefsDelGestor.current, [me.role]: next };");
    expect(pagina).toContain("guardaColumnas(createClient() as unknown as ClienteDePrefs, me.id, todas, CLAVE_DE_COLUMNAS_DEL_GESTOR)");
    expect(pagina).not.toMatch(/hayQueSembrar|semillaDelNavegador|rtg_routes_columns/);
  });
});

describe("137: la lista cerrada de la base es la del código", () => {
  const sql = leer("supabase/migrations/137_user_prefs_routes_columns.sql");
  const e = plano(sql.split("\n").map((l) => l.replace(/--.*$/, "")).join("\n"));

  it("cambia UNA restricción y nada más: ni políticas, ni grants, ni tablas, ni funciones", () => {
    expect(e).toContain("alter table public.user_prefs drop constraint if exists user_prefs_key_permitida;");
    expect(e).toContain("alter table public.user_prefs add constraint user_prefs_key_permitida check (key in ('order_columns', 'routes_columns'));");
    expect(e.indexOf("drop constraint if exists user_prefs_key_permitida")).toBeGreaterThanOrEqual(0);
    expect(e.indexOf("drop constraint if exists user_prefs_key_permitida")).toBeLessThan(e.indexOf("add constraint user_prefs_key_permitida"));
    expect(e.slice(0, e.indexOf("do $comprueba$"))).not.toMatch(/create policy|drop policy|grant |revoke |create table|create or replace function|create trigger|delete from|update public/i);
  });
  it("la ÚLTIMA migración que toca esa restricción lleva exactamente las claves que usa el código", () => {
    const migraciones = readdirSync(join(process.cwd(), "supabase/migrations")).filter((f) => /^\d+_.*\.sql$/.test(f)).sort();
    const queLaTocan = migraciones.filter((f) => /add constraint user_prefs_key_permitida|constraint user_prefs_key_permitida check/.test(leer(`supabase/migrations/${f}`)));
    expect(queLaTocan[queLaTocan.length - 1]).toBe("137_user_prefs_routes_columns.sql");
    const lista = /constraint user_prefs_key_permitida check \(key in \(([^)]*)\)\)/.exec(e)![1].split(",").map((k) => k.trim().replace(/'/g, "")).sort();
    expect(lista).toEqual([...CLAVES_DE_PREFERENCIA].sort());
  });
  it("sin transacción propia, sin el marcador, con autocomprobación, ensayo y ledger", () => {
    expect(e).not.toMatch(/(^|[\s;])(begin|commit)\s*;/i);
    expect(sql).not.toContain("D-" + "NEXT");
    expect(sql).toContain("debe tener exactamente dos");
    expect(sql).toContain("debe seguir con 3 politicas");
    expect(sql).toContain("MENOS que el total");
    expect(sql).toMatch(/-- @ledger-below\ninsert into public\.schema_migrations \(name, checksum\)\n {2}values \('137_user_prefs_routes_columns\.sql', '[0-9a-f]{64}'\)/);
  });
});
