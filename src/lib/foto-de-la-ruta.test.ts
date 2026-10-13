import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { encuadreDeLaFoto, filasDeLaFoto, lineasDeLaRuta, nombreDelPng, palletsDeLaFoto, puedeCompartirFicheros, puntosDeLaRuta } from "./foto-de-la-ruta";
import type { MapLine, MapPoint } from "@/components/LeafletMap";
import type { Delivery } from "@/lib/types";

// D-NEXT · «crea una opcion para crear una imagen png del schedule y el mapa con su ruta en el mapa parfa mandarlo al driver».

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

describe("el Gestor y el cuadro", () => {
  it("el Gestor: «📸 PNG» en la cabecera de cada ruta con paradas, también en solo lectura, y el cuadro con SOLO esa ruta", () => {
    const g = leer("src/app/(app)/routes/page.tsx");
    expect(g).toContain('import { FotoDeLaRuta } from "@/components/FotoDeLaRuta";');
    expect(g).toContain("const [pngDe, setPngDe] = useState<string | null>(null);");
    expect(g).toContain('<button className="btn btn-ghost btn-sm" data-png-de-la-ruta={u.key}');
    expect(g).toContain("points={puntosDeLaRuta(points, u, new Set(stops.map((d) => d.id)))} lines={lineasDeLaRuta(lines, u.key)} />");
    expect(g).toContain("<FotoDeLaRuta chofer={u.label} fecha={date} stops={stops} color={colorFor(u.driver)} t={t} onClose={() => setPngDe(null)}");
  });
  it("el cuadro: fotografía la hoja con snapdom (el de Ayuda) a doble escala, sin los botones; descarga o comparte", () => {
    const c = leer("src/components/FotoDeLaRuta.tsx");
    expect(c).toContain('import { cargaSnapdom } from "@/components/CapturaDeAyuda";');
    expect(c).toContain('snapdom.toCanvas(hoja.current!, { backgroundColor: "#ffffff", fast: true, scale: 2, exclude: ["[data-fuera-de-la-foto]"], excludeMode: "remove" })');
    expect(c).toContain("<MapView points={points} lines={lines} fitTo={fitTo} height={360} />");
    expect(c).toContain("a.href = url; a.download = nombre; a.click();");
    expect(c).toContain("await navigator.share({ files: [fichero], title: `${chofer} · ${fmtDate(fecha)}` });");
    expect(c).toContain('if ((e as { name?: string })?.name !== "AbortError")');
    expect(leer("src/components/CapturaDeAyuda.tsx")).toContain("export function cargaSnapdom(): Promise<Snapdom> {");
  });
});
