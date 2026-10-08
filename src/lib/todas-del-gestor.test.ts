import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Delivery, Stage } from "@/lib/types";
import { cuentasDeTodas, entraEnTodas, filasDeTodas, todasDelGestor } from "./todas-del-gestor";
import { CHIPS_SIN_ASIGNAR, cuentasSinAsignar, filasSinAsignar, type ChipSinAsignar, type ModoDelGestor } from "./ordenes-del-dia";
import { CHOFER_DE_TODAS, COLUMNAS_DEL_GESTOR, COLUMNAS_DEL_GESTOR_POR_DEFECTO, ETAPA_EN_TODAS, anchoDePartida, columnaDeOrdenes, columnaDelGestor, columnasDeLaTabla, columnasDeTodas, columnasDelSelector, columnasDelSelectorDeTodas } from "./routes-columns";
import { valorDelGestor } from "./valores-del-gestor";
import { PANEL_DE_TODAS, PANEL_SIN_ASIGNAR, TODOS_LOS_CHOFERES, estaPlegada, nacePlegada } from "./vista-del-gestor";

/**
 * D-462 (2026-10-02): la pestaña «Todas (N)» del Gestor de Rutas. El dueño: «agrega el tab donde se mire la lista de
 * todas las ordenes para ese dia asignanada o no que ahi esten». Las reglas, sin pantalla; y que la pantalla las USA.
 */

const ETAPAS = ["pending", "approved", "fulfilling", "ready"];
const o = (id: string, delivery_date: string | null, order_no: number, stage: Stage = "approved", assigned_driver: string | null = null, mas: Partial<Delivery> = {}) =>
  ({ id, delivery_date, order_no, stage, assigned_driver, delivery_windows: null, delivery_lat: 26.2, account: null, delivery_address: null, delivery_phone: null, contact: null, store: null, route_seq: null, ...mas });
const DIA = [
  o("sin-chofer", "2026-09-19", 5),
  o("de-ana", "2026-09-19", 3, "ready", "Ana", { route_seq: 1, delivery_windows: "09:00-12:00" }),
  o("de-beto", "2026-09-19", 8, "approved", "Beto", { delivery_lat: null }),
  o("entregada-de-ana", "2026-09-19", 1, "delivered", "Ana", { route_seq: 0 }),
  o("recogida-de-beto", "2026-09-19", 7, "picked_up", "Beto", { route_seq: 0 }),
  o("entregada-ayer-de-ana", "2026-09-18", 2, "delivered", "Ana"),
  o("anulada-de-hoy", "2026-09-19", 9, "canceled", "Ana"),
  o("de-ayer", "2026-09-18", 4),
  o("de-ayer-con-chofer", "2026-09-18", 6, "approved", "Ana"),
  o("de-manana", "2026-09-20", 10, "approved", null, { account: "Casa Bella" }),
  o("sin-fecha", null, 11, "approved", "Beto"),
];
const ids = (xs: { id: string }[]) => xs.map((x) => x.id);
const filas = (chip: ChipSinAsignar, busqueda = "", filtro = TODOS_LOS_CHOFERES, modo: ModoDelGestor = "dia") => ids(filasDeTodas(DIA, "2026-09-19", modo, ETAPAS, chip, busqueda, filtro));

beforeAll(() => { vi.useFakeTimers(); vi.setSystemTime(new Date("2026-09-19T17:00:00Z")); });      // mediodía en Texas
afterAll(() => { vi.useRealTimers(); });

