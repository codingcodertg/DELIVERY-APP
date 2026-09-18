import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ROLE_DEFAULT_COLUMNS } from "@/lib/constants";
import {
  CLAVE_DE_COLUMNAS, ROLES_QUE_ELIGEN, claveDelNavegador, columnasDe, columnasValidas, guardaColumnas, hayQueSembrar, leeColumnas, semillaDelNavegador,
  type ClienteDePrefs,
} from "./user-prefs";

/** Las columnas de Órdenes, por persona (D-330): la librería, la página, los defectos y la 136. */

const leer = (r: string) => readFileSync(join(process.cwd(), r), "utf8").split("\r\n").join("\n");
const plano = (s: string) => s.replace(/\s+/g, " ");
const sinComentarios = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").split("\n").map((l) => l.replace(/^\s*\/\/.*$/, "")).join("\n");

describe("qué columnas ve cada quien, y de dónde salen", () => {
  const defecto = ["stage", "type"];
  it("la base manda; si no dice nada de ESE rol, el navegador; si tampoco, el defecto del rol — y se dice cuál fue", () => {
    expect(columnasDe("logistics", { logistics: ["a"] }, { logistics: ["b"] }, defecto)).toEqual({ columnas: ["a"], origen: "base" });
    expect(columnasDe("logistics", { admin: ["a"] }, { logistics: ["b"] }, defecto)).toEqual({ columnas: ["b"], origen: "navegador" });
    expect(columnasDe("logistics", null, { logistics: ["b"] }, defecto)).toEqual({ columnas: ["b"], origen: "navegador" });
    expect(columnasDe("logistics", {}, {}, defecto)).toEqual({ columnas: ["stage", "type"], origen: "defecto" });
    // Una lista VACÍA guardada a propósito es una elección, no «no hay nada».
    expect(columnasDe("logistics", { logistics: [] }, { logistics: ["b"] }, defecto)).toEqual({ columnas: [], origen: "base" });
  });

  it("VENTAS no elige: ni se lee ni se guarda nada para ese rol, venga de donde venga", () => {
    expect(ROLES_QUE_ELIGEN).not.toContain("sales");
    expect(columnasValidas({ sales: ["type"], logistics: ["stage"] })).toEqual({ logistics: ["stage"] });
    expect(semillaDelNavegador((k) => (k === claveDelNavegador("sales") ? '["type"]' : null))).toEqual({});
  });

  it("lo que llega de la base o del navegador se sanea: solo listas de textos cortos, de roles que existen", () => {
    expect(columnasValidas({ logistics: ["stage", "type"], admin: "stage", manager: [1, 2], driver: [""], warehouse: ["x".repeat(41)], inventado: ["a"] })).toEqual({ logistics: ["stage", "type"] });
    expect([null, undefined, "texto", 7, ["stage"]].map(columnasValidas)).toEqual([{}, {}, {}, {}, {}]);
    expect(columnasValidas({ logistics: Array.from({ length: 61 }, (_, k) => `c${k}`) })).toEqual({});
  });

  it("la semilla: todas las claves de rol que haya en ESTE navegador; un JSON roto no es una elección", () => {
    const guardado: Record<string, string> = { [claveDelNavegador("logistics")]: '["stage","driver"]', [claveDelNavegador("admin")]: "{roto", [claveDelNavegador("warehouse")]: '["fee"]', otra_cosa: '["x"]' };
    expect(semillaDelNavegador((k) => guardado[k] ?? null)).toEqual({ logistics: ["stage", "driver"], warehouse: ["fee"] });
    expect(claveDelNavegador("logistics")).toBe("rtg_order_columns_logistics");            // la de siempre: nadie pierde lo suyo
  });
});

