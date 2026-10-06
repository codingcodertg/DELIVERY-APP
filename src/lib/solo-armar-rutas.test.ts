import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { cuerpoDeLaMedida, firmaDeLaMedida, pintaElTrazoDelPlan } from "./medida-de-ruta";
import * as candados from "./rutas-bloqueadas";

/**
 * D-437. El dueño, 2026-09-28: «quita lo de optemizar y lo de autoa signar que este en earmar rutas», y eligió «Quitar los
 * dos; solo Armar rutas». En la misma rama: «julio esta vacio pero aun asi aparece y abajo tambien aparece como viaje», e
 * «incidencias que sea un boton».
 */

const leer = (ruta: string) => readFileSync(join(process.cwd(), ruta), "utf8").split("\r\n").join("\n");
const plano = (s: string) => s.replace(/\s+/g, " ");
/** Sin comentarios: los que cuentan qué se quitó nombran lo quitado, y «no está» tiene que mirar el código. */
const sinComentarios = (s: string) => s.replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
const pagina = plano(leer("src/app/(app)/routes/page.tsx"));
const codigoDePagina = plano(sinComentarios(leer("src/app/(app)/routes/page.tsx")));
const mapa = plano(leer("src/app/(app)/map/page.tsx"));
const codigoDeMapa = plano(sinComentarios(leer("src/app/(app)/map/page.tsx")));
// **Puesto al día por D-467**: la medida y el dibujo del mapa salieron del Gestor a estas dos librerías, que comparte con
// «Ruta de hoy» (antes «Mapa»). Lo que se comprobaba en la página se comprueba donde vive ahora.
const medida = plano(leer("src/lib/usa-medida-de-rutas.ts"));
const mapaDeRutas = plano(leer("src/lib/mapa-de-rutas.ts"));
const trozo = (desde: string, hasta: string, de = pagina) => {
  const i = de.indexOf(desde);
  expect(i, desde).toBeGreaterThan(-1);
  const j = de.indexOf(hasta, i + desde.length);
  expect(j, hasta).toBeGreaterThan(i);
  return de.slice(i, j);
};

const p = (id: string, route_seq: number | null = null, load_no: number | null = null) => ({ id, route_seq, load_no, delivery_lat: 26.2, delivery_lng: -98.2 });

describe("«Unir viajes» y «Dividir en 2» (D-437) se fueron con los viajes (D-443)", () => {
  it("ni sus botones ni sus funciones: la ruta es una lista", () => {
    for (const x of ["const combineLoads", "const splitLoads", "data-unir-viajes", "data-dividir-en-dos", "planDeUnirViajes", "planDeDividirEnDos"]) expect(codigoDePagina).not.toContain(x);
  });
});

