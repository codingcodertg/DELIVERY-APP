import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { COLUMN_WIDTHS } from "./use-col-widths";
import { COLUMNAS_DEL_GESTOR, COLUMNAS_DEL_GESTOR_POR_DEFECTO, MARCA_V2, MARCA_V3, MARCA_V4, alternaColumna, anchoDePartida, columnaDeOrdenes, columnasDeLaTabla, conColumnasNuevas, extrasDeParadas, indicesOcultosDeParadas } from "./routes-columns";
import { CLAVES_DE_PREFERENCIA, CLAVE_DE_COLUMNAS_DEL_GESTOR, guardaColumnas, leeColumnas, type ClienteDePrefs } from "./user-prefs";

/** La factura y el selector de columnas del Gestor de Rutas (D-331): el catálogo, la página y la 137. */

const leer = (r: string) => readFileSync(join(process.cwd(), r), "utf8").split("\r\n").join("\n");
const plano = (s: string) => s.replace(/\s+/g, " ");
const sinComentarios = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").split("\n").map((l) => l.replace(/^\s*\/\/.*$/, "")).join("\n");

const MARCAS = [MARCA_V2, MARCA_V3, MARCA_V4];
const NUEVAS_DE_ORDENES = ["type", "so", "po", "fee", "contact"];
const EXTRAS_DE_PARADAS = ["p_stage", "p_store", "p_account", "p_so", "p_po", "p_date", "p_fee", "p_contact"];

