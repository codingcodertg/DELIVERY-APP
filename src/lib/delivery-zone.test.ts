import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  comoLatLng, colorZona, ESTILO_ZONA, LOCAL_ZONE_DEFAULT, LOCAL_ZONE_LATLNG,
  puntoEnZonaLocal, VERDE_ZONA_FALLBACK, type Vertice,
} from "./delivery-zone";
import { suggestDeliveryFee } from "./pricing";

// La zona local se decide por el PUNTO y no por el nombre de la ciudad (D-219). Aquí van las
// ciudades de verdad: las que tienen que quedar dentro, las de Texas que no son locales, y las
// mexicanas, que quedan fuera porque el borde sur es el río.

const leer = (r: string) => readFileSync(join(process.cwd(), r), "utf8");
const dentro = (lat: number, lng: number) => puntoEnZonaLocal(lat, lng) === true;

const LOCALES: [string, number, number][] = [
  ["McAllen", 26.2034, -98.2300], ["Brownsville", 25.9017, -97.4975],
  ["South Padre", 26.1118, -97.1681], ["Port Isabel", 26.0731, -97.2086],
  ["Harlingen", 26.1906, -97.6961], ["Edinburg", 26.3017, -98.1633],
  ["Mission", 26.2159, -98.3253], ["Weslaco", 26.1595, -97.9908],
  ["San Benito", 26.1325, -97.6311], ["Rio Hondo", 26.2364, -97.5811],
  ["La Joya", 26.2434, -98.4839], ["Sullivan City", 26.2764, -98.5636],
  ["Alton", 26.2870, -98.3050], ["Elsa", 26.2953, -97.9922],
  ["Pharr", 26.1948, -98.1836], ["San Juan", 26.1892, -98.1553],
  ["Alamo", 26.1826, -98.1164], ["Donna", 26.1470, -98.0522],
  ["Mercedes", 26.1495, -97.9139], ["La Feria", 26.1520, -97.8228],
  ["Palmview", 26.2306, -98.3792], ["Rancho Viejo", 25.9906, -97.5361],
  ["Los Fresnos", 26.0714, -97.4764], ["Combes", 26.2478, -97.7275],
];

const FUERA_EEUU: [string, number, number][] = [
  ["Raymondville", 26.4806, -97.7828],      // norte
  ["Port Mansfield", 26.5556, -97.4278],    // este/norte, por la costa
  ["Rio Grande City", 26.3795, -98.8203],   // oeste
  ["Falfurrias", 27.2278, -98.1447],
  ["Houston", 29.7604, -95.3698],
];

const MEXICO: [string, number, number][] = [
  ["Reynosa", 26.0806, -98.2878],
  ["Matamoros", 25.8797, -97.5044],
  ["Rio Bravo", 25.9861, -98.0917],
  ["Nuevo Progreso", 26.0192, -97.9503],
  ["Valle Hermoso", 25.6739, -97.8158],
];

describe("el contorno deja dentro lo local", () => {
  for (const [nombre, lat, lng] of LOCALES) {
    it(`${nombre} → dentro`, () => expect(dentro(lat, lng)).toBe(true));
  }
});

describe("y fuera lo que no lo es", () => {
  for (const [nombre, lat, lng] of FUERA_EEUU) {
    it(`${nombre} → fuera`, () => expect(dentro(lat, lng)).toBe(false));
  }
});

describe("al sur del río, fuera — que es lo que pidió el dueño", () => {
  for (const [nombre, lat, lng] of MEXICO) {
    it(`${nombre} → fuera`, () => expect(dentro(lat, lng)).toBe(false));
  }
  it("Brownsville dentro y Matamoros fuera, aunque estén a 2,4 km: el borde pasa entre las dos", () => {
    expect(dentro(25.9017, -97.4975)).toBe(true);   // Brownsville
    expect(dentro(25.8797, -97.5044)).toBe(false);  // Matamoros
  });
});

