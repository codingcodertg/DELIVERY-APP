import { describe, it, expect } from "vitest";
import { choferesEnVivo, marcaEnVivo } from "./choferes-en-vivo";
import { MINUTOS_PARA_AVISAR, posicionesDeChoferes, posicionFusionada, textoDeLaFusion, type CamionDelChofer, type MemoriaDeSeparados } from "./posicion-del-chofer";
import type { DriverLocation } from "./types";

/**
 * UNA posición por chofer, de su teléfono y del rastreador de su camión (D-903). Aquí no hay red ni TrackSolid:
 * las dos fuentes son datos inventados y el reloj entra por parámetro.
 */

const AHORA = Date.parse("2026-11-06T18:00:00Z");
const hace = (min: number) => new Date(AHORA - min * 60_000).toISOString();
const PHARR = { lat: 26.1948, lng: -98.1836 };
/** ~5 millas al norte. */
const LEJOS = { lat: 26.27, lng: -98.1836 };
const t = (en: string) => en;

const telefono = (min: number, p: Partial<DriverLocation> = {}): DriverLocation => ({
  id: "f1", driver_id: "ana", ...PHARR, accuracy_m: 12, speed_mps: 0, heading: null, battery_pct: 80, recorded_at: hace(min), created_at: hace(min), ...p,
});
const camion = (p: Partial<CamionDelChofer> = {}): CamionDelChofer => ({
  driverId: "ana", imei: "863240070017882", nombre: "EDINBURG PETERBIL", ...PHARR, velocidadKmh: 0, posicionEn: hace(0.3), contactoEn: hace(0.3), encendido: true, ...p,
});

describe("posicionFusionada — qué fuente se usa", () => {
  it("las dos frescas y juntas: la más nueva", () => {
    expect(posicionFusionada(telefono(6), camion(), AHORA)).toMatchObject({ fuente: "truck", motivo: "fresher", separados: false });
    expect(posicionFusionada(telefono(0.2), camion({ posicionEn: hace(4), contactoEn: hace(4) }), AHORA)).toMatchObject({ fuente: "phone", motivo: "fresher" });
  });

  it("a menos de 30 s una de otra: el camión", () => {
    expect(posicionFusionada(telefono(0.1), camion({ posicionEn: hace(0.4), contactoEn: hace(0.4) }), AHORA)).toMatchObject({ fuente: "truck" });
  });

  it("teléfono más nuevo pero impreciso (>200 m): el camión", () => {
    expect(posicionFusionada(telefono(0.2, { accuracy_m: 900 }), camion({ posicionEn: hace(3), contactoEn: hace(3) }), AHORA)).toMatchObject({ fuente: "truck", motivo: "accuracy" });
  });

  it("el teléfono deja de reportar (sin datos, sin batería, app cerrada): el camión mantiene al chofer", () => {
    expect(posicionFusionada(telefono(25), camion(), AHORA)).toMatchObject({ fuente: "truck", motivo: "only", telefonoMin: 25 });
    expect(posicionFusionada(null, camion(), AHORA)).toMatchObject({ fuente: "truck", motivo: "only", telefonoMin: null });
  });

  it("el rastreador calla o no tiene punto: el teléfono", () => {
    expect(posicionFusionada(telefono(1), camion({ posicionEn: hace(40), contactoEn: hace(40) }), AHORA)).toMatchObject({ fuente: "phone", motivo: "only" });
    expect(posicionFusionada(telefono(1), camion({ lat: null, lng: null }), AHORA)).toMatchObject({ fuente: "phone", camionMin: null });
    expect(posicionFusionada(telefono(1), null, AHORA)).toMatchObject({ fuente: "phone", motivo: "only" });
  });

  it("camión estacionado (motor apagado): su punto es viejo pero el rastreador late — sigue valiendo", () => {
    const f = posicionFusionada(telefono(30), camion({ encendido: false, posicionEn: hace(600), contactoEn: hace(2) }), AHORA);
    expect(f).toMatchObject({ fuente: "truck", motivo: "only" });
    expect(f!.camionMin).toBeCloseTo(2);
  });

  it("motor encendido con el punto viejo: NO vale por el latido (un camión en marcha manda puntos)", () => {
    expect(posicionFusionada(telefono(1), camion({ encendido: true, posicionEn: hace(30), contactoEn: hace(0.5) }), AHORA)).toMatchObject({ fuente: "phone", motivo: "only" });
  });

  it("ninguna fresca: la menos vieja, hasta una hora; después, nada", () => {
    expect(posicionFusionada(telefono(40), camion({ posicionEn: hace(20), contactoEn: hace(20) }), AHORA)).toMatchObject({ fuente: "truck", motivo: "old" });
    expect(posicionFusionada(telefono(20), camion({ posicionEn: hace(45), contactoEn: hace(45) }), AHORA)).toMatchObject({ fuente: "phone", motivo: "old" });
    expect(posicionFusionada(telefono(90), camion({ posicionEn: hace(300), contactoEn: hace(300) }), AHORA)).toBeNull();
    expect(posicionFusionada(null, null, AHORA)).toBeNull();
  });

  it("separados: gana la que se mueve; si no se sabe, el teléfono (es de la persona)", () => {
    // El camión en marcha y el teléfono quieto en otro sitio (olvidado en la tienda).
    expect(posicionFusionada(telefono(1, LEJOS), camion({ velocidadKmh: 60 }), AHORA)).toMatchObject({ fuente: "truck", motivo: "other_is_still", separados: true });
    // El teléfono en marcha y el camión estacionado (hoy lleva otro camión).
    expect(posicionFusionada(telefono(1, { ...LEJOS, speed_mps: 15 }), camion({ encendido: false }), AHORA)).toMatchObject({ fuente: "phone", motivo: "other_is_still", separados: true });
    // Los dos quietos, o los dos en marcha: no se adivina.
    expect(posicionFusionada(telefono(1, LEJOS), camion({ encendido: false }), AHORA)).toMatchObject({ fuente: "phone", motivo: "person", separados: true });
    expect(posicionFusionada(telefono(1, { ...LEJOS, speed_mps: 15 }), camion({ velocidadKmh: 60 }), AHORA)).toMatchObject({ fuente: "phone", motivo: "person", separados: true });
  });

  it("lejos pero con datos de horas distintas: no es desacuerdo (el camión recorrió eso en ese rato)", () => {
    // 5 millas (~8 km) entre un dato de hace 8 min y otro de ahora: a 70 mph caben de sobra.
    expect(posicionFusionada(telefono(8, LEJOS), camion({ velocidadKmh: 90 }), AHORA)).toMatchObject({ fuente: "truck", separados: false });
  });
});

