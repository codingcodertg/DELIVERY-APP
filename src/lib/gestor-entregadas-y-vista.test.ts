import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { filasConLoHecho, hechasQueSePintan, horaReal, resumenDeEntregas, type FilaPintada, type OrdenHecha } from "./hechas-del-gestor";
import { botonDeVolver, HISTORIAL_VACIO, type Historial, type Movimiento } from "./arrastre-de-paradas";
import { lecturaDeLaRuta, type OrdenAsignada, type ParadaDelPlanMinima } from "./route-plan/lectura-de-ruta";
import { estadoDelPlan, textoDelEstadoDelPlan } from "./route-plan/estado-del-plan";
import { ANCHO_FIJO_DE_PARADAS } from "./routes-columns";

/**
 * D-459 (2026-10-01): nueve pedidos del dueño sobre el Gestor de Rutas, el mismo día.
 *  1 · lo ya entregado SIGUE en la lista de su chofer            6 · fuera la franja «Programadas · Sin programar · Total · Rutas»
 *  2 · la celda de acciones, descuadrada (`display: flex` en el td) 7 · ↶ ↷ a la vista en la tarjeta de cada ruta
 *  3 · el ID al lado de la factura, no debajo                      8 · fuera el texto de sobra de la tarjeta
 *  4 · «Armar rutas»: un solo botón, y sin «Mostrar avisos ocultos» arriba   9 · el filtro de chofer, junto a «Horario»
 *  5 · «Cuadrícula» junto a «Horario»
 * Las reglas, sin pantalla; y que la pantalla las USA (se alimentan de quien llama).
 */

const leer = (ruta: string) => readFileSync(join(process.cwd(), ruta), "utf8").split("\r\n").join("\n");
const plano = (s: string) => s.replace(/\s+/g, " ");
const pagina = plano(leer("src/app/(app)/routes/page.tsx"));
const css = plano(leer("src/app/globals.css"));
const trozo = (desde: string, hasta: string, de = pagina) => {
  const i = de.indexOf(desde);
  expect(i, `no está: ${desde}`).toBeGreaterThan(-1);
  const j = de.indexOf(hasta, i + desde.length);
  expect(j, `no está: ${hasta}`).toBeGreaterThan(i);
  return de.slice(i, j);
};

const pend = (id: string, route_seq: number | null, mas: Partial<OrdenAsignada> = {}): OrdenAsignada => ({ id, store: "T", est_pallets: 1, route_seq, ...mas });
const hecha = (id: string, route_seq: number | null, stage = "delivered", mas: Partial<OrdenHecha> = {}): OrdenHecha => ({ id, store: "T", est_pallets: 1, route_seq, stage, ...mas });
/** Cómo se lee una lista pintada: «✓P:a» una hecha, «~D:a» una entrega en camino, «P1#0» una pendiente con su etiqueta y su índice. */
const lee = (filas: FilaPintada[]) => filas.map((f) => (f.hecha ? `${f.estado === "hecho" ? "✓" : "~"}${f.tipo}:${f.orden}` : `${f.fila.etiqueta}#${f.i}`));