describe("medir la ruta sin reordenarla", () => {
  it("el cuerpo pide el camino EN ESE ORDEN (`optimize: false`), con la base delante y de ida y vuelta si la hay", () => {
    const c = cuerpoDeLaMedida([{ id: "b", lat: 2, lng: 2 }, { id: "a", lat: 1, lng: 1 }], [9, 9], "2026-09-28");
    expect(c).toEqual({
      stops: [{ id: "__depot__", lat: 9, lng: 9 }, { id: "b", lat: 2, lng: 2 }, { id: "a", lat: 1, lng: 1 }],
      roundtrip: true, date: "2026-09-28", optimize: false,
    });
    const sinBase = cuerpoDeLaMedida([{ id: "b", lat: 2, lng: 2 }, { id: "a", lat: 1, lng: 1 }], null, null);
    expect(sinBase.stops.map((s) => s.id)).toEqual(["b", "a"]);
    expect(sinBase.roundtrip).toBe(false);
  });
  it("la forma cambia si cambia el orden, el viaje, una parada o su pin; y no cambia si no cambia nada", () => {
    const base = firmaDeLaMedida("2026-09-28", "Diego", [p("A", 0), p("B", 1)]);
    expect(firmaDeLaMedida("2026-09-28", "Diego", [p("A", 0), p("B", 1)])).toBe(base);
    expect(firmaDeLaMedida("2026-09-28", "Diego", [p("B", 0), p("A", 1)])).not.toBe(base);
    // El mismo orden con otros puestos (las flechas numeran tras lo ya hecho) es otra forma…
    expect(firmaDeLaMedida("2026-09-28", "Diego", [p("A", 1), p("B", 2)])).not.toBe(base);
    // …y sin puestos, el orden en que se pintan decide.
    expect(firmaDeLaMedida("2026-09-28", "Diego", [p("A"), p("B")])).not.toBe(firmaDeLaMedida("2026-09-28", "Diego", [p("B"), p("A")]));
    expect(firmaDeLaMedida("2026-09-28", "Diego", [p("A", 0), p("B", 1, 2)])).not.toBe(base);
    // D-443: la recogida también es una parada medida; moverla es otra forma de la ruta.
    expect(firmaDeLaMedida("2026-09-28", "Diego", [{ ...p("A", 0), pickup_seq: -0.5 }, p("B", 1)])).not.toBe(firmaDeLaMedida("2026-09-28", "Diego", [{ ...p("A", 0), pickup_seq: 0.5 }, p("B", 1)]));
    expect(firmaDeLaMedida("2026-09-28", "Diego", [p("A", 0)])).not.toBe(base);
    expect(firmaDeLaMedida("2026-09-28", "Diego", [p("A", 0), { ...p("B", 1), delivery_lat: 25 }])).not.toBe(base);
    expect(firmaDeLaMedida("2026-09-29", "Diego", [p("A", 0), p("B", 1)])).not.toBe(base);
    expect(firmaDeLaMedida("2026-09-28", "Diego", [])).not.toBe(base);
  });
  it("la pantalla mide con ese cuerpo, en el orden guardado, y no escribe nada", () => {
    const mide = trozo("export async function mideLaLista", "const pintaLaMedida =", medida);
    expect(mide).toContain('e.pide("/api/optimize-route"');
    expect(mide).toContain("pide: (url, init) => fetch(url, init) });");
    // D-443: UNA medida por chofer, la lista entera en su orden —cada recogida en su tienda y cada entrega—, no un lazo por viaje.
    expect(mide).toContain("const r = await mideLaLista({ lista: e.listaDe(laneKey, stopList), ordenes: stopList, base: depot,");
    expect(pagina).toContain("listaDe: (clave, stops) => lecturaDe(clave, stops).paradas,");
    expect(mide).toContain("body: JSON.stringify(cuerpoDeLaMedida(puntos.map(({ id, lat, lng }) => ({ id, lat, lng })), depot, e.ordenes[0]?.delivery_date ?? e.fecha)),");
    // **Reemplazado en parte por D-461** (2026-10-02): cada fila P sumaba la recarga entera (`servicio: RELOAD_MIN`); desde
    // D-444 cada recogida es su fila, y cinco cajas de la misma tienda eran 100 minutos. Ahora las recogidas seguidas en la
    // misma tienda son UNA visita (`minutosEnCadaParada`), como en el optimizador y en «Armar rutas». Y la base de la medida es
    // la del chofer (`baseDeLaRuta`), no la dirección de recogida más repetida. Ver `optimizar-desde-el-gestor.test.ts`.
    expect(mide).toContain("if (c) puntos.push({ id: `P:${i}`, lat: c.lat, lng: c.lng, servicio: parado[i] });");
    for (const escribe of ["updateDelivery(", "reorderStops(", "addNote("]) expect(mide).not.toContain(escribe);
    const pinta = trozo("const pintaLaMedida =", "const mide = async", medida);
    for (const escribe of ["updateDelivery(", "reorderStops("]) expect(pinta).not.toContain(escribe);
  });
  it("cada forma de la ruta se mide una vez (sin bucle si falla); lo que llega tarde, de otra forma, no se pinta", () => {
    // Hasta D-456 esto era un `Set` de formas ya pedidas (`medidasPedidas`), y solo para el chofer elegido. Ahora la medida
    // de cada forma se GUARDA (`medidas`) y qué se pide lo decide `siguienteMedida`: ver `gestor-factura-arrastre-optimizar`.
    const efecto = trozo("const queMedir = e.rutasAMedir.join(", "const estadoDeLaMedida =", medida);
    expect(efecto).toContain("const que = siguienteMedida<MedidaDeLaRuta>(rutas, pintadas, medidas.current);");
    expect(efecto).toContain("if (midiendo == null && que.pide) void mide(que.pide.clave, byDriver.get(que.pide.clave) ?? []);");
    expect(codigoDePagina).not.toContain("medidasPedidas");
    const mide = trozo("const mide = async", "const reintentaLaMedida", medida);
    expect(mide).toContain("if (firmaAhora.current(driver, formaActual.current.byDriver.get(driver) ?? []) === firma) { firmaPintada.current[driver] = firma; pintaLaMedida(driver, m); }");
    expect(mide).toContain("medidas.current.set(firma, MEDIDA_FALLIDA);");
  });
});

