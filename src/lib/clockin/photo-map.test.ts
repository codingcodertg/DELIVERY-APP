import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { comoFence, estadoFoto, estiloMarcador, etiquetaFoto, geocercaDeFoto } from "./photo-map";
import type { SitioFoto } from "./day-photos";

// La ventana del mapa de una foto: estado y geocerca, sin recalcular nada en el cliente.

const NORTE: SitioFoto = { id: "s1", name: "Tienda Norte", latitude: 33, longitude: -96, radius_meters: 100, boundary: null, padding_meters: null };
const ALMACEN: SitioFoto = { id: "s2", name: "Almacén", latitude: 33.1, longitude: -96.1, radius_meters: 30, padding_meters: 25, boundary: [{ lat: 33.099, lng: -96.101 }, { lat: 33.101, lng: -96.101 }, { lat: 33.101, lng: -96.099 }] };
const SITES = [NORTE, ALMACEN];

describe("geocercaDeFoto: solo la de esa foto", () => {
  it("por siteId; sin siteId o desconocido, ninguna", () => {
    expect(geocercaDeFoto({ siteId: "s2" }, SITES)).toBe(ALMACEN);
    expect(geocercaDeFoto({ siteId: null }, SITES)).toBeNull();
    expect(geocercaDeFoto({ siteId: "nope" }, SITES)).toBeNull();
  });
});

describe("estadoFoto: qué se pinta", () => {
  it("sin coordenadas → sinCoords (no pulsable)", () => {
    expect(estadoFoto({ lat: null, lng: null, siteId: "s1", distanceM: 0 }, SITES)).toEqual({ kind: "sinCoords" });
  });
  it("con coordenadas y sin sitio (o sin distancia) → sinSitio, solo el punto", () => {
    expect(estadoFoto({ lat: 33, lng: -96, siteId: null, distanceM: null }, SITES)).toEqual({ kind: "sinSitio", lat: 33, lng: -96 });
    expect(estadoFoto({ lat: 33, lng: -96, siteId: "s1", distanceM: null }, SITES)).toEqual({ kind: "sinSitio", lat: 33, lng: -96 });
  });
  it("distancia 0 del servidor → dentro, con la geocerca", () => {
    expect(estadoFoto({ lat: 33.0004, lng: -96, siteId: "s1", distanceM: 0 }, SITES)).toEqual({ kind: "dentro", lat: 33.0004, lng: -96, site: NORTE });
  });
  it("distancia > 0 del servidor → fuera, con la geocerca y ESA distancia (no se recalcula)", () => {
    expect(estadoFoto({ lat: 33.01, lng: -96, siteId: "s1", distanceM: 1234 }, SITES)).toEqual({ kind: "fuera", lat: 33.01, lng: -96, site: NORTE, distanceM: 1234 });
  });
});