describe("1 · lo ya hecho SIGUE en la lista de su chofer (D-433 lo contaba sin pintarlo)", () => {
  describe("qué hechas se pintan", () => {
    const todas = [
      { id: "a", stage: "delivered", assigned_driver: "Ana", delivery_date: "2026-10-01", route_seq: 2, order_no: 1 },
      { id: "b", stage: "picked_up", assigned_driver: "Ana", delivery_date: "2026-10-01", route_seq: 0, order_no: 2 },
      { id: "c", stage: "ready", assigned_driver: "Ana", delivery_date: "2026-10-01", route_seq: 1, order_no: 3 },
      { id: "d", stage: "delivered", assigned_driver: "Ana", delivery_date: "2026-09-30", route_seq: 0, order_no: 4 },
      { id: "e", stage: "delivered", assigned_driver: null, delivery_date: "2026-10-01", route_seq: null, order_no: 5 },
      { id: "f", stage: "delivered", assigned_driver: "Beto", delivery_date: "2026-10-01", route_seq: null, order_no: 6 },
      { id: "g", stage: "canceled", assigned_driver: "Ana", delivery_date: "2026-10-01", route_seq: 5, order_no: 7 },
      { id: "h", stage: "delivered", assigned_driver: "Ana", delivery_date: "2026-10-01", route_seq: null, order_no: 8 },
    ];
    it("las recogidas y las entregadas del chofer ESE día: ni lo pendiente, ni lo de otro día, ni lo sin chofer, ni lo anulado", () => {
      const m = hechasQueSePintan(todas, "2026-10-01", "dia");
      expect([...m.keys()].sort()).toEqual(["Ana", "Beto"]);
      expect(m.get("Beto")!.map((d) => d.id)).toEqual(["f"]);
      expect(m.get("Ana")!.map((d) => d.id).sort()).toEqual(["a", "b", "h"]);
    });
    it("en el orden en que iban: la que no tiene puesto, delante; las demás, por su puesto", () => {
      expect(hechasQueSePintan(todas, "2026-10-01", "dia").get("Ana")!.map((d) => d.id)).toEqual(["h", "b", "a"]);
    });
    it("viendo «todas las fechas» o lo atrasado no se pinta nada hecho: ahí la lista de un chofer mezcla días", () => {
      expect(hechasQueSePintan(todas, "2026-10-01", "todas").size).toBe(0);
      expect(hechasQueSePintan(todas, "2026-10-01", "pendientes").size).toBe(0);
    });
  });

  describe("dónde va cada fila hecha", () => {
    it("sin nada hecho, la lista es la de siempre, fila a fila y con su índice", () => {
      const pendientes = [pend("b", 0), pend("c", 1)];
      const lectura = lecturaDeLaRuta(pendientes, 12, null);
      const filas = filasConLoHecho(lectura, pendientes, [], 12, null);
      expect(filas).toEqual(lectura.filas.map((fila, i) => ({ hecha: false, fila, i })));
    });
    it("una entregada se queda donde iba: su recogida entre las recogidas, su entrega delante de las pendientes", () => {
      const pendientes = [pend("b", 1), pend("c", 2)];
      const lectura = lecturaDeLaRuta(pendientes, 12, null);
      // La lista del día entera (la que ve el chofer): P a · P b · P c · D a · D b · D c.
      expect(lee(filasConLoHecho(lectura, pendientes, [hecha("a", 0)], 12, null))).toEqual(["✓P:a", "P1#0", "P2#1", "✓D:a", "D1#2", "D2#3"]);
    });
    it("una entregada a MITAD de la ruta sale a mitad, no arriba", () => {
      const pendientes = [pend("a", 0), pend("c", 2)];
      const lectura = lecturaDeLaRuta(pendientes, 12, null);
      expect(lee(filasConLoHecho(lectura, pendientes, [hecha("b", 1)], 12, null))).toEqual(["P1#0", "✓P:b", "P2#1", "D1#2", "✓D:b", "D2#3"]);
    });
    it("las pendientes son EXACTAMENTE las de la lectura, en su orden y con su índice: las hechas solo se intercalan", () => {
      const pendientes = [pend("a", 0), pend("c", 2), pend("e", 4), pend("z", null)];
      const lectura = lecturaDeLaRuta(pendientes, 2, null);
      const filas = filasConLoHecho(lectura, pendientes, [hecha("b", 1), hecha("d", 3, "picked_up"), hecha("y", null)], 2, null);
      const suyas = filas.filter((f): f is Extract<FilaPintada, { hecha: false }> => !f.hecha);
      expect(suyas.map((f) => f.fila)).toEqual(lectura.filas);
      expect(suyas.map((f) => f.i)).toEqual(lectura.filas.map((_, i) => i));
      // Y cada hecha, una recogida y una entrega, ni más ni menos.
      expect(filas.filter((f) => f.hecha).map((f) => (f.hecha ? `${f.tipo}:${f.orden}` : "")).sort()).toEqual(["D:b", "D:d", "D:y", "P:b", "P:d", "P:y"]);
    });
    it("con el MISMO puesto guardado en una hecha y una pendiente (el empate que midió D-433), la hecha va delante", () => {
      const pendientes = [pend("b", 1)];
      const lectura = lecturaDeLaRuta(pendientes, 12, null);
      expect(lee(filasConLoHecho(lectura, pendientes, [hecha("a", 1)], 12, null))).toEqual(["✓P:a", "P1#0", "✓D:a", "D1#1"]);
    });
    it("una hecha SIN puesto va arriba del todo, con su recogida y su entrega: ya pasó", () => {
      const pendientes = [pend("b", 0)];
      const lectura = lecturaDeLaRuta(pendientes, 12, null);
      expect(lee(filasConLoHecho(lectura, pendientes, [hecha("a", null)], 12, null))).toEqual(["✓P:a", "✓D:a", "P1#0", "D1#1"]);
    });
    it("una RECOGIDA y aún sin entregar: su recogida está hecha; su entrega va «en camino», que tampoco se mueve", () => {
      const pendientes = [pend("b", 1)];
      const lectura = lecturaDeLaRuta(pendientes, 12, null);
      expect(lee(filasConLoHecho(lectura, pendientes, [hecha("a", 0, "picked_up")], 12, null))).toEqual(["✓P:a", "P1#0", "~D:a", "D1#1"]);
    });
    it("con la ruta tal como la publicó el plan, el sitio de cada hecha es el del PLAN; una orden en dos cargas, una fila de cada", () => {
      const plan: ParadaDelPlanMinima[] = [
        { kind: "P", order_ref: "a", seq: 0, label: "P1", load_after: 1 }, { kind: "P", order_ref: "b", seq: 1, label: "P2", load_after: 2 },
        { kind: "D", order_ref: "b", seq: 2, label: "D2", load_after: 1 }, { kind: "D", order_ref: "a", seq: 3, label: "D1", load_after: 0.5 },
        { kind: "P", order_ref: "a#b", seq: 4, label: "P3", load_after: 1 }, { kind: "D", order_ref: "a#b", seq: 5, label: "D3", load_after: 0 },
      ];
      const pendientes = [pend("b", 0)];
      const hechas = [hecha("a", 1)];
      const lectura = lecturaDeLaRuta(pendientes, 12, plan, hechas);
      expect(lectura.fuente).toBe("plan");
      expect(lee(filasConLoHecho(lectura, pendientes, hechas, 12, plan))).toEqual(["✓P:a", "P2#0", "D2#1", "✓D:a"]);
    });
    it("aunque la lista del día no cuadre con la lectura, NINGUNA fila pendiente se pierde: las que sobran, al final", () => {
      const lectura = lecturaDeLaRuta([pend("b", 1), pend("c", 2)], 12, null);
      // A la función le llega una lista de pendientes corta (falta «c»): la lista del día solo tiene hueco para «b».
      expect(lee(filasConLoHecho(lectura, [pend("b", 1)], [hecha("a", 0)], 12, null))).toEqual(["✓P:a", "P1#0", "✓D:a", "P2#1", "D1#2", "D2#3"]);
    });
    it("una ruta que ya lo entregó todo: solo filas hechas", () => {
      const lectura = lecturaDeLaRuta([], 12, null);
      expect(lee(filasConLoHecho(lectura, [], [hecha("a", 0), hecha("b", 1)], 12, null))).toEqual(["✓P:a", "✓P:b", "✓D:a", "✓D:b"]);
    });
  });

  it("«3 de 7 entregadas»: lo entregado contra TODO lo del chofer ese día; lo recogido aún no cuenta como entregado", () => {
    expect(resumenDeEntregas([1, 2, 3], [{ stage: "delivered" }, { stage: "delivered" }, { stage: "delivered" }, { stage: "picked_up" }])).toEqual({ entregadas: 3, total: 7 });
    expect(resumenDeEntregas([], [{ stage: "delivered" }])).toEqual({ entregadas: 1, total: 1 });
  });
  it("la hora REAL, en el huso del negocio: la de la entrega en la fila D, la de la recogida en la P; sin dato, nada", () => {
    const o = { pod_delivered_at: "2026-10-01T15:42:00.000Z", pickup_gps_at: "2026-10-01T13:05:00.000Z" };
    expect(horaReal(o, "D")).toBe("10:42");
    expect(horaReal(o, "P")).toBe("08:05");
    expect(horaReal({ pod_delivered_at: null }, "D")).toBeNull();
    expect(horaReal({ pod_delivered_at: "no es una fecha" }, "D")).toBeNull();
    expect(horaReal({ pod_delivered_at: "2026-10-01T15:42:00.000Z" }, "P")).toBeNull();
  });

  describe("la pantalla", () => {
    it("pinta lo hecho del día de cada chofer, intercalado en su lista, y la tarjeta sigue aunque no quede nada pendiente", () => {
      expect(pagina).toContain("const hechasPintadas = useMemo(() => hechasQueSePintan(deliveries, date, modo), [deliveries, date, modo]);");
      expect(pagina).toContain("const hechasDe = (laneKey: string): Delivery[] => hechasPintadas.get(laneKey) ?? [];");
      expect(pagina).toContain("const pintadas = filasConLoHecho(lectura, stops, hechas, capacity, paradasPublicadasDe(u.key));");
      expect(pagina).toContain("{pintadas.map((fp) => { if (fp.hecha) return filaYaHecha(fp); const f = fp.fila; const fi = fp.i;");
      expect(pagina).toContain("const shownDrivers = lanesDelFiltro.filter((u) => conAlgoQuePintar(u.key));");
      expect(pagina).toContain("const hayFilas = stops.length > 0 || hechas.length > 0;");
      expect(pagina).toContain("{hayFilas && ( <> <BarraSuperior caja={cajaDeParadas(u.key)} />");
    });
    it("la fila hecha: ✓, el verde de `row-done`, la hora real, y NINGÚN control —ni flechas, ni «Pasar a…», ni ✕, ni arrastre, ni sitio donde soltar—", () => {
      const fila = trozo("const filaYaHecha = (fp: Extract<FilaPintada, { hecha: true }>) => {", "// Nadie la ordenó");
      expect(fila).toContain('className={hecho ? "row-done fila-hecha" : "fila-hecha"}');
      expect(fila).toContain('{hecho ? "✓" : "🚚"}{fp.tipo}</td>');
      expect(fila).toContain("const hora = hecho ? horaReal(d, fp.tipo) : null;");
      expect(fila).toContain("data-hora-real={hora ?? \"\"}");
      expect(fila).toContain("{facturaConSuId(d)}{etiquetaDeLaCarga(d)}");
      expect(fila).toContain('<td className="celda-acciones" />');
      for (const control of ["<button", "<select", "mueveParada", "pasaA(", "unassign(", "filaArrastrable", "sueltaAqui", "draggable", "onClick"]) expect(fila, control).not.toContain(control);
    });
    it("lo que mueve, cuenta y mide la ruta sigue trabajando SOLO sobre lo pendiente (el puesto de lo hecho es fijo, D-433)", () => {
      // La lectura, la cuenta de pallets, Optimizar y la medida salen de `stops` (lo pendiente), no de lo pintado.
      expect(pagina).toContain("const cuenta = cuentaDePallets(lectura.filas.map((f) => f.cambio), capacity);");
      const optimiza = trozo("const optimizaLaRuta = async (laneKey: string) => {", "// Friendly display name for a lane key.");
      expect(optimiza).toContain("const stops = byDriver.get(laneKey) ?? [];");
      expect(optimiza).toContain("const lista = lecturaDe(laneKey, stops).paradas;");
      expect(optimiza).not.toContain("hechasDe(");
      const guarda = trozo("const guardaLaLista = async (", "/** La fila de la Base");
      expect(guarda).toContain("const desde = inicioDeLaRuta(laneKey, stops);");      // numera TRAS lo hecho, sin reescribirlo
      expect(pagina).toContain("const dayOrders = useMemo(() => ordenesDelDia(deliveries, date, modo, ROUTE_STAGES), [deliveries, date, modo]);");
    });
    it("«3 de 7 entregadas» en la cabecera de la tarjeta, sin tocar la cuenta de lo pendiente", () => {
      expect(pagina).toContain("const entregas = resumenDeEntregas(stops, hechas);");
      expect(pagina).toContain("{hechas.length > 0 && ( <span className=\"sema\" data-resumen-de-entregas");
      expect(pagina).toContain("✓ {t(`${entregas.entregadas} of ${entregas.total} delivered`, `${entregas.entregadas} de ${entregas.total} entregadas`)}");
      expect(pagina).toContain('<span className="count-tag">{stops.length} {t("orders", "órdenes")}</span>');
    });
    it("en el mapa su pin queda como hecho: ✓ y apagado; y no es una parada que se pueda marcar", () => {
      const pines = trozo("for (const [laneKey, lista] of hechasPintadas) {", "// Pickup (\"P\") pin for each selected load");
      expect(pines).toContain("id: `__hecha__${d.id}`");
      expect(pines).toContain('badge: entregada ? "✓" : "🚚"');
      expect(pines).toContain("dimmed: entregada || isDim(laneKey) || selActive,");
      expect(pines).toContain("if (!pasaFiltro(laneKey)) continue;");
    });
    it("«Vaciar» no se lleva lo ya recogido o entregado", () => {
      const vaciar = trozo("const clearLane = async (laneKey: string) => {", "// Drivers on vacation/sick/maintenance");
      expect(vaciar).toContain('const stops = deliveries.filter((d) => (d.assigned_driver || "") === laneKey && !ETAPAS_HECHAS.has(d.stage));');
    });
    it("el tono apagado de la fila hecha está en la hoja de estilos", () => {
      expect(css).toContain("table.orders tr.fila-hecha td { color: var(--ink-soft); }");
      expect(css).toContain("table.orders tr.row-done td { background: #e9f7f0; }");
    });
  });
});

