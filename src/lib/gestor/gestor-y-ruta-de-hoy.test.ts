import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { alternaMarcado, claveDeMarcados, guardaMarcados, leeMarcados, marcadosVigentes, pasaElFiltro, soloAlgunos, unicoMarcado } from "@/lib/gestor/filtro-de-choferes";
import { rutasConOrdenes } from "@/lib/gestor/rutas-visibles";
import { nombreEnElMapa } from "@/lib/gestor/nombre-en-el-mapa";
import { alternaDesplegada, conAcciones, conCuerpo, desplegadaVigente } from "@/lib/gestor/cuadricula";
import { ordenesDeRutaDeHoy, ordenLegible } from "@/lib/gestor/ordenes-de-ruta-de-hoy";
import { carrilesDelDia, puntosDeLasRutas, rutasPorChofer } from "@/lib/mapa-de-rutas";
import { lecturaConLoHecho } from "@/lib/route-plan/lectura-del-gestor";
import { entraEnTodas } from "@/lib/todas-del-gestor";
import type { ParadaDelDia } from "@/lib/rutas-del-dia";
import type { Delivery } from "@/lib/types";

/**
 * D-481 · seis pedidos del dueño (2026-10-06, dictado) sobre el Gestor de Rutas y «Ruta de hoy».
 *   a · la factura en el mapa        b · «Ruta de hoy» = el Gestor sin acciones    c · el filtro son las casillas
 *   d · sin «P1» en una tienda        e · «Cuadrícula»: tabla abajo al pulsar       f · sin choferes vacíos en la lista
 */
const leer = (r: string) => readFileSync(join(process.cwd(), r), "utf8").split("\r\n").join("\n");
const plano = (s: string) => s.replace(/\s+/g, " ");
const gestor = plano(leer("src/app/(app)/routes/page.tsx"));
const mapa = plano(leer("src/app/(app)/map/page.tsx"));
const t = (en: string) => en;
const es = (_en: string, s: string) => s;

