import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { paradasDeLaRuta, textoDeLaParada } from "@/lib/gestor/paradas-numeradas";
import { carrilesDelDia, puntosDeLasRutas, rutasPorChofer } from "@/lib/mapa-de-rutas";
import { leyendaDelMapa } from "@/lib/map-legend";
import { ANCHO_FIJO_DE_PARADAS, anchoDelNumeroDeParada } from "@/lib/routes-columns";
import type { FilaDeLaRuta } from "@/lib/route-plan/lectura-de-ruta";
import { lecturaConLoHecho } from "@/lib/route-plan/lectura-del-gestor";
import type { ParadaDelDia } from "@/lib/rutas-del-dia";

/**
 * D-485 · la ruta del Gestor numerada por PARADAS. El dueño, 2026-10-06 (dictado): «vamos a hacerlo ahora por stops, like
 * stop. 1, 2, 3, 4, 5, 6, en vez de P1, P2, P3 […] en stop 1 va a recoger P1, P2, P3. Y después, la segunda stop va a ser D1».
 */
const leer = (r: string) => readFileSync(join(process.cwd(), r), "utf8").split("\r\n").join("\n");
const plano = (s: string) => s.replace(/\s+/g, " ");
const t = (en: string) => en;
const es = (_en: string, s: string) => s;

const P = (id: string, etiqueta: string, lugar: string | null = "RDZ Pharr"): FilaDeLaRuta => ({ tipo: "P", ordenes: [id], lugar, etiqueta, cambio: 1, indice: 0 });
const D = (id: string, etiqueta: string): Extract<FilaDeLaRuta, { tipo: "D" }> => ({ tipo: "D", orden: id, etiqueta, cambio: -1, indice: 0, otraCarga: false });
const ordenes = [
  { id: "a", delivery_address: "1 Main St, Edinburg" },
  { id: "b", delivery_address: "  1 MAIN st,  Edinburg " },
  { id: "c", delivery_address: "9 Elm, McAllen" },
];

describe("paradasDeLaRuta: filas seguidas en el mismo sitio son una parada", () => {
  it("el ejemplo del dueño: tres recogidas en la misma tienda = parada 1; luego D1 = 2, D2 = 3, D3 = 4", () => {
    const filas = [P("a", "P1"), P("b", "P2"), P("c", "P3"), D("a", "D1"), D("c", "D3"), D("b", "D2")];
    const r = paradasDeLaRuta(filas, [{ id: "a", delivery_address: "x" }, { id: "b", delivery_address: "y" }, { id: "c", delivery_address: "z" }]);
    expect(r.deFila).toEqual([1, 1, 1, 2, 3, 4]);
    expect(r.primera).toEqual([true, false, false, true, true, true]);
    expect(r.paradas[0]).toEqual({ numero: 1, tipo: "P", filas: [0, 1, 2], etiquetas: ["P1", "P2", "P3"], ordenes: ["a", "b", "c"], lugar: "RDZ Pharr" });
    expect(r.paradas.map((p) => p.etiquetas.join(","))).toEqual(["P1,P2,P3", "D1", "D3", "D2"]);
    expect(r.paradas[1].lugar).toBeNull();
  });
  it("dos entregas seguidas a la misma dirección (sin mayúsculas ni espacios) son una parada", () => {
    const r = paradasDeLaRuta([P("a", "P1"), P("b", "P2"), D("a", "D1"), D("b", "D2"), D("c", "D3")], ordenes);
    expect(r.deFila).toEqual([1, 1, 2, 2, 3]);
    expect(r.paradas[1]).toMatchObject({ tipo: "D", etiquetas: ["D1", "D2"], ordenes: ["a", "b"] });
  });
  it("la misma tienda más adelante es OTRA parada; dos tiendas distintas seguidas, dos paradas", () => {
    const r = paradasDeLaRuta([P("a", "P1"), D("a", "D1"), P("b", "P2"), P("c", "P3", "RDZ McAllen")], ordenes);
    expect(r.deFila).toEqual([1, 2, 3, 4]);
  });
  it("una P y una D no se juntan; una recogida sin tienda va sola", () => {
    expect(paradasDeLaRuta([P("a", "P1", null), P("b", "P2", null)], ordenes).deFila).toEqual([1, 2]);
    expect(paradasDeLaRuta([P("a", "P1", "1 Main St, Edinburg"), D("a", "D1")], ordenes).deFila).toEqual([1, 2]);
  });
  it("una orden en dos filas de la misma parada cuenta una vez; sin filas, sin paradas", () => {
    const r = paradasDeLaRuta([P("a", "P1"), { ...P("a", "P1"), indice: null }], ordenes);
    expect(r.paradas).toHaveLength(1);
    expect(r.paradas[0].ordenes).toEqual(["a"]);
    expect(paradasDeLaRuta([], ordenes)).toEqual({ deFila: [], primera: [], paradas: [] });
  });
});

