import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { anchoSinAcciones, encuadreDeLaFoto, filasDeLaFoto, FUERA_DE_LA_TABLA, lineasDeLaRuta, nombreDelPng, palletsDeLaFoto, puedeCompartirFicheros, puntosDeLaRuta } from "./foto-de-la-ruta";
import type { MapLine, MapPoint } from "@/components/LeafletMap";
import type { ParadaFisica } from "@/lib/gestor/paradas-numeradas";
import type { Delivery } from "@/lib/types";

// D-536 · «crea una opcion para crear una imagen png del schedule y el mapa con su ruta en el mapa parfa mandarlo al driver».

const leer = (p: string) => readFileSync(p, "utf8").split("\r\n").join("\n");
const pt = (id: string, extra: Partial<MapPoint> = {}): MapPoint => ({ id, lat: 26, lng: -97, color: "#000", label: id, dimmed: true, offset: [3, 3] as unknown as MapPoint["offset"], ...extra });
const carlos = { id: "u-carlos", key: "Carlos R." };

describe("qué va en la foto de UNA ruta", () => {
  const points = [pt("__depot__u-carlos"), pt("__fin__u-carlos"), pt("__parada__Carlos R.__1"), pt("o1"), pt("o2"), pt("__depot__u-miguel"), pt("__parada__Miguel A.__1"), pt("m1"), pt("__selpk__o1")];
  it("sus marcas: su base, su fin, sus recogidas en tienda y sus entregas; todas encendidas y sin abanico", () => {
    const mias = puntosDeLaRuta(points, carlos, new Set(["o1", "o2"]));
    expect(mias.map((p) => p.id)).toEqual(["__depot__u-carlos", "__fin__u-carlos", "__parada__Carlos R.__1", "o1", "o2"]);
    for (const p of mias) { expect(p.dimmed).toBe(false); expect("offset" in p).toBe(false); }
  });
  it("D-678: lo ya hecho de sus órdenes (`__hecha__<id>`) también; lo hecho de otro, no", () => {
    const mias = puntosDeLaRuta([...points, pt("__hecha__o3"), pt("__hecha__m1")], carlos, new Set(["o1", "o3"]));
    expect(mias.map((p) => p.id)).toEqual(["__depot__u-carlos", "__fin__u-carlos", "__parada__Carlos R.__1", "o1", "__hecha__o3"]);
  });
  it("sus líneas: el trazo medido (ida y regreso) o el del plan publicado; las de otros no; encendidas y sin desplazar", () => {
    const lines: MapLine[] = [
      { id: "line:Carlos R.#0", color: "#000", positions: [[1, 1], [2, 2]], dimmed: true, offset: 5 },
      { id: "ret:Carlos R.#0", color: "#000", positions: [[2, 2], [1, 1]], dashed: true, offset: 12 },
      { id: "plan:Carlos R.", color: "#000", positions: [[1, 1]] },
      { id: "line:Miguel A.#0", color: "#000", positions: [[9, 9]] },
      { id: "sel:o1", color: "#000", positions: [[1, 1]] },
    ];
    const mias = lineasDeLaRuta(lines, "Carlos R.");
    expect(mias.map((l) => l.id)).toEqual(["line:Carlos R.#0", "ret:Carlos R.#0", "plan:Carlos R."]);
    for (const l of mias) { expect(l.dimmed).toBe(false); expect(l.offset).toBe(0); }
    expect(mias[1].dashed).toBe(true);
  });
  it("el encuadre: todas sus marcas y todo su trazo", () => {
    expect(encuadreDeLaFoto([pt("a", { lat: 1, lng: 2 })], [{ id: "x", color: "", positions: [[3, 4], [5, 6]] }])).toEqual([[1, 2], [3, 4], [5, 6]]);
    expect(encuadreDeLaFoto([], [])).toEqual([]);
  });
});