describe("2 · la celda de acciones es una celda de tabla: el flex va DENTRO («look theres a glitch»)", () => {
  it("ningún <td> de la página lleva `display: flex`", () => {
    expect(pagina).not.toMatch(/<td\b[^>]*display: "flex"/);
  });
  it("las filas con botones (P y D) envuelven sus acciones en un div; las que no (otra carga, Base, hecha) llevan la celda vacía", () => {
    expect(pagina.split('<td className="celda-acciones" onClick={(e) => e.stopPropagation()}> <div className="acciones-de-parada">').length - 1).toBe(2);
    expect(pagina).toContain('<div className="acciones-de-parada">{flechas}{pasar}</div>');
    expect(pagina).toContain('<div className="acciones-de-parada"> {flechas}{pasar}{botonesDeCarga(d, capacity)}');
    expect(pagina.split('<td className="celda-acciones" />').length - 1).toBe(3);
    // La última celda de TODAS las filas de la tabla de paradas es `celda-acciones`: ninguna se quedó con un <td /> suelto.
    const tabla = trozo('<table className="orders tbl-resize tabla-de-paradas"', "</table>");
    expect(tabla).not.toContain("<td /> </tr>");
    expect(trozo("const filaDeLaBase = (", "/** La clave de una fila de la lista")).toContain('<td className="celda-acciones" /> </tr>');
  });
  it("el flex, el desplegable sin cortar y el MISMO alto en todas las filas están en la hoja de estilos", () => {
    expect(css).toContain(".acciones-de-parada { display: flex; gap: 3px; justify-content: flex-end; align-items: center; }");
    expect(css).toContain("table.orders.tabla-de-paradas td.celda-acciones { overflow: visible; }");
    expect(css).toContain("table.orders.tabla-de-paradas tbody td { height: 34px; }");
    expect(css).toContain("@media (max-width: 640px) { table.orders.tabla-de-paradas tbody td { height: 47px; } }");
    // La raya de inicio de grupo ya no es un borde (hacía esas filas más altas): es una sombra hacia dentro.
    expect(css).toContain("table.orders tr.fila-grupo-inicio.fila-grupo-recoger td { box-shadow: inset 0 2px 0 var(--green); }");
    expect(css).not.toContain("tr.fila-grupo-inicio.fila-grupo-recoger td { border-top");
  });
});

