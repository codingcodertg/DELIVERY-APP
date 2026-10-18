import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  centroDeLasTiendas, centroInicial, encuadreDeLaRegion, encuadreFinal, puntosParaEncuadrar, RADIO_MAX_KM, topeDeAlejamiento,
  ZOOM_MINIMO_DEL_MAPA, zoomDeLaCaja,
} from "./encuadre-del-mapa";
import { distanceMeters } from "./geo";

// Tres tiendas inventadas en el Valle (no son las de Ajustes del dueño).
const tiendas = [{ lat: 26.20, lng: -98.23 }, { lat: 26.30, lng: -98.16 }, { lat: 25.95, lng: -97.50 }];
const mcallen: [number, number] = [26.21, -98.24];
const harlingen: [number, number] = [26.19, -97.70];

describe("puntosParaEncuadrar (D-NEXT): qué entra en fitBounds", () => {
  it("el 0,0 queda fuera y se cuenta", () => {
    const r = puntosParaEncuadrar([mcallen, [0, 0], harlingen], tiendas);
    expect(r.validos).toEqual([mcallen, harlingen]);
    expect(r.descartados).toEqual([[0, 0]]);
  });
  it("un punto a 1.000 km (Houston→no, Dallas sí: 32.78,-96.80) queda fuera; uno a 100 km entra", () => {
    const dallas: [number, number] = [32.78, -96.80];
    expect(distanceMeters({ lat: dallas[0], lng: dallas[1] }, centroDeLasTiendas(tiendas))).toBeGreaterThan(700_000);
    const r = puntosParaEncuadrar([mcallen, dallas], tiendas);
    expect(r.validos).toEqual([mcallen]);
    expect(r.descartados).toEqual([dallas]);
    // Raymondville-ish, dentro del radio.
    expect(puntosParaEncuadrar([[26.48, -97.78]], tiendas).validos).toHaveLength(1);
  });
  it("NaN, null convertido, y coordenadas imposibles quedan fuera (las imposibles, por el radio)", () => {
    const r = puntosParaEncuadrar([[NaN, -98], [26.2, Infinity], [95, -98], [26.2, -181], [null as unknown as number, 0]], tiendas);
    expect(r.validos).toEqual([]);
    expect(r.descartados).toHaveLength(5);
  });
  it("el radio es de 300 km alrededor del centro de las tiendas, no un número suelto", () => {
    expect(RADIO_MAX_KM).toBe(300);
    const c = centroDeLasTiendas(tiendas);
    // ~2,7° de latitud al norte ≈ 300 km: justo fuera; 2,5° ≈ 278 km: dentro.
    expect(puntosParaEncuadrar([[c.lat + 2.75, c.lng]], tiendas).validos).toEqual([]);
    expect(puntosParaEncuadrar([[c.lat + 2.5, c.lng]], tiendas).validos).toHaveLength(1);
  });
  it("el centro es la mediana: una tienda mal geocodificada en otro estado no arrastra el radio hacia ella", () => {
    const conMala = [...tiendas, { lat: 39.1, lng: -94.6 }]; // «Mission», pero en Kansas
    const c = centroDeLasTiendas(conMala);
    expect(c.lat).toBeLessThan(27);
    expect(puntosParaEncuadrar([[39.1, -94.6]], conMala).validos).toEqual([]);
  });
  it("sin tiendas con punto, el centro es el de la zona local por defecto y el 0,0 sigue fuera", () => {
    const c = centroDeLasTiendas([]);
    expect(c.lat).toBeGreaterThan(25.8); expect(c.lat).toBeLessThan(26.5);
    expect(c.lng).toBeGreaterThan(-98.6); expect(c.lng).toBeLessThan(-97.1);
    expect(centroDeLasTiendas([{ lat: 0, lng: 0 }])).toEqual(c);
    // Una tienda con NaN no envenena la mediana (NaN en la mediana dejaría el centro en NaN y todo fuera).
    expect(centroDeLasTiendas([{ lat: NaN, lng: -98 }, { lat: 26.2, lng: Infinity }, ...tiendas])).toEqual(centroDeLasTiendas(tiendas));
    expect(puntosParaEncuadrar([mcallen, [0, 0]], []).validos).toEqual([mcallen]);
  });
});

