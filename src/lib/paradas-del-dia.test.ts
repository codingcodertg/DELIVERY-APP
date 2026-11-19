import { describe, expect, it } from "vitest";
import {
  horaDeItem, lineaDelDia, limitesDelDia, paradaDeLaLinea, puedeIrAlDiaSiguiente, totalesDelDia, turnosDelDia, type TurnoDelDia,
} from "@/lib/paradas-del-dia";
import { cierreDePausa, cierreSinRecibo, esRechazoDeFoto, puedeAnadirFotoDespues, reciboTardio, type PausaDelChofer } from "@/lib/pausas-del-chofer";

// ============================================================
// «Paradas» (2026-11-19): la bitácora del día del chofer. Lo que se prueba aquí es lo que se pinta: el orden de la línea
// (turno, paradas, fin de turno), los totales, qué se puede añadir a una parada cerrada y qué día se puede mirar.
// ============================================================

const FOTO = "data:image/jpeg;base64,AAAA";
const base = (p: Partial<PausaDelChofer> = {}): PausaDelChofer => ({
  id: "p1", driver_id: "u1", motivo: "gas", nota: null, empezo_at: "2026-11-18T15:00:00.000Z", termino_at: "2026-11-18T15:20:00.000Z",
  lat: null, lng: null, precision_m: null, recibo_foto: null, recibo_monto: null, recibo_galones: null, sin_recibo: false,
  created_at: "2026-11-18T15:00:00.000Z", ...p,
});
const turno = (p: Partial<TurnoDelDia> = {}): TurnoDelDia => ({ id: "t1", started_at: "2026-11-18T13:00:00.000Z", ended_at: "2026-11-18T23:00:00.000Z", note: null, ...p });
const AHORA = new Date("2026-11-18T16:00:00.000Z");

describe("la línea del día: el turno y las paradas, en orden de hora", () => {
  it("entrada del turno, paradas y salida, en ese orden", () => {
    const l = lineaDelDia({
      turnos: [turno()],
      paradas: [base({ id: "b", empezo_at: "2026-11-18T17:00:00.000Z", termino_at: "2026-11-18T17:10:00.000Z", motivo: "food" }), base({ id: "a" })],
      ahora: AHORA,
    });
    expect(l.items.map((i) => (i.tipo === "parada" ? `parada:${i.id}` : i.tipo))).toEqual(["turno-inicio", "parada:a", "parada:b", "turno-fin"]);
  });

  it("si la entrada y una parada empatan, la entrada va primero; si la salida y una parada empatan, la salida va al final", () => {
    const l = lineaDelDia({
      turnos: [turno({ started_at: "2026-11-18T15:00:00.000Z", ended_at: "2026-11-18T15:20:00.000Z" })],
      paradas: [base({ id: "x", empezo_at: "2026-11-18T15:00:00.000Z", termino_at: "2026-11-18T15:20:00.000Z" })],
      ahora: AHORA,
    });
    expect(l.items.map((i) => i.tipo)).toEqual(["turno-inicio", "parada", "turno-fin"]);
  });

  it("sin turno ese día: no hay entrada ni salida, y lo dice", () => {
    const l = lineaDelDia({ turnos: [], paradas: [base()], ahora: AHORA });
    expect(l.huboTurno).toBe(false);
    expect(l.items.map((i) => i.tipo)).toEqual(["parada"]);
  });

  it("turno abierto (sin salida): no hay ítem de salida y se marca como abierto", () => {
    const l = lineaDelDia({ turnos: [turno({ ended_at: null })], paradas: [], ahora: AHORA });
    expect(l.turnoAbierto).toBe(true);
    expect(l.items.map((i) => i.tipo)).toEqual(["turno-inicio"]);
  });

  it("la hora de un ítem de parada es la de su inicio", () => {
    const l = lineaDelDia({ turnos: [], paradas: [base()], ahora: AHORA });
    expect(horaDeItem(l.items[0])).toBe("2026-11-18T15:00:00.000Z");
  });
});

describe("una parada en la línea", () => {
  it("la que sigue parada no tiene fin y cuenta sus minutos hasta ahora", () => {
    const p = paradaDeLaLinea(base({ termino_at: null, empezo_at: "2026-11-18T15:30:00.000Z" }), AHORA);
    expect(p).toMatchObject({ enCurso: true, hasta: null, minutos: 30 });
  });

  it("la cerrada cuenta de inicio a fin, y no es en curso", () => {
    const p = paradaDeLaLinea(base(), AHORA);
    expect(p).toMatchObject({ enCurso: false, hasta: "2026-11-18T15:20:00.000Z", minutos: 20 });
  });

  it("la gasolina sin recibo todavía queda como pendiente; la de otro motivo, no", () => {
    expect(paradaDeLaLinea(base({ motivo: "gas" }), AHORA).reciboPendiente).toBe(true);
    expect(paradaDeLaLinea(base({ motivo: "food" }), AHORA).reciboPendiente).toBe(false);
  });

  it("una comida cerrada sin foto se puede completar; la que ya tiene foto, no", () => {
    expect(paradaDeLaLinea(base({ motivo: "food" }), AHORA).puedeAnadirFoto).toBe(true);
    expect(paradaDeLaLinea(base({ motivo: "food", recibo_foto: FOTO }), AHORA).puedeAnadirFoto).toBe(false);
  });

  it("los galones solo se muestran en gasolina", () => {
    expect(paradaDeLaLinea(base({ motivo: "gas", recibo_galones: 15.2 }), AHORA).galones).toBe(15.2);
    expect(paradaDeLaLinea(base({ motivo: "other", recibo_galones: 3 }), AHORA).galones).toBeNull();
  });
});

