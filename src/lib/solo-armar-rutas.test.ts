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
const trozo = (desde: string, hasta: string) => {
  const i = pagina.indexOf(desde);
  expect(i, desde).toBeGreaterThan(-1);
  const j = pagina.indexOf(hasta, i + desde.length);
  expect(j, hasta).toBeGreaterThan(i);
  return pagina.slice(i, j);
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
    const mide = trozo("const mideLaRuta = async", "const pintaLaMedida =");
    expect(mide).toContain('fetch("/api/optimize-route"');
    // D-443: UNA medida por chofer, la lista entera en su orden —cada recogida en su tienda y cada entrega—, no un lazo por viaje.
    expect(mide).toContain("const lista = lecturaDe(laneKey, stopList).paradas;");
    expect(mide).toContain("body: JSON.stringify(cuerpoDeLaMedida(puntos.map(({ id, lat, lng }) => ({ id, lat, lng })), depot, stopList[0]?.delivery_date ?? date)),");
    expect(mide).toContain("if (c) puntos.push({ id: `P:${i}`, lat: c.lat, lng: c.lng, servicio: RELOAD_MIN });");
    for (const escribe of ["updateDelivery(", "reorderStops(", "addNote("]) expect(mide).not.toContain(escribe);
    const pinta = trozo("const pintaLaMedida =", "const mide = async");
    for (const escribe of ["updateDelivery(", "reorderStops("]) expect(pinta).not.toContain(escribe);
  });
  it("elegir un chofer lo mide una vez por forma (sin bucle si falla); lo que llega tarde, de otra forma, no se pinta", () => {
    const efecto = trozo("const medidasPedidas = useRef(new Set<string>());", "// eslint-disable-next-line react-hooks/exhaustive-deps");
    expect(efecto).toContain("const firma = firmaDeLaMedida(date, name, stops);");
    expect(efecto).toContain("if (medidasPedidas.current.has(firma)) continue;");
    expect(efecto).toContain("medidasPedidas.current.add(firma);");
    const mide = trozo("const mide = async", "const toggleOrder");
    expect(mide).toContain("if (firmaDeLaMedida(ahora.date, driver, ahora.byDriver.get(driver) ?? []) === firma) { firmaPintada.current[driver] = firma; pintaLaMedida(driver, m); }");
  });
});

describe("lo que se quitó (D-437): Optimizar, Auto-asignar, Reagrupar por zona y Simular", () => {
  it("el sin-comentarios de la prueba quita los comentarios y deja el código", () => {
    expect(sinComentarios("a /* x */ b {/* y */} c // z\nd \"https://e\"")).toBe("a  b  c \nd \"https://e\"");
  });
  it("el Gestor no tiene ninguno de sus botones", () => {
    for (const quitado of [
      "Optimize all routes", "Optimizar todas las rutas", "Optimize route", "Optimizar ruta", "data-optimizar-ruta",
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
    expect(mapa).toContain("<option value=\"\">{t(\"Assign all to…\", \"Asignar todas a…\")}</option>");
  });
  it("los ficheros que solo servían a eso ya no existen; `/api/optimize-route` se queda (trazos del Gestor, del Mapa y de «Mi ruta»)", () => {
    for (const f of ["src/components/AutoAsignarDialogo.tsx", "src/lib/auto-asignar.ts", "src/lib/route-plan/reparto.ts",
      "src/lib/route-plan/reparto-cliente.ts", "src/app/api/route-plan/reparto/route.ts"]) expect(existsSync(join(process.cwd(), f)), f).toBe(false);
    expect(existsSync(join(process.cwd(), "src/app/api/optimize-route/route.ts"))).toBe(true);
    expect(leer("src/app/(app)/my-route/page.tsx")).toContain('fetch("/api/optimize-route"');
    expect(mapa).toContain('fetch("/api/optimize-route"');
    expect(leer("src/lib/data-provider.tsx")).not.toContain("siNoCambioDesde");
    expect("optimizaSinLasBloqueadas" in candados).toBe(false);
  });
});

describe("lo que se queda, a la vista", () => {
  it("«Armar las rutas del día»: su barra plegada lleva el botón primario, y con la barra cerrada la cabecera la trae (también primario)", () => {
    expect(plano(leer("src/components/PlanDelDia.tsx"))).toContain("<button className=\"btn btn-primary btn-sm\" data-abrir-armar-rutas aria-expanded={false} onClick={() => setAbierto(true)}>");
    expect(pagina).toContain("<button className=\"btn btn-primary btn-sm\" data-traer-armar-rutas onClick={() => setPlanTraidoAMano(true)}");
  });
  it("«Mejor lugar», las flechas de CADA parada (P y D), «Pasar a…» y el arrastre siguen conectados (D-443: sin selector ni flechas de viaje)", () => {
    expect(pagina).toContain("onClick={() => { if (conductorElegido) void colocaEnElMejorLugar(conductorElegido); }}");
    expect(pagina).toContain("onClick={() => void mueveParada(u.key, f.indice!, -1)}");
    expect(pagina).toContain("onClick={() => void mueveParada(u.key, f.indice!, 1)}");
    expect(pagina).toContain("if (v) void pasaA(ordenesDeLaFila, v);");
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
    expect(pagina).toContain("geom.length > 1 && pasaFiltro(driver) && sigueSuPlan(driver)");
  });
  it("la línea medida, solo de quien tiene paradas; y lo medido de una ruta que cambió (también por quitarle) se tira", () => {
    expect(pagina).toContain("const entries = Object.entries(routeLines).filter(([driver]) => pasaFiltro(driver) && (byDriver.get(driver)?.length ?? 0) > 0);");
    expect(pagina).toContain("if (firmaPintada.current[k] !== firmaDeLaMedida(date, k, byDriver.get(k) ?? [])) clearRouteFor(k);");
  });
  it("sin paradas no hay tarjeta, aunque esté marcado; se nombra en una línea", () => {
    expect(pagina).toContain("const shownDrivers = lanesDelFiltro.filter((u) => (byDriver.get(u.key) ?? []).length > 0);");
    expect(pagina).toContain("const marcadasSinParadas = lanesDelFiltro.filter((u) => selected.has(u.key) && (byDriver.get(u.key) ?? []).length === 0);");
    expect(pagina).toContain("{marcadasSinParadas.length > 0 && (");
  });
});

describe("«⚠ Incidencias» es un botón que abre una ventana", () => {
  it("ya no es pestaña", () => {
    expect(pagina).toContain('const [tab, setTab] = useState<"routes" | "orders" | "board" | "timeline">("routes");');
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