describe("textoDeLaParada: qué se hace ahí", () => {
  it("en/es, con y sin los nombres de las órdenes", () => {
    expect(textoDeLaParada({ numero: 1, tipo: "P", etiquetas: ["P1", "P2", "P3"] }, ["INV-1", "INV-2", "INV-3"], t)).toBe("Stop 1 — pick up P1, P2, P3 · INV-1, INV-2, INV-3");
    expect(textoDeLaParada({ numero: 2, tipo: "D", etiquetas: ["D1"] }, ["INV-1"], es)).toBe("Parada 2 — entregar D1 · INV-1");
    expect(textoDeLaParada({ numero: 3, tipo: "D", etiquetas: ["D2"] }, [], t)).toBe("Stop 3 — deliver D2");
  });
});

describe("el mapa: una burbuja por parada, con su número", () => {
  const p = (x: Partial<ParadaDelDia> & { id: string }): ParadaDelDia => ({
    order_no: 1, order_code: null, order_suffix: null, stage: "approved", assigned_driver: "Ana", route_seq: 0, pickup_seq: null, load_no: null,
    actual_pallets: null, est_pallets: 2, store: "RDZ Pharr", store_lat: 26.19, store_lng: -98.18, delivery_lat: 26.3, delivery_lng: -98.2,
    delivery_city: "Edinburg", delivery_windows: null, delivery_date: "2026-10-06", delivery_duration: null, pickup_duration: null,
    pod_delivered_at: null, pickup_gps_at: null, ...x,
  });
  // Tres órdenes recogidas en RDZ Pharr; dos van a la misma dirección.
  const tres = [
    { ...p({ id: "a", order_code: "A", route_seq: 0 }), invoice_num: "INV-1", delivery_address: "1 Main St" },
    { ...p({ id: "b", order_code: "B", route_seq: 1 }), invoice_num: "INV-2", delivery_address: "1 main st" },
    { ...p({ id: "c", order_code: "C", route_seq: 2, delivery_lat: 26.5 }), invoice_num: "INV-3", delivery_address: "9 Elm" },
  ];
  const puntos = (marcadas?: Set<string>) => puntosDeLasRutas({
    carriles: carrilesDelDia([{ id: "u-ana", full_name: "Ana" }], [], tres, []), porChofer: rutasPorChofer(tres), delDia: tres, hechas: new Map(),
    pasaFiltro: () => true, soloUnChofer: false, enfocado: false, atenuada: () => false, colorDe: () => "rojo", colorSinChofer: "gris",
    baseDe: () => ({ coords: [26.19, -98.18], direccion: "RDZ Pharr" }), lecturaDe: (_k, s) => lecturaConLoHecho(s, 12, null, []),
    coordsDeTienda: () => ({ lat: 26.19, lng: -98.18 }), t,
    marcadas: marcadas && { tiene: (id) => marcadas.has(id), colorDe: () => "azul", cuantas: marcadas.size },
  });
  it("las tres recogidas en la tienda son UNA burbuja «1» del color del chofer, que dice qué se recoge", () => {
    const recogidas = puntos().filter((x) => x.id.startsWith("__parada__"));
    expect(recogidas).toHaveLength(1);
    expect(recogidas[0]).toMatchObject({ badge: "1", color: "rojo", lat: 26.19 });
    expect(recogidas[0].label).toBe("Stop 1 — pick up P1, P2, P3 · INV-1, INV-2, INV-3 — Ana · RDZ Pharr");
  });
  it("las dos entregas a la misma dirección son UNA burbuja «2»; la otra, «3»", () => {
    const pts = puntos();
    expect(pts.find((x) => x.id === "a")).toMatchObject({ badge: "2", label: "Stop 2 — deliver D1, D2 · INV-1, INV-2 — Ana" });
    expect(pts.some((x) => x.id === "b")).toBe(false);
    expect(pts.find((x) => x.id === "c")).toMatchObject({ badge: "3" });
  });
  it("una orden marcada ☑ se pinta aparte, en su color; la burbuja de su parada la lleva la siguiente", () => {
    const pts = puntos(new Set(["a"]));
    expect(pts.find((x) => x.id === "a")).toMatchObject({ badge: "D", color: "azul", label: "INV-1 — Ana (Stop 2)" });
    expect(pts.find((x) => x.id === "b")).toMatchObject({ badge: "2", color: "rojo" });
  });
});

