import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { COLUMNAS_DEL_GESTOR, COLUMNAS_DEL_GESTOR_POR_DEFECTO, MARCA_V2, MARCA_V3, alternaColumna, columnasDeLaTabla, conColumnasNuevas, indicesOcultosDeParadas } from "./routes-columns";
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
  it("por defecto cada tabla enseña lo que ya enseñaba, en el mismo orden, con la factura delante — y la dirección tras la cuenta (D-346)", () => {
    expect(columnasDeLaTabla("programadas", COLUMNAS_DEL_GESTOR_POR_DEFECTO).map((c) => c.key)).toEqual(["invoice", "account", "pickup", "address", "driver", "load", "stop", "windows", "pallets"]);
    expect(columnasDeLaTabla("sinAsignar", COLUMNAS_DEL_GESTOR_POR_DEFECTO).map((c) => c.key)).toEqual(["invoice", "account", "pickup", "address", "store", "pallets", "date", "windows", "status"]);
  });
  it("el orden es el de la tabla, no el de quien marca; una clave que ya no existe se ignora; y cada columna sale solo en SU tabla", () => {
    expect(columnasDeLaTabla("programadas", ["pallets", "columna_retirada", "invoice", "store", "status"]).map((c) => c.key)).toEqual(["invoice", "pallets"]);
    expect(columnasDeLaTabla("sinAsignar", ["driver", "load", "stop"])).toEqual([]);
    expect(columnasDeLaTabla("programadas", [])).toEqual([]);
  });
  it("todas las columnas del catálogo salen en alguna tabla, y toda la que sale en una tabla está en el catálogo", () => {
    const enTablas = new Set((["programadas", "sinAsignar", "paradas"] as const).flatMap((tb) => columnasDeLaTabla(tb, COLUMNAS_DEL_GESTOR_POR_DEFECTO)).map((c) => c.key));
    expect([...enTablas].sort()).toEqual(COLUMNAS_DEL_GESTOR.map((c) => c.key).sort());
    for (const c of COLUMNAS_DEL_GESTOR) for (const tabla of ["programadas", "sinAsignar", "paradas"] as const) expect(columnasDeLaTabla(tabla, [c.key]).length === 1, `${c.key} en ${tabla}`).toBe(c.tablas.includes(tabla));
  });
  it("marcar y desmarcar: en orden canónico, sin repetidas y sin claves desconocidas — y con la marca de D-346 siempre", () => {
    // Y la de D-353 (la recogida): las dos marcas viajan siempre.
    expect(alternaColumna(["pallets", "invoice"], "account")).toEqual(["invoice", "account", "pallets", MARCA_V2, MARCA_V3]);
    expect(alternaColumna(["invoice", "account"], "invoice")).toEqual(["account", MARCA_V2, MARCA_V3]);
    expect(alternaColumna(["invoice", "invoice", "no_existe"], "stop")).toEqual(["invoice", "stop", MARCA_V2, MARCA_V3]);
    expect(alternaColumna([], "no_existe")).toEqual([MARCA_V2, MARCA_V3]);
    expect(alternaColumna(["invoice", MARCA_V2, MARCA_V3], "account")).toEqual(["invoice", "account", MARCA_V2, MARCA_V3]);
  });
  it("la DIRECCIÓN de entrega está en las dos tablas del Gestor, que es lo que el dueño echó en falta (D-346)", () => {
    expect(COLUMNAS_DEL_GESTOR.find((c) => c.key === "address")).toMatchObject({ tablas: ["programadas", "sinAsignar"] });
  });
  it("a quien guardó sus columnas ANTES de D-346 le llegan las nuevas; a quien las quitó después, no le vuelven", () => {
    const deAntes = conColumnasNuevas(["invoice", "pallets"]);
    expect(deAntes).toEqual(["invoice", "pallets", "address", "p_type", "p_pallets", "p_address", "p_eta", "p_windows", MARCA_V2, "pickup", MARCA_V3]);
    expect(columnasDeLaTabla("programadas", deAntes).map((c) => c.key)).toEqual(["invoice", "pickup", "address", "pallets"]);
    // Ya conoce las de D-346 (lleva la v2) y quitó la dirección: se respeta; pero la recogida de D-353 sí le llega, una vez.
    expect(conColumnasNuevas(["invoice", MARCA_V2])).toEqual(["invoice", MARCA_V2, "pickup", MARCA_V3]);
    // Con las dos marcas, ya nada se añade: quitó la recogida y se respeta.
    expect(conColumnasNuevas(["invoice", MARCA_V2, MARCA_V3])).toEqual(["invoice", MARCA_V2, MARCA_V3]);
    // Una que ya la tenía no la gana dos veces.
    expect(conColumnasNuevas(["address"]).filter((k) => k === "address")).toHaveLength(1);
  });
  it("la tabla de paradas: lo que se quita se esconde por su puesto; por defecto no se esconde nada", () => {
    expect([...indicesOcultosDeParadas(COLUMNAS_DEL_GESTOR_POR_DEFECTO)]).toEqual([]);
    expect([...indicesOcultosDeParadas(alternaColumna(COLUMNAS_DEL_GESTOR_POR_DEFECTO, "p_eta"))]).toEqual([5]);
    expect([...indicesOcultosDeParadas(["invoice", MARCA_V2])].sort()).toEqual([2, 3, 4, 5, 6]);
    // Los puestos son los de la tabla, sin repetir y sin pisar los fijos (0 número, 1 ID, 7 acciones).
    const puestos = COLUMNAS_DEL_GESTOR.filter((c) => c.tablas.includes("paradas")).map((c) => c.indice);
    expect(puestos).toEqual([2, 3, 4, 5, 6]);
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
    // Desde D-NEXT la factura es un enlace que abre la orden, y las cabeceras salen del juego con menú (el catálogo más el ID).
    expect(pagina.split('c.key === "invoice" ? (d.invoice_num ? <span {...abreLaOrden(d)}>{d.invoice_num}</span> : "—")').length - 1).toBe(2);
    expect(pagina).toContain("const menuProgramadas: ColumnaConMenu[] = [COL_ID, ...colsProgramadas.map(");
    expect(pagina).toContain("const menuSinAsignar: ColumnaConMenu[] = [COL_ID, ...colsSinAsignar.map(");
    expect(pagina).toContain("{menuProgramadas.slice(1).map((c) => <th key={c.key}>");
    expect(pagina).toContain("{menuSinAsignar.slice(1).map((c) => <th key={c.key}>");
    // La tercera tabla (paradas por ruta) la enseña bajo el código, si la columna está elegida.
    expect(pagina).toContain('{colsGestor.includes("invoice") && d.invoice_num && <div');
  });
  it("D-346: la dirección se pinta en las dos tablas, lo guardado de antes recibe las columnas nuevas, y la sugerencia de chofer ya no está", () => {
    expect(pagina.split('c.key === "address" ? <span title={d.delivery_address || undefined}>{d.delivery_address || "—"}</span>').length - 1).toBe(2);
    // Y la recogida (D-353): el nombre de la tienda o almacén, y la dirección al pasar el ratón.
    expect(pagina.split('c.key === "pickup" ? <span title={d.pickup_address || undefined}>{d.pickup_name || d.pickup_address || "—"}</span>').length - 1).toBe(2);
    expect(pagina).toContain("if (suyas) setColsGestor(conColumnasNuevas(suyas));");
    expect(pagina).not.toContain("suggestDriverFor");
    expect(pagina).not.toContain("same store, has room");
  });
  it("D-346: la tabla de paradas esconde por su puesto lo que la persona quitó — columna, cabecera y celda — y la dirección nace abierta", () => {
    expect(pagina).toContain("const paradasOcultas = indicesOcultosDeParadas(colsGestor);");
    expect(pagina).toContain("paradasOcultas.has(i) ? null : <col key={i}");
    for (const n of [2, 3, 4, 5, 6]) expect(pagina.split(`{!paradasOcultas.has(${n}) && <t`).length - 1, `puesto ${n}`).toBe(2);
    expect(pagina).toContain("<td colSpan={8 - paradasOcultas.size}");
    expect(pagina).toContain("const [addrWide, setAddrWide] = useState(true);");
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

describe("«Armar las rutas del día» nace plegado tras su botón (D-346)", () => {
  const plan = plano(sinComentarios(leer("src/components/PlanDelDia.tsx")));
  it("plegado por defecto, y plegado sigue diciendo cuántas órdenes no tienen plan", () => {
    expect(plan).toContain("const [abierto, setAbierto] = useState(false);");
    const desde = plan.indexOf("if (!abierto) return ("), hasta = plan.indexOf("return ( <div className=\"card\"> <div style");
    expect(desde).toBeGreaterThan(-1); expect(hasta).toBeGreaterThan(desde);
    const plegado = plan.slice(desde, hasta);
    expect(plegado).toContain("onClick={() => setAbierto(true)}");
    expect(plegado).toContain("{!borrador && sinPlan > 0 &&");
    expect(plegado).not.toContain("planifica()");
  });
});

describe("«Sin asignar» tiene su propio ⚙ Columnas (D-349)", () => {
  const pagina = plano(sinComentarios(leer("src/app/(app)/routes/page.tsx")));
  it("el selector está junto al buscador, con las columnas de ESA tabla, y usa la misma función que los otros dos", () => {
    const i = pagina.indexOf('{COLUMNAS_DEL_GESTOR.filter((c) => c.tablas.includes("sinAsignar")).map((c) => (');
    expect(i).toBeGreaterThan(-1);
    expect(pagina.slice(i, i + 400)).toContain("onChange={() => alternaColumnaDelGestor(c.key)}");
    expect(pagina).toContain("useCierraAlSalir(verColsPool, () => setVerColsPool(false), () => [cajaDeColsPool.current]);");
  });
});

describe("«Atrasada» en el Gestor lo decide la orden, no el día que se mira (D-354)", () => {
  it("la celda de fecha pregunta isOverdue y pinta la etiqueta solo si está vencida", () => {
    const pagina = leer("src/app/(app)/routes/page.tsx");
    const i = pagina.indexOf("function DateCell(");
    expect(i).toBeGreaterThan(-1);
    const celda = pagina.slice(i, i + 1500);
    expect(celda).toContain("const vencida = isOverdue(d);");
    expect(celda).toContain("if (d.delivery_date === date && !vencida) return <>{fmtDate(d.delivery_date)}</>;");
    expect(celda).toContain('{vencida && <span className="sema"');
  });
});

describe("la carga y lo libre del viaje van a la décima (D-355)", () => {
  it("el Gestor redondea la suma de pallets y el sobrante antes de pintarlos", () => {
    const pagina = leer("src/app/(app)/routes/page.tsx");
    expect(pagina).toContain("const load = Math.round(batch.reduce((n, d) => n + (d.actual_pallets ?? d.est_pallets ?? 0), 0) * 10) / 10;");
    expect(pagina).toContain("const free = Math.round(Math.max(0, capacity - load) * 10) / 10;");
    // Lo que el dueño vio: 12 − (4 + 0.4 + 0.03) en coma flotante.
    expect(12 - (4 + 0.4 + 0.03)).not.toBe(7.57);
    expect(Math.round((12 - (4 + 0.4 + 0.03)) * 10) / 10).toBe(7.6);
  });
});
