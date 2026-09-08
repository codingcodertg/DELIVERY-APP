import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { suggestDeliveryFee } from "./pricing";

// El bug de la captura (D-NEXT): el dueño suelta el pin, lo VE dentro del área verde, y debajo
// sigue diciendo «No local». La zona no mentía —ese punto está dentro— pero el aviso se calculaba
// con `d.delivery_lat/lng`, que con un pin en borrador todavía valen lo de antes.

const leer = (r: string) => readFileSync(join(process.cwd(), r), "utf8");

/** Lo mismo que hace la ficha: si hay borrador, ese punto manda. */
const conBorrador = (d: Parameters<typeof suggestDeliveryFee>[0], pin: [number, number] | null) =>
  suggestDeliveryFee(pin ? { ...d, delivery_lat: pin[0], delivery_lng: pin[1] } : d);

const DENTRO: [number, number] = [26.405, -97.795];   // suroeste de Lyford, el pin de la captura
const FUERA: [number, number] = [26.4806, -97.7828];  // Raymondville
const DIR = "1 Palm Ave, McAllen, TX";

describe("el punto que decide es el que el usuario tiene delante", () => {
  it("EL CASO DE LA CAPTURA: borrador dentro y pedido guardado fuera → local, sin aprobación", () => {
    const guardado = { delivery_address: DIR, route_miles: 30, delivery_lat: FUERA[0], delivery_lng: FUERA[1] };
    expect(suggestDeliveryFee(guardado).zone).toBe("nonlocal");        // lo que se veía antes
    const s = conBorrador(guardado, DENTRO);
    expect(s.zone).toBe("local");
    expect(s.needsApproval).toBe(false);
    expect(s.zoneSource).toBe("pin");
  });
  it("borrador dentro y pedido SIN pin → local (el otro camino de la captura)", () => {
    const s = conBorrador({ delivery_address: "sin ciudad reconocible 78566", route_miles: 12 }, DENTRO);
    expect(s.zone).toBe("local");
    expect(s.zoneSource).toBe("pin");
  });
  it("borrador fuera → no local, aunque el pedido guardado estuviera dentro", () => {
    const guardado = { delivery_address: DIR, route_miles: 12, delivery_lat: DENTRO[0], delivery_lng: DENTRO[1] };
    expect(suggestDeliveryFee(guardado).zone).toBe("local");
    const s = conBorrador(guardado, FUERA);
    expect(s.zone).toBe("nonlocal");
    expect(s.needsApproval).toBe(true);
  });
  it("sin borrador manda el pin guardado", () => {
    const s = conBorrador({ delivery_address: DIR, route_miles: 12, delivery_lat: DENTRO[0], delivery_lng: DENTRO[1] }, null);
    expect(s.zone).toBe("local");
    expect(s.zoneSource).toBe("pin");
  });
  it("sin borrador y sin pin: el respaldo por ciudad, igual que antes", () => {
    expect(conBorrador({ delivery_address: DIR, route_miles: 12 }, null)).toMatchObject({ zone: "local", zoneSource: "city", city: "McAllen" });
    expect(conBorrador({ delivery_address: "500 Ranch Rd, Falfurrias, TX", route_miles: 60 }, null)).toMatchObject({ zone: "nonlocal", zoneSource: "city" });
  });
  it("sin dirección: `unknown` y sin fuente, como antes", () => {
    expect(conBorrador({ delivery_address: "", route_miles: 20 }, null)).toMatchObject({ zone: "unknown", zoneSource: "none" });
  });
  it("mutación: si el borrador no se mirara, el caso de la captura seguiría diciendo «No local»", () => {
    const guardado = { delivery_address: DIR, route_miles: 30, delivery_lat: FUERA[0], delivery_lng: FUERA[1] };
    const sinMirarBorrador = suggestDeliveryFee(guardado);
    expect(sinMirarBorrador.needsApproval).toBe(true);
    expect(conBorrador(guardado, DENTRO).needsApproval).toBe(false);
  });
});