describe("las columnas del Gestor", () => {
  it("la FACTURA está en «Sin asignar» y se ve por defecto — que es lo que el dueño pidió y no aparecía", () => {
    expect(COLUMNAS_DEL_GESTOR.find((c) => c.key === "invoice")).toMatchObject({ en: "Invoice #", es: "Factura #", tablas: ["sinAsignar"] });
    expect(COLUMNAS_DEL_GESTOR_POR_DEFECTO).toContain("invoice");
    expect(columnasDeLaTabla("sinAsignar", COLUMNAS_DEL_GESTOR_POR_DEFECTO)[0].key).toBe("invoice");
  });
  it("por defecto «Sin asignar» enseña lo que ya enseñaba, en el mismo orden, y DETRÁS las de Órdenes (D-NEXT)", () => {
    expect(columnasDeLaTabla("sinAsignar", COLUMNAS_DEL_GESTOR_POR_DEFECTO).map((c) => c.key)).toEqual(["invoice", "account", "pickup", "address", "store", "pallets", "date", "windows", "status", ...NUEVAS_DE_ORDENES]);
    // La de paradas, las cinco de siempre y ninguna de las nuevas: esas se eligen.
    expect(columnasDeLaTabla("paradas", COLUMNAS_DEL_GESTOR_POR_DEFECTO).map((c) => c.key)).toEqual(["p_type", "p_pallets", "p_address", "p_eta", "p_windows"]);
  });
  it("el orden es el de la tabla, no el de quien marca; una clave que ya no existe se ignora; y cada columna sale solo en SU tabla", () => {
    expect(columnasDeLaTabla("sinAsignar", ["pallets", "columna_retirada", "fee", "invoice", "p_eta"]).map((c) => c.key)).toEqual(["invoice", "pallets", "fee"]);
    expect(columnasDeLaTabla("sinAsignar", [])).toEqual([]);
  });
  it("D-NEXT: lo guardado cuando existía «Programadas» —chofer, carga, parada— se ignora sin romper, y al marcar se limpia", () => {
    for (const k of ["driver", "load", "stop"]) expect(COLUMNAS_DEL_GESTOR.some((c) => c.key === k), k).toBe(false);
    const guardada = ["invoice", "driver", "load", "stop", "pallets", MARCA_V2, MARCA_V3];
    expect(columnasDeLaTabla("sinAsignar", conColumnasNuevas(guardada)).map((c) => c.key)).toEqual(["invoice", "pallets", ...NUEVAS_DE_ORDENES]);
    expect(alternaColumna(guardada, "account")).toEqual(["invoice", "account", "pallets", ...MARCAS]);
  });
  it("todas las columnas del catálogo salen en alguna tabla, y toda la que sale en una tabla está en el catálogo", () => {
    const todas = COLUMNAS_DEL_GESTOR.map((c) => c.key);
    const enTablas = new Set((["sinAsignar", "paradas"] as const).flatMap((tb) => columnasDeLaTabla(tb, todas)).map((c) => c.key));
    expect([...enTablas].sort()).toEqual([...todas].sort());
    for (const c of COLUMNAS_DEL_GESTOR) for (const tabla of ["sinAsignar", "paradas"] as const) expect(columnasDeLaTabla(tabla, [c.key]).length === 1, `${c.key} en ${tabla}`).toBe(c.tablas.includes(tabla));
  });
  it("marcar y desmarcar: en orden canónico, sin repetidas y sin claves desconocidas — y con las tres marcas siempre", () => {
    expect(alternaColumna(["pallets", "invoice"], "account")).toEqual(["invoice", "account", "pallets", ...MARCAS]);
    expect(alternaColumna(["invoice", "account"], "invoice")).toEqual(["account", ...MARCAS]);
    expect(alternaColumna(["invoice", "invoice", "no_existe"], "fee")).toEqual(["invoice", "fee", ...MARCAS]);
    expect(alternaColumna([], "no_existe")).toEqual(MARCAS);
    expect(alternaColumna(["invoice", ...MARCAS], "account")).toEqual(["invoice", "account", ...MARCAS]);
  });
  it("la DIRECCIÓN de entrega está en «Sin asignar», que es lo que el dueño echó en falta (D-346)", () => {
    expect(COLUMNAS_DEL_GESTOR.find((c) => c.key === "address")).toMatchObject({ tablas: ["sinAsignar"] });
  });
  it("a quien guardó sus columnas ANTES de cada tanda le llegan las nuevas; a quien las quitó después, no le vuelven", () => {
    const deAntes = conColumnasNuevas(["invoice", "pallets"]);
    expect(deAntes).toEqual(["invoice", "pallets", "address", "p_type", "p_pallets", "p_address", "p_eta", "p_windows", MARCA_V2, "pickup", MARCA_V3, ...NUEVAS_DE_ORDENES, MARCA_V4]);
    expect(columnasDeLaTabla("sinAsignar", deAntes).map((c) => c.key)).toEqual(["invoice", "pickup", "address", "pallets", ...NUEVAS_DE_ORDENES]);
    // Ya conoce las de D-346 (lleva la v2) y quitó la dirección: se respeta; pero la recogida de D-353 sí le llega, una vez.
    expect(conColumnasNuevas(["invoice", MARCA_V2])).toEqual(["invoice", MARCA_V2, "pickup", MARCA_V3, ...NUEVAS_DE_ORDENES, MARCA_V4]);
    // Con la v3 y sin la v4 (guardó antes de D-NEXT): le llegan las de Órdenes, una vez.
    expect(conColumnasNuevas(["invoice", MARCA_V2, MARCA_V3])).toEqual(["invoice", MARCA_V2, MARCA_V3, ...NUEVAS_DE_ORDENES, MARCA_V4]);
    // Con las tres marcas, ya nada se añade: quitó el costo y se respeta.
    expect(conColumnasNuevas(["invoice", ...MARCAS])).toEqual(["invoice", ...MARCAS]);
    // Una que ya la tenía no la gana dos veces.
    expect(conColumnasNuevas(["address", "fee"]).filter((k) => k === "address" || k === "fee")).toEqual(["address", "fee"]);
  });
  it("las de Órdenes en paradas NO llegan a lo guardado ni al defecto: se eligen", () => {
    for (const k of EXTRAS_DE_PARADAS) {
      expect(COLUMNAS_DEL_GESTOR_POR_DEFECTO, k).not.toContain(k);
      expect(conColumnasNuevas(["invoice"]), k).not.toContain(k);
    }
  });
  it("la tabla de paradas: lo que se quita se esconde por su puesto; por defecto no se esconde nada", () => {
    expect([...indicesOcultosDeParadas(COLUMNAS_DEL_GESTOR_POR_DEFECTO)]).toEqual([]);
    expect([...indicesOcultosDeParadas(alternaColumna(COLUMNAS_DEL_GESTOR_POR_DEFECTO, "p_eta"))]).toEqual([5]);
    expect([...indicesOcultosDeParadas(["invoice", MARCA_V2])].sort()).toEqual([2, 3, 4, 5, 6]);
    // Las que no tienen puesto no se cuelan como «undefined» entre los ocultos, estén o no elegidas.
    expect([...indicesOcultosDeParadas([...COLUMNAS_DEL_GESTOR_POR_DEFECTO, "p_fee"])]).toEqual([]);
    // Los puestos son los de la tabla, sin repetir y sin pisar los fijos (0 número, 1 ID, 7 acciones).
    const puestos = COLUMNAS_DEL_GESTOR.filter((c) => c.tablas.includes("paradas") && c.indice != null).map((c) => c.indice);
    expect(puestos).toEqual([2, 3, 4, 5, 6]);
  });
  it("las columnas de Órdenes en paradas: solo las elegidas, en el orden de la tabla, y ninguna con puesto", () => {
    expect(extrasDeParadas(COLUMNAS_DEL_GESTOR_POR_DEFECTO)).toEqual([]);
    expect(extrasDeParadas(["p_fee", "p_type", "p_stage", "fee"]).map((c) => c.key)).toEqual(["p_stage", "p_fee"]);
    expect(extrasDeParadas(COLUMNAS_DEL_GESTOR.map((c) => c.key)).map((c) => c.key)).toEqual(EXTRAS_DE_PARADAS);
  });
});