describe("3 · el ID al lado de la factura, en la misma línea, sin subrayar («dont make the row larger just fix the view»)", () => {
  it("la celda: la factura con el gesto de enlace y, dentro del mismo renglón, el ID con su `title`; ya no hay un bloque debajo", () => {
    const celda = trozo("const facturaConSuId = (d: Delivery) => {", "// ---- Las cargas de una orden");
    expect(celda).toContain('<span className="factura-e-id"> <span {...gesto} data-abre-la-orden');
    expect(celda).toContain("{n.id && <span data-id-de-la-orden title={n.id}>{n.id}</span>}");
    expect(celda).not.toContain('display: "block"');
    expect(celda).not.toContain("{...gesto} data-id-de-la-orden");      // el gesto (el subrayado de puntos) es solo de la factura
  });
  it("la tabla del plan, igual", () => {
    const ruta = plano(leer("src/components/RutaDelPlan.tsx"));
    expect(ruta).toContain('<span className="factura-e-id"> {abrirOrden');
    expect(ruta).toContain("{n.id && <span data-id-de-la-orden title={n.id}>{n.id}</span>} </span>");
    expect(ruta).not.toContain('<div className="hint" data-id-de-la-orden');
  });
  it("el estilo: una línea, el ID pequeño, gris y sin subrayar, y es ÉL quien se corta con puntos suspensivos", () => {
    expect(css).toContain(".factura-e-id { display: inline-flex; align-items: baseline; gap: 6px; max-width: 100%; min-width: 0; white-space: nowrap; vertical-align: bottom; }");
    const id = trozo(".factura-e-id > [data-id-de-la-orden] {", "}", css);
    for (const regla of ["flex: 0 100 auto;", "overflow: hidden;", "text-overflow: ellipsis;", "font-size: 11px;", "color: var(--gray);", "text-decoration: none;"]) expect(id, regla).toContain(regla);
    expect(css).toContain(".factura-e-id > :first-child { flex: 0 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; }");
  });
  it("la columna nace con el ancho justo para los dos (era 84), y la del número de parada cabe «✓P»", () => {
    expect(ANCHO_FIJO_DE_PARADAS).toEqual({ _n: 46, _factura: 124, _cuenta: 100, _acciones: 150 });
  });
});