describe("de dónde sale la zona se dice, no se adivina", () => {
  it("`zoneSource` distingue el pin de la ciudad", () => {
    expect(suggestDeliveryFee({ delivery_address: DIR, route_miles: 12, delivery_lat: DENTRO[0], delivery_lng: DENTRO[1] }).zoneSource).toBe("pin");
    expect(suggestDeliveryFee({ delivery_address: DIR, route_miles: 12 }).zoneSource).toBe("city");
  });
  it("un pin en 0,0 no cuenta como pin: la zona la decide la ciudad y la fuente lo dice (D-219)", () => {
    const s = suggestDeliveryFee({ delivery_address: DIR, route_miles: 12, delivery_lat: 0, delivery_lng: 0 });
    expect(s.zoneSource).toBe("city");
    expect(s.zone).toBe("local");
  });
  it("la ficha usa el borrador visible y enseña el motivo", () => {
    const src = leer("src/components/OrderModal.tsx");
    expect(src).toMatch(/const pinVisible = showPinPicker && pinDraft \? pinDraft : null;/);
    expect(src).toMatch(/pinVisible \? \{ \.\.\.d, delivery_lat: pinVisible\[0\], delivery_lng: pinVisible\[1\] \} : d/);
    expect(src).toMatch(/const zoneWhy = feeSuggestion\.zoneSource === "pin"/);
    // Los dos avisos y la insignia dicen el motivo.
    expect(src.match(/\{zoneWhy &&/g) ?? []).toHaveLength(3);
    // Y el borrador NO se escribe en el pedido: `dropPin` sigue tocando solo el estado local.
    const dropPin = src.slice(src.indexOf("const dropPin ="), src.indexOf("const savePin ="));
    expect(dropPin).toContain("setPinDraft([lat, lng])");
    expect(dropPin).not.toContain('set("delivery_lat"');
    // Sin memoizar, a propósito: se recalcula en cada render y por eso el aviso cambia al mover el pin.
    expect(src).not.toMatch(/useMemo\([^)]*suggestDeliveryFee/);
  });
  it("«Cancelar» descarta el borrador, en los DOS selectores de pin", () => {
    // Lo encontró el auditor: «Cancelar» solo cerraba el selector y dejaba `pinDraft` puesto, así
    // que el aviso habría seguido enseñando la zona de un pin descartado.
    const src = leer("src/components/OrderModal.tsx");
    const cancelar = src.match(/onClick=\{\(\) => \{ setPinDraft\(null\); setShowPinPicker\(false\); \}\}/g) ?? [];
    expect(cancelar).toHaveLength(2);
  });
  it("con el selector cerrado la zona vuelve al pin guardado, o a la ciudad", () => {
    // El mismo cálculo que hace la ficha cuando `pinVisible` es null.
    const guardado = { delivery_address: DIR, route_miles: 30, delivery_lat: FUERA[0], delivery_lng: FUERA[1] };
    expect(conBorrador(guardado, null).zone).toBe("nonlocal");
    expect(conBorrador({ delivery_address: DIR, route_miles: 12 }, null)).toMatchObject({ zone: "local", zoneSource: "city" });
  });
});

describe("lo que no cambia", () => {
  it("la tarifa: mismo precio para la misma zona y millas", () => {
    const a = suggestDeliveryFee({ delivery_address: DIR, route_miles: 13 });
    const b = suggestDeliveryFee({ delivery_address: DIR, route_miles: 13, delivery_lat: DENTRO[0], delivery_lng: DENTRO[1] });
    expect(b.list).toBe(a.list);
    expect(b.discount).toBe(a.discount);
  });
  it("las fórmulas y el respaldo siguen intactos", () => {
    const src = leer("src/lib/pricing.ts");
    expect(src).toMatch(/export function listFee\(miles: number, local = true\): number \{/);
    expect(src).toMatch(/export function discountFee\(miles: number, local = true\): number \{/);
    expect(src).toMatch(/const local = porPunto \?\? isLocalCity\(city, s\);/);
  });
});