describe("posicionesDeChoferes — la función que usan las pantallas", () => {
  const memoria = (): MemoriaDeSeparados => new Map();

  it("sin camiones devuelve lo del teléfono, una fila por chofer (la más nueva)", () => {
    const out = posicionesDeChoferes([telefono(5), telefono(1, { id: "f2" }), telefono(2, { id: "f3", driver_id: "luis" })], [], AHORA, memoria());
    expect(out.map((p) => [p.driver_id, p.id])).toEqual([["ana", "f2"], ["luis", "f3"]]);
    expect(out.every((p) => p.fusion === undefined)).toBe(true);
  });

  it("chofer con camión: una sola fila, con la fuente elegida; el chofer sin camión, como siempre", () => {
    const out = posicionesDeChoferes([telefono(20), telefono(1, { id: "f3", driver_id: "luis" })], [camion({ lat: 26.2, lng: -98.2 })], AHORA, memoria());
    expect(out).toHaveLength(2);
    const ana = out.find((p) => p.driver_id === "ana")!;
    expect(ana).toMatchObject({ lat: 26.2, lng: -98.2, accuracy_m: null, fusion: { fuente: "truck", camion: { nombre: "EDINBURG PETERBIL" } } });
    expect(out.find((p) => p.driver_id === "luis")!.fusion).toBeUndefined();
  });

  it("un chofer cuyo teléfono no ha reportado NUNCA sale igual, por su camión", () => {
    const out = posicionesDeChoferes([], [camion()], AHORA, memoria());
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ driver_id: "ana", ...PHARR, fusion: { fuente: "truck", telefonoMin: null } });
  });

  it("entra tal cual en choferesEnVivo, y la marca lleva la tarjeta con las dos edades", () => {
    const fundidas = posicionesDeChoferes([telefono(6)], [camion()], AHORA, memoria());
    const [c] = choferesEnVivo(fundidas, new Map([["ana", "Ana"]]), () => "#123456", AHORA);
    expect(c).toMatchObject({ driver: "Ana", fusion: { fuente: "truck" } });
    expect(c.ageMin).toBeCloseTo(0.3);
    const m = marcaEnVivo(c, t);
    expect(m.label).toContain("EDINBURG PETERBIL");
    expect(m.tarjeta!.lineas[1]).toBe("Truck GPS, 18 s ago · Phone, 6 min ago");
    expect(m.tarjeta!.aviso).toBeNull();
    // Sin camión: lo de antes, sin tarjeta.
    const [solo] = choferesEnVivo([telefono(3)], new Map([["ana", "Ana"]]), () => "#123456", AHORA);
    expect(marcaEnVivo(solo, t)).toMatchObject({ label: "🚚 Ana · 3 min ago" });
    expect(marcaEnVivo(solo, t).tarjeta).toBeUndefined();
  });

  it("separados: avisa solo cuando lleva varios minutos seguidos, y se le pasa en cuanto se juntan", () => {
    const m = memoria();
    const lejos = (ahora: number) => posicionesDeChoferes(
      [{ ...telefono(0), ...LEJOS, recorded_at: new Date(ahora - 20_000).toISOString() }],
      [camion({ encendido: false, contactoEn: new Date(ahora - 20_000).toISOString() })], ahora, m)[0].fusion!;
    expect(lejos(AHORA)).toMatchObject({ separados: true, aviso: false });
    expect(lejos(AHORA + 60_000).aviso).toBe(false);
    const f = lejos(AHORA + MINUTOS_PARA_AVISAR * 60_000);
    expect(f.aviso).toBe(true);
    expect(textoDeLaFusion(f, t).aviso).toMatch(/^Phone and truck are 5\.\d mi apart: wrong truck assigned\?$/);
    // Se juntan: se olvida; si se vuelven a separar, la cuenta empieza de cero.
    const despues = AHORA + 5 * 60_000;
    const juntos = posicionesDeChoferes([{ ...telefono(0), recorded_at: new Date(despues - 20_000).toISOString() }], [camion({ encendido: false, contactoEn: new Date(despues - 20_000).toISOString() })], despues, m)[0].fusion!;
    expect(juntos).toMatchObject({ separados: false, aviso: false });
    expect(lejos(despues + 30_000).aviso).toBe(false);
  });
});