describe("4 · «Armar rutas»: en qué está el plan, dicho junto al botón de la cabecera", () => {
  it("con plan, su versión; sin plan, cuántas órdenes de la fecha no tienen; sin plan ni órdenes, nada", () => {
    expect(estadoDelPlan({ status: "draft", version: 2 }, 13)).toEqual({ tipo: "borrador", version: 2 });
    expect(estadoDelPlan({ status: "published", version: 3 }, 13)).toEqual({ tipo: "publicado", version: 3 });
    expect(estadoDelPlan(null, 13)).toEqual({ tipo: "sin_plan", ordenes: 13 });
    expect(estadoDelPlan(null, 0)).toBeNull();
  });
  it("el texto es el que decía la tarjeta plegada, en los dos idiomas", () => {
    expect(textoDelEstadoDelPlan({ tipo: "borrador", version: 2 }, false).texto).toBe("Draft v2");
    expect(textoDelEstadoDelPlan({ tipo: "borrador", version: 2 }, true).texto).toBe("Borrador v2");
    expect(textoDelEstadoDelPlan({ tipo: "publicado", version: 3 }, false).texto).toBe("Published v3");
    expect(textoDelEstadoDelPlan({ tipo: "publicado", version: 3 }, true).texto).toBe("Publicado v3");
    expect(textoDelEstadoDelPlan({ tipo: "sin_plan", ordenes: 6 }, true)).toEqual({ texto: "6 sin plan", titulo: "6 orden(es) de esta fecha sin plan" });
    expect(textoDelEstadoDelPlan({ tipo: "sin_plan", ordenes: 6 }, false).titulo).toBe("6 order(s) on this date with no plan");
  });
  it("el panel le cuenta su estado a la página, y la página lo pinta junto al botón", () => {
    const panel = plano(leer("src/components/PlanDelDia.tsx"));
    expect(panel).toContain("const estado = estadoDelPlan(borrador, sinPlan);");
    expect(panel).toContain("useEffect(() => { onEstado?.(estado); }, [firmaDelEstado]);");
    expect(pagina).toContain("onCerrar={() => setPlanAbierto(false)} onEstado={setEstadoPlan}");
    expect(pagina).toContain("{puedeArmarRutas && estadoPlan && (() => { const e = textoDelEstadoDelPlan(estadoPlan, lang === \"es\");");
  });
});