describe("qué filas tiene «Todas»", () => {
  it("«Este día»: lo pendiente del día CON chofer o SIN él, más lo ya entregado o recogido ese día; por número de orden", () => {
    expect(filas("dia")).toEqual(["entregada-de-ana", "de-ana", "sin-chofer", "recogida-de-beto", "de-beto"]);
  });
  it("ni lo anulado, ni lo de otro día (pendiente o entregado), ni lo sin fecha: cada día es aparte (D-331)", () => {
    for (const fuera of ["anulada-de-hoy", "de-ayer", "de-ayer-con-chofer", "entregada-ayer-de-ana", "de-manana", "sin-fecha"]) expect(filas("dia"), fuera).not.toContain(fuera);
  });
  it("la pestaña cuenta exactamente las filas de «Este día» sin búsqueda (misma función, nunca otra cuenta)", () => {
    expect(ids(todasDelGestor(DIA, "2026-09-19", "dia", ETAPAS))).toEqual(filas("dia"));
    expect(ids(todasDelGestor(DIA, "2026-09-19", "dia", ETAPAS, "Beto"))).toEqual(filas("dia", "", "Beto"));
  });
  it("es «Sin asignar» más lo asignado: sus filas del día son un subconjunto, y lo demás tiene chofer", () => {
    const sinAsignar = ids(filasSinAsignar(DIA, "2026-09-19", "dia", ETAPAS, "dia"));
    expect(sinAsignar).toEqual(["sin-chofer"]);
    const todas = filasDeTodas(DIA, "2026-09-19", "dia", ETAPAS, "dia");
    for (const id of sinAsignar) expect(ids(todas)).toContain(id);
    expect(todas.filter((d) => !sinAsignar.includes(d.id)).every((d) => !!d.assigned_driver)).toBe(true);
  });

  describe("el filtro de chofer de la barra: con un chofer, LAS SUYAS y LAS SIN ASIGNAR", () => {
    it("con «Todos» entra todo; con Ana, lo de Ana (pendiente y entregado) y lo sin chofer; nunca lo de Beto", () => {
      expect(entraEnTodas(TODOS_LOS_CHOFERES, "Beto")).toBe(true);
      expect(entraEnTodas("Ana", "Ana")).toBe(true);
      expect(entraEnTodas("Ana", null)).toBe(true);
      expect(entraEnTodas("Ana", "Beto")).toBe(false);
      expect(filas("dia", "", "Ana")).toEqual(["entregada-de-ana", "de-ana", "sin-chofer"]);
      expect(filas("dia", "", "Beto")).toEqual(["sin-chofer", "recogida-de-beto", "de-beto"]);
    });
    it("N cambia con el filtro: 5 con todos, 3 con Ana, 3 con Beto", () => {
      expect([TODOS_LOS_CHOFERES, "Ana", "Beto"].map((f) => todasDelGestor(DIA, "2026-09-19", "dia", ETAPAS, f).length)).toEqual([5, 3, 3]);
    });
  });

  describe("los chips, como en «Sin asignar» (D-393) pero sin la condición «sin chofer»", () => {
    it("«Todas las fechas»: lo pendiente de cualquier día, con chofer o sin él; sin lo hecho (sería toda la historia)", () => {
      expect(filas("todas")).toEqual(["de-ana", "de-ayer", "sin-chofer", "de-ayer-con-chofer", "de-beto", "de-manana", "sin-fecha"]);
    });
    it("«Expiradas»: lo vencido de cualquier día, con chofer o sin él", () => {
      expect(filas("overdue")).toEqual(["de-ayer", "de-ayer-con-chofer"]);
    });
    it("«Con ventana» y «Sin ubicación»: lo del día que cumple eso, hecho incluido", () => {
      expect(filas("windowed")).toEqual(["de-ana"]);
      expect(filas("noloc")).toEqual(["de-beto"]);
    });
    it("el filtro de chofer manda también en los otros chips", () => {
      expect(filas("todas", "", "Beto")).toEqual(["de-ayer", "sin-chofer", "de-beto", "de-manana", "sin-fecha"]);
      expect(filas("overdue", "", "Beto")).toEqual(["de-ayer"]);
    });
    it("la búsqueda entra en todos, y el número de cada chip es el largo de SUS filas con la misma búsqueda y el mismo filtro", () => {
      expect(filas("todas", "casa")).toEqual(["de-manana"]);
      expect(filas("dia", "8")).toEqual(["de-beto"]);
      for (const filtro of [TODOS_LOS_CHOFERES, "Ana"]) for (const busqueda of ["", "casa", "8", "nadie"]) {
        const cuentas = cuentasDeTodas(DIA, "2026-09-19", "dia", ETAPAS, busqueda, filtro);
        for (const chip of CHIPS_SIN_ASIGNAR) expect(cuentas[chip], `${chip} «${busqueda}» ${filtro || "todos"}`).toBe(filas(chip, busqueda, filtro).length);
      }
      expect(cuentasDeTodas(DIA, "2026-09-19", "dia", ETAPAS)).toEqual({ dia: 5, todas: 7, overdue: 2, windowed: 1, noloc: 1 });
      // Y no son los números de «Sin asignar»: aquí entra lo asignado.
      expect(cuentasSinAsignar(DIA, "2026-09-19", "dia", ETAPAS)).toEqual({ dia: 1, todas: 3, overdue: 1, windowed: 0, noloc: 0 });
    });
  });

  it("viendo «todas las fechas» arriba (modo «todas») el chip del día es todo lo pendiente, y nada hecho (D-459)", () => {
    expect(filas("dia", "", TODOS_LOS_CHOFERES, "todas")).toEqual(filas("todas"));
  });
});