describe("D-678: la ruta sin orden guardado sale numerada como su tabla", () => {
  // Maximo Garza, 2026-10-26: una orden, `route_seq` vacío. El Gestor la pinta como un punto sin número y sin su recogida.
  const parada = (numero: number, tipo: "P" | "D", ordenes: string[], lugar: string | null, etiquetas = [`${tipo}1`]): ParadaFisica =>
    ({ numero, tipo, filas: [], etiquetas, ordenes, lugar });
  const paradas = [parada(1, "P", ["o1"], "RDZ Brownsville"), parada(2, "D", ["o1"], null)];
  const coordsDeTienda = (n: string | null) => (n === "RDZ Brownsville" ? { lat: 25.95, lng: -97.48 } : null);
  const numeros = { paradas, color: "#e67e22", coordsDeTienda };
  const sinNumeros = [pt("__depot__u-carlos", { badge: "P" }), pt("o1"), pt("m1")];
  it("la entrega lleva el número de su parada y la recogida su marca en la tienda, detrás de la base", () => {
    const mias = puntosDeLaRuta(sinNumeros, carlos, new Set(["o1"]), numeros);
    expect(mias.map((p) => [p.id, p.badge])).toEqual([["__depot__u-carlos", "P"], ["__parada__Carlos R.__1", "1"], ["o1", "2"]]);
    expect(mias[1]).toMatchObject({ lat: 25.95, lng: -97.48, color: "#e67e22", dimmed: false });
  });
  it("una orden en dos paradas lleva los dos números; una tienda sin coordenadas no inventa marca", () => {
    const dos = [parada(1, "P", ["o1"], "Sin coords"), parada(2, "D", ["o1"], null), parada(3, "D", ["o1"], null)];
    const mias = puntosDeLaRuta(sinNumeros, carlos, new Set(["o1"]), { ...numeros, paradas: dos });
    expect(mias.map((p) => [p.id, p.badge])).toEqual([["__depot__u-carlos", "P"], ["o1", "2·3"]]);
  });
  it("si el mapa del Gestor ya trae números (una entrega con número o una recogida), no se tocan", () => {
    const conEntrega = [pt("__depot__u-carlos", { badge: "P" }), pt("o1", { badge: "5" })];
    expect(puntosDeLaRuta(conEntrega, carlos, new Set(["o1"]), numeros).map((p) => [p.id, p.badge])).toEqual([["__depot__u-carlos", "P"], ["o1", "5"]]);
    const conRecogida = [pt("__parada__Carlos R.__1", { badge: "1" }), pt("o1")];
    expect(puntosDeLaRuta(conRecogida, carlos, new Set(["o1"]), numeros).map((p) => [p.id, p.badge])).toEqual([["__parada__Carlos R.__1", "1"], ["o1", undefined]]);
  });
  it("sin `numeros`, como antes", () => {
    expect(puntosDeLaRuta(sinNumeros, carlos, new Set(["o1"])).map((p) => [p.id, p.badge])).toEqual([["__depot__u-carlos", "P"], ["o1", undefined]]);
  });
});