describe("encuadreDeLaRegion (D-NEXT): sin puntos, la región de las tiendas", () => {
  it("EXACTAMENTE la caja de las tiendas («exactly visible all stores but not further»), ni un grado más", () => {
    expect(encuadreDeLaRegion(tiendas)).toEqual([[25.95, -98.23], [26.30, -97.50]]);
  });
  it("una sola tienda (o dos en la misma ciudad): un lado mínimo de 0,3° centrado en ellas, no su acera", () => {
    const [[a, b], [c, d]] = encuadreDeLaRegion([{ lat: 26.2, lng: -98.2 }]);
    expect(c - a).toBeCloseTo(0.3, 6); expect(d - b).toBeCloseTo(0.3, 6);
    expect((a + c) / 2).toBeCloseTo(26.2, 6); expect((b + d) / 2).toBeCloseTo(-98.2, 6);
    // Dos tiendas separadas 0,5° en longitud y 0,02° en latitud: la longitud exacta, la latitud al mínimo.
    const [[e, f], [g, h]] = encuadreDeLaRegion([{ lat: 26.20, lng: -98.20 }, { lat: 26.22, lng: -97.70 }]);
    expect(f).toBeCloseTo(-98.20, 6); expect(h).toBeCloseTo(-97.70, 6);
    expect(g - e).toBeCloseTo(0.3, 6); expect((e + g) / 2).toBeCloseTo(26.21, 6);
  });
  it("sin tiendas, la caja de la zona local; con una tienda en 0,0, igual que sin tiendas", () => {
    const sin = encuadreDeLaRegion([]);
    expect(sin[0][0]).toBeCloseTo(25.852, 3); expect(sin[1][0]).toBeCloseTo(26.45, 3);
    expect(sin[0][1]).toBeCloseTo(-98.58, 3); expect(sin[1][1]).toBeCloseTo(-97.12, 3);
    expect(encuadreDeLaRegion([{ lat: 0, lng: 0 }])).toEqual(sin);
  });
  it("una tienda lejana no estira la región", () => {
    const [[minLat], [maxLat]] = encuadreDeLaRegion([...tiendas, { lat: 39.1, lng: -94.6 }]);
    expect(maxLat).toBeLessThan(27); expect(minLat).toBeGreaterThan(25);
  });
});

describe("topeDeAlejamiento (D-NEXT): «not further than that»", () => {
  it("zoomDeLaCaja: una caja de 0,3° en un mapa de 800×430 con 45 px de margen cabe a ~10,5; el doble de caja, un nivel menos", () => {
    const z = zoomDeLaCaja([[26.05, -98.35], [26.35, -98.05]], 800, 430);
    expect(z).toBeGreaterThan(10.3); expect(z).toBeLessThan(10.7);
    const z2 = zoomDeLaCaja([[25.90, -98.50], [26.50, -97.90]], 800, 430);
    expect(z - z2).toBeCloseTo(1, 1);
    // Manda el lado que menos cabe: una caja ancha y baja la limita el ancho.
    const ancha = zoomDeLaCaja([[26.20, -99.00], [26.21, -97.00]], 800, 430);
    expect(ancha).toBeLessThan(zoomDeLaCaja([[26.20, -98.10], [26.21, -97.90]], 800, 430));
  });
  it("el tope es la región de las tiendas redondeada hacia abajo, y nunca por debajo de 8", () => {
    const z = zoomDeLaCaja(encuadreDeLaRegion(tiendas), 800, 430);
    expect(topeDeAlejamiento(tiendas, 800, 430)).toBe(Math.floor(z));
    expect(topeDeAlejamiento(tiendas, 800, 430)).toBeGreaterThanOrEqual(9);
    // Una región enorme (tiendas a 2° entre sí) cae al suelo de 8.
    expect(topeDeAlejamiento([{ lat: 25, lng: -100 }, { lat: 27.5, lng: -96 }], 800, 430)).toBe(ZOOM_MINIMO_DEL_MAPA);
    // Una sola tienda: su ciudad (el lado mínimo), tope ~10.
    expect(topeDeAlejamiento([{ lat: 26.2, lng: -98.2 }], 800, 430)).toBe(10);
    // Un mapa sin tamaño aún (0×0): no explota ni devuelve NaN.
    expect(Number.isFinite(topeDeAlejamiento(tiendas, 0, 0))).toBe(true);
  });
});

