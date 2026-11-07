import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { suggestDeliveryFee, isLocalCity, LOCAL_CITIES_DEFAULT } from "./pricing";
import { ciudadDeEntrega } from "./ciudad-de-entrega";
import { puntoEnZonaLocal } from "./delivery-zone";
import { zonaDecidida, motivoDeLaZona } from "./zona-decidida";

// D-920 · Francisca Reyes (ayuda 50e906e6, 1.405.0): «DICE QUE NO ES LOCAL PERO SÍ ES». Orden de RDZ Pharr
// (1120 E Expressway 83, Pharr) a «3004 E Sabinal Ave, Hidalgo, TX, USA», sin pin, 9.3 mi: salía NO LOCAL · «TX».
const es = (_en: string, es: string) => es;
const en = (en: string) => en;
const leer = (p: string) => readFileSync(p, "utf8");

const DIRECCION = "3004 E Sabinal Ave, Hidalgo, TX, USA";
/** El punto que Google devuelve para esa dirección (aprox.): sur de Hidalgo, al norte del río. */
const HIDALGO: [number, number] = [26.108, -98.235];
/** La tienda de la captura, para el contexto de la orden (la zona no sale de la tienda; sale de la entrega). */
const RDZ_PHARR = { name: "RDZ Pharr", address: "1120 E Expressway 83, Pharr, TX 78577, USA", lat: 26.174, lng: -98.168 };

describe("la ciudad de una dirección de Google: la de delante del estado, nunca el estado ni el ZIP", () => {
  it.each([
    ["3004 E Sabinal Ave, Hidalgo, TX, USA", "Hidalgo"],
    ["3004 E Sabinal Ave, Hidalgo, TX 78557, USA", "Hidalgo"],
    ["3004 E Sabinal Ave, Hidalgo, TX 78557", "Hidalgo"],
    ["3004 E Sabinal Ave, Hidalgo, TX", "Hidalgo"],
    ["4500 N 23rd St, McAllen, TX 78501", "McAllen"],
    ["4500 N 23rd St, McAllen, TX 78501, USA", "McAllen"],
    ["4500 N 23rd St, McAllen, TX 78501, United States", "McAllen"],
    ["1120 E Expressway 83, Pharr, Texas", "Pharr"],
    ["1120 E Expressway 83, Pharr, Texas 78577, United States", "Pharr"],
    ["1120 E Expressway 83, Pharr, Hidalgo County, Texas, 78577, United States", "Pharr"],
    ["17920 Royal Palm Drive, Penitas, TX, USA", "Penitas"],
    ["3202 Agualeguas St, Edinburg, TX, USA", "Edinburg"],
  ])("%s → %s", (dir, ciudad) => {
    expect(ciudadDeEntrega(dir)).toBe(ciudad);
  });

  it("nunca TX, Texas, USA ni un ZIP", () => {
    const malas = new Set(["tx", "texas", "usa", "united states"]);
    for (const dir of ["1 A St, Hidalgo, TX, USA", "1 A St, Hidalgo, TX 78557, USA", "1 A St, Hidalgo, Texas", "1 A St, Hidalgo, 78557, USA"]) {
      const c = ciudadDeEntrega(dir);
      expect(malas.has(c.toLowerCase())).toBe(false);
      expect(c).not.toMatch(/^\d{5}$/);
    }
  });
});

describe("la orden de la captura", () => {
  it("sin pin, por la ciudad: LOCAL, sin aprobación de zona, a 9.3 mi de RDZ Pharr", () => {
    const s = suggestDeliveryFee({ delivery_address: DIRECCION, route_miles: 9.3, store: RDZ_PHARR.name } as Parameters<typeof suggestDeliveryFee>[0], { local_cities: [] });
    expect(s.city).toBe("Hidalgo");
    expect(s.zoneSource).toBe("city");
    expect(s.zone).toBe("local");
    expect(s.needsApproval).toBe(false);
    const z = zonaDecidida(s, 9.3, es);
    expect(z).toMatchObject({ local: true, source: "city", city: "Hidalgo", miles: 9.3, needsApproval: false });
    expect(z.why).toBe("por la ciudad de la dirección (Hidalgo) — esta orden no tiene pin");
  });

  it("con el pin que encuentra la búsqueda: LOCAL por el pin (el punto está al norte del río)", () => {
    expect(puntoEnZonaLocal(HIDALGO[0], HIDALGO[1])).toBe(true);
    const s = suggestDeliveryFee({ delivery_address: DIRECCION, route_miles: 9.3, delivery_lat: HIDALGO[0], delivery_lng: HIDALGO[1] }, { local_cities: [] });
    expect(s.zone).toBe("local");
    expect(s.needsApproval).toBe(false);
    expect(zonaDecidida(s, 9.3, es, "geocoded").why).toBe("por el punto que encontró la búsqueda de dirección");
    expect(zonaDecidida(s, 9.3, en, null).why).toBe("from the saved pin");
  });

  it("la lista de Ajustes vacía en producción (leída el 2026-11-07) cae a la de defecto, que trae Hidalgo", () => {
    expect(isLocalCity("Hidalgo", { local_cities: [] })).toBe(true);
    expect(isLocalCity("Hidalgo", null)).toBe(true);
    // Y si Ajustes trae su propia lista sin Hidalgo, manda Ajustes (D-690): eso no se adivina aquí.
    expect(isLocalCity("Hidalgo", { local_cities: ["McAllen"] })).toBe(false);
  });
});