describe("5, 6 y 9 · la barra de vistas de abajo lleva el filtro de chofer, los números de la franja y «Cuadrícula»", () => {
  // Sin `expect` aquí fuera: si la barra no está, que caiga una prueba CON NOMBRE y no la colección entera.
  const corta = (desde: string, hasta: string) => { const i = pagina.indexOf(desde); const j = i < 0 ? -1 : pagina.indexOf(hasta, i + desde.length); return j < 0 ? "" : pagina.slice(i, j); };
  const barra = corta("<div data-barra-de-vistas", "{incidenciasAbiertas && (");
  const cabecera = corta('<div className="page-head">', "{/* El motor nuevo (D-320)");
  it("en este orden: filtro de chofer · las vistas · Cuadrícula · Deshacer/Rehacer · Incidencias", () => {
    const puestos = ["data-filtro-de-chofer", 'data-pestana="routes"', 'data-pestana="orders"', 'data-pestana="board"', 'data-pestana="timeline"', "data-cuadricula", "data-deshacer", "data-rehacer", "data-abrir-incidencias"].map((x) => barra.indexOf(x));
    expect(puestos.every((p) => p > -1)).toBe(true);
    expect(puestos).toEqual([...puestos].sort((a, b) => a - b));
  });
  it("9 · el filtro de chofer está abajo y NO en la cabecera, con la misma función y lo mismo guardado", () => {
    expect(pagina.split("data-filtro-de-chofer").length - 1).toBe(1);
    expect(cabecera).not.toContain("data-filtro-de-chofer");
    expect(barra).toContain("value={filtroChofer} onChange={(e) => eligeFiltroDeChofer(e.target.value)} data-filtro-de-chofer");
    // En la cabecera quedan la fecha, los atajos, «Todas» y «Armar rutas».
    for (const queda of ['type="date"', "data-atajo-fecha={dias}", "All dates", "data-armar-rutas"]) expect(cabecera, queda).toContain(queda);
  });
  it("5 · «Cuadrícula» está junto a «Horario», con su función y su título; arriba queda solo «Ocultar mapa y choferes»", () => {
    expect(pagina.split("setWideRoutes((v) => !v)").length - 1).toBe(1);
    expect(barra).toContain('{tab === "routes" && ( <button className="btn btn-ghost btn-sm" data-cuadricula aria-pressed={!wideRoutes} onClick={() => setWideRoutes((v) => !v)} title={t("Toggle full-width route cards vs a compact grid", "Alternar tarjetas de ruta a ancho completo o cuadrícula compacta")}>');
    expect(barra).toContain('{wideRoutes ? "▦ " + t("Grid", "Cuadrícula") : "▭ " + t("Wide", "Ancho")}');
  });
  it("6 · la franja de cuatro casillas ya no está, y sus cuatro números viven en las pestañas", () => {
    for (const muerto of ['label: t("Scheduled", "Programadas")', 'label: t("Unscheduled", "Sin programar")', 'label: t("Total", "Total")', 'label: t("Routes", "Rutas"), target']) expect(pagina, muerto).not.toContain(muerto);
    expect(barra).toContain('🧭 {t("Routes", "Rutas")} ({withStops.filter((u) => pasaFiltro(u.key)).length})');                  // Rutas
    expect(barra).toContain("<span data-cuenta-programadas>{t(`${scheduledCount} scheduled`, `${scheduledCount} programadas`)}</span>");   // Programadas
    expect(barra).toContain("{unassigned.length}</span>)");                                                                      // Sin programar
    expect(barra).toContain('<span data-cuenta-sin-programar style={unassigned.length > 0 && tab !== "orders" ? { color: "var(--amber)", fontWeight: 800 } : undefined}>');
    expect(barra).toContain("(<span data-cuenta-total>{dayOrders.length}</span>)");                                               // Total
    expect(pagina).toContain("const scheduledCount = dayOrders.length - unassigned.length;");
  });
});