describe("encuadreFinal (D-NEXT): lo que recibe fitBounds", () => {
  it("fitTo ausente: null (quien monta el mapa no encuadra)", () => {
    expect(encuadreFinal(undefined, tiendas)).toBeNull();
  });
  it("fitTo vacío o solo basura: la región, marcada como tal, con lo descartado", () => {
    const vacio = encuadreFinal([], tiendas);
    expect(vacio).toMatchObject({ region: true, descartados: [] });
    expect(vacio!.validos).toEqual(encuadreDeLaRegion(tiendas));
    const basura = encuadreFinal([[0, 0]], tiendas);
    expect(basura).toMatchObject({ region: true, descartados: [[0, 0]] });
  });
  it("con puntos válidos: solo esos, sin la región", () => {
    expect(encuadreFinal([mcallen, [0, 0]], tiendas)).toEqual({ validos: [mcallen], descartados: [[0, 0]], region: false });
  });
  it("el centro inicial salta el punto malo", () => {
    expect(centroInicial([[0, 0], harlingen], tiendas)).toEqual({ lat: harlingen[0], lng: harlingen[1] });
    expect(centroInicial([], tiendas)).toEqual(centroDeLasTiendas(tiendas));
  });
});

describe("los dos mapas pasan por aquí (D-NEXT)", () => {
  const google = readFileSync("src/components/GoogleMapView.tsx", "utf8");
  const leaflet = readFileSync("src/components/LeafletMap.tsx", "utf8");
  it("encuadran con encuadreFinal y centran con centroInicial, con tope de alejamiento", () => {
    for (const [nombre, src] of [["GoogleMapView", google], ["LeafletMap", leaflet]] as const) {
      expect(src, nombre).toMatch(/encuadreFinal\(fitTo, stores\)/);
      expect(src, nombre).toMatch(/centroInicial\(/);
      expect(src, nombre).toMatch(/minZoom: ZOOM_MINIMO_DEL_MAPA/);
      expect(src, nombre).toMatch(/topeDeAlejamiento\(stores, /);
      expect(src, nombre).not.toMatch(/RGV_FALLBACK|26\.2034/);
    }
    expect(ZOOM_MINIMO_DEL_MAPA).toBe(8);
  });
  it("Google: fitBounds recibe los puntos filtrados, no fitTo tal cual", () => {
    expect(google).toMatch(/for \(const \[lat, lng\] of enc\.validos\) bounds\.extend/);
    expect(google).not.toMatch(/of fitTo\) bounds/);
  });
  it("Leaflet: idem", () => {
    expect(leaflet).toMatch(/latLngBounds\(enc\.validos\.map/);
    expect(leaflet).not.toMatch(/latLngBounds\(fitTo\.map/);
  });
  it("el tope se fija ANTES de fitBounds, en los dos, con el tamaño real del mapa", () => {
    expect(google.indexOf("map.setOptions({ minZoom: topeDeAlejamiento(stores, el.clientWidth, el.clientHeight) })")).toBeGreaterThan(0);
    expect(google.indexOf("map.setOptions({ minZoom: topeDeAlejamiento(")).toBeLessThan(google.indexOf("map.fitBounds(bounds, 45)"));
    expect(leaflet.indexOf("mapRef.current.setMinZoom(topeDeAlejamiento(stores, tam.x, tam.y))")).toBeGreaterThan(0);
    expect(leaflet.indexOf("setMinZoom(topeDeAlejamiento(")).toBeLessThan(leaflet.indexOf("mapRef.current.fitBounds(bounds"));
  });
});