describe("una sola decisión: la pastilla y el aviso no pueden contradecirse", () => {
  const casos = [
    { delivery_address: DIRECCION, route_miles: 9.3 },
    { delivery_address: DIRECCION, route_miles: 9.3, delivery_lat: HIDALGO[0], delivery_lng: HIDALGO[1] },
    { delivery_address: "10 Main St, Reynosa, Tamaulipas, Mexico", route_miles: 12 },
    { delivery_address: "10 Main St, Raymondville, TX, USA", route_miles: 23.8 },
    { delivery_address: "33007 Marshall Hutts Road, Rio Hondo, TX, USA", route_miles: 31.1, delivery_lat: 26.3234, delivery_lng: -97.4539 },
    { delivery_address: "941 FM3087, Alice, TX, USA", route_miles: 118, delivery_lat: 27.75, delivery_lng: -98.07 },
    { delivery_address: "104 NAPA VALLY DRIVE MISSION", route_miles: 2006.9, delivery_lat: 38.3, delivery_lng: -122.3 },
    { delivery_address: "", route_miles: 5 },
  ];
  it.each(casos.map((c) => [c.delivery_address || "(sin dirección)", c] as const))("%s", (_n, c) => {
    const s = suggestDeliveryFee(c, { local_cities: [] });
    // La aprobación por zona ES «no local», ni más ni menos; las millas no la tocan.
    expect(s.needsApproval).toBe(s.zone === "nonlocal");
    const z = zonaDecidida(s, c.route_miles, es);
    expect(z.needsApproval).toBe(z.local === false);
    if (z.local == null) expect(z.why).toBe("");
    else expect(z.why).not.toBe("");
  });

  it("cuando el pin y la ciudad discrepan manda el pin, y el motivo lo dice", () => {
    // Rio Hondo está en la lista pero el pin cae fuera del polígono: NO LOCAL por el pin (FV603 en producción).
    const fuera = suggestDeliveryFee({ delivery_address: "33007 Marshall Hutts Road, Rio Hondo, TX, USA", route_miles: 31.1, delivery_lat: 26.3234, delivery_lng: -97.4539 }, { local_cities: [] });
    expect(fuera).toMatchObject({ city: "Rio Hondo", zoneSource: "pin", zone: "nonlocal", needsApproval: true });
    expect(motivoDeLaZona(fuera, es)).toBe("por el pin guardado");
    // Y al revés: una ciudad que no está en la lista con el pin dentro del polígono es LOCAL por el pin.
    const dentro = suggestDeliveryFee({ delivery_address: "1 A St, Sullivan City, TX, USA", route_miles: 20, delivery_lat: 26.28, delivery_lng: -98.50 }, { local_cities: [] });
    expect(dentro).toMatchObject({ zoneSource: "pin", zone: "local", needsApproval: false });
  });

  it("Peñitas: en el río y en el polígono; sin pin, con o sin acento, LOCAL (FU185 en producción salía NO LOCAL)", () => {
    expect(LOCAL_CITIES_DEFAULT).toContain("Peñitas");
    for (const dir of ["17920 Royal Palm Drive, Penitas, TX, USA", "17920 Royal Palm Drive, Peñitas, TX 78576, USA", "17920 ROYAL PALM DRIVE, PENITAS, TX"]) {
      expect(suggestDeliveryFee({ delivery_address: dir, route_miles: 28.7 }, { local_cities: [] })).toMatchObject({ zoneSource: "city", zone: "local", needsApproval: false });
    }
    // Lo mismo si la lista de Ajustes lo escribe sin acento.
    expect(isLocalCity("Peñitas", { local_cities: ["Penitas"] })).toBe(true);
  });

  it("la ficha y el cotizador pintan la pastilla y el aviso con los mismos componentes, desde la misma `zona`", () => {
    for (const f of ["src/components/OrderModal.tsx", "src/app/estimator/EntregaCotizacion.tsx"]) {
      const src = leer(f);
      expect(src).toMatch(/const zona = zonaDecidida\(/);
      expect(src).toContain("<PastillaDeZona zona={zona} t={t}>");
      expect(src).toContain("<AvisoNoLocal zona={zona} t={t} />");
      // Ya nadie compone la pastilla ni el aviso a mano.
      expect(src).not.toMatch(/zone === "local" \? t\("LOCAL"/);
      expect(src).not.toContain('"Not local — requires manager approval."');
    }
    // El aviso de igualar precio sigue aparte: es de la tarifa, no de la zona.
    expect(leer("src/components/OrderModal.tsx")).toContain('"Price match (below discount) — requires approval."');
    expect(leer("src/app/estimator/EntregaCotizacion.tsx")).toContain('"Price match (below discount) — requires approval."');
  });
});