// Direcciones REALES de producción, con sus coordenadas: el cotejo del orquestador contra los 112
// pedidos las señaló una por una. Las nueve primeras son el bug que reportó el dueño —se les
// cobraba tarifa NO LOCAL porque la ciudad no se leía de la dirección— y las dos de Brownsville
// son las que destaparon que mi primer trazado del río no bajaba hacia el este.
const PEDIDOS_REALES: [string, number, number][] = [
  ["#57/#48/#56 Nayeli St, Los Fresnos", 26.0933, -97.4966],
  ["#33 Heron Drive, Los Fresnos", 26.0669, -97.4632],
  ["#17 N Arroyo Blvd, Los Fresnos", 26.0784, -97.4758],
  ["#80 Spoonbill Cove, Laguna Vista", 26.1163, -97.3031],
  ["#58 Escandon Ave, Rancho Viejo", 26.0319, -97.5657],
  ["#2 Enchilada St, Rancho Viejo", 26.0384, -97.5606],
  ["#16 Loira, Brownsville", 25.9964, -97.5789],
  ["#26 Lynx, Brownsville", 25.8804, -97.4112],
  ["#69 Maverick Road, Brownsville", 25.8801, -97.4321],
];

describe("las entregas reales que el cotejo señaló, todas dentro", () => {
  for (const [nombre, lat, lng] of PEDIDOS_REALES) {
    it(`${nombre} → dentro`, () => expect(dentro(lat, lng)).toBe(true));
  }
  it("y las dos de Brownsville al norte del río lo siguen estando con Matamoros fuera", () => {
    // Las dos restricciones que había que cumplir A LA VEZ, y que obligaron a seis vértices en el
    // tramo del río: el cauce baja hacia el este.
    expect(dentro(25.8804, -97.4112)).toBe(true);
    expect(dentro(25.8801, -97.4321)).toBe(true);
    expect(dentro(25.8797, -97.5044)).toBe(false);  // Matamoros
    expect(dentro(25.9017, -97.4975)).toBe(true);   // Brownsville centro
  });
});

describe("cuándo NO se puede decidir por el punto", () => {
  it("sin coordenadas → null (no `false`): quien llama tiene que poder caer al respaldo", () => {
    expect(puntoEnZonaLocal(null, null)).toBeNull();
    expect(puntoEnZonaLocal(26.2, null)).toBeNull();
    expect(puntoEnZonaLocal(undefined, undefined)).toBeNull();
    expect(puntoEnZonaLocal(Number.NaN, -98)).toBeNull();
  });
  it("el pin en 0,0 es «no decidible», no «fuera»: es lo que escribe un geocodificador roto", () => {
    // Sin esto, un pin corrupto se saltaría el respaldo por ciudad y el pedido saldría NO LOCAL
    // —500 + millas y aprobación— en silencio. El golfo de Guinea no es una dirección de reparto.
    expect(puntoEnZonaLocal(0, 0)).toBeNull();
    const s = suggestDeliveryFee({ delivery_address: "1 Palm Ave, McAllen, TX", route_miles: 13, delivery_lat: 0, delivery_lng: 0 });
    expect(s.zone).toBe("local");          // cae al respaldo por ciudad, como si no hubiera pin
    expect(s.needsApproval).toBe(false);
    // Y un 0 en UNA sola coordenada sigue siendo un punto: no se descarta de más.
    expect(puntoEnZonaLocal(0, -98.23)).toBe(false);
    expect(puntoEnZonaLocal(26.2034, 0)).toBe(false);
  });
  it("un contorno de menos de tres vértices no es un área → null", () => {
    expect(puntoEnZonaLocal(26.2, -98.23, [])).toBeNull();
    expect(puntoEnZonaLocal(26.2, -98.23, [[26, -98], [27, -97]])).toBeNull();
  });
  it("con un contorno propio manda ese, no la semilla", () => {
    const cuadrado: Vertice[] = [[0, 0], [0, 1], [1, 1], [1, 0]];
    expect(puntoEnZonaLocal(0.5, 0.5, cuadrado)).toBe(true);
    expect(puntoEnZonaLocal(26.2034, -98.23, cuadrado)).toBe(false);  // McAllen, fuera de ESE cuadrado
  });
});