describe("lo que se quitó (D-437): Optimizar, Auto-asignar, Reagrupar por zona y Simular", () => {
  it("el sin-comentarios de la prueba quita los comentarios y deja el código", () => {
    expect(sinComentarios("a /* x */ b {/* y */} c // z\nd \"https://e\"")).toBe("a  b  c \nd \"https://e\"");
  });
  it("el Gestor no tiene ninguno de sus botones — salvo «🧭 Optimizar» por ruta, que volvió en D-456", () => {
    // **Reemplazado en parte por D-456** (2026-10-01): el dueño pidió de vuelta optimizar CADA ruta («have the optimize option
    // for every route»). Vuelve un botón por tarjeta, que decide el orden aquí (`optimizaLaLista`) sin pedírselo a Google.
    // «Optimizar todas», Auto-asignar, Reagrupar y Simular siguen fuera, y el código que los movía también (abajo).
    expect(pagina).toContain("data-optimizar={u.key}");
    expect(pagina).toContain("onClick={(e) => { e.stopPropagation(); void optimizaLaRuta(u.key); }}");
    for (const quitado of [
      "Optimize all routes", "Optimizar todas las rutas", "data-optimizar-ruta",
      "data-auto-asignar", "Auto-assign", "Auto-asignar", "Regroup by area", "Reagrupar por zona",
      "previewAdd", "🔮", "Simulate", "Simular", "AutoAsignarDialogo",
    ]) expect(codigoDePagina, quitado).not.toContain(quitado);
  });
  it("ni el código que los movía", () => {
    for (const quitado of ["computeRoute", "applyPlan", "const optimize = async", "optimizeAll", "optimizaEstas",
      "regroupByArea", "confirmPreview", "repartirConElDialogo", "optimizingAll", "autoAssigning", "busyDriver",
      "buildGeoLoads", "repartirConElMotor", "optimizaSinLasBloqueadas", "setPreview"]) expect(codigoDePagina, quitado).not.toContain(quitado);
  });
  it("el Mapa ya no tiene «✨ Auto-asignar selección»", () => {
    for (const quitado of ["Auto-assign", "Auto-asignar", "autoAssignSelected", "repartirConElMotor", "pideElReparto", "leeBloqueos"]) expect(codigoDeMapa, quitado).not.toContain(quitado);
    // **Reemplazado en parte por D-467** (2026-10-04): el «Mapa» es ahora «Ruta de hoy», de solo lectura. Hasta aquí
    // conservaba asignar a mano («Asignar todas a…»); ya no asigna nada: ni escribe órdenes ni las anota.
    for (const escribe of ["Assign all to…", "updateDelivery", "addNote(", "reorderStops(", "assignOrders"]) expect(codigoDeMapa, escribe).not.toContain(escribe);
  });
  it("los ficheros que solo servían a eso ya no existen; `/api/optimize-route` se queda (trazos del Gestor, del Mapa y de «Mi ruta»)", () => {
    for (const f of ["src/components/AutoAsignarDialogo.tsx", "src/lib/auto-asignar.ts", "src/lib/route-plan/reparto.ts",
      "src/lib/route-plan/reparto-cliente.ts", "src/app/api/route-plan/reparto/route.ts"]) expect(existsSync(join(process.cwd(), f)), f).toBe(false);
    expect(existsSync(join(process.cwd(), "src/app/api/optimize-route/route.ts"))).toBe(true);
    expect(leer("src/app/(app)/my-route/page.tsx")).toContain('fetch("/api/optimize-route"');
    // D-467: «Ruta de hoy» ya no llama por su cuenta; mide con `useMedidaDeRutas`, como el Gestor.
    // D-481: «Ruta de hoy» monta la página del Gestor en solo lectura, que mide con `useMedidaDeRutas<Delivery>`.
    expect(mapa).toContain("<SoloLectura>");
    expect(pagina).toContain("useMedidaDeRutas<Delivery>({");
    expect(medida).toContain('e.pide("/api/optimize-route"');
    expect(leer("src/lib/data-provider.tsx")).not.toContain("siNoCambioDesde");
    expect("optimizaSinLasBloqueadas" in candados).toBe(false);
  });
});

describe("lo que se queda, a la vista", () => {
  it("«Armar las rutas del día»: UN botón, primario, en la cabecera (D-459 quitó la tarjeta plegada que lo repetía)", () => {
    expect(plano(leer("src/components/PlanDelDia.tsx"))).not.toContain("data-abrir-armar-rutas");
    expect(pagina).toContain("<button className=\"btn btn-primary btn-sm\" data-armar-rutas aria-expanded={planAbierto} onClick={() => setPlanAbierto((v) => !v)}");
    expect(pagina.split("data-armar-rutas").length - 1).toBe(1);
  });
  it("«Mejor lugar», las flechas de CADA parada (P y D), «Pasar a…» y el arrastre siguen conectados (D-443: sin selector ni flechas de viaje)", () => {
    expect(pagina).toContain("onClick={() => { if (conductorElegido) void colocaEnElMejorLugar(conductorElegido); }}");
    expect(pagina).toContain("onClick={() => void mueveParada(u.key, f.indice!, -1)}");
    expect(pagina).toContain("onClick={() => void mueveParada(u.key, f.indice!, 1)}");
    expect(pagina).toContain("if (v) void pasaA(u.key, ordenesDeLaFila, v);");      // D-459: con la ruta de salida, para deshacer
    expect(pagina).toContain("suelta: (id, destino) => void sueltaEnLaLinea(id, destino)");
    for (const x of ["moveStopToLoad(", "moveTrip(", "data-viaje-visto"]) expect(codigoDePagina).not.toContain(x);
  });
});