describe("la lista y el fichero", () => {
  const d = (extra: Partial<Delivery>): Delivery => ({ id: "x", order_no: 7, invoice_num: null, delivery_windows: null, ...extra }) as unknown as Delivery;
  it("las filas en el orden de la ruta: #, factura (o número), cuenta, dirección, ventana, pallets", () => {
    const filas = filasDeLaFoto([
      d({ id: "a", invoice_num: "179500", account: "RDZ Brownsville", delivery_address: "27334 Prudencia", actual_pallets: 7, est_pallets: 5 }),
      d({ id: "b", order_no: 231, order_code: "FU231", delivery_name: "Cliente", est_pallets: 3 }),
      d({ id: "c", order_no: 9 }),
    ]);
    expect(filas.map((f) => [f.n, f.orden, f.cuenta, f.direccion, f.pallets])).toEqual([
      [1, "179500", "RDZ Brownsville", "27334 Prudencia", "7"],
      [2, "#FU231", "Cliente", "—", "3"],
      [3, "#9", "—", "—", "—"],
    ]);
    expect(palletsDeLaFoto([d({ actual_pallets: 7, est_pallets: 5 }), d({ est_pallets: 3 }), d({})])).toBe(10);
    // D-678: la ruta de Ernesto Castillo del 2026-10-26 daba «12.399999999999999 pallets».
    const ernesto = [2, 3, 2, 3, 1, 0.2, 0.25, 0.5, 0.25, 0.2].map((est_pallets) => d({ est_pallets }));
    expect(ernesto.reduce((n, x) => n + (x.est_pallets as number), 0)).not.toBe(12.4);
    expect(palletsDeLaFoto(ernesto)).toBe(12.4);
  });
  it("el nombre del PNG: sin acentos ni espacios, con el día", () => {
    expect(nombreDelPng("Máximo Garza", "2026-10-12")).toBe("ruta-maximo-garza-2026-10-12.png");
    expect(nombreDelPng("  ", "2026-10-12T05:00:00")).toBe("ruta-ruta-2026-10-12.png");
  });
  it("compartir solo donde el navegador comparte ficheros", () => {
    const f = new File(["x"], "a.png", { type: "image/png" });
    expect(puedeCompartirFicheros(undefined, f)).toBe(false);
    expect(puedeCompartirFicheros({ share: async () => {} } as unknown as Navigator, f)).toBe(false);
    expect(puedeCompartirFicheros({ share: async () => {}, canShare: () => true } as unknown as Navigator, f)).toBe(true);
    expect(puedeCompartirFicheros({ share: async () => {}, canShare: () => false } as unknown as Navigator, f)).toBe(false);
  });
});

describe("D-636: la foto lleva la tabla del Gestor", () => {
  it("anchoSinAcciones quita la última columna (flechas y acciones); una medida sin sentido deja la tabla entera", () => {
    expect(anchoSinAcciones(1300, 100)).toBe(1200);
    expect(anchoSinAcciones(1300, 0)).toBe(1300);
    expect(anchoSinAcciones(1300, 1300)).toBe(1300);
    expect(anchoSinAcciones(1300, Number.NaN)).toBe(1300);
    expect([...FUERA_DE_LA_TABLA]).toEqual(['input[type="checkbox"]', ".col-resizer"]);
  });
  it("el cuadro: mapa ARRIBA y la tabla de la página debajo, en tema claro, sin casillas; sin tabla, la lista sencilla", () => {
    const c = leer("src/components/FotoDeLaRuta.tsx");
    expect(c).toContain("document.querySelector<HTMLElement>(`[data-tabla-de-la-ruta=\"${CSS.escape(laneKey)}\"]`)");
    expect(c).toContain('snapdom.toCanvas(tabla, { backgroundColor: "#ffffff", scale: 2, exclude: [...FUERA_DE_LA_TABLA], excludeMode: "hide" })');
    expect(c).toContain('if (tema === "dark") raiz.setAttribute("data-theme", "light");');
    expect(c).toContain('if (tema === "dark") raiz.setAttribute("data-theme", tema);');
    expect(c).toContain("const ancho = anchoSinAcciones(tabla.offsetWidth, ultima?.offsetWidth ?? 0);");
    const mapa = c.indexOf("<LeafletMap points={points}");
    const imagen = c.indexOf("data-tabla-en-la-foto");
    const sencilla = c.indexOf("{tabla === null && (");
    expect(mapa).toBeGreaterThan(-1);
    expect(imagen).toBeGreaterThan(mapa);
    expect(sencilla).toBeGreaterThan(mapa);
    // El mapa se pinta cuando el cuadro ya tiene el ancho de la tabla (si no, Leaflet deja una franja gris).
    expect(c).toContain('{tabla === "cargando" ? (');
    expect(c.indexOf('{tabla === "cargando" ? (')).toBeLessThan(mapa);
    // Mientras se fotografía la tabla, no se puede descargar ni compartir (saldría sin ella).
    expect(c).toContain('data-descargar-png disabled={!!ocupado || tabla === "cargando"}');
    expect(c).toContain('if (ocupado || tabla === "cargando") return;');
  });
});