describe("7 · ↶ Deshacer / ↷ Rehacer a la vista en la tarjeta de cada ruta", () => {
  const mov = (rutas: string[], en: string): Movimiento => ({ etiqueta: { en, es: en }, rutas, antes: {}, despues: {}, sellos: null });
  const nombre = (k: string) => `«${k}»`;
  it("sin nada que deshacer, apagado, y lo dice", () => {
    expect(botonDeVolver(HISTORIAL_VACIO, "deshacer", "Ana", nombre)).toEqual({ activo: false, titulo: { en: "Nothing to undo", es: "Nada que deshacer" } });
    expect(botonDeVolver(HISTORIAL_VACIO, "rehacer", "Ana", nombre)).toEqual({ activo: false, titulo: { en: "Nothing to redo", es: "Nada que rehacer" } });
  });
  it("si el ÚLTIMO movimiento tocó esta ruta, encendido, y el título dice QUÉ deshace", () => {
    const h: Historial = { deshacer: [mov(["Beto"], "viejo"), mov(["Ana"], "D1 147890 → stop 2 of 4")], rehacer: [] };
    expect(botonDeVolver(h, "deshacer", "Ana", nombre)).toEqual({ activo: true, titulo: { en: "Undo: D1 147890 → stop 2 of 4 (Ctrl+Z)", es: "Deshacer: D1 147890 → stop 2 of 4 (Ctrl+Z)" } });
  });
  it("un movimiento entre DOS choferes enciende el botón en las dos tarjetas: es un solo movimiento, y no se deshace a medias", () => {
    const h: Historial = { deshacer: [mov(["Ana", "Beto"], "147890 → Beto")], rehacer: [] };
    expect(botonDeVolver(h, "deshacer", "Ana", nombre).activo).toBe(true);
    expect(botonDeVolver(h, "deshacer", "Beto", nombre).activo).toBe(true);
    expect(botonDeVolver(h, "deshacer", "Caro", nombre).activo).toBe(false);
  });
  it("si el último fue en OTRA ruta, apagado, y dice en cuál: el botón de una tarjeta no mueve la ruta de otra sin que se vea", () => {
    const h: Historial = { deshacer: [mov(["Ana"], "de Ana"), mov(["Beto"], "de Beto")], rehacer: [] };
    const b = botonDeVolver(h, "deshacer", "Ana", nombre);
    expect(b.activo).toBe(false);
    expect(b.titulo.es).toBe("El último movimiento fue en «Beto» (de Beto): se deshace desde esa tarjeta, o con Ctrl+Z");
    expect(b.titulo.en).toBe("The last move was on «Beto» (de Beto): undo it from that card, or with Ctrl+Z");
  });
  it("rehacer mira SU pila, con su tecla", () => {
    const h: Historial = { deshacer: [], rehacer: [mov(["Ana"], "x")] };
    expect(botonDeVolver(h, "rehacer", "Ana", nombre)).toEqual({ activo: true, titulo: { en: "Redo: x (Ctrl+Y)", es: "Rehacer: x (Ctrl+Y)" } });
    expect(botonDeVolver(h, "deshacer", "Ana", nombre).activo).toBe(false);
  });
  it("la tarjeta: los dos botones junto a Bloquear / Optimizar / Vaciar, sobre el MISMO historial que Ctrl+Z", () => {
    expect(pagina).toContain('const deshace = botonDeVolver(historial, "deshacer", u.key, laneLabel);');
    expect(pagina).toContain('const rehace = botonDeVolver(historial, "rehacer", u.key, laneLabel);');
    const grupo = trozo("<span data-acciones-de-la-ruta", "{!isC && <>");
    expect(grupo).toContain('data-deshacer-en-ruta={u.key} disabled={moviendo || !deshace.activo} title={t(deshace.titulo.en, deshace.titulo.es)} onClick={(e) => { e.stopPropagation(); void vuelve("deshacer"); }}>');
    expect(grupo).toContain('data-rehacer-en-ruta={u.key} disabled={moviendo || !rehace.activo} title={t(rehace.titulo.en, rehace.titulo.es)} onClick={(e) => { e.stopPropagation(); void vuelve("rehacer"); }}>');
    const orden = ["data-deshacer-en-ruta", "data-rehacer-en-ruta", "data-candado={u.key}", "data-optimizar={u.key}", "onClick={() => clearLane(u.key)}"].map((x) => grupo.indexOf(x));
    expect(orden.every((p) => p > -1)).toBe(true);
    expect(orden).toEqual([...orden].sort((a, b) => a - b));
    // Un solo historial: no hay una pila por ruta.
    expect(pagina.split("useState<Historial>(HISTORIAL_VACIO)").length - 1).toBe(1);
  });
  it("«Pasar a…» entra en el historial con las DOS rutas, y «Vaciar» con la suya", () => {
    const pasar = trozo("const pasaA = async (origen: string, ids: readonly string[], destino: string) => {", "// ---- ARRASTRAR (D-456)");
    expect(pasar).toContain("const afectadas = [...(byDriver.get(origen) ?? []), ...(byDriver.get(destino) ?? [])];");
    expect(pasar).toContain("despues[id] = { ...antes[id], assigned_driver: destino, route_seq: null, load_no: null };");
    expect(pasar).toContain("[origen, destino], antes, despues);");
    expect(pagina).toContain("if (v) void pasaA(u.key, ordenesDeLaFila, v);");
    const vaciar = trozo("const clearLane = async (laneKey: string) => {", "// Drivers on vacation/sick/maintenance");
    expect(vaciar).toContain("const antes = fotoDe(stops.map(aParadaDelGantt));");
    expect(vaciar).toContain("[id, { ...e, assigned_driver: null, route_seq: null, load_no: null }]");
    expect(vaciar).toContain("await anotaMovimiento({ en: `Clear ${nombreDeLaRuta}`, es: `Vaciar ${nombreDeLaRuta}` }, [laneKey], antes, despues);");
  });
});