describe("Julio vacío: ni línea en el mapa ni tarjeta", () => {
  it("la línea del plan publicado solo con paradas pendientes y la ruta aún como se publicó", () => {
    expect(pintaElTrazoDelPlan(0, "plan")).toBe(false);
    expect(pintaElTrazoDelPlan(3, "derivada")).toBe(false);
    expect(pintaElTrazoDelPlan(3, "plan")).toBe(true);
  });
  it("la pantalla decide con eso, al pedir el trazo y al pintarlo", () => {
    const sigue = trozo("const sigueSuPlan = (laneKey: string): boolean => {", "// «Elige conductor para N órdenes»");
    expect(sigue).toContain("const paradas = paradasPublicadasDe(laneKey);");
    expect(sigue).toContain("return pintaElTrazoDelPlan(stops.length, lecturaDe(laneKey, stops).fuente);");
    expect(pagina).toContain("if (!paradas || !sigueSuPlan(chofer)) continue;");
    expect(mapaDeRutas).toContain("geom.length > 1 && e.pasaFiltro(driver) && e.sigueSuPlan(driver)");
    expect(pagina).toContain("pasaFiltro, sigueSuPlan, colorDe: colorFor, atenuada: isDim,");
  });
  it("la línea medida, solo de quien tiene paradas; y lo medido de una ruta que cambió (también por quitarle) se tira", () => {
    expect(mapaDeRutas).toContain("const entries = Object.entries(e.trazos).filter(([driver]) => e.pasaFiltro(driver) && e.tieneParadas(driver));");
    expect(pagina).toContain("trazos: routeLines, trazosDelPlan, tieneParadas: (clave) => (byDriver.get(clave)?.length ?? 0) > 0,");
    expect(medida).toContain("if (firmaPintada.current[k] !== firmaDe(k, byDriver.get(k) ?? [])) clearRouteFor(k);");
  });
  it("sin paradas no hay tarjeta, aunque esté marcado; se nombra en una línea", () => {
    // D-459: «sin paradas» es sin pendientes NI hechas: quien ya lo entregó todo conserva su tarjeta, con sus filas hechas.
    expect(pagina).toContain("const conAlgoQuePintar = (clave: string) => (byDriver.get(clave) ?? []).length > 0 || hechasDe(clave).length > 0;");
    expect(pagina).toContain("const shownDrivers = lanesDelFiltro.filter((u) => conAlgoQuePintar(u.key));");
    expect(pagina).toContain("const marcadasSinParadas = lanesDelFiltro.filter((u) => selected.has(u.key) && (byDriver.get(u.key) ?? []).length === 0);");
    expect(pagina).toContain("{marcadasSinParadas.length > 0 && (");
  });
});

describe("«⚠ Incidencias» es un botón que abre una ventana", () => {
  it("ya no es pestaña", () => {
    // D-462 suma la pestaña «todas» (todas las del día, con chofer o sin él); «incidents» sigue sin estar.
    expect(pagina).toContain('const [tab, setTab] = useState<"routes" | "orders" | "todas" | "board" | "timeline">("routes");');
    expect(pagina).not.toContain('setTab("incidents")');
    expect(pagina).not.toContain('tab === "incidents"');
  });
  it("el botón, con su cuenta y en ámbar si hay alguna, abre la ventana con lo de siempre dentro", () => {
    expect(pagina).toContain("<button className={\"btn btn-sm \" + (incidents.length ? \"btn-amber\" : \"btn-ghost\")} data-abrir-incidencias");
    expect(pagina).toContain("onClick={() => setIncidenciasAbiertas(true)}> ⚠ {t(\"Incidents\", \"Incidencias\")} ({incidents.length})");
    const ventana = trozo("{incidenciasAbiertas && (", "{/* ---------- Day timeline");
    expect(ventana).toContain("<DriverIncidents me={me} drivers={drivers} deliveries={deliveries} incidents={incidents} addIncident={addIncident} removeIncident={removeIncident} confirmAction={confirmAction} notify={notify} t={t} enVentana />");
    expect(ventana).toContain("data-cerrar-incidencias onClick={() => setIncidenciasAbiertas(false)}");
    expect(ventana).toContain('role="dialog" aria-modal="true"');
  });
});