describe("los totales del día", () => {
  it("cuenta paradas y minutos; la abierta cuenta hasta ahora", () => {
    const t = totalesDelDia([
      base({ empezo_at: "2026-11-18T15:00:00.000Z", termino_at: "2026-11-18T15:20:00.000Z" }),
      base({ id: "b", motivo: "food", empezo_at: "2026-11-18T15:30:00.000Z", termino_at: null }),
    ], AHORA);
    expect(t).toMatchObject({ paradas: 2, minutos: 20 + 30 });
  });

  it("la gasolina suma su monto y sus galones; los montos de otro motivo no entran ahí", () => {
    const t = totalesDelDia([
      base({ recibo_foto: FOTO, recibo_monto: 54.3, recibo_galones: 15.2 }),
      base({ id: "g2", recibo_foto: FOTO, recibo_monto: 40.1, recibo_galones: 9.1234 }),
      base({ id: "o", motivo: "other", recibo_foto: FOTO, recibo_monto: 80 }),
    ], AHORA);
    expect(t.gasolinaMonto).toBe(94.4);
    expect(t.gasolinaGalones).toBe(24.323);
  });

  it("cuenta la gasolina sin recibo como pendiente", () => {
    expect(totalesDelDia([base({ id: "p" }), base({ id: "q", recibo_foto: FOTO })], AHORA).recibosPendientes).toBe(1);
  });

  it("un día sin paradas: todo en cero", () => {
    expect(totalesDelDia([], AHORA)).toEqual({ paradas: 0, minutos: 0, gasolinaMonto: 0, gasolinaGalones: 0, recibosPendientes: 0 });
  });
});

describe("el día que se mira", () => {
  it("no se pasa de hoy: el día siguiente solo si el que se mira es anterior a hoy", () => {
    expect(puedeIrAlDiaSiguiente("2026-11-17", "2026-11-18")).toBe(true);
    expect(puedeIrAlDiaSiguiente("2026-11-18", "2026-11-18")).toBe(false);
  });

  it("los límites del día son de Central: el día tiene 24 horas, y el de hoy empieza antes que el de mañana", () => {
    const { desde, hasta } = limitesDelDia("2026-11-18");
    expect(Date.parse(hasta) - Date.parse(desde)).toBe(24 * 60 * 60 * 1000);
    expect(Date.parse(desde)).toBeLessThan(Date.parse(hasta));
  });

  it("de los turnos, solo los que empezaron dentro del día", () => {
    const { desde, hasta } = limitesDelDia("2026-11-18");
    const dentro = turno({ id: "in", started_at: new Date(Date.parse(desde) + 3600_000).toISOString() });
    const fuera = turno({ id: "out", started_at: new Date(Date.parse(hasta) + 3600_000).toISOString() });
    expect(turnosDelDia([dentro, fuera], desde, hasta).map((t) => t.id)).toEqual(["in"]);
  });
});

describe("la foto y el monto de una parada que no es de gasolina (2026-11-19)", () => {
  it("cierre: la foto y el monto valen para cualquier motivo; los galones y «no tengo» no", () => {
    expect(cierreDePausa("food", { foto: FOTO, monto: "$12.50", galones: "", sinRecibo: false }))
      .toEqual({ recibo_foto: FOTO, recibo_monto: 12.5, recibo_galones: null, sin_recibo: false });
    expect(cierreDePausa("other", { foto: null, monto: "", galones: "", sinRecibo: false }))
      .toEqual({ recibo_foto: null, recibo_monto: null, recibo_galones: null, sin_recibo: false });
  });

  it("un monto que no es número no pasa, en ninguna parada", () => {
    expect(cierreDePausa("other", { foto: null, monto: "mucho", galones: "", sinRecibo: false })).toEqual({ falta: "monto" });
  });

  it("añadir después: solo a una parada cerrada sin foto (y sin «no tengo recibo»)", () => {
    expect(puedeAnadirFotoDespues(base({ motivo: "other" }))).toBe(true);
    expect(puedeAnadirFotoDespues(base({ motivo: "gas" }))).toBe(true);
    expect(puedeAnadirFotoDespues(base({ termino_at: null }))).toBe(false);
    expect(puedeAnadirFotoDespues(base({ recibo_foto: FOTO }))).toBe(false);
    expect(puedeAnadirFotoDespues(base({ motivo: "gas", sin_recibo: true }))).toBe(false);
  });

  it("reciboTardio: la foto es obligatoria; los galones solo en gasolina", () => {
    expect(reciboTardio({ foto: null, monto: "5", galones: "" }, "other")).toEqual({ falta: "foto" });
    expect(reciboTardio({ foto: FOTO, monto: "5", galones: "3" }, "other")).toEqual({ recibo_foto: FOTO, recibo_monto: 5, recibo_galones: null });
    expect(reciboTardio({ foto: FOTO, monto: "", galones: "3" }, "gas")).toEqual({ recibo_foto: FOTO, recibo_monto: null, recibo_galones: 3 });
  });

  it("si la base rechaza la foto de una que no es de gasolina, se reconoce el rechazo y se cierra sin nada de recibo", () => {
    expect(esRechazoDeFoto({ message: 'new row violates check constraint "pausas_recibo_solo_gasolina"' })).toBe(true);
    expect(esRechazoDeFoto({ code: "42501", message: "new row violates row-level security policy" })).toBe(true);
    expect(esRechazoDeFoto({ message: "Failed to fetch" })).toBe(false);
    expect(cierreSinRecibo()).toEqual({ recibo_foto: null, recibo_monto: null, recibo_galones: null, sin_recibo: false });
  });
});