describe("el Gestor y el cuadro", () => {
  it("el Gestor: «📸 PNG» en la cabecera de cada ruta con paradas, también en solo lectura, y el cuadro con SOLO esa ruta", () => {
    const g = leer("src/app/(app)/routes/page.tsx");
    expect(g).toContain('import { FotoDeLaRuta } from "@/components/FotoDeLaRuta";');
    expect(g).toContain("const [pngDe, setPngDe] = useState<string | null>(null);");
    expect(g).toContain('<button className="btn btn-ghost btn-sm" data-png-de-la-ruta={u.key}');
    expect(g).toContain("points={puntosDeLaRuta(points, u, new Set([...stops, ...hechasDe(u.key)].map((d) => d.id)), { paradas: diaDe(u.key, stops).paradas, color: colorFor(u.driver), coordsDeTienda })} lines={lineasDeLaRuta(lines, u.key)} />");
    expect(g).toContain("<FotoDeLaRuta chofer={u.label} fecha={date} laneKey={u.key} stops={stops} color={colorFor(u.driver)} t={t} onClose={() => setPngDe(null)}");
    // D-636: la tabla de cada ruta lleva su clave, para que la foto la encuentre.
    expect(g).toContain('<table className="orders tbl-resize tabla-de-paradas" data-tabla-de-la-ruta={u.key}');
    // Y pulsar «📸 PNG» abre la ruta (si no, su tabla no está en la página); una sola foto, la de la tarjeta con tabla.
    expect(g).toContain("onClick={(e) => { e.stopPropagation(); abreParaLaFoto(u.key); setPngDe(u.key); }}>📸 PNG</button>");
    expect(g).toContain("if (!wideRoutes) { setDesplegada(key); return; }");
    expect(g).toContain("if (isCollapsed(key)) toggleCollapse(key);");
    expect(g).toContain('{pngDe === u.key && modoDeTarjeta !== "compacta" && (');
  });
  it("el cuadro: fotografía la hoja con snapdom (el de Ayuda) a doble escala, sin los botones; descarga o comparte", () => {
    const c = leer("src/components/FotoDeLaRuta.tsx");
    expect(c).toContain('import { cargaSnapdom } from "@/components/CapturaDeAyuda";');
    expect(c).toContain('snapdom.toCanvas(hoja.current!, { backgroundColor: "#ffffff", fast: true, scale: 2, exclude: ["[data-fuera-de-la-foto]", ".leaflet-control-zoom", ".gm-bundled-control"], excludeMode: "remove" })');
    // D-678: Leaflet con los mosaicos de Google (el mapa de Google salía sin marcas y con la región entera); en el demo, OSM.
    expect(c).toContain("<LeafletMap points={points} lines={lines} fitTo={fitTo} height={420} mosaicos={MOSAICOS_DE_LA_FOTO} />");
    expect(c).not.toContain("MapView");
    expect(c).toContain('const MOSAICOS_DE_LA_FOTO = process.env.NEXT_PUBLIC_LOCAL_MODE === "true" ? "osm" : "google";');
    const l = leer("src/components/LeafletMap.tsx");
    expect(l).toContain('mosaicos = "osm",');
    expect(l).toContain('if (mosaicos === "google") {\n        L.tileLayer("/api/map-tiles/{z}/{x}/{y}", { attribution: "Map data © Google", maxZoom: 19 }).addTo(map);');
    expect(c).toContain("a.href = url; a.download = nombre; a.click();");
    expect(c).toContain("await navigator.share({ files: [fichero], title: `${chofer} · ${fmtDate(fecha)}` });");
    expect(c).toContain('if ((e as { name?: string })?.name !== "AbortError")');
    expect(leer("src/components/CapturaDeAyuda.tsx")).toContain("export function cargaSnapdom(): Promise<Snapdom> {");
  });
});