describe("cuándo se siembra la base desde el navegador", () => {
  const nav = { logistics: ["stage"] };
  it("solo si la base se LEYÓ, no había fila, el navegador tiene algo, y se SABE que no hay suplantación", () => {
    expect(hayQueSembrar({ baseLeida: true, hayFila: false, suplantando: false }, nav)).toBe(true);
    expect(hayQueSembrar({ baseLeida: false, hayFila: false, suplantando: false }, nav)).toBe(false);      // no se pudo leer: no se escribe a ciegas
    expect(hayQueSembrar({ baseLeida: true, hayFila: true, suplantando: false }, nav)).toBe(false);        // ya sembrado: manda la base
    expect(hayQueSembrar({ baseLeida: true, hayFila: false, suplantando: false }, {})).toBe(false);        // nada que sembrar
  });
  it("durante una suplantación NO: el navegador es del admin y la fila, de otra persona. Y si no se sabe, tampoco", () => {
    expect(hayQueSembrar({ baseLeida: true, hayFila: false, suplantando: true }, nav)).toBe(false);
    expect(hayQueSembrar({ baseLeida: true, hayFila: false, suplantando: null }, nav)).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------------------------
function clienteFalso(opciones: { fila?: { value: unknown } | null; errorAlLeer?: boolean; lanza?: boolean; escritas?: number; errorAlGuardar?: boolean }) {
  const llamadas: { op: string; args: unknown[] }[] = [];
  const cliente: ClienteDePrefs = {
    from: (tabla) => ({
      select: (cols) => ({ eq: (c1, v1) => ({ eq: (c2, v2) => ({ maybeSingle: async () => {
        llamadas.push({ op: "select", args: [tabla, cols, c1, v1, c2, v2] });
        if (opciones.lanza) throw new Error("sin red");
        return opciones.errorAlLeer ? { data: null, error: { message: "relation does not exist" } } : { data: opciones.fila ?? null, error: null };
      } }) }) }),
      upsert: (fila, o) => ({ select: async (cols) => {
        llamadas.push({ op: "upsert", args: [tabla, fila, o, cols] });
        return opciones.errorAlGuardar ? { data: null, error: { message: "x" } } : { data: Array.from({ length: opciones.escritas ?? 1 }, () => ({ user_id: fila.user_id })), error: null };
      } }),
    }),
  };
  return { cliente, llamadas };
}

describe("la base", () => {
  it("lee SOLO la fila propia de `order_columns`, y la sanea", async () => {
    const { cliente, llamadas } = clienteFalso({ fila: { value: { logistics: ["stage"], sales: ["x"] } } });
    expect(await leeColumnas(cliente, "yo")).toEqual({ leida: true, hayFila: true, columnas: { logistics: ["stage"] } });
    expect(llamadas).toEqual([{ op: "select", args: ["user_prefs", "value", "user_id", "yo", "key", CLAVE_DE_COLUMNAS] }]);
  });
  it("sin fila: leída y sin fila. Con error —la tabla aún no existe— o sin red: NO leída, y no revienta", async () => {
    expect(await leeColumnas(clienteFalso({ fila: null }).cliente, "yo")).toEqual({ leida: true, hayFila: false, columnas: {} });
    expect(await leeColumnas(clienteFalso({ errorAlLeer: true }).cliente, "yo")).toEqual({ leida: false, hayFila: false, columnas: {} });
    expect(await leeColumnas(clienteFalso({ lanza: true }).cliente, "yo")).toEqual({ leida: false, hayFila: false, columnas: {} });
  });
  it("guarda la fila PROPIA, saneada, y mide que se escribió: cero filas no es «guardado»", async () => {
    const { cliente, llamadas } = clienteFalso({});
    expect(await guardaColumnas(cliente, "yo", { logistics: ["stage"], sales: ["x"] } as never)).toBe(true);
    expect(llamadas).toEqual([{ op: "upsert", args: ["user_prefs", { user_id: "yo", key: "order_columns", value: { logistics: ["stage"] } }, { onConflict: "user_id,key" }, "user_id"] }]);
    expect(await guardaColumnas(clienteFalso({ escritas: 0 }).cliente, "yo", {})).toBe(false);
    expect(await guardaColumnas(clienteFalso({ errorAlGuardar: true }).cliente, "yo", {})).toBe(false);
  });
});

describe("la página de Órdenes", () => {
  const pagina = sinComentarios(leer("src/app/(app)/page.tsx"));
  it("ventas sigue con la lista del admin y sin tocar `user_prefs`; los demás pintan YA lo del navegador y luego manda la base", () => {
    const i = pagina.indexOf('if (me.role === "sales") {'), j = pagina.indexOf("semillaDelNavegador(");
    expect(i).toBeGreaterThan(0);
    expect(plano(pagina.slice(i, j))).toContain('setCols(settings.sales_columns ?? defaultColsFor("sales")); return; }');
    expect(j).toBeLessThan(pagina.indexOf("leeColumnas(supabase, yo)"));
    expect(plano(pagina)).toContain("if (leido.hayFila) { setCols(columnasDe(rol, leido.columnas, delNavegador, defaultColsFor(rol)).columnas); return; }");
  });
  it("antes de sembrar pregunta si hay suplantación, y siembra solo si `hayQueSembrar` dice que sí", () => {
    const p = plano(pagina);
    expect(p).toContain('fetch("/api/impersonate/state")');
    expect(p).toContain("suplantando = !!e?.como;");
    expect(p).toContain("if (!vivo || !hayQueSembrar({ baseLeida: true, hayFila: false, suplantando }, delNavegador)) return;");
    expect(p.indexOf("hayQueSembrar(")).toBeGreaterThanOrEqual(0);
    expect(p.indexOf("hayQueSembrar(")).toBeLessThan(p.indexOf("guardaColumnas(supabase, yo, delNavegador)"));
  });
  it("al cambiar columnas: el navegador SIEMPRE (nunca se borra), y la base solo si se pudo leer; ventas, ni lo uno ni lo otro", () => {
    const p = plano(pagina);
    const guarda = p.slice(p.indexOf("const saveCols = "), p.indexOf("const colsRef"));
    expect(guarda).toContain('if (!me || me.role === "sales") return;');
    // Un `indexOf` que no encuentra da -1, y -1 es «menor que» cualquier cosa: primero, que ESTÉ.
    expect(guarda.indexOf("localStorage.setItem(colsKey(me.role)")).toBeGreaterThanOrEqual(0);
    expect(guarda.indexOf("localStorage.setItem(colsKey(me.role)")).toBeLessThan(guarda.indexOf("prefsDeLaBase.current === null) return;"));
    expect(guarda).toContain("const todas: ColumnasPorRol = { ...prefsDeLaBase.current, [me.role]: next };");
    expect(pagina).not.toMatch(/localStorage\.removeItem\([^)]*col/i);
  });
});

describe("los defectos por rol ya no repiten la factura", () => {
  it("ninguno lleva `invoice`: la columna `#` ya la enseña, para todos", () => {
    for (const [rol, cols] of Object.entries(ROLE_DEFAULT_COLUMNS)) expect(cols, rol).not.toContain("invoice");
    expect(Object.keys(ROLE_DEFAULT_COLUMNS).sort()).toEqual(["driver", "sales", "warehouse"]);
    expect(sinComentarios(leer("src/components/OrdersTable.tsx"))).toContain("const byInvoice = true;");
    // Y sigue en el selector para quien la quiera.
    expect(leer("src/components/OrdersTable.tsx")).toContain('{ key: "invoice", en: "Invoice #", es: "Factura #"');
  });
  it("lo demás de cada defecto no cambió", () => {
    expect(ROLE_DEFAULT_COLUMNS).toEqual({
      sales: ["type", "store", "date", "windows", "account"], driver: ["stage", "type", "store", "account", "date", "windows", "pallets"],
      warehouse: ["stage", "type", "store", "account", "date", "windows", "pallets", "fee", "driver"],
    });
  });
});

describe("136: la base dice lo mismo", () => {
  const sql = leer("supabase/migrations/136_user_prefs.sql");
  const e = plano(sql.split("\n").map((l) => l.replace(/--.*$/, "")).join("\n"));
  const politica = (n: string) => { const i = e.indexOf(`create policy "${n}"`); if (i < 0) throw new Error(n); return e.slice(i, e.indexOf(";", i)); };

  it("(user_id, key) con lista CERRADA de claves —la misma que usa el código— y tope de tamaño", () => {
    expect(e).toContain("primary key (user_id, key)");
    expect(e).toContain(`constraint user_prefs_key_permitida check (key in ('${CLAVE_DE_COLUMNAS}'))`);
    expect(e).toContain("constraint user_prefs_tamano check (pg_column_size(value) < 8192)");
    expect(e).toContain("user_id uuid not null references public.profiles(id) on delete cascade");
  });
  it("tres políticas, una por comando, todas atadas a `auth.uid()` y ninguna mira el rol: tampoco un admin lee la de otro", () => {
    expect([...e.matchAll(/create policy "([^"]+)" on public\.user_prefs for (\w+)/g)].map((m) => [m[1], m[2]])).toEqual([
      ["user_prefs select own", "select"], ["user_prefs insert own", "insert"], ["user_prefs update own", "update"],
    ]);
    const propia = "(user_id = (select auth.uid()))";
    expect(politica("user_prefs select own")).toContain(`using ${propia}`);
    expect(politica("user_prefs insert own")).toContain(`with check ${propia}`);
    expect(politica("user_prefs update own")).toContain(`using ${propia} with check ${propia}`);
    expect(e.slice(0, e.indexOf("do $comprueba$"))).not.toMatch(/is_admin|current_user_role|for all/i);
  });
  it("revoke antes del grant, sin DELETE; el disparador congela dueño y clave; sin transacción propia, sin el marcador, con ensayo y ledger", () => {
    expect(e.indexOf("revoke all on public.user_prefs from anon, authenticated;")).toBeGreaterThan(0);
    expect(e.indexOf("revoke all on public.user_prefs")).toBeLessThan(e.indexOf("grant select, insert, update on public.user_prefs to authenticated;"));
    expect(e).not.toMatch(/grant [^;]*delete[^;]*user_prefs/i);
    expect(e).toContain("if NEW.user_id is distinct from OLD.user_id or NEW.key is distinct from OLD.key then");
    expect(e).not.toMatch(/(^|[\s;])(begin|commit)\s*;/i);
    expect(sql).not.toContain("D-" + "NEXT");
    expect(sql).toContain("MENOS que el total");
    expect(sql).toContain("un admin SUPLANTANDO a A");
    expect(sql).toMatch(/-- @ledger-below\ninsert into public\.schema_migrations \(name, checksum\)\n {2}values \('136_user_prefs\.sql', '[0-9a-f]{64}'\)/);
  });
});