describe("8 · sin el texto de sobra en la tarjeta de cada ruta («remueve todo ese texto incesario»)", () => {
  const sinComentarios = pagina.replace(/\{\/\*.*?\*\/\}/g, "");
  it("los tres renglones se fueron: «Total (desde la base…)», «Este chofer no tiene tienda…» y «✋ Arrastre una fila…»", () => {
    expect(sinComentarios).not.toContain("Total (from the base and back)");
    expect(sinComentarios).not.toContain('<span className="hint" data-pista-de-arrastre');
    // **Puesto al día por D-NEXT**: la frase de la pastilla nombra ahora las dos tiendas que se miran (Ajustes → Rutas y Usuarios).
    expect(sinComentarios).not.toContain("This driver has no home store assigned (Users)");
    expect(sinComentarios.split("This driver has no base store (Settings → Routes) nor a home store (Users)").length - 1).toBe(1);      // solo en el `title` de la pastilla
    expect(sinComentarios.split("No saved order yet").length - 1).toBe(1);
    expect(sinComentarios.split("Every route is on the map at once.").length - 1).toBe(1);
  });
  it("el aviso «sin base» no se pierde: una pastilla junto al nombre, con la frase entera al pasar", () => {
    // **Reemplazado en parte por D-NEXT** (2026-10-02): la pastilla salía si el chofer no tenía tienda en su PERFIL (`!u.store`),
    // aunque tuviera base en Ajustes → Rutas —la que usa «Armar rutas»—, y la medida usaba otra cosa (la recogida más repetida).
    // Ahora sale justo cuando la ruta no tiene base de verdad (`tiendaBaseDe`): ni en Ajustes ni en el perfil.
    expect(pagina).toContain('{!tiendaBaseDe(u.key) && stops.length > 0 && ( <span className="sema" data-sin-base tabIndex={0}');
    const pastilla = trozo("<span className=\"sema\" data-sin-base", "</span>");
    expect(pastilla).toContain("title={t( \"This driver has no base store (Settings → Routes) nor a home store (Users), so the route can't be anchored to a base");
    expect(pastilla).toContain('⚠ {t("no base", "sin base")}');
  });
  it("«sin orden guardado» también es una pastilla; la ayuda de arrastrar, el `title` de la cabecera de la tabla; la del mapa, un ⓘ", () => {
    expect(pagina).toContain('{stops.length > 0 && !sequenced && ( <span className="sema" data-sin-orden-guardado tabIndex={0}');
    expect(pagina).toContain('<tr data-pista-de-arrastre title={t("Drag a row to another position, or onto another driver, to move it. The ↑ ↓ arrows still work."');
    expect(pagina).toContain('<span className="hint" data-ayuda-del-mapa tabIndex={0}');
  });
  it("los avisos de problema real se QUEDAN: no llega a su ventana, parada sin pin, solo ciudad, se pasa de capacidad", () => {
    for (const queda of ["stop(s) will miss their delivery window", "stop(s) aren't on the map yet, so the route skips them.", "data-solo-ciudad-ruta", "data-exceso-en-la-ruta", "data-no-acaba-en-cero"]) expect(pagina, queda).toContain(queda);
  });
});