describe("c · el filtro de chofer son las casillas del panel", () => {
  it("sin nada marcado pasan todas; con algo marcado, solo las marcadas (y nada sin chofer)", () => {
    expect(pasaElFiltro(new Set(), "Ana")).toBe(true);
    expect(pasaElFiltro(new Set(), null)).toBe(true);
    expect(pasaElFiltro(new Set(["Ana"]), "Ana")).toBe(true);
    expect(pasaElFiltro(new Set(["Ana"]), "Beto")).toBe(false);
    expect(pasaElFiltro(new Set(["Ana"]), null)).toBe(false);
    expect(pasaElFiltro(new Set(["Ana", "Beto"]), "Beto")).toBe(true);
    expect(soloAlgunos(new Set())).toBe(false);
    expect(soloAlgunos(new Set(["Ana"]))).toBe(true);
  });
  it("lo marcado que ya no está en pantalla no cuenta (no deja la pantalla vacía)", () => {
    expect([...marcadosVigentes(new Set(["Ana", "Zoe"]), ["Ana", "Beto"])]).toEqual(["Ana"]);
    expect(marcadosVigentes(new Set(["Zoe"]), ["Ana"]).size).toBe(0);
  });
  it("marcar y desmarcar; el recuadro «Elige conductor» solo toma un chofer si es el único marcado", () => {
    expect([...alternaMarcado(new Set(["Ana"]), "Beto")]).toEqual(["Ana", "Beto"]);
    expect([...alternaMarcado(new Set(["Ana"]), "Ana")]).toEqual([]);
    expect(unicoMarcado(new Set(["Ana"]))).toBe("Ana");
    expect(unicoMarcado(new Set(["Ana", "Beto"]))).toBe("");
    expect(unicoMarcado(new Set())).toBe("");
  });
  it("se recuerda por persona: guardar, leer, y sin nada marcado se borra la clave", () => {
    const m = new Map<string, string>();
    const alm = { setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
    guardaMarcados(() => alm, "u1", new Set(["Ana", "Beto"]));
    expect(leeMarcados((k) => m.get(k) ?? null, "u1")).toEqual(["Ana", "Beto"]);
    expect(leeMarcados((k) => m.get(k) ?? null, "u2")).toEqual([]);
    guardaMarcados(() => alm, "u1", new Set());
    expect(m.has(claveDeMarcados("u1"))).toBe(false);
    expect(leeMarcados(() => "{roto", "u1")).toEqual([]);
    expect(leeMarcados(() => { throw new Error("sin almacenamiento"); }, "u1")).toEqual([]);
  });
  it("«Todas» con casillas: las de los marcados y las sin chofer", () => {
    expect(entraEnTodas(new Set(["Ana"]), "Ana")).toBe(true);
    expect(entraEnTodas(new Set(["Ana"]), "Beto")).toBe(false);
    expect(entraEnTodas(new Set(["Ana"]), null)).toBe(true);
    expect(entraEnTodas(new Set(), "Beto")).toBe(true);
  });
  it("la pantalla: el filtro es lo marcado, ya no hay desplegable, y se lee y se guarda por persona", () => {
    expect(gestor).toContain("const filtroChofer = useMemo(() => marcadosVigentes(selected, lanes.map((l) => l.key)), [selected, lanes]);");
    expect(gestor).toContain("const pasaFiltro = (ruta: string | null | undefined) => pasaElFiltro(filtroChofer, ruta);");
    expect(gestor).toContain("const lanesDelFiltro = lanes.filter((l) => pasaFiltro(l.key));");
    expect(gestor).toContain("const shownDrivers = lanesDelFiltro.filter((u) => conAlgoQuePintar(u.key));");
    expect(gestor).toContain("pasaFiltro, soloUnChofer: soloAlgunos(filtroChofer),");
    expect(gestor).not.toContain("All drivers");
    expect(gestor).not.toContain("TODOS_LOS_CHOFERES");
    // D-499: «Todas» ya no sigue el filtro de choferes.
    expect(gestor).toContain("const todasDelDia = useMemo(() => todasDelGestor(deliveries, date, modo, ROUTE_STAGES, sinFiltroDeChofer)");
  });
});

describe("f · un chofer sin órdenes no sale en la lista", () => {
  const rutas = [{ key: "Ana", isBucket: false }, { key: "Beto", isBucket: false }, { key: "Ruta 1", isBucket: true }];
  it("sale quien tiene algo (pendiente o hecho); una ruta temporal vacía se queda", () => {
    expect(rutasConOrdenes(rutas, (k) => k === "Ana").map((r) => r.key)).toEqual(["Ana", "Ruta 1"]);
    expect(rutasConOrdenes(rutas, () => true).map((r) => r.key)).toEqual(["Ana", "Beto", "Ruta 1"]);
  });
  it("la pantalla: el panel lista `filasDelPanel`, las tarjetas solo quien tiene algo; donde se asigna siguen todos", () => {
    expect(gestor).toContain("const filasDelPanel = rutasConOrdenes(lanes, conAlgoQuePintar);");
    expect(gestor).toContain("filas={filasDelPanel.map((u) => {");
    expect(gestor).toContain("sinRutas={filasDelPanel.length === 0}");
    // «Asignar a…», «Elige conductor» y «Asignar a varios» salen de `drivers`, no del panel.
    expect(gestor).toContain("...drivers.map((u) => ({ clave: u.full_name, etiqueta: u.full_name, esRuta: false })),");
    expect(gestor).toContain("{drivers.map((u) => <option key={u.id} value={u.full_name}>{u.full_name}</option>)}");
    expect(gestor).toContain("const filasDelGantt = soloLectura ? ganttRows.filter((r) => r.orders.length > 0) : ganttRows;");
  });
});

// Puesto al día por D-485 (la ruta por paradas): la burbuja de una recogida en una tienda de RTG VUELVE, ahora con su número
// de parada («1»), una por parada. Sin ella el mapa empezaba a contar en 2. `esTiendaRtg` (lib/gestor/recogida-en-tienda) se
// quitó: nadie más la usaba. Lo de las paradas se prueba en `paradas-numeradas.test.ts`.
describe("d · (D-485) la parada en una tienda de RTG lleva su número en el mapa", () => {
  const p = (x: Partial<ParadaDelDia> & { id: string }): ParadaDelDia => ({
    order_no: 1, order_code: null, order_suffix: null, stage: "approved", assigned_driver: "Ana", route_seq: 0, pickup_seq: null, load_no: null,
    actual_pallets: null, est_pallets: 2, store: "RDZ Pharr", store_lat: 26.19, store_lng: -98.18, delivery_lat: 26.3, delivery_lng: -98.2,
    delivery_city: "Edinburg", delivery_windows: null, delivery_date: "2026-10-06", delivery_duration: null, pickup_duration: null,
    pod_delivered_at: null, pickup_gps_at: null, ...x,
  });
  const ordenes = [p({ id: "a1", order_code: "A1" }), p({ id: "a2", order_code: "A2", route_seq: 1, store: "Proveedor X" })];
  it("la recogida en la tienda y la del proveedor llevan su burbuja con número; la base y las D siguen", () => {
    const pts = puntosDeLasRutas<ParadaDelDia>({
      carriles: carrilesDelDia([{ id: "u-ana", full_name: "Ana" }], [], ordenes, []), porChofer: rutasPorChofer(ordenes), delDia: ordenes, hechas: new Map(),
      pasaFiltro: () => true, soloUnChofer: false, enfocado: false, atenuada: () => false, colorDe: () => "rojo", colorSinChofer: "gris",
      baseDe: () => ({ coords: [26.19, -98.18], direccion: "RDZ Pharr" }), lecturaDe: (_k, s) => lecturaConLoHecho(s, 12, null, []),
      coordsDeTienda: () => ({ lat: 26.19, lng: -98.18 }), t,
    });
    const recogidas = pts.filter((x) => x.id.startsWith("__parada__"));
    expect(recogidas.map((x) => x.label.split(" — ")[0])).toEqual(["Stop 1", "Stop 2"]);
    expect(recogidas[0].label).toContain("RDZ Pharr");
    expect(pts.some((x) => x.id === "__depot__u-ana")).toBe(true);
    expect(pts.filter((x) => x.id === "a1" || x.id === "a2")).toHaveLength(2);
    expect(gestor).not.toContain("recogidaEnTienda");
  });
});

describe("a · el mapa nombra la orden por su factura", () => {
  it("con factura, la factura; sin ella, el ID y «sin factura»", () => {
    expect(nombreEnElMapa({ order_no: 13, order_code: "1013", invoice_num: " INV-3010 " }, t)).toBe("INV-3010");
    expect(nombreEnElMapa({ order_no: 13, order_code: "1013", invoice_num: null }, t)).toBe("#1013 (no invoice)");
    expect(nombreEnElMapa({ order_no: 13, order_code: "1013", invoice_num: "" }, es)).toBe("#1013 (sin factura)");
  });
  it("los tres rótulos de entrega del mapa la usan (con chofer, sin chofer, ya hecha)", () => {
    const m = leer("src/lib/mapa-de-rutas.ts");
    expect(m.split("${nombreEnElMapa(d, t)} — ").length - 1).toBe(3);
    expect(m).not.toContain("#${orderLabel(d)}");
  });
});

describe("e · «Cuadrícula»: tarjetas compactas arriba, la tabla del nombre pulsado abajo", () => {
  it("pulsar un nombre la despliega; otro la cambia; el mismo la pliega", () => {
    expect(alternaDesplegada(null, "Ana")).toBe("Ana");
    expect(alternaDesplegada("Ana", "Beto")).toBe("Beto");
    expect(alternaDesplegada("Ana", "Ana")).toBeNull();
  });
  it("la desplegada solo vale si su tarjeta sigue en pantalla", () => {
    expect(desplegadaVigente("Ana", ["Ana", "Beto"])).toBe("Ana");
    expect(desplegadaVigente("Zoe", ["Ana"])).toBeNull();
    expect(desplegadaVigente(null, ["Ana"])).toBeNull();
  });
  it("los botones: nunca en solo lectura; en cuadrícula, solo la desplegada", () => {
    expect(conAcciones(false, "ancha")).toBe(true);
    expect(conAcciones(false, "desplegada")).toBe(true);
    expect(conAcciones(false, "compacta")).toBe(false);
    expect(conAcciones(true, "ancha")).toBe(false);
    expect(conAcciones(true, "desplegada")).toBe(false);
  });
  it("el cuerpo (avisos y tabla): la compacta nunca; la desplegada siempre; la ancha si no está plegada", () => {
    expect(conCuerpo("compacta", false)).toBe(false);
    expect(conCuerpo("desplegada", true)).toBe(true);
    expect(conCuerpo("ancha", false)).toBe(true);
    expect(conCuerpo("ancha", true)).toBe(false);
  });
  it("la pantalla: compactas arriba y la desplegada abajo a todo el ancho; el nombre la alterna; botones con `acciones`", () => {
    expect(gestor).toContain('const tarjetasDeRuta: [Lane, ModoDeTarjeta][] = wideRoutes ? shownDrivers.map((u) => [u, "ancha"]) : [...shownDrivers.map((u): [Lane, ModoDeTarjeta] => [u, "compacta"]), ...shownDrivers.filter((u) => u.key === rutaDesplegada).map((u): [Lane, ModoDeTarjeta] => [u, "desplegada"])];');
    expect(gestor).toContain("const rutaDesplegada = desplegadaVigente(desplegada, shownDrivers.map((u) => u.key));");
    expect(gestor).toContain('gridColumn: modoDeTarjeta === "desplegada" ? "1 / -1" : undefined');
    expect(gestor).toContain('onClick={() => (modoDeTarjeta === "ancha" ? focusOnly(u.key) : setDesplegada((x) => alternaDesplegada(x, u.key)))}');
    expect(gestor).toContain("const acciones = conAcciones(soloLectura, modoDeTarjeta);");
    expect(gestor).toContain("const sinCuerpo = !conCuerpo(modoDeTarjeta, isC);");
    expect(gestor).toContain("{!sinCuerpo && <>");
    expect(gestor).toContain("{acciones && ( <span data-acciones-de-la-ruta");
    expect(gestor).toContain("const flechas = acciones && movible && (");
    expect(gestor).toContain("const pasar = acciones && movible && lanes.length > 1 && (");
  });
});

describe("b · «Ruta de hoy» es el Gestor de Rutas en solo lectura", () => {
  const leidas = [{ id: "a1", invoice_num: "INV-1", account: "ACME", created_by: "u-ven", assigned_sales_rep: null } as unknown as Delivery];
  const paradas: ParadaDelDia[] = [
    { id: "a1", order_no: 1, order_code: "A1", order_suffix: null, stage: "approved", assigned_driver: "Ana", route_seq: 0, pickup_seq: null, load_no: null,
      actual_pallets: null, est_pallets: 2, store: "RDZ Pharr", store_lat: 1, store_lng: 2, delivery_lat: 3, delivery_lng: 4, delivery_city: "Edinburg",
      delivery_windows: null, delivery_date: "2026-10-06", delivery_duration: null, pickup_duration: null, pod_delivered_at: null, pickup_gps_at: null },
    { id: "b1", order_no: 2, order_code: "B1", order_suffix: null, stage: "delivered", assigned_driver: "Beto", route_seq: 1, pickup_seq: null, load_no: null,
      actual_pallets: 3, est_pallets: 2, store: "RDZ Pharr", store_lat: 1, store_lng: 2, delivery_lat: 3, delivery_lng: 4, delivery_city: "McAllen",
      delivery_windows: "0900-1200", delivery_date: "2026-10-06", delivery_duration: null, pickup_duration: null, pod_delivered_at: "2026-10-06T15:00:00Z", pickup_gps_at: null },
  ];
  it("cada parada es la orden entera si la persona ya la lee; si no, solo lo mínimo de la parada (sin factura, cuenta ni calle)", () => {
    const [a, b] = ordenesDeRutaDeHoy(paradas, leidas);
    expect(a).toBe(leidas[0]);
    expect(b).toMatchObject({ id: "b1", order_code: "B1", stage: "delivered", assigned_driver: "Beto", route_seq: 1, actual_pallets: 3, store: "RDZ Pharr",
      delivery_address: "McAllen", delivery_windows: "0900-1200", is_training: false, invoice_num: null, account: null, pod_delivered_at: "2026-10-06T15:00:00Z" });
  });
  it("la orden entera solo se abre si ya se lee, y un vendedor solo las suyas", () => {
    expect(ordenLegible("a1", leidas, { id: "u-log", role: "logistics" })).toBe(leidas[0]);
    expect(ordenLegible("b1", leidas, { id: "u-log", role: "logistics" })).toBeNull();
    expect(ordenLegible("a1", leidas, { id: "u-ven", role: "sales" })).toBe(leidas[0]);
    expect(ordenLegible("a1", leidas, { id: "u-otro", role: "sales" })).toBeNull();
    expect(ordenLegible("a1", leidas, null)).toBeNull();
  });
  it("/map monta la misma página dentro de `SoloLectura`, y no tiene código propio", () => {
    expect(mapa).toContain("<SoloLectura> <RoutesPage /> </SoloLectura>");
    for (const propio of ["useData(", "<MapView", "<PanelDeChoferes", "useRutasDelDia("]) expect(mapa, propio).not.toContain(propio);
  });
});

describe("b · `SoloLectura` enciende el modo de solo lectura de la página que envuelve", () => {
  it("dentro, `useSoloLectura()` es true; fuera (el Gestor), false", async () => {
    const { createElement } = await import("react");
    const { renderToString } = await import("react-dom/server");
    const { SoloLectura, useSoloLectura } = await import("@/lib/gestor/solo-lectura");
    const Sonda = () => createElement("i", null, String(useSoloLectura()));
    expect(renderToString(createElement(SoloLectura, null, createElement(Sonda)))).toBe("<i>true</i>");
    expect(renderToString(createElement(Sonda))).toBe("<i>false</i>");
  });
});

describe("D-482 · la desplegada pegada a su compacta, sin repetir el nombre", () => {
  it("la desplegada no lleva cabecera; la compacta y la ancha sí", async () => {
    const { conCabecera } = await import("./cuadricula");
    expect(conCabecera("desplegada")).toBe(false);
    expect(conCabecera("compacta")).toBe(true);
    expect(conCabecera("ancha")).toBe(true);
  });
  it("clases: compacta abierta marcada, desplegada con la animación, el resto «card»", async () => {
    const { claseDeTarjeta } = await import("./cuadricula");
    expect(claseDeTarjeta("desplegada", true)).toBe("card tarjeta-desplegada");
    expect(claseDeTarjeta("compacta", true)).toBe("card tarjeta-abierta");
    expect(claseDeTarjeta("compacta", false)).toBe("card");
    expect(claseDeTarjeta("ancha", true)).toBe("card");
  });
  it("la página usa las dos piezas y el CSS anima y respeta «reducir movimiento»", async () => {
    const { readFileSync } = await import("node:fs");
    const gestor = readFileSync("src/app/(app)/routes/page.tsx", "utf8");
    expect(gestor).toContain("{conCabecera(modoDeTarjeta) && (<>");
    expect(gestor).toContain("className={claseDeTarjeta(modoDeTarjeta, desplegadaAqui)}");
    const css = readFileSync("src/app/globals.css", "utf8");
    expect(css).toContain("@keyframes tarjeta-se-abre");
    expect(css).toMatch(/prefers-reduced-motion: reduce\) \{ \.tarjeta-desplegada \{ animation: none; \}/);
  });
});

describe("D-488 · el filtro de choferes: el panel lista a todos, la casilla dice si se ve, y «Todos»", async () => {
  const { NINGUNO, alternaTodas, alternaVisible, marcadasAProposito, marcadosVigentes, pasaElFiltro, rutasVisibles, seVenTodas, unicoMarcado } = await import("./filtro-de-choferes");
  const R = ["Ana", "Beto", "Carla"];
  it("sin nada guardado se ven todas, y la casilla «Todos» sale marcada", () => {
    expect([...rutasVisibles(new Set(), R)]).toEqual(R);
    expect(seVenTodas(new Set(), R)).toBe(true);
  });
  it("desmarcar una la esconde; las otras siguen y se pueden marcar varias", () => {
    const sinBeto = alternaVisible(new Set(), R, "Beto");
    expect([...rutasVisibles(sinBeto, R)]).toEqual(["Ana", "Carla"]);
    expect(pasaElFiltro(marcadosVigentes(sinBeto, R), "Beto")).toBe(false);
    expect(pasaElFiltro(marcadosVigentes(sinBeto, R), "Ana")).toBe(true);
    expect(seVenTodas(sinBeto, R)).toBe(false);
    // volver a marcar a Beto: todas a la vista = el defecto
    expect(alternaVisible(sinBeto, R, "Beto").size).toBe(0);
  });
  it("desmarcarlas todas no vuelve a «todas»: no se ve ninguna", () => {
    let s = new Set<string>();
    for (const r of R) s = alternaVisible(s, R, r);
    expect([...s]).toEqual([NINGUNO]);
    expect(rutasVisibles(s, R).size).toBe(0);
    const v = marcadosVigentes(s, R);
    for (const r of R) expect(pasaElFiltro(v, r)).toBe(false);
    expect(unicoMarcado(s)).toBe("");
    expect(marcadasAProposito(s).size).toBe(0);
  });
  it("«Todos»: con todas a la vista las quita; si falta alguna, las pone todas", () => {
    expect([...alternaTodas(new Set(), R)]).toEqual([NINGUNO]);
    expect(alternaTodas(new Set([NINGUNO]), R).size).toBe(0);
    expect(alternaTodas(new Set(["Ana"]), R).size).toBe(0);
  });
  it("la pantalla: el panel lista todas y su casilla es «se ve»; la confirmación va encima del panel de Switch user", async () => {
    const { readFileSync } = await import("node:fs");
    const gestor = readFileSync("src/app/(app)/routes/page.tsx", "utf8");
    expect(gestor).toContain("const filasDelPanel = rutasConOrdenes(lanes, conAlgoQuePintar);");
    expect(gestor).toContain("marcada: visiblesEnPanel.has(u.key)");
    expect(gestor).toContain("onAlterna={(clave) => setSelected((s) => alternaVisible(s, clavesDelPanel, clave))}");
    expect(readFileSync("src/components/PanelDeChoferes.tsx", "utf8")).toContain("data-todos-los-choferes");
    expect(readFileSync("src/lib/confirm.tsx", "utf8")).toContain('style={{ zIndex: 10000 }}');
  });
});