describe("las columnas de «Todas»: las de «Sin asignar» con el Chofer delante y la Etapa siempre", () => {
  it("son exactamente las elegidas de «Sin asignar», en su orden, con «chofer» delante", () => {
    const sinAsignar = columnasDeLaTabla("sinAsignar", COLUMNAS_DEL_GESTOR_POR_DEFECTO).map((c) => c.key);
    expect(columnasDeTodas(COLUMNAS_DEL_GESTOR_POR_DEFECTO).map((c) => c.key)).toEqual(["chofer", ...sinAsignar]);
    expect(columnasDeTodas(COLUMNAS_DEL_GESTOR_POR_DEFECTO)[0]).toBe(CHOFER_DE_TODAS);
    // Y siguen el orden de la persona, como «Sin asignar».
    const movido = ["windows", "invoice"];
    expect(columnasDeTodas(COLUMNAS_DEL_GESTOR_POR_DEFECTO, movido).map((c) => c.key).slice(0, 3)).toEqual(["chofer", "windows", "invoice"]);
  });
  it("quien quitó la Etapa de «Sin asignar» la ve igual en «Todas», en su puesto; y en su ⚙ sale marcada y apagada", () => {
    const sinEtapa = COLUMNAS_DEL_GESTOR_POR_DEFECTO.filter((k) => k !== ETAPA_EN_TODAS);
    expect(columnasDeLaTabla("sinAsignar", sinEtapa).map((c) => c.key)).not.toContain("status");
    const todas = columnasDeTodas(sinEtapa).map((c) => c.key);
    expect(todas).toContain("status");
    expect(todas.indexOf("status")).toBe(columnasDeTodas(COLUMNAS_DEL_GESTOR_POR_DEFECTO).map((c) => c.key).indexOf("status"));
    expect(columnasDelSelectorDeTodas(null).find((c) => c.key === "status")).toMatchObject({ fija: true });
    expect(columnasDelSelector("sinAsignar", null).find((c) => c.key === "status")?.fija).toBeUndefined();
    // Lo demás del ⚙ es el de «Sin asignar», tal cual (mismas claves, mismo orden).
    expect(columnasDelSelectorDeTodas(null).map((c) => c.key)).toEqual(columnasDelSelector("sinAsignar", null).map((c) => c.key));
  });
  it("«Chofer» vive fuera del catálogo (no se elige, no se guarda), toma la celda, el valor y el ancho de la «Chofer» de Órdenes", () => {
    expect(COLUMNAS_DEL_GESTOR.some((c) => c.key === "chofer")).toBe(false);
    expect(COLUMNAS_DEL_GESTOR_POR_DEFECTO).not.toContain("chofer");
    expect(CHOFER_DE_TODAS).toMatchObject({ key: "chofer", es: "Chofer", deOrdenes: "driver", fija: true, tablas: [] });
    expect(columnaDelGestor("chofer")).toBe(CHOFER_DE_TODAS);
    expect(columnaDelGestor("status")?.key).toBe("status");
    expect(columnaDelGestor("nada")).toBeUndefined();
    const catalogo = [{ key: "driver", value: (d: Delivery) => d.assigned_driver, cell: (d: Delivery) => d.assigned_driver || "—" }];
    expect(columnaDeOrdenes("chofer", catalogo)?.key).toBe("driver");
    expect(anchoDePartida("chofer", { driver: 120, stage: 108 })).toBe(120);
    const orden = { ...o("x", "2026-09-19", 1, "approved", "Ana") } as unknown as Delivery;
    expect(valorDelGestor("chofer", orden, { catalogo, ctx: {} })).toBe("Ana");
    expect(valorDelGestor("chofer", { ...orden, assigned_driver: null }, { catalogo, ctx: {} })).toBeNull();
  });
  it("la tabla de «Todas» nace abierta, como «Sin asignar»; las tarjetas de chofer siguen naciendo plegadas", () => {
    expect(nacePlegada(PANEL_DE_TODAS)).toBe(false);
    expect(nacePlegada(PANEL_SIN_ASIGNAR)).toBe(false);
    expect(nacePlegada("Ana")).toBe(true);
    expect(estaPlegada(PANEL_DE_TODAS, new Set())).toBe(false);
    expect(estaPlegada(PANEL_DE_TODAS, new Set([PANEL_DE_TODAS]))).toBe(true);
  });
});

