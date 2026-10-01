import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AddressInput } from "@/components/AddressInput";
import { AvisoSoloCiudad } from "@/components/AvisoSoloCiudad";
import { PrefsProvider } from "@/lib/prefs";
import { CAJA_DE_LA_ZONA, CAJA_DE_TEXAS, TOPE_DE_CIUDADES, TOPE_DE_PLACES, cuerpoDeCiudades, sugerenciasDePlaces } from "./busqueda-de-direccion";
import { necesitaUbicacion } from "./geocode-on-save";
import { suggestDeliveryFee } from "./pricing";
import { missingKeys } from "./required";
import { AVISO_SOLO_CIUDAD, esSoloCiudad, ordenSoloCiudad } from "./solo-ciudad";

/**
 * D-454 · «cuando buscas una direccion que puedas selecionar solo la ciudad si asi lo quieres como broad answer».
 * Ninguna prueba llama a un proveedor: la llamada a Places se finge.
 */

const leer = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8").replace(/\r\n/g, "\n");
const pinta = (el: ReturnType<typeof createElement>) => renderToStaticMarkup(createElement(PrefsProvider, null, el));

describe("qué es «solo ciudad»", () => {
  it("una ciudad a secas lo es, en el formato de cada proveedor y tecleada a mano", () => {
    for (const d of [
      "Mission, TX, USA",                                          // Places
      "Mission, TX 78572, USA",                                    // Google Geocoding
      "Mission, Texas, United States",                             // Mapbox
      "Pharr, Hidalgo County, Texas, 78577, United States",        // Nominatim
      "Mission TX", "mission tx 78572", "Mission", "  San Juan , TX ",
    ]) expect(esSoloCiudad(d), d).toBe(true);
  });
  it("con calle delante no lo es, lleve número o no; ni lo vacío", () => {
    for (const d of [
      "123 Main St, Mission, TX, USA", "Main St, Mission, TX", "1203 N 10th St, McAllen, TX 78501, USA",
      "9 W ROBLES EDINBURG TX", "123 Main St", "", "   ", null, undefined,
    ]) expect(esSoloCiudad(d), String(d)).toBe(false);
  });
  it("la orden: el pin soltado a mano quita el aviso; el punto geocodificado (centro de la ciudad) no", () => {
    expect(ordenSoloCiudad({ delivery_address: "Mission, TX, USA" })).toBe(true);
    expect(ordenSoloCiudad({ delivery_address: "Mission, TX, USA", delivery_pin_source: "geocoded" })).toBe(true);
    expect(ordenSoloCiudad({ delivery_address: "Mission, TX, USA", delivery_pin_source: "manual" })).toBe(false);
    expect(ordenSoloCiudad({ delivery_address: "123 Main St, Mission, TX" })).toBe(false);
    expect(ordenSoloCiudad({})).toBe(false);
    expect(ordenSoloCiudad(null)).toBe(false);
  });
});