describe("el borde, medido y no supuesto", () => {
  // Contrato de `pointInPolygon` (lib/geo.ts), medido aquí sobre ESTE contorno: determinista e
  // invariante al orden de los vértices. Lo que NO es cierto —y se comprobó antes de escribirlo—
  // es que un punto sobre el borde caiga siempre fuera: depende de la arista.
  it("es determinista", () => {
    const v = Array.from({ length: 200 }, () => puntoEnZonaLocal(26.2034, -98.23));
    expect(new Set(v).size).toBe(1);
  });
  it("no depende del orden de los vértices", () => {
    const alReves = [...LOCAL_ZONE_DEFAULT].reverse();
    for (const [, lat, lng] of [...LOCALES, ...MEXICO]) {
      expect(puntoEnZonaLocal(lat, lng, alReves)).toBe(puntoEnZonaLocal(lat, lng));
    }
  });
  it("sobre el borde exacto el resultado es determinista, pero NO es «siempre fuera»: depende de la arista", () => {
    // Medido sobre las 18 aristas de este contorno, en el punto medio exacto de cada una: unas
    // dan dentro y otras fuera, según su orientación respecto al rayo que traza el algoritmo. Un
    // punto exactamente encima de la línea no tiene respuesta «correcta»; lo que sí está
    // garantizado es que siempre da la misma. En el río eso no es un riesgo práctico: el margen
    // hasta Brownsville y hasta Matamoros es de ~1 km a cada lado, y un pin no cae en la línea.
    const medios = LOCAL_ZONE_DEFAULT.map((a, i) => {
      const b = LOCAL_ZONE_DEFAULT[(i + 1) % LOCAL_ZONE_DEFAULT.length];
      return puntoEnZonaLocal((a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
    });
    expect(medios.some((v) => v === true)).toBe(true);
    expect(medios.some((v) => v === false)).toBe(true);
    // Determinista: cien pasadas dan lo mismo, arista por arista.
    for (let n = 0; n < 100; n++) {
      const otra = LOCAL_ZONE_DEFAULT.map((a, i) => {
        const b = LOCAL_ZONE_DEFAULT[(i + 1) % LOCAL_ZONE_DEFAULT.length];
        return puntoEnZonaLocal((a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
      });
      expect(otra).toEqual(medios);
    }
  });
});

describe("la tarifa usa el punto, y cae a la ciudad solo cuando no lo hay", () => {
  const local = { delivery_address: "1 Palm Ave, McAllen, TX", route_miles: 13 };

  it("con punto dentro: local, sin aprobación — aunque la dirección no diga ninguna ciudad conocida", () => {
    const s = suggestDeliveryFee({ delivery_address: "123 sin ciudad 78501", route_miles: 13, delivery_lat: 26.2034, delivery_lng: -98.23 });
    expect(s.zone).toBe("local");
    expect(s.needsApproval).toBe(false);
  });
  it("con punto fuera: no local, con aprobación — aunque la dirección diga «McAllen»", () => {
    const s = suggestDeliveryFee({ ...local, delivery_lat: 29.7604, delivery_lng: -95.3698 });
    expect(s.zone).toBe("nonlocal");
    expect(s.needsApproval).toBe(true);
  });
  it("el punto manda sobre la ciudad en los dos sentidos (es el bug que se arregla)", () => {
    const porCiudad = suggestDeliveryFee({ delivery_address: "algo, mcallen tx", route_miles: 13 });
    const porPunto = suggestDeliveryFee({ delivery_address: "algo, mcallen tx", route_miles: 13, delivery_lat: 25.8797, delivery_lng: -97.5044 });
    expect(porPunto.zone).toBe("nonlocal");   // Matamoros: el punto gana
    expect(porCiudad.zone).not.toBe(porPunto.zone);
  });
  it("sin punto: exactamente el comportamiento de antes (ciudad conocida → local)", () => {
    expect(suggestDeliveryFee(local).zone).toBe("local");
    expect(suggestDeliveryFee({ delivery_address: "500 Ranch Rd, Falfurrias, TX", route_miles: 60 }).zone).toBe("nonlocal");
  });
  it("sin dirección sigue siendo `unknown`, y la ciudad se sigue enseñando como texto", () => {
    expect(suggestDeliveryFee({ delivery_address: "", route_miles: 20 }).zone).toBe("unknown");
    expect(suggestDeliveryFee(local).city).toBe("McAllen");
  });
  it("la tarifa en sí no cambia: mismo precio para la misma zona y millas", () => {
    const conPunto = suggestDeliveryFee({ ...local, delivery_lat: 26.2034, delivery_lng: -98.23 });
    expect(conPunto.list).toBe(suggestDeliveryFee(local).list);
    expect(conPunto.discount).toBe(suggestDeliveryFee(local).discount);
  });
  it("mutación: si el punto no se mirara, una entrega en México saldría LOCAL", () => {
    const sinMirarPunto = suggestDeliveryFee({ delivery_address: "x, Brownsville, TX", route_miles: 10 });
    expect(sinMirarPunto.zone).toBe("local");
    const mirando = suggestDeliveryFee({ delivery_address: "x, Brownsville, TX", route_miles: 10, delivery_lat: 25.8797, delivery_lng: -97.5044 });
    expect(mirando.zone).toBe("nonlocal");
  });
});

describe("el verde y el contorno los comparten los dos mapas", () => {
  it("el literal es el --green de globals.css, no un verde inventado", () => {
    expect(VERDE_ZONA_FALLBACK).toBe("#1f9d61");
    expect(leer("src/app/globals.css")).toMatch(/--green:\s*#1f9d61/);
  });
  it("sin DOM, colorZona cae al literal (en el navegador gana la variable del tema)", () => {
    expect(colorZona()).toBe(VERDE_ZONA_FALLBACK);
  });
  it("los dos mapas pintan la MISMA geometría y el MISMO estilo, del módulo", () => {
    for (const ruta of ["src/components/LeafletMap.tsx", "src/components/GoogleMapView.tsx"]) {
      const src = leer(ruta);
      expect(src, ruta).toMatch(/import \{ colorZona, ESTILO_ZONA \} from "@\/lib\/delivery-zone"/);
      expect(src, ruta).toMatch(/zone\?: \{ lat: number; lng: number \}\[\]/);
      expect(src, ruta).toMatch(/ESTILO_ZONA\.fillOpacity/);
      expect(src, ruta).not.toMatch(/#1f9d61/);   // el color no se copia a mano en ningún mapa
    }
  });
  it("y ninguno la dibuja si no se la pasan (los demás mapas quedan igual)", () => {
    for (const ruta of ["src/components/LeafletMap.tsx", "src/components/GoogleMapView.tsx"]) {
      expect(leer(ruta), ruta).toMatch(/if \(!zone \|\| zone\.length < 3\) return;/);
    }
  });
  it("los dos selectores de pin de la ficha la enseñan", () => {
    const modal = leer("src/components/OrderModal.tsx");
    expect(modal.match(/zone=\{LOCAL_ZONE_LATLNG\}/g) ?? []).toHaveLength(2);
  });
  it("Ajustes la enseña en diferido y dice que mover el contorno exige un despliegue", () => {
    const ajustes = leer("src/app/(app)/settings/page.tsx");
    expect(ajustes).toMatch(/const ZoneMap = dynamic\(/);
    expect(ajustes).toMatch(/LOCAL_ZONE_DEFAULT\): moving it needs a deploy/);
  });
  it("LOCAL_ZONE_LATLNG es el mismo contorno, en la forma que quieren los mapas", () => {
    expect(LOCAL_ZONE_LATLNG).toEqual(comoLatLng(LOCAL_ZONE_DEFAULT));
    expect(LOCAL_ZONE_LATLNG).toHaveLength(LOCAL_ZONE_DEFAULT.length);
    expect(ESTILO_ZONA.fillOpacity).toBeGreaterThan(0);
    expect(ESTILO_ZONA.fillOpacity).toBeLessThan(0.5);   // tenue: no puede tapar las calles
  });
});

describe("el respaldo por ciudad queda intacto", () => {
  it("la lista y su comparación no se tocan", () => {
    const src = leer("src/lib/pricing.ts");
    expect(src).toMatch(/export const LOCAL_CITIES_DEFAULT = \[/);
    expect(src).toMatch(/export function isLocalCity\(city: string, s\?: Partial<Settings> \| null\): boolean \{/);
    // Y la zona sigue siendo el respaldo, no el camino principal:
    expect(src).toMatch(/const local = porPunto \?\? isLocalCity\(city, s\);/);
  });
  it("no hay ninguna migración ni columna nueva para el contorno", () => {
    expect(leer("src/lib/types.ts")).not.toMatch(/local_zone/);
    expect(leer("src/lib/delivery-zone.ts")).not.toMatch(/Settings/);
  });
});