describe("la pantalla", () => {
  const leer = (ruta: string) => readFileSync(join(process.cwd(), ruta), "utf8").split("\r\n").join("\n");
  const plano = (s: string) => s.replace(/\s+/g, " ");
  const pagina = plano(leer("src/app/(app)/routes/page.tsx"));
  const corta = (desde: string, hasta: string) => { const i = pagina.indexOf(desde); const j = i < 0 ? -1 : pagina.indexOf(hasta, i + desde.length); return j < 0 ? "" : pagina.slice(i, j); };
  const barra = corta("<div data-barra-de-vistas", "{incidenciasAbiertas && (");
  const comun = corta("const tablaDeOrdenes = (vista: VistaDeOrdenes) => {", "const vistaDeSinAsignar: VistaDeOrdenes = {");
  const fila = corta("const fila = (d: Delivery) => {", "return ( <div className=\"card\" data-tabla-de-ordenes={vista.clave}");

  it("la pestaña «Todas (N)» está entre «Sin asignar» y «Tablero», y respeta el orden de la barra (D-459)", () => {
    const puestos = ["data-filtro-de-chofer", 'data-pestana="routes"', 'data-pestana="orders"', 'data-pestana="todas"', 'data-pestana="board"', 'data-pestana="timeline"', "data-cuadricula", "data-deshacer", "data-rehacer", "data-abrir-incidencias"].map((x) => barra.indexOf(x));
    expect(puestos.every((p) => p > -1)).toBe(true);
    expect(puestos).toEqual([...puestos].sort((a, b) => a - b));
    expect(barra).toContain('📋 {t("All", "Todas")} (<span data-cuenta-todas>{todasDelDia.length}</span>)');
    expect(pagina).toContain('useState<"routes" | "orders" | "todas" | "board" | "timeline">("routes")');
  });
  it("N sale de `todasDelGestor` SIN el filtro de choferes: todas son todas (D-499)", () => {
    expect(pagina).toContain("const todasDelDia = useMemo(() => todasDelGestor(deliveries, date, modo, ROUTE_STAGES, sinFiltroDeChofer), [deliveries, date, modo, sinFiltroDeChofer]);");
    expect(barra).not.toContain("y las sin asignar`");
    expect(barra).toContain("`${todasDelDia.length} orden(es) este día, con chofer o sin él, entregadas incluidas`");
  });
  it("la tabla y sus chips salen de `filasDeTodas` y `cuentasDeTodas` con su chip, su búsqueda y el mismo filtro", () => {
    expect(pagina).toContain('const filasDeTodasDelChip = useMemo(() => filasDeTodas(deliveries, date, modo, ROUTE_STAGES, chipDeTodas, "", sinFiltroDeChofer)');
    expect(pagina).toContain("const todasConBusqueda = useMemo(() => filasDeTodas(deliveries, date, modo, ROUTE_STAGES, chipDeTodas, busquedaDeTodas, sinFiltroDeChofer)");
    expect(pagina).toContain("const cuentasDeTodasAqui = useMemo(() => cuentasDeTodas(deliveries, date, modo, ROUTE_STAGES, busquedaDeTodas, sinFiltroDeChofer)");
    expect(pagina).toContain("filas: filasDeTodasDelChip, conBusqueda: todasConBusqueda, orden: ordenDeTodas,");
    expect(pagina).toContain("const ordenDeTodas = useOrdenYFiltro(todasConBusqueda, valorDelGestorAqui);");
    expect(pagina).toContain('useState<ChipSinAsignar>("dia")');
  });
  it("las dos columnas extra: `columnasDeTodas` para la tabla y `columnasDelSelectorDeTodas` para su ⚙, con los anchos de «Sin asignar»", () => {
    expect(pagina).toContain("const colsTodas = columnasDeTodas(colsGestor, ordenGestor);");
    expect(pagina).toContain("const menuDeTodas: ColumnaConMenu[] = colsTodas.map((c) => ({ ...c, etiqueta: etiquetaDelGestor(c.key, deOrdenes) }));");
    expect(pagina).toContain("columnas: colsTodas, menu: menuDeTodas, selector: columnasDelSelectorDeTodas(ordenGestor),");
    expect(comun).toContain("...columnas.map((c) => anchoEnSinAsignar(c.key)), vista.anchoDeAcciones])");
    // La última columna: «Asignar a» cabe en 116 (lo de siempre); «Asignar / pasar» pide 136 (medido: 118 a 1440 y 130 a 390 no cabían en 116).
    expect(pagina).toContain("cabeceraDeAcciones: t(\"Assign / move\", \"Asignar / pasar\"), anchoDeAcciones: 136,");
    // La celda del chofer es la de Órdenes, por `deOrdenes`, como las demás que vienen de allí.
    expect(fila).toContain("{c.deOrdenes ? celdaDeOrdenes(c.key, d)");
  });
  it("UNA tabla para las dos pestañas: `tablaDeOrdenes` se pinta con cada vista, y el marcado de la tabla está una sola vez", () => {
    expect(pagina).toContain('{tab === "orders" && tablaDeOrdenes(vistaDeSinAsignar)}');
    expect(pagina).toContain('{tab === "todas" && tablaDeOrdenes(vistaDeTodas)}');
    expect(pagina.split("tablaDeOrdenes(").length - 1).toBe(2);
    expect(pagina.split('<table className="orders tbl-resize" style={anchoDeTabla(').length - 1).toBe(1);
    expect(pagina.split("data-elige-conductor role=\"group\"").length - 1).toBe(1);
    expect(pagina.split('data-chip={f}').length - 1).toBe(1);
    // Las dos vistas comparten las columnas elegidas, el orden, las plantillas y las flechas de «Sin asignar».
    expect(comun).toContain('mover={moverEn("sinAsignar")}');
    expect(comun).toContain("elegidas={colsGestor} onAlterna={alternaColumnaDelGestor}");
    expect(pagina).toContain('clave: "sinAsignar", panel: PANEL_SIN_ASIGNAR,');
    expect(pagina).toContain('clave: "todas", panel: PANEL_DE_TODAS,');
  });
  it("cada fila decide: sin chofer, casilla, arrastre y «Asignar a…»; con chofer, «Pasar a…» (`pasaA`, con deshacer); hecha, ✓ y nada", () => {
    expect(fila).toContain("const hecha = ETAPAS_HECHAS.has(d.stage);");
    expect(fila).toContain("const sinChofer = !d.assigned_driver;");
    // Puesto al día por D-481: en «Ruta de hoy» (solo lectura) ni arrastre, ni casilla, ni «Asignar a…», ni «Pasar a…».
    expect(fila).toContain('data-fila-arrastrable={sinChofer && !soloLectura ? "orden" : undefined} {...(sinChofer && !soloLectura ? filaArrastrable({ tipo: "orden", id: d.id }) : {})}>');
    expect(fila).toContain("onClick={hecha ? undefined : () => toggleOrder(d.id)}");
    expect(fila).toContain('<span data-hecha={entregada ? "hecho" : "en_camino"} style={{ fontWeight: 700 }}>{entregada ? "✓" : "🚚"}</span>');
    expect(fila).toContain('className={`${marcada ? "row-selected" : ""}${hecha ? ` fila-hecha${entregada ? " row-done" : ""}` : ""}`}');
    expect(fila).toContain("const hora = entregada ? horaReal(d, \"D\") : null;");
    expect(fila).toContain("{hecha || soloLectura ? null : sinChofer ? (");
    expect(fila).toContain("<select defaultValue=\"\" data-asignar-a onChange={(e) => {");
    expect(fila).toContain("else manualAssign(d.id, target);");
    expect(fila).toContain("ruta && lanes.some((l) => l.key !== ruta) ? (");
    expect(fila).toContain('if (v) void pasaA(ruta, [d.id], v); }} style={{ width: "auto" }}>');
    expect(fila).toContain("{lanes.filter((l) => l.key !== ruta).map((l) => <option key={l.key} value={l.key}>{l.label}</option>)}");
    expect(fila).toContain("const ruta = sinChofer ? null : orderLaneKey(d);");
    // «Seleccionar todo» no marca lo hecho.
    expect(comun).toContain("const marcables = orden.visibles.filter((d) => !ETAPAS_HECHAS.has(d.stage));");
  });
  it("lo marcado para «Asignar» y «Mejor lugar» son las filas SIN CHOFER de la tabla que se ve", () => {
    expect(pagina).toContain('const filasAsignables = useMemo(() => (tab === "todas" ? filasDeTodasDelChip.filter((d) => !d.assigned_driver) : filasDelChip), [tab, filasDeTodasDelChip, filasDelChip]);');
    expect(pagina).toContain("() => filasAsignables.reduce((n, d) => n + (selectedOrders.has(d.id) ? 1 : 0), 0),");
    expect(pagina).toContain("const ids = filasAsignables.filter((d) => selectedOrders.has(d.id)).map((d) => d.id);");
  });
  it("el chip de cualquier día se llama «Todas las fechas» en «Todas» (la pestaña ya se llama «Todas») y «Todas» en «Sin asignar»", () => {
    expect(pagina).toContain('rotuloDelChip: (f) => rotuloDelChip(f, t("All dates", "Todas las fechas")),');
    expect(pagina).toContain('rotuloDelChip: (f) => rotuloDelChip(f, t("All", "Todas")),');
  });
});