describe("estiloMarcador: color y tamaño por estado («un icon rojo más visible», sobre D-213)", () => {
  const fuera = estiloMarcador("fuera");
  const dentro = estiloMarcador("dentro");
  const sinSitio = estiloMarcador("sinSitio");
  it("fuera: el rojo del hub (--red, #d64545), claramente mayor que el estándar, y la etiqueta en rojo", () => {
    expect(fuera.fill).toBe("#d64545");
    expect(fuera.labelColor).toBe("#d64545");
    expect(fuera.scale).toBeGreaterThanOrEqual(dentro.scale * 1.8);
    expect(fuera.strokeWeight).toBeGreaterThan(dentro.strokeWeight);
    expect(fuera.labelClass).toContain("tt-map-label-out");
  });
  it("dentro: verde, tamaño normal (7 px, el de siempre)", () => {
    expect(dentro.fill).toBe("#22c55e");
    expect(dentro.scale).toBe(7);
    expect(dentro.labelClass).toBe("tt-map-label");
  });
  it("sin sitio: gris neutro, tamaño normal, y nunca el rojo", () => {
    expect(sinSitio.fill).toBe("#9aa6b8");
    expect(sinSitio.scale).toBe(dentro.scale);
    expect(sinSitio.fill).not.toBe(fuera.fill);
    expect(sinSitio.labelColor).not.toBe(fuera.labelColor);
  });
  it("mutación: los tres estados dan tres rellenos distintos, y solo «fuera» sale del tamaño estándar", () => {
    expect(new Set([fuera.fill, dentro.fill, sinSitio.fill]).size).toBe(3);
    expect([dentro.scale, sinSitio.scale].every((s) => s === 7)).toBe(true);
  });
  it("y el mapa, la ventana, la hoja y la línea bajo la foto lo usan (por fuente)", () => {
    const leer = (r: string) => readFileSync(join(process.cwd(), r), "utf8");
    const mapa = leer("src/components/timetracker/GeofenceMap.tsx");
    expect(mapa).toMatch(/const s = estiloMarcador\(p\.estado\)/);
    expect(mapa).not.toMatch(/p\.inside/);
    expect(leer("src/components/timetracker/PhotoMapModal.tsx")).toMatch(/estado: e\.kind/);
    expect(leer("src/app/timetracker/timetracker.css")).toMatch(/\.tt-map-label\{[^}]*background/);
    expect(leer("src/app/timetracker/timetracker.css")).toMatch(/\.tt-map-label-out\{border:2px solid #d64545\}/);
    // Desde D-215 la línea es una pastilla (`pill off` = rojo del módulo), ya no un color inline.
    expect(leer("src/components/timetracker/DayPhotos.tsx")).toMatch(/className=\{`pill \$\{e\.cls\} rev-loc`\}/);
  });
});

describe("etiquetaFoto: la pastilla bajo la foto y su segunda línea (D-215: el veredicto nunca se corta)", () => {
  it("sin coordenadas → «No location», gris, sin segunda línea (y no pulsable)", () => {
    expect(etiquetaFoto({ lat: null, lng: null, siteName: null, distanceM: null, offSite: null })).toEqual({ kind: "none", cls: "neutral", distanceM: null, second: null });
  });
  it("coordenadas sin sitio → «No site», gris, con las coordenadas en la segunda línea", () => {
    expect(etiquetaFoto({ lat: 33.00045, lng: -96, siteName: null, distanceM: null, offSite: null })).toEqual({ kind: "noSite", cls: "neutral", distanceM: null, second: "33.00045, -96.00000" });
  });
  it("marcada fuera por el servidor → «Out · d», roja, con el sitio debajo", () => {
    expect(etiquetaFoto({ lat: 33, lng: -96, siteName: "Brownsville", distanceM: 85, offSite: true })).toEqual({ kind: "out", cls: "off", distanceM: 85, second: "Brownsville" });
  });
  it("distancia 0 → «On site», verde, con el sitio debajo", () => {
    expect(etiquetaFoto({ lat: 33, lng: -96, siteName: "Brownsville", distanceM: 0, offSite: false })).toEqual({ kind: "on", cls: "on", distanceM: 0, second: "Brownsville" });
  });
  it("con distancia y sin marca de fuera (una excepción lejos, o dentro del margen de GPS) → «d away», ámbar", () => {
    expect(etiquetaFoto({ lat: 33, lng: -96, siteName: "Brownsville", distanceM: 1234, offSite: null })).toEqual({ kind: "near", cls: "wait", distanceM: 1234, second: "Brownsville" });
  });
  it("mutación: el rojo solo con offSite; el verde solo con 0; nunca rojo sin sitio", () => {
    expect(etiquetaFoto({ lat: 33, lng: -96, siteName: "X", distanceM: 0, offSite: true }).cls).toBe("off");
    expect(etiquetaFoto({ lat: 33, lng: -96, siteName: "X", distanceM: 5, offSite: false }).cls).not.toBe("on");
    expect(etiquetaFoto({ lat: 33, lng: -96, siteName: null, distanceM: 5, offSite: true }).cls).toBe("neutral");
  });
  it("y la pantalla: la pastilla primero, nunca truncada, con el sitio en la segunda línea (por fuente)", () => {
    const leer = (r: string) => readFileSync(join(process.cwd(), r), "utf8");
    const ui = leer("src/components/timetracker/DayPhotos.tsx");
    expect(ui).toMatch(/const e = etiquetaFoto\(p\);/);
    // una clave literal por estado, y las claves ya no llevan el sitio dentro
    for (const k of ["mgr.photos.locNone", "mgr.photos.locNoSite", "mgr.photos.locOnSite", "mgr.photos.locOff", "mgr.photos.locAt"]) expect(ui, k).toContain(`t("${k}"`);
    expect(ui).not.toMatch(/mgr\.photos\.offSite/);
    expect(ui).toMatch(/\{e\.second && <span className="small muted rev-note">\{e\.second\}<\/span>\}/);
    const css = leer("src/app/timetracker/timetracker.css");
    expect(css).toMatch(/\.rev-loc\{white-space:nowrap;flex-shrink:0;order:-1\}/);
    expect(css).toMatch(/\.pill\.neutral\{background:var\(--tt-chip\);color:var\(--tt-muted\)\}/);
    const dict = leer("src/lib/timetracker/i18n.ts");
    expect(dict).not.toMatch(/mgr\.photos\.offSite/);
    for (const k of ["locNone", "locNoSite", "locOnSite", "locOff", "locAt"]) {
      const veces = dict.match(new RegExp(`'mgr\\.photos\\.${k}': '[^']*\\{site\\}`, "g")) ?? [];
      expect(veces, `${k} ya no lleva {site}`).toHaveLength(0);
    }
  });
});

describe("comoFence: el sitio en la forma de GeofenceMap", () => {
  it("copia la geocerca y la marca activa", () => {
    expect(comoFence(ALMACEN)).toEqual({
      id: "s2", name: "Almacén", active: true, latitude: 33.1, longitude: -96.1,
      radius_meters: 30, padding_meters: 25, boundary: ALMACEN.boundary,
    });
  });
});

describe("mutación: la ventana va en diferido y la pantalla no arrastra el mapa", () => {
  const leer = (r: string) => readFileSync(join(process.cwd(), r), "utf8");
  it("DayPhotos carga PhotoMapModal con next/dynamic y no importa GeofenceMap ni el loader", () => {
    const src = leer("src/components/timetracker/DayPhotos.tsx");
    expect(src).toMatch(/from "next\/dynamic"/);
    expect(src).toMatch(/dynamic\(\(\) => import\("\.\/PhotoMapModal"\)/);
    expect(src).not.toMatch(/from "\.\/GeofenceMap"|google-maps-loader/);
  });
  it("la ventana dibuja solo la geocerca de esa foto, con el punto, y el respaldo con el enlace", () => {
    const src = leer("src/components/timetracker/PhotoMapModal.tsx");
    expect(src).toMatch(/estadoFoto\(/);
    // Solo la geocerca de esa foto, y memoizada: un array inline reconstruiría el mapa por render.
    expect(src).toMatch(/const fences = useMemo<Fence\[\]>\(\(\) => \(e\.kind === "dentro" \|\| e\.kind === "fuera" \? \[comoFence\(e\.site\)\] : \[\]\)/);
    expect(src).toMatch(/const points = useMemo<MapPoint\[\]>\(/);
    expect(src).toMatch(/fences=\{fences\}/);
    expect(src).toMatch(/points=\{points\}/);
    expect(src).toMatch(/enlaceMapa\(/);
    for (const k of ["mgr.photos.mapTitle", "mgr.photos.mapInside", "mgr.photos.mapOutside", "mgr.photos.mapNoSite", "mgr.photos.mapFailed", "mgr.photos.openMap"]) {
      expect(src, k).toContain(`t("${k}"`);
    }
  });
  it("GeofenceMap sigue aceptando solo fences (GeofenceSection no cambia)", () => {
    expect(leer("src/components/timetracker/GeofenceSection.tsx")).toMatch(/<GeofenceMap fences=\{sites\} \/>/);
    expect(leer("src/components/timetracker/GeofenceMap.tsx")).toMatch(/points\?:/);
  });
  it("el default de points es una constante de módulo, no un [] en la firma (un [] nuevo por render reconstruiría el mapa en Ajustes)", () => {
    const src = leer("src/components/timetracker/GeofenceMap.tsx");
    expect(src).toMatch(/^const SIN_PUNTOS: MapPoint\[\] = \[\];/m);
    expect(src).toMatch(/points = SIN_PUNTOS/);
    expect(src).not.toMatch(/\{ fences, points = \[\]/);
    // Y sin puntos, el encuadre de Ajustes es el de siempre (24).
    expect(src).toMatch(/fitBounds\(bounds, points\.length \? 40 : 24\)/);
  });
  it("una llave rechazada por dominio (gm_authFailure) cae en el respaldo, también en el SEGUNDO mapa de la página", () => {
    // La fuente de verdad es el cargador compartido: registra el callback una vez al crear el
    // script, recuerda el motivo a nivel de módulo, y rechaza mientras esté puesto ANTES de
    // devolver la promesa cacheada (Google solo avisa una vez por carga de script).
    const loader = leer("src/lib/google-maps-loader.ts");
    expect(loader).toMatch(/gm_authFailure/);
    expect(loader).toMatch(/^let authFailed: string \| null = null;/m);
    const rechaza = loader.indexOf("if (authFailed) return Promise.reject(new Error(authFailed));");
    const cache = loader.indexOf("if (loadPromise) return loadPromise;");
    expect(rechaza).toBeGreaterThan(0);
    expect(cache).toBeGreaterThan(rechaza);
    expect(loader).toMatch(/export function onMapsAuthFailure\(/);
    // GeofenceMap escucha (la primera vez, con el mapa ya pintado) y no registra el global.
    const mapa = leer("src/components/timetracker/GeofenceMap.tsx");
    expect(mapa).toMatch(/onMapsAuthFailure\(\(message\) => \{ if \(!cancelled\) setErr\(message\); \}\)/);
    expect(mapa).toMatch(/offAuth\(\);/);
    expect(mapa).not.toMatch(/gm_authFailure\s*=/);
  });
  it("la ventana está en la prueba de claves de D-187", () => {
    expect(leer("src/lib/timetracker/i18n.test.ts")).toContain('"src/components/timetracker/PhotoMapModal.tsx"');
  });
});
