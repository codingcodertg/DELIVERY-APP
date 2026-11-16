import { describe, expect, it } from "vitest";
import {
  TTL_DISTANCIA_MS,
  TTL_PLACES_MS,
  TTL_RUTA_OPT_MS,
  claveDeDireccion,
  claveDeRuta,
  clavePlaces,
  clavePorPar,
  cubetaDeHora,
  estaVigente,
  hashClave,
} from "@/lib/cache-google";

const HORA = 60 * 60 * 1000;

describe("claveDeDireccion", () => {
  it("normaliza: minúsculas, sin espacios sobrantes y espacios internos colapsados", () => {
    expect(claveDeDireccion("  1200   North  Main St,  McAllen, TX ")).toBe("1200 north main st, mcallen, tx");
  });
  it("dos formas de escribir la misma dirección dan la misma clave", () => {
    expect(claveDeDireccion("100 Main St, TX")).toBe(claveDeDireccion("100 MAIN st,   tx"));
  });
  it("direcciones distintas dan claves distintas", () => {
    expect(claveDeDireccion("100 Main St, TX")).not.toBe(claveDeDireccion("101 Main St, TX"));
  });
});

describe("hashClave", () => {
  it("es SHA-256 en hexadecimal de 64 caracteres y determinista", () => {
    const h = hashClave("hola");
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(hashClave("hola")).toBe(h);
    expect(h).toBe("b221d9dbb083a7f33428d7c2a3c3198ae925614d70210e28716ccaa7cd4ddb79");
  });
});

describe("clavePorPar", () => {
  it("ignora mayúsculas y espacios en cada extremo", () => {
    expect(clavePorPar(" 10 Elm  St ", "Mission, TX")).toBe(clavePorPar("10 elm st", "mission, tx"));
  });
  it("es ordenada: A→B y B→A son claves distintas", () => {
    expect(clavePorPar("A", "B")).not.toBe(clavePorPar("B", "A"));
  });
  it("no confunde el límite entre origen y destino", () => {
    expect(clavePorPar("ab", "c")).not.toBe(clavePorPar("a", "bc"));
  });
});

describe("clavePlaces", () => {
  const centros: [number, number][] = [[26.2, -98.23], [26.19, -97.7]];
  it("es estable para la misma categoría, consultas y centros", () => {
    expect(clavePlaces("flooring", ["flooring store"], centros)).toBe(clavePlaces("flooring", ["flooring store"], centros));
  });
  it("cambia si cambian las consultas o los centros (la lista ya no sirve)", () => {
    const base = clavePlaces("flooring", ["flooring store"], centros);
    expect(clavePlaces("flooring", ["flooring store", "tile store"], centros)).not.toBe(base);
    expect(clavePlaces("flooring", ["flooring store"], [[26.2, -98.23]])).not.toBe(base);
    expect(clavePlaces("bigbox", ["flooring store"], centros)).not.toBe(base);
  });
});

describe("claveDeRuta", () => {
  const paradas = [
    { id: "a", lat: 26.2034561, lng: -98.2301234 },
    { id: "b", lat: 26.1900001, lng: -97.7000009 },
  ];
  const base = { paradas, roundtrip: false, dateISO: "2026-11-16", trafficOptimal: false, optimize: true, cubeta: 500 };

  it("redondea las coordenadas a 5 decimales: diferencias en el sexto no cambian la clave", () => {
    const movida = paradas.map((s) => ({ ...s, lat: s.lat + 0.0000001 }));
    expect(claveDeRuta({ ...base, paradas: movida })).toBe(claveDeRuta(base));
  });
  it("una diferencia en el quinto decimal sí cambia la clave", () => {
    const movida = [{ ...paradas[0], lat: paradas[0].lat + 0.00001 }, paradas[1]];
    expect(claveDeRuta({ ...base, paradas: movida })).not.toBe(claveDeRuta(base));
  });
  it("el orden de las paradas importa", () => {
    expect(claveDeRuta({ ...base, paradas: [paradas[1], paradas[0]] })).not.toBe(claveDeRuta(base));
  });
  it("cambian las opciones, la fecha y la hora", () => {
    const k = claveDeRuta(base);
    expect(claveDeRuta({ ...base, roundtrip: true })).not.toBe(k);
    expect(claveDeRuta({ ...base, trafficOptimal: true })).not.toBe(k);
    expect(claveDeRuta({ ...base, optimize: false })).not.toBe(k);
    expect(claveDeRuta({ ...base, dateISO: "2026-11-17" })).not.toBe(k);
    expect(claveDeRuta({ ...base, cubeta: 501 })).not.toBe(k);
  });
  it("es un hash SHA-256 de 64 caracteres", () => {
    expect(claveDeRuta(base)).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("cubetaDeHora", () => {
  it("cambia cada hora y se mantiene dentro de la misma hora", () => {
    const inicio = 1_700_000_000_000 - (1_700_000_000_000 % HORA);
    expect(cubetaDeHora(inicio)).toBe(cubetaDeHora(inicio + HORA - 1));
    expect(cubetaDeHora(inicio + HORA)).toBe(cubetaDeHora(inicio) + 1);
  });
});

describe("estaVigente (TTL)", () => {
  const ahora = Date.parse("2026-11-16T12:00:00.000Z");
  it("una fila de hace menos del TTL está vigente", () => {
    expect(estaVigente("2026-11-16T11:30:00.000Z", TTL_RUTA_OPT_MS, ahora)).toBe(true);
  });
  it("una fila de hace más del TTL ya no vale", () => {
    expect(estaVigente("2026-11-16T10:30:00.000Z", TTL_RUTA_OPT_MS, ahora)).toBe(false);
  });
  it("los TTL son 7 días (lugares), 60 min (rutas) y 30 días (distancias)", () => {
    expect(TTL_PLACES_MS).toBe(7 * 24 * HORA);
    expect(TTL_RUTA_OPT_MS).toBe(HORA);
    expect(TTL_DISTANCIA_MS).toBe(30 * 24 * HORA);
  });
  it("a los 7 días exactos ya caduca la lista de lugares", () => {
    const hace7Dias = new Date(ahora - TTL_PLACES_MS).toISOString();
    expect(estaVigente(hace7Dias, TTL_PLACES_MS, ahora)).toBe(false);
    expect(estaVigente(new Date(ahora - TTL_PLACES_MS + 1000).toISOString(), TTL_PLACES_MS, ahora)).toBe(true);
  });
  it("una fecha que no se lee cuenta como caducada", () => {
    expect(estaVigente(null, TTL_PLACES_MS, ahora)).toBe(false);
    expect(estaVigente(undefined, TTL_PLACES_MS, ahora)).toBe(false);
    expect(estaVigente("no es una fecha", TTL_PLACES_MS, ahora)).toBe(false);
  });
});