describe("el buscador ofrece la ciudad", () => {
  const calle = (n: number, ciudad: string) => `${n} Mission Rd, ${ciudad}, TX, USA`;
  const LOCALES = [calle(1, "Pharr"), calle(2, "Alamo"), calle(3, "Donna")];
  /** Places fingido: contesta según lo que se le pide (ciudades, zona verde o Texas) y lo apunta. */
  function finge(r: { ciudades?: string[] | Error; zona?: string[] | Error; texas?: string[] | Error }) {
    const pedidas: string[] = [];
    const pide = async (cuerpo: object) => {
      const c = cuerpo as { includedPrimaryTypes?: string[]; locationRestriction: { rectangle: { high: { latitude: number } } } };
      const cual = c.includedPrimaryTypes ? "ciudades" : c.locationRestriction.rectangle.high.latitude === CAJA_DE_LA_ZONA.norte ? "zona" : "texas";
      pedidas.push(cual);
      const v = r[cual as "ciudades" | "zona" | "texas"] ?? [];
      if (v instanceof Error) throw v;
      return v;
    };
    return { pide, pedidas };
  }

  it("la llamada de ciudades: solo ciudades, restringida a Texas, solo EE. UU.", () => {
    const t = CAJA_DE_TEXAS;
    expect(cuerpoDeCiudades("miss")).toEqual({
      input: "miss", includedRegionCodes: ["us"], includedPrimaryTypes: ["(cities)"],
      locationRestriction: { rectangle: { low: { latitude: t.sur, longitude: t.oeste }, high: { latitude: t.norte, longitude: t.este } } },
    });
  });
  it("al teclear un nombre de ciudad, la ciudad sale la PRIMERA, delante de las calles locales que casan", async () => {
    const f = finge({ ciudades: ["Mission, TX, USA"], zona: LOCALES });
    expect(await sugerenciasDePlaces("Mission", f.pide)).toEqual(["Mission, TX, USA", ...LOCALES]);
    expect([...f.pedidas].sort()).toEqual(["ciudades", "zona"]);
  });
  it("una ciudad de fuera de la zona verde también sale, aunque lo local baste para no preguntar por Texas", async () => {
    const f = finge({ ciudades: ["Houston, TX, USA"], zona: LOCALES });
    expect((await sugerenciasDePlaces("Houston", f.pide))[0]).toBe("Houston, TX, USA");
    expect(f.pedidas).not.toContain("texas");
  });
  it("con un número en lo tecleado no se gasta la llamada de ciudades", async () => {
    const f = finge({ ciudades: ["Mission, TX, USA"], zona: LOCALES });
    expect(await sugerenciasDePlaces("120 Mission", f.pide)).toEqual(LOCALES);
    expect(f.pedidas).toEqual(["zona"]);
  });
  it(`de la llamada de ciudades solo pasa lo que es ciudad a secas y de Texas, y como mucho ${TOPE_DE_CIUDADES}`, async () => {
    const f = finge({
      ciudades: ["Mission, KS, USA", "5 Mission Plaza, Mission, TX, USA", "Mission, TX, USA", "Mission Bend, TX, USA", "Missouri City, TX, USA"],
      zona: LOCALES,
    });
    expect(await sugerenciasDePlaces("Miss", f.pide)).toEqual(["Mission, TX, USA", "Mission Bend, TX, USA", ...LOCALES]);
  });
  it("las ciudades no le quitan el sitio a las direcciones: siguen saliendo hasta el tope de antes", async () => {
    const muchas = [1, 2, 3, 4, 5, 6, 7].map((n) => calle(n, "Pharr"));
    const r = await sugerenciasDePlaces("Mission", finge({ ciudades: ["Mission, TX, USA", "Mission Bend, TX, USA"], zona: muchas }).pide);
    expect(r).toEqual(["Mission, TX, USA", "Mission Bend, TX, USA", ...muchas.slice(0, TOPE_DE_PLACES)]);
  });
  it("si la llamada de ciudades falla, las direcciones salen igual; y si fallan las direcciones, la ciudad sale", async () => {
    expect(await sugerenciasDePlaces("Mission", finge({ ciudades: new Error("x"), zona: LOCALES }).pide)).toEqual(LOCALES);
    expect(await sugerenciasDePlaces("Mission", finge({ ciudades: ["Mission, TX, USA"], zona: new Error("x"), texas: new Error("y") }).pide)).toEqual(["Mission, TX, USA"]);
  });
  it("la ciudad que también viene entre las direcciones sale una sola vez", async () => {
    const f = finge({ ciudades: ["Mission, TX, USA"], zona: ["Mission, TX, USA", ...LOCALES] });
    expect(await sugerenciasDePlaces("Mission", f.pide)).toEqual(["Mission, TX, USA", ...LOCALES]);
  });
  it("la ruta deja sitio a las ciudades y sigue sin montar a mano lo que pide a Places", () => {
    const r = leer("src/app/api/geocode/route.ts");
    expect(r).toContain("return sugerenciasDePlaces(q, async (cuerpo) => {");
    expect(r).toContain("suggestions.slice(0, 6)");
    expect(r).not.toMatch(/includedPrimaryTypes|cuerpoDeCiudades/);
  });
});

describe("la orden «solo ciudad» sigue el camino de cualquier dirección", () => {
  it("cumple la dirección obligatoria, y al guardar se le busca el punto (el centro de la ciudad)", () => {
    expect(missingKeys({ delivery_address: "Mission, TX, USA" }).has("delivery_address")).toBe(false);
    expect(missingKeys({ delivery_address: "" }).has("delivery_address")).toBe(true);
    expect(necesitaUbicacion({ delivery_address: "Mission, TX, USA" })).toBe(true);
  });
  it("antes de guardar, la zona sale de la ciudad; con el punto ya puesto, del punto", () => {
    const antes = suggestDeliveryFee({ delivery_address: "Mission, TX, USA", route_miles: 5 });
    expect(antes.zoneSource).toBe("city");
    expect(antes.zone).toBe("local");
    expect(suggestDeliveryFee({ delivery_address: "Mission, TX, USA", route_miles: 5, delivery_lat: 26.2159, delivery_lng: -98.3253 }).zoneSource).toBe("pin");
    expect(suggestDeliveryFee({ delivery_address: "Houston, TX, USA", route_miles: 350 }).zone).not.toBe("local");
  });
});

