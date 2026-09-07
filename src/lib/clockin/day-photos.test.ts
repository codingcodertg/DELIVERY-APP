import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  armarFotos, distanciaAGeocerca, enlaceMapa, fmtDistancia, sitioDeExcepcion, ubicar,
  type FilaExcepcion, type FilaFichaje, type SitioFoto,
} from "./day-photos";

// Auditoría → Fotos con ubicación. Todo puro: filas en, fotos con sitio y distancia fuera.

const CIRCULO: SitioFoto = { id: "s1", name: "Tienda Norte", latitude: 33.0, longitude: -96.0, radius_meters: 100, boundary: null, padding_meters: null };
// Cuadrado de ±0,001° alrededor de (33.1, -96.1): unos 110 m de lado a lado desde el centro.
const POLIGONO: SitioFoto = {
  id: "s2", name: "Almacén", latitude: 33.1, longitude: -96.1, radius_meters: 30, padding_meters: 25,
  boundary: [{ lat: 33.099, lng: -96.101 }, { lat: 33.101, lng: -96.101 }, { lat: 33.101, lng: -96.099 }, { lat: 33.099, lng: -96.099 }],
};
const SITES = [CIRCULO, POLIGONO];

describe("distancia a la geocerca (los casos del auditor)", () => {
  it("círculo: dentro del radio es 0; fuera, lo que sobresale", () => {
    expect(distanciaAGeocerca(33.0 + 0.00045, -96.0, CIRCULO)).toBe(0);          // ~50 m del centro, radio 100
    expect(distanciaAGeocerca(33.0 + 0.00135, -96.0, CIRCULO)).toBeCloseTo(50, -1); // ~150 m del centro → ~50 m
  });
  it("polígono: dentro es 0 (no la distancia al borde); fuera, al borde más cercano", () => {
    expect(distanciaAGeocerca(33.1, -96.1, POLIGONO)).toBe(0);
    expect(distanciaAGeocerca(33.1 + 0.002, -96.1, POLIGONO)).toBeCloseTo(110, -1); // 0,001° por encima del borde norte
  });
  it("un grado de latitud son ~111 km (haversine contra un caso conocido)", () => {
    const s: SitioFoto = { ...CIRCULO, radius_meters: 0 };
    expect(distanciaAGeocerca(34.0, -96.0, s)).toBeCloseTo(111195, -3);
  });
});

describe("ubicar: el sitio del fichaje, o el más cercano, o nada", () => {
  it("con sitio del fichaje: su nombre y su distancia", () => {
    expect(ubicar(33.0 + 0.00135, -96.0, "s1", SITES)).toEqual({ siteName: "Tienda Norte", siteId: "s1", distanceM: 50 });
  });
  it("sin sitio (fichaje fuera de la geocerca): el más cercano, con la distancia a ESE", () => {
    const r = ubicar(33.1 + 0.002, -96.1, null, SITES);
    expect(r.siteName).toBe("Almacén");
    expect(r.distanceM).toBeGreaterThan(100);
    expect(r.distanceM).toBeLessThan(120);
  });
  it("sin posición, o sin sitios: nulos", () => {
    expect(ubicar(null, null, "s1", SITES)).toEqual({ siteName: null, siteId: null, distanceM: null });
    expect(ubicar(33, -96, "s1", [])).toEqual({ siteName: null, siteId: null, distanceM: null });
  });
});

describe("sitioDeExcepcion: el turno en que ocurrió, no el último", () => {
  const entradas = [
    { id: "e1", employee_id: "u1", clock_in_at: "2026-09-05T13:00:00Z", clock_out_at: "2026-09-05T22:00:00Z", clock_in_site_id: "s1" },
    { id: "e2", employee_id: "u1", clock_in_at: "2026-09-06T13:00:00Z", clock_out_at: null, clock_in_site_id: "s2" },
  ];
  it("por time_entry_id cuando lo trae", () => {
    expect(sitioDeExcepcion({ employee_id: "u1", time_entry_id: "e1" }, "2026-09-06T15:00:00Z", entradas)).toBe("s1");
  });
  it("sin time_entry_id: el fichaje de esa persona abierto en ese momento", () => {
    expect(sitioDeExcepcion({ employee_id: "u1", time_entry_id: null }, "2026-09-05T18:00:00Z", entradas)).toBe("s1");
    expect(sitioDeExcepcion({ employee_id: "u1", time_entry_id: null }, "2026-09-06T15:00:00Z", entradas)).toBe("s2");
    expect(sitioDeExcepcion({ employee_id: "u2", time_entry_id: null }, "2026-09-06T15:00:00Z", entradas)).toBeNull();
    expect(sitioDeExcepcion({ employee_id: "u1", time_entry_id: null }, "2026-09-05T23:00:00Z", entradas)).toBeNull();
  });
});

