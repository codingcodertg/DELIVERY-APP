import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { LADO_DEL_PIN, RADIO_MAXIMO, abanicoDeMarcas, metrosPorPixel, radioDelAbanico } from "./abanico-de-marcas";

/** El abanico de las marcas que comparten punto (D-367). Coordenadas inventadas del Valle. */

const leer = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8").replace(/\r\n/g, "\n");
const marca = (id: string, lat: number, lng: number) => ({ id, lat, lng });
const PUNTO = { lat: 26.2034, lng: -98.23 };
const separacion = (n: number) => 2 * radioDelAbanico(n) * Math.sin(Math.PI / n);

describe("qué se mueve y qué no", () => {
  it("una marca sola en su punto NO se mueve: no sale en el reparto", () => {
    const r = abanicoDeMarcas([marca("a", PUNTO.lat, PUNTO.lng), marca("b", 26.3017, -98.1633)]);
    expect(r.size).toBe(0);
  });
  it("dos en el MISMO punto se abren, una a cada lado, y siguen centradas en él", () => {
    const r = abanicoDeMarcas([marca("a", PUNTO.lat, PUNTO.lng), marca("b", PUNTO.lat, PUNTO.lng)]);
    expect([...r.keys()].sort()).toEqual(["a", "b"]);
    const a = r.get("a")!, b = r.get("b")!;
    expect(a).not.toEqual(b);
    // El abanico gira alrededor del punto real: la suma de los desplazamientos se va a cero.
    expect(a.x + b.x).toBe(0);
    expect(a.y + b.y).toBe(0);
  });
  it("marcas CERCANAS pero no iguales se quedan donde están: al acercar el mapa se separan solas", () => {
    // ~1 m de diferencia: se ven encima al alejar, pero moverlas las dejaría mal puestas al acercar.
    expect(abanicoDeMarcas([marca("a", 26.2034, -98.23), marca("b", 26.20341, -98.23)]).size).toBe(0);
  });
  it("lo que no tiene coordenada no entra, ni siquiera acompañado: dos sin punto no son un grupo", () => {
    // Con UNA sola no basta para probarlo: se caería igual por quedarse sola en su grupo. Hacen falta DOS, que es
    // justo lo que agruparía un `NaN.toFixed(6)` convertido en la clave "NaN,NaN" — y por eso las dos van sin coordenada NINGUNA,
    // que si no cada una cae en su propia clave y el guardián no decide nada.
    const r = abanicoDeMarcas([marca("a", NaN, NaN), marca("z", NaN, NaN), marca("b", PUNTO.lat, PUNTO.lng), marca("c", PUNTO.lat, PUNTO.lng)]);
    expect(r.has("a")).toBe(false);
    expect(r.has("z")).toBe(false);
    expect(r.size).toBe(2);
  });
  it("el mismo dato da el mismo reparto, y en el orden en que llegan", () => {
    const ms = [marca("a", PUNTO.lat, PUNTO.lng), marca("b", PUNTO.lat, PUNTO.lng), marca("c", PUNTO.lat, PUNTO.lng)];
    expect([...abanicoDeMarcas(ms)]).toEqual([...abanicoDeMarcas(ms)]);
    expect(abanicoDeMarcas(ms).get("a")).toEqual({ x: 0, y: -18 });     // la primera, arriba
  });
  it("dos puntos distintos, cada uno con su abanico, sin mezclarse", () => {
    const r = abanicoDeMarcas([
      marca("a1", PUNTO.lat, PUNTO.lng), marca("a2", PUNTO.lat, PUNTO.lng),
      marca("b1", 26.3017, -98.1633), marca("b2", 26.3017, -98.1633), marca("b3", 26.3017, -98.1633),
    ]);
    expect(r.size).toBe(5);
    // Los dos empiezan arriba, pero con SU radio: el grupo de tres se abre mas que el de dos.
    for (const id of ["a1", "b1"]) { const d = r.get(id)!; expect(d.x).toBe(0); expect(d.y).toBeLessThan(0); }
    expect(r.get("a1")!.y).toBeGreaterThan(r.get("b1")!.y);              // -15 esta por encima de -18: menos radio
    expect(new Set([...r.values()].map((d) => `${d.x},${d.y}`)).size).toBe(5);
  });
});