describe("el aviso se ve: buscador, ficha, Gestor, Mi ruta y la parada del chofer", () => {
  it("el componente pinta el aviso solo en una orden «solo ciudad»; corto para la tabla, entero para el chofer", () => {
    const entero = pinta(createElement(AvisoSoloCiudad, { orden: { delivery_address: "Mission, TX, USA" } }));
    expect(entero).toContain("data-solo-ciudad");
    expect(entero).toContain(AVISO_SOLO_CIUDAD.en);
    const corto = pinta(createElement(AvisoSoloCiudad, { orden: { delivery_address: "Mission, TX, USA" }, corto: true }));
    expect(corto).toContain("city only");
    expect(corto).toContain(`title="${AVISO_SOLO_CIUDAD.en}"`);
    expect(pinta(createElement(AvisoSoloCiudad, { orden: { delivery_address: "123 Main St, Mission, TX" } }))).toBe("");
    expect(pinta(createElement(AvisoSoloCiudad, { orden: { delivery_address: "Mission, TX", delivery_pin_source: "manual" } }))).toBe("");
  });
  it("el buscador deja el aviso bajo el campo cuando lo elegido es solo una ciudad, y no con una dirección con calle", () => {
    const con = pinta(createElement(AddressInput, { label: "Dirección", value: "Mission, TX, USA", onChange: () => {} }));
    expect(con).toContain("data-solo-ciudad");
    expect(con).toContain(AVISO_SOLO_CIUDAD.en);
    const sin = pinta(createElement(AddressInput, { label: "Dirección", value: "123 Main St, Mission, TX, USA", onChange: () => {} }));
    expect(sin).not.toContain("data-solo-ciudad");
    expect(pinta(createElement(AddressInput, { label: "Dirección", value: "", onChange: () => {} }))).not.toContain("data-solo-ciudad");
  });
  it("el buscador distingue la sugerencia de ciudad de la de calle, y elegirla es elegir como cualquier otra", () => {
    const a = leer("src/components/AddressInput.tsx");
    expect(a).toMatch(/\{esSoloCiudad\(s\)\s*\? <>🏙️ \{s\} <span className="hint" data-sugerencia-ciudad>/);
    expect(a).toContain(": <>📍 {s}</>}");
    expect(a).toContain('<button type="button" key={i} className="addr-opt" onClick={() => pick(s)}>');
  });
  it("la ficha de la orden y el Quote Builder buscan con ese buscador", () => {
    expect(leer("src/components/OrderModal.tsx")).toMatch(/<AddressInput\s+label=\{t\("Delivery Address", "Dirección de Entrega"\)\}/);
    expect(leer("src/components/LocationCombo.tsx")).toContain("<AddressInput");
    expect(leer("src/app/estimator/EntregaCotizacion.tsx")).toContain("<AddressInput");
  });
  it("la ficha lo dice en la fila de la dirección, y la parada del chofer bajo el destino", () => {
    const m = leer("src/components/OrderModal.tsx");
    expect(m).toContain('(existing.delivery_address || "—") + (ordenSoloCiudad(existing) ? ` — ⚠ ${t(AVISO_SOLO_CIUDAD.en, AVISO_SOLO_CIUDAD.es)}` : "")');
    expect(m).toContain("<AvisoSoloCiudad orden={order} />");
  });
  it("el Gestor: la pastilla en las tres celdas de «Ciudad de entrega» y una tarjeta por chofer que no depende de las columnas", () => {
    const g = leer("src/app/(app)/routes/page.tsx");
    expect(g.split("<AvisoSoloCiudad orden={d} corto />").length - 1).toBe(2);
    expect(g.split("<AvisoSoloCiudad orden={o} corto />").length - 1).toBe(1);
    expect(g).toContain("{stops.some(ordenSoloCiudad) && (");
    expect(g).toContain("{stops.filter(ordenSoloCiudad).map((d) =>");
    expect(g).toContain("data-solo-ciudad-ruta");
  });
  it("Mi ruta: en la siguiente parada y en cada parada de la lista", () => {
    const r = leer("src/app/(app)/my-route/page.tsx");
    expect(r).toContain("<AvisoSoloCiudad orden={next} />");
    expect(r).toContain("<AvisoSoloCiudad orden={d} />");
  });
});