describe("armarFotos: fila → foto con lat/lng, sitio, distancia y nulos", () => {
  const nombre = new Map([["u1", "Ana"]]);
  const punch: FilaFichaje = {
    employee_id: "u1", clock_in_at: "2026-09-06T13:00:00Z", clock_out_at: "2026-09-06T22:00:00Z",
    clock_in_photo_path: "a/in.jpg", clock_out_photo_path: "a/out.jpg",
    clock_in_in_radius: true, clock_out_in_radius: false,
    clock_in_lat: 33.0 + 0.00045, clock_in_lng: -96.0, clock_in_site_id: "s1",
    clock_out_lat: 33.1 + 0.002, clock_out_lng: -96.1, clock_out_site_id: null,
  };
  const exc: FilaExcepcion = {
    employee_id: "u1", time_entry_id: null, type: "leaving_while_clocked_in", reason: "lunch", note: null,
    photo_path: "a/left.jpg", returned_photo_path: "a/back.jpg",
    left_at: "2026-09-06T17:00:00Z", returned_at: "2026-09-06T17:40:00Z", created_at: "2026-09-06T17:00:00Z",
    latitude: 33.0 + 0.00135, longitude: -96.0, returned_lat: null, returned_lng: null,
  };
  const entradas = [{ id: "e1", employee_id: "u1", clock_in_at: punch.clock_in_at, clock_out_at: punch.clock_out_at, clock_in_site_id: "s1" }];
  const fotos = armarFotos({ punches: [punch], excs: [exc], sites: SITES, entradas, nombre });

  it("cuatro fotos, en orden de hora", () => {
    expect(fotos.map((f) => f.kind)).toEqual(["in", "left", "back", "out"]);
  });
  it("entrada: en el sitio del fichaje, a 0", () => {
    expect(fotos[0]).toMatchObject({ who: "Ana", offSite: false, lat: 33.00045, lng: -96, siteName: "Tienda Norte", distanceM: 0 });
  });
  it("salida fuera de la geocerca: el sitio más cercano y la distancia a él", () => {
    expect(fotos[3]).toMatchObject({ kind: "out", offSite: true, siteName: "Almacén" });
    expect(fotos[3].distanceM).toBeGreaterThan(100);
  });
  it("salir: sin time_entry_id, se sitúa por el turno abierto de esa persona", () => {
    expect(fotos[1]).toMatchObject({ kind: "left", note: "lunch", siteName: "Tienda Norte", distanceM: 50, offSite: null });
  });
  it("volver sin posición: lat/lng, sitio y distancia nulos, y la foto sigue", () => {
    expect(fotos[2]).toMatchObject({ kind: "back", lat: null, lng: null, siteName: null, distanceM: null, path: "a/back.jpg" });
  });
});

describe("texto y enlace", () => {
  it("fmtDistancia: metros enteros bajo 1 km; km con un decimal, coma en español", () => {
    expect(fmtDistancia(35.4, "en")).toBe("35 m");
    expect(fmtDistancia(1234, "en")).toBe("1.2 km");
    expect(fmtDistancia(1234, "es")).toBe("1,2 km");
  });
  it("enlaceMapa: la URL de consulta de Google Maps, sin API", () => {
    expect(enlaceMapa(33.00045, -96)).toBe("https://www.google.com/maps?q=33.00045,-96");
  });
});

describe("mutación: la acción selecciona las columnas de posición y pasa por armarFotos", () => {
  const src = readFileSync(join(process.cwd(), "src/app/timetracker/clock-in/actions/photos.ts"), "utf8");
  it("time_entries: lat/lng/site de entrada y salida", () => {
    for (const c of ["clock_in_lat", "clock_in_lng", "clock_in_site_id", "clock_out_lat", "clock_out_lng", "clock_out_site_id"]) {
      expect(src, c).toMatch(new RegExp(`select\\([^)]*\\b${c}\\b`));
    }
  });
  it("exceptions: latitude/longitude, returned_lat/lng, time_entry_id", () => {
    for (const c of ["latitude", "longitude", "returned_lat", "returned_lng", "time_entry_id"]) {
      expect(src, c).toMatch(new RegExp(`select\\([^)]*\\b${c}\\b`));
    }
  });
  it("job_sites con nombre y geocerca, y el mapeo es el puro", () => {
    expect(src).toMatch(/from\("job_sites"\)/);
    expect(src).toMatch(/name, latitude, longitude, radius_meters, boundary, padding_meters/);
    expect(src).toMatch(/armarFotos\(/);
  });
  it("y la pantalla pinta los estados con claves literales, y el enlace a Maps vive en la ventana del mapa", () => {
    const ui = readFileSync(join(process.cwd(), "src/components/timetracker/DayPhotos.tsx"), "utf8");
    for (const k of ["mgr.photos.locNone", "mgr.photos.locOff", "mgr.photos.locOnSite", "mgr.photos.locAt", "mgr.photos.showMap"]) {
      expect(ui, k).toContain(`t("${k}"`);
    }
    expect(ui).not.toMatch(/leaflet|google-maps-loader|GoogleMapView/);
    // Desde la ventana del mapa (encargo 8), el enlace de D-212 es el respaldo de esa ventana.
    const modal = readFileSync(join(process.cwd(), "src/components/timetracker/PhotoMapModal.tsx"), "utf8");
    expect(modal).toMatch(/enlaceMapa\(/);
    expect(modal).toMatch(/target="_blank"/);
    expect(modal).toContain('t("mgr.photos.openMap"');
  });
  it("el cliente manda posición al salir y al volver (el hueco de este encargo)", () => {
    const pp = readFileSync(join(process.cwd(), "src/components/timetracker/PunchPanel.tsx"), "utf8");
    expect(pp).toMatch(/startLeave\(\{ reason: "lunch", geo: await ubicacionOpcional\(\) \}\)/);
    expect(pp).toMatch(/startLeave\(\{ reason: "customer_visit", geo: await ubicacionOpcional\(\) \}\)/);
    expect(pp).toMatch(/endLeave\(d\.leave!\.id, await ubicacionOpcional\(\)\)/);
  });
});