describe("D-NEXT: las columnas de Órdenes, con el rótulo, la celda y el valor de Órdenes", () => {
  // Solo el catálogo `ORDER_COLUMNS`, para que un `key:` de otro sitio del fichero no conteste por él.
  const tabla = leer("src/components/OrdersTable.tsx").split("export const ORDER_COLUMNS: OrderColumn[] = [")[1].split("\n];")[0];
  // El rótulo de cada columna de `ORDER_COLUMNS`, leído de su fuente: el catálogo tiene JSX y no se importa aquí.
  const rotuloEnOrdenes = (key: string) => {
    const m = new RegExp(`key: "${key}", en: "([^"]+)", es: "([^"]+)"`).exec(tabla);
    expect(m, key).not.toBeNull();
    return { en: m![1], es: m![2] };
  };
  const quitaPrefijo = (s: string) => s.replace(/^[^:]+: /, "");

  it("en «Sin asignar» están tipo, SO, PO, costo y contacto; y en paradas, las ocho, todas elegibles en su ⚙", () => {
    for (const k of NUEVAS_DE_ORDENES) expect(COLUMNAS_DEL_GESTOR.find((c) => c.key === k), k).toMatchObject({ tablas: ["sinAsignar"], deOrdenes: k });
    for (const k of EXTRAS_DE_PARADAS) expect(COLUMNAS_DEL_GESTOR.find((c) => c.key === k), k).toMatchObject({ tablas: ["paradas"], deOrdenes: k.slice(2), oculta: true });
  });
  it("el `status` del Gestor ES la etapa de Órdenes: se llama igual y se pinta con su celda, sin columna duplicada", () => {
    expect(COLUMNAS_DEL_GESTOR.find((c) => c.key === "status")).toMatchObject({ en: "Stage", es: "Etapa", deOrdenes: "stage" });
    expect(COLUMNAS_DEL_GESTOR.some((c) => c.key === "stage")).toBe(false);
  });
  it("cada columna que viene de Órdenes lleva EXACTAMENTE su rótulo en los dos idiomas", () => {
    const deOrdenes = COLUMNAS_DEL_GESTOR.filter((c) => c.deOrdenes);
    expect(deOrdenes.length).toBe(1 + NUEVAS_DE_ORDENES.length + EXTRAS_DE_PARADAS.length);
    for (const c of deOrdenes) {
      const r = rotuloEnOrdenes(c.deOrdenes!);
      expect({ en: quitaPrefijo(c.en), es: quitaPrefijo(c.es) }, c.key).toEqual(r);
    }
  });
  it("cada columna que viene de Órdenes nace con el ancho de Órdenes — la etapa, 108, para que no salga «Program…»", () => {
    expect(COLUMN_WIDTHS.stage).toBeGreaterThan(100);
    expect(anchoDePartida("status", COLUMN_WIDTHS)).toBe(COLUMN_WIDTHS.stage);
    for (const c of COLUMNAS_DEL_GESTOR.filter((x) => x.deOrdenes)) expect(anchoDePartida(c.key, COLUMN_WIDTHS), c.key).toBe(COLUMN_WIDTHS[c.deOrdenes!]);
    // Las que el Gestor pinta a su manera siguen con el ancho general de su tabla, aunque Órdenes tenga una con su clave.
    for (const k of ["invoice", "account", "address", "date", "no_existe"]) expect(anchoDePartida(k, COLUMN_WIDTHS), k).toBeUndefined();
  });
  it("`columnaDeOrdenes` devuelve la columna de Órdenes de cada clave, y nada para las que el Gestor pinta a su manera", () => {
    const catalogo = ["stage", "type", "store", "account", "so", "po", "invoice", "date", "fee", "contact"].map((key) => ({ key }));
    expect(columnaDeOrdenes("fee", catalogo)).toBe(catalogo.find((o) => o.key === "fee"));
    expect(columnaDeOrdenes("status", catalogo)).toBe(catalogo.find((o) => o.key === "stage"));
    expect(columnaDeOrdenes("p_date", catalogo)).toBe(catalogo.find((o) => o.key === "date"));
    for (const k of ["invoice", "account", "store", "date", "p_type", "no_existe"]) expect(columnaDeOrdenes(k, catalogo), k).toBeUndefined();
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
  it("«Sin asignar» se pinta desde el catálogo, con la factura leída de la orden", () => {
    expect(pagina).toContain('const colsSinAsignar = columnasDeLaTabla("sinAsignar", colsGestor);');
    // Desde D-360 la factura es un enlace que abre la orden, y las cabeceras salen del juego con menú (el catálogo más el ID).
    expect(pagina.split('c.key === "invoice" ? (d.invoice_num ? <span {...abreLaOrden(d)}>{d.invoice_num}</span> : "—")').length - 1).toBe(1);
    expect(pagina).toContain("const menuSinAsignar: ColumnaConMenu[] = [COL_ID, ...colsSinAsignar.map(");
    expect(pagina).toContain("{menuSinAsignar.slice(1).map((c) => <th key={c.key}>");
    // La tabla de paradas por ruta la enseña bajo el código, si la columna está elegida.
    expect(pagina).toContain('{colsGestor.includes("invoice") && d.invoice_num && <div');
  });
  it("D-346: la dirección y la recogida se pintan en «Sin asignar», lo guardado de antes recibe las columnas nuevas, y la sugerencia de chofer ya no está", () => {
    expect(pagina.split('c.key === "address" ? <span title={d.delivery_address || undefined}>{d.delivery_address || "—"}</span>').length - 1).toBe(1);
    expect(pagina.split('c.key === "pickup" ? <span title={d.pickup_address || undefined}>{d.pickup_name || d.pickup_address || "—"}</span>').length - 1).toBe(1);
    expect(pagina).toContain("if (suyas) setColsGestor(conColumnasNuevas(suyas));");
    expect(pagina).not.toContain("suggestDriverFor");
    expect(pagina).not.toContain("same store, has room");
  });
  it("D-346: la tabla de paradas esconde por su puesto lo que la persona quitó — columna, cabecera y celda — y la dirección nace abierta", () => {
    expect(pagina).toContain("const paradasOcultas = indicesOcultosDeParadas(colsGestor);");
    expect(pagina).toContain("{stopCols.widths.slice(0, 7).map((w, i) => paradasOcultas.has(i) ? null : <col key={i}");
    for (const n of [2, 3, 4, 5, 6]) expect(pagina.split(`{!paradasOcultas.has(${n}) && <t`).length - 1, `puesto ${n}`).toBe(2);
    expect(pagina).toContain("const [addrWide, setAddrWide] = useState(true);");
  });
  it("D-NEXT: las columnas de Órdenes en paradas — col, cabecera y celda — entre «Ventanas» y las acciones, y los colSpan las cuentan", () => {
    expect(pagina).toContain("const paradasExtra = extrasDeParadas(colsGestor);");
    expect(pagina).toContain("const columnasDeParadas = 8 - paradasOcultas.size + paradasExtra.length;");
    // Los tres colSpan de las filas que ocupan la tabla entera (el viaje, el aviso, la fila informativa).
    expect(pagina.split("<td colSpan={columnasDeParadas}").length - 1).toBe(2);
    expect(pagina.split("<td colSpan={columnasDeParadas - 1}>").length - 1).toBe(1);
    expect(pagina).not.toMatch(/colSpan=\{[78] - paradasOcultas\.size\}/);
    const col = pagina.indexOf("{paradasExtra.map((c) => <col key={c.key} style={{ width: stopExtraCols.widthOf(c.deOrdenes!) }} />)}");
    expect(col).toBeGreaterThan(pagina.indexOf("{stopCols.widths.slice(0, 7).map("));
    expect(pagina.indexOf("<col style={{ width: stopCols.widths[7] }} />")).toBeGreaterThan(col);
    const th = pagina.indexOf("{paradasExtra.map((c) => <th key={c.key}>");
    expect(th).toBeGreaterThan(pagina.indexOf("{!paradasOcultas.has(6) && <th>"));
    const td = pagina.indexOf("{paradasExtra.map((c) => <td key={c.key} className={clasePastillas(c.key)}>{celdaDeOrdenes(c.key, d)}</td>)}");
    expect(td).toBeGreaterThan(pagina.indexOf("{!paradasOcultas.has(6) && <td>{fmtWindows(d.delivery_windows)}</td>}"));
    // El ancho suma las elegidas: sin esto, la tabla se queda con el ancho de antes y las columnas se aplastan.
    expect(pagina).toContain("+ paradasExtra.reduce((sum, c) => sum + stopExtraCols.widthOf(c.deOrdenes!), 0) }}>");
    expect(pagina).toContain('const stopExtraCols = useColWidthMap("rtg_routes_stops_extra1", 100);');
    expect(pagina).toContain('const stopCols = useColWidths("rtg_routes_stops7", [40, 96, 140, 70, 240, 56, 110, 150]);');
  });
  it("D-NEXT: «Sin asignar» pinta, ordena y filtra las de Órdenes con las funciones de Órdenes", () => {
    expect(pagina).toContain('import { ORDER_COLUMNS } from "@/components/OrdersTable";');
    expect(pagina).toContain("const ctxDeOrdenes = useMemo(() => ({ lang, t, motivos: motivosDeAnulacion(settings) }), [lang, t, settings]);");
    expect(pagina).toContain("const deOrdenes = useMemo(() => ({ catalogo: ORDER_COLUMNS, ctx: ctxDeOrdenes }), [ctxDeOrdenes]);");
    expect(pagina).toContain("const valorDelGestorAqui = useCallback((clave: string, d: Delivery) => valorDelGestor(clave, d, deOrdenes), [deOrdenes]);");
    expect(pagina).toContain("etiqueta: etiquetaDelGestor(c.key, deOrdenes)");
    expect(pagina).toContain("const celdaDeOrdenes = (clave: string, d: Delivery) => columnaDeOrdenes(clave, ORDER_COLUMNS)?.cell(d, ctxDeOrdenes);");
    expect(pagina).toContain('const clasePastillas = (clave: string) => (columnaDeOrdenes(clave, ORDER_COLUMNS)?.pastillas ? "td-pastillas" : undefined);');
    expect(pagina).toContain("<td key={c.key} className={clasePastillas(c.key)} onClick={c.key === \"date\"");
    expect(pagina).toContain("{c.deOrdenes ? celdaDeOrdenes(c.key, d) : c.key === \"invoice\"");
    // La pastilla de etapa que la página pintaba a mano se fue: la pinta la celda de Órdenes.
    expect(pagina).not.toContain("stageLabel(d.stage, lang)");
  });
  it("D-NEXT: «Sin asignar» usa el ancho de Órdenes en la tabla, en cada col y en el asa; y el hook lo respeta por debajo de lo arrastrado", () => {
    expect(pagina).toContain("const anchoEnSinAsignar = (clave: string) => poolCols.widthOf(`g_${clave}`, anchoDePartida(clave, COLUMN_WIDTHS));");
    expect(pagina).toContain("...colsSinAsignar.map((c) => anchoEnSinAsignar(c.key)), 116])");
    expect(pagina).toContain("{colsSinAsignar.map((c) => <col key={c.key} style={{ width: anchoEnSinAsignar(c.key) }} />)}");
    expect(pagina).toContain("onMouseDown={poolCols.startResize(`g_${c.key}`, anchoDePartida(c.key, COLUMN_WIDTHS))}");
    expect(pagina).not.toContain("poolCols.widthOf(`g_${c.key}`)");
    const hook = plano(leer("src/lib/use-col-widths.ts"));
    expect(hook).toContain("const widthOf = (key: string, porDefecto?: number) => widths[key] ?? COLUMN_WIDTHS[key] ?? porDefecto ?? defaultWidth;");
    expect(hook).toContain("const base = widths[key] ?? COLUMN_WIDTHS[key] ?? porDefecto ?? defaultWidth;");
  });
  it("D-NEXT: la pestaña «Programadas» ya no está, ni lo que colgaba de ella; su cuenta lleva a las rutas", () => {
    for (const muerto of ['"scheduled"', "setTab(\"scheduled\")", "colsProgramadas", "ordenProgramadas", "menuProgramadas", "schedCols", "rtg_routes_sched4", "const scheduled ="])
      expect(pagina, muerto).not.toContain(muerto);
    expect(pagina).toContain('const [tab, setTab] = useState<"routes" | "orders" | "board" | "timeline" | "incidents">("routes");');
    expect(pagina).toContain('{ n: scheduledCount, label: t("Scheduled", "Programadas"), target: "routes" as const },');
  });
  it("el selector marca y desmarca con la función probada, se cierra al hacer clic fuera, y nace con el defecto", () => {
    expect(pagina).toContain("const [colsGestor, setColsGestor] = useState<string[]>([...COLUMNAS_DEL_GESTOR_POR_DEFECTO]);");
    expect(pagina).toContain("const next = alternaColumna(colsGestor, key);");
    expect(pagina).toContain("useCierraAlSalir(verColsParadas, () => setVerColsParadas(false), () => [cajaDeColsParadas.current]);");
    expect(pagina).toContain("onChange={() => alternaColumnaDelGestor(c.key)}");
    // Cada ⚙ ofrece las de SU tabla, nuevas incluidas: ahí es donde se eligen.
    expect(pagina).toContain('{COLUMNAS_DEL_GESTOR.filter((c) => c.tablas.includes("paradas")).map((c) => (');
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
  // Esta prueba NO es de las columnas del Gestor: es la invariante COMPARTIDA de `user_prefs`, y
  // vive aquí porque aquí nació. Se actualiza cuando una migración nueva toca la restricción — la
  // 141 lo hizo, para RTG PROMOS — en vez de copiarla al fichero del módulo nuevo: dos copias de
  // «cuál es la última» acabarían señalando a dos migraciones distintas.
  it("la ÚLTIMA migración que toca esa restricción lleva exactamente las claves que usa el código", () => {
    const migraciones = readdirSync(join(process.cwd(), "supabase/migrations")).filter((f) => /^\d+_.*\.sql$/.test(f)).sort();
    const queLaTocan = migraciones.filter((f) => /add constraint user_prefs_key_permitida|constraint user_prefs_key_permitida check/.test(leer(`supabase/migrations/${f}`)));
    const ultima = queLaTocan[queLaTocan.length - 1];
    expect(ultima).toBe("141_user_prefs_promos_columns.sql");
    const ultimaPlana = plano(leer(`supabase/migrations/${ultima}`).split("\n").map((l) => l.replace(/--.*$/, "")).join("\n"));
    const lista = /constraint user_prefs_key_permitida check \(key in \(([^)]*)\)\)/.exec(ultimaPlana)![1].split(",").map((k) => k.trim().replace(/'/g, "")).sort();
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

describe("la carga y lo libre del viaje van a la décima (D-355, generalizado en D-362)", () => {
  it("el Gestor ya no redondea a mano: usa las funciones compartidas, y ninguna suma de pallets queda cruda", () => {
    const pagina = leer("src/app/(app)/routes/page.tsx");
    expect(pagina).toContain("const load = sumaPallets(batch);");
    expect(pagina).toContain("const free = aLaDecima(Math.max(0, capacity - load));");
    // D-362: la página no vuelve a sumar pallets por su cuenta, ni redondeando ni sin redondear.
    expect(pagina).not.toMatch(new RegExp("reduce" + String.fromCharCode(92) + "([^)]*actual_pallets"));
    // Lo que el dueño vio: 12 − (4 + 0.4 + 0.03) en coma flotante.
    expect(12 - (4 + 0.4 + 0.03)).not.toBe(7.57);
    expect(Math.round((12 - (4 + 0.4 + 0.03)) * 10) / 10).toBe(7.6);
  });
});