describe("el radio: que dos vecinas no compartan centro", () => {
  it("hasta ocho marcas, la separación entre vecinas es al menos un pin entero", () => {
    for (let n = 2; n <= 8; n++) expect(separacion(n), `${n} marcas`).toBeGreaterThanOrEqual(LADO_DEL_PIN);
  });
  it("de nueve en adelante el radio se para en el tope, y se acepta que vuelvan a rozarse", () => {
    expect(radioDelAbanico(9)).toBe(RADIO_MAXIMO);
    expect(radioDelAbanico(30)).toBe(RADIO_MAXIMO);
    expect(separacion(12)).toBeLessThan(LADO_DEL_PIN);
  });
  it("crece con el número de marcas y nunca es negativo; con una sola no hay radio", () => {
    expect(radioDelAbanico(1)).toBe(0);
    for (let n = 2; n < 9; n++) expect(radioDelAbanico(n + 1)).toBeGreaterThanOrEqual(radioDelAbanico(n));
  });
  it("las marcas de un grupo caben dentro del radio: el desplazamiento no se dispara", () => {
    const ms = Array.from({ length: 6 }, (_, i) => marca(`m${i}`, PUNTO.lat, PUNTO.lng));
    for (const d of abanicoDeMarcas(ms).values()) expect(Math.hypot(d.x, d.y)).toBeLessThanOrEqual(radioDelAbanico(6) + 1);
  });
});

describe("cuánto es eso en metros", () => {
  it("un píxel mide lo que mide el zoom, y a la latitud del Valle", () => {
    expect(metrosPorPixel(0, 0)).toBeCloseTo(156543.03, 1);
    // Medido en el navegador el 2026-09-23: 285 m/px con todas las rutas, 34 con una elegida.
    expect(metrosPorPixel(26.2, 9)).toBeCloseTo(274, 0);
    expect(metrosPorPixel(26.2, 12)).toBeCloseTo(34.3, 1);
    expect(metrosPorPixel(26.2, 13)).toBeLessThan(metrosPorPixel(26.2, 12));
  });
});

describe("dónde está cableado: solo el Gestor", () => {
  const gestor = leer("src/app/(app)/routes/page.tsx");
  it("el Gestor lo aplica a sus puntos, lo último, y solo si hay algo que mover", () => {
    expect(gestor).toContain("const abanico = abanicoDeMarcas(pts);");
    expect(gestor).toContain("return abanico.size ? pts.map((p) => { const o = abanico.get(p.id); return o ? { ...p, offset: o } : p; }) : pts;");
  });
  it("las otras pantallas que montan un mapa no lo usan: allí nada se mueve", () => {
    for (const ruta of ["src/app/(app)/map/page.tsx", "src/app/(app)/my-route/page.tsx", "src/app/(app)/track/page.tsx",
                        "src/app/(app)/warehouse/page.tsx", "src/app/(app)/market/page.tsx", "src/components/OrderModal.tsx"]) {
      expect(leer(ruta), ruta).not.toContain("abanicoDeMarcas");
    }
  });
  it("los dos motores lo restan del ancla, y un punto sin desplazamiento se pinta donde se pintaba", () => {
    const leaflet = leer("src/components/LeafletMap.tsx"), google = leer("src/components/GoogleMapView.tsx");
    expect(leaflet).toContain("iconAnchor: [13 - (p.offset?.x ?? 0), 28 - (p.offset?.y ?? 0)]");
    expect(leaflet).toContain("iconAnchor: [8 - (p.offset?.x ?? 0), 8 - (p.offset?.y ?? 0)]");
    expect(google).toContain("anchor: new maps.Point(16 - (p.offset?.x ?? 0), 36 - (p.offset?.y ?? 0))");
    expect(google).toContain("anchor: new maps.Point(9 - (p.offset?.x ?? 0), 9 - (p.offset?.y ?? 0))");
    // La posición del marcador NO se toca: lo que se mueve es el dibujo sobre ella, así que no hay que recalcular al hacer zoom.
    expect(leaflet).toContain("L.marker([p.lat, p.lng]");
    expect(google).toContain("position: { lat: p.lat, lng: p.lng },");
  });
  it("la casita de la tienda se queda quieta: no pasa por el abanico", () => {
    const capa = leer("src/components/LeafletMap.tsx");
    const tiendas = capa.slice(capa.indexOf("for (const s of stores)"), capa.indexOf("Live drivers"));
    expect(tiendas).not.toContain("offset");
  });
});