describe("el mapa: una orden repartida en dos cargas (plan del motor)", () => {
  it("si va dentro de la burbuja de otra en una parada pero lleva la suya en otra, se pinta, con sus dos números", () => {
    const base = { order_no: 1, stage: "approved", assigned_driver: "Ana", route_seq: 0, delivery_lat: 26.3, delivery_lng: -98.2, store: "RDZ Pharr" };
    const dos = [
      { ...base, id: "a", order_code: "A", invoice_num: "INV-1", delivery_address: "1 Main St" },
      { ...base, id: "b", order_code: "B", invoice_num: "INV-2", delivery_address: "1 Main St", route_seq: 1 },
    ];
    const filas: FilaDeLaRuta[] = [P("a", "P1"), P("b", "P2"), D("b", "D2"), D("a", "D1"), P("a", "P1"), { ...D("a", "D1"), otraCarga: true }];
    const pts = puntosDeLasRutas({
      carriles: carrilesDelDia([{ id: "u-ana", full_name: "Ana" }], [], dos, []), porChofer: rutasPorChofer(dos), delDia: dos, hechas: new Map(),
      pasaFiltro: () => true, soloUnChofer: false, enfocado: false, atenuada: () => false, colorDe: () => "rojo", colorSinChofer: "gris",
      baseDe: () => null, lecturaDe: () => ({ etiquetaDe: new Map(), filas }), coordsDeTienda: () => ({ lat: 26.19, lng: -98.18 }), t,
    });
    expect(pts.find((x) => x.id === "b")).toMatchObject({ badge: "2" });
    expect(pts.find((x) => x.id === "a")).toMatchObject({ badge: "2·4", label: "Stop 4 — deliver D1 · INV-1 — Ana" });
  });
});

describe("la pantalla usa las paradas", () => {
  const gestor = plano(leer("src/app/(app)/routes/page.tsx"));
  it("la tabla: el número delante de la P/D de cada fila, primera fila con el número y las demás con la raya", () => {
    expect(gestor).toContain("const numeradas = paradasDeLaRuta(lectura.filas, stops);");
    expect(gestor).toContain("return numeradas.primera[fi] ? <span className=\"numero-de-parada\" data-numero-de-parada={n}");
    expect(gestor).toContain(": <span className=\"numero-de-parada sigue\" data-sigue-la-parada={n}");
    expect(gestor.split("{numeroDeParada(fi)}{f.etiqueta}").length - 1).toBe(3);
    expect(gestor).toContain("{t(\"Stop\", \"Parada\")}<span className=\"col-resizer\" onMouseDown={asaDeParada(\"_n\")} />");
  });
  it("la columna del número no baja de su partida aunque se guardara más estrecha (46 de antes → 96)", () => {
    expect(ANCHO_FIJO_DE_PARADAS._n).toBe(96);
    expect(anchoDelNumeroDeParada(46)).toBe(96);
    expect(anchoDelNumeroDeParada(130)).toBe(130);
    expect(gestor).toContain("return clave === \"_n\" ? anchoDelNumeroDeParada(w) : w;");
  });
  it("la cabecera cuenta paradas, no filas", () => {
    expect(gestor).toContain("{numeradas.paradas.length} {t(\"stops\", \"paradas\")} ·");
    expect(gestor).not.toContain("{cuenta.totales.paradas} {t(\"stops\"");
  });
  it("el mapa numera con la misma función, sobre la misma lectura", () => {
    expect(plano(leer("src/lib/mapa-de-rutas.ts"))).toContain("for (const p of paradasDeLaRuta(lectura.filas, list).paradas) {");
  });
  it("la leyenda de «Ruta de hoy» explica los números", () => {
    const l = leyendaDelMapa({ choferes: [], coloresDeChofer: {}, rutasSinChofer: false, puedeAsignar: false, rutasDelDia: { camiones: false } });
    expect(l.find((x) => x.clave === "recogida_de_ruta")).toMatchObject({ insignia: "1", es: "Parada 1, 2, 3… en el orden de la ruta: recoger en la tienda" });
  });
});
