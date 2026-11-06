import { describe, it, expect, vi } from "vitest";
import { aGuardar, deLoGuardado, historialDeCamiones, horaDeJimi, aHoraDeJimi, limitesDelDia, pideHistorial, puntoDesdeJimi, ventanasDe, type AlmacenDeHistorial, type DiaDeCamion } from "./historial";
import type { AlmacenDeToken } from "./token";
import type { FetchFn } from "./api";

/**
 * El historial de los camiones (D-907): qué se le pide a TrackSolid, cuánto, y qué se guarda. Sin red: `fetch` es falso.
 * La forma de la respuesta es la que dio TrackSolid de verdad el 2026-11-06 (`jimi.device.track.list`).
 */

const CONFIG = { appKey: "k", appSecret: "secreto-que-no-sale", cuenta: "a", claveMd5: "m" };
const IMEI = "863240070017882", ZONA = "America/Chicago";
const AHORA = Date.parse("2026-11-06T18:00:00Z");           // mediodía del 6 en Texas
const tokenFijo: AlmacenDeToken = { leeToken: async () => ({ accessToken: "tok", refreshToken: "r", caducaEn: AHORA + 3_600_000 }), guardaToken: async () => {}, reservaPeticion: async () => true };

/** Un TrackSolid de mentira: devuelve un punto cada hora dentro de lo pedido, y apunta lo que se le pidió. */
function tracksolid(codigo = 0) {
  const pedidas: Record<string, string>[] = [];
  const fetch: FetchFn = vi.fn(async (_url, init) => {
    const q = Object.fromEntries(new URLSearchParams(init.body));
    pedidas.push(q);
    const a = horaDeJimi(q.begin_time)!, b = horaDeJimi(q.end_time)!;
    const result: Record<string, unknown>[] = [];
    for (let t = a + 1_800_000; t < b; t += 3_600_000) result.push({ lat: 26.2, lng: -98.2, gpsTime: aHoraDeJimi(t), gpsSpeed: 50, posType: 1 });
    return { json: async () => (codigo ? { code: codigo, message: "no" } : { code: 0, message: "success", result, data: { mileage: 1 } }) };
  });
  return { fetch, pedidas };
}
function memoria(inicial: DiaDeCamion[] = []): AlmacenDeHistorial & { dias: DiaDeCamion[] } {
  const dias = [...inicial];
  return { dias, lee: async (imeis, desde, hasta) => dias.filter((d) => imeis.includes(d.imei) && d.fecha >= desde && d.fecha <= hasta), guarda: async (n) => { for (const d of n) { const i = dias.findIndex((x) => x.imei === d.imei && x.fecha === d.fecha); if (i >= 0) dias[i] = d; else dias.push(d); } } };
}
const deps = (ts: ReturnType<typeof tracksolid>, historial: AlmacenDeHistorial | null) => ({ config: CONFIG, almacen: tokenFijo, fetch: ts.fetch, ahora: () => AHORA, historial });
const fechas = (desde: string, n: number) => Array.from({ length: n }, (_, i) => new Date(Date.parse(`${desde}T00:00:00Z`) + i * 86_400_000).toISOString().slice(0, 10));

describe("lo que TrackSolid devuelve", () => {
  it("la hora viene en UTC; un punto que no es de GPS, o sin coordenadas, no vale", () => {
    expect(horaDeJimi("2026-11-05 14:37:01")).toBe(Date.parse("2026-11-05T14:37:01Z"));
    expect(horaDeJimi("ayer")).toBeNull();
    expect(puntoDesdeJimi({ lat: 26.204482, lng: -98.168594, gpsTime: "2026-11-05 14:37:01", gpsSpeed: 4, posType: 1 })).toEqual({ t: Date.parse("2026-11-05T14:37:01Z"), lat: 26.204482, lng: -98.168594, mph: 2.5 });
    expect(puntoDesdeJimi({ lat: 26.2, lng: -98.1, gpsTime: "2026-11-05 14:37:01", posType: 2 })).toBeNull();   // antena
    expect(puntoDesdeJimi({ lat: 0, lng: 0, gpsTime: "2026-11-05 14:37:01", posType: 1 })).toBeNull();
    expect(puntoDesdeJimi({ lat: 26.2, lng: -98.1, gpsTime: null })).toBeNull();
  });
  it("lo guardado se lee igual que se guardó (y lo que no tenga forma se ignora)", () => {
    const ps = [{ t: 1_762_353_421_000, lat: 26.204482, lng: -98.168594, mph: 2.5 }, { t: 1_762_353_431_000, lat: 26.2045, lng: -98.1686, mph: null }];
    expect(deLoGuardado(aGuardar(ps))).toEqual(ps);
    expect(deLoGuardado([[1, 2], "x", null, [1, "a", 3]])).toEqual([]);
    expect(deLoGuardado(null)).toEqual([]);
  });
  it("el día LOCAL: en noviembre empieza a las 06:00 UTC", () => {
    expect(limitesDelDia("2026-11-05", ZONA)).toEqual([Date.parse("2026-11-05T06:00:00Z"), Date.parse("2026-11-06T06:00:00Z")]);
    // El día del cambio de hora dura 25 horas.
    const [a, b] = limitesDelDia("2026-11-01", ZONA)!;
    expect((b - a) / 3_600_000).toBe(25);
  });
});

describe("cuánto se le pide", () => {
  it("como mucho 7 días por llamada: las fechas se juntan en ventanas", () => {
    expect(ventanasDe(fechas("2026-10-30", 7))).toEqual([{ desde: "2026-10-30", hasta: "2026-11-05", fechas: fechas("2026-10-30", 7) }]);
    expect(ventanasDe(fechas("2026-10-30", 8)).map((v) => v.fechas.length)).toEqual([7, 1]);
    expect(ventanasDe(["2026-10-01", "2026-10-20", "2026-10-21"]).map((v) => [v.desde, v.hasta])).toEqual([["2026-10-01", "2026-10-01"], ["2026-10-20", "2026-10-21"]]);
  });

  it("una llamada: un rastreador, las horas en UTC, y el final nunca en el futuro. Solo lee", async () => {
    const ts = tracksolid();
    const ps = await pideHistorial(deps(ts, null), IMEI, Date.parse("2026-11-06T06:00:00Z"), Date.parse("2026-11-07T06:00:00Z"));
    expect(ts.pedidas).toHaveLength(1);
    expect(ts.pedidas[0]).toMatchObject({ method: "jimi.device.track.list", imei: IMEI, access_token: "tok", begin_time: "2026-11-06 06:00:00", end_time: "2026-11-06 17:59:00" });
    expect(ps!.length).toBe(12);
    expect(ps!.every((p) => p.t < AHORA)).toBe(true);
  });

  it("una semana de un camión es UNA llamada, partida por día local; lo terminado se guarda como completo", async () => {
    const ts = tracksolid(), m = memoria();
    const pedidos = fechas("2026-10-31", 7).map((fecha) => ({ imei: IMEI, fecha }));   // del 31 al 6 (hoy)
    const r = await historialDeCamiones(deps(ts, m), pedidos, { zona: ZONA });
    expect(ts.pedidas).toHaveLength(1);
    expect(r).toMatchObject({ llamadas: 1, pendientes: 0, conCache: true });
    expect(r.dias.get(`${IMEI}|2026-11-05`)).toHaveLength(24);
    expect(r.dias.get(`${IMEI}|2026-11-01`)).toHaveLength(25);                          // el día de 25 horas
    expect(m.dias).toHaveLength(7);
    expect(m.dias.find((d) => d.fecha === "2026-11-05")!.completo).toBe(true);
    expect(m.dias.find((d) => d.fecha === "2026-11-06")!.completo).toBe(false);          // hoy va por la mitad
  });

  it("lo ya guardado y completo NO se vuelve a pedir; lo de hoy, solo si tiene más de 10 minutos", async () => {
    const punto = [{ t: Date.parse("2026-11-05T15:00:00Z"), lat: 1, lng: 2, mph: null }];
    const m = memoria([
      { imei: IMEI, fecha: "2026-11-05", puntos: punto, completo: true, leidoEn: AHORA - 86_400_000 },
      { imei: IMEI, fecha: "2026-11-06", puntos: punto, completo: false, leidoEn: AHORA - 5 * 60_000 },
    ]);
    const ts = tracksolid();
    const r = await historialDeCamiones(deps(ts, m), [{ imei: IMEI, fecha: "2026-11-05" }, { imei: IMEI, fecha: "2026-11-06" }], { zona: ZONA });
    expect(ts.pedidas).toHaveLength(0);
    expect(r.dias.get(`${IMEI}|2026-11-05`)).toEqual(punto);
    m.dias[1].leidoEn = AHORA - 11 * 60_000;
    await historialDeCamiones(deps(ts, m), [{ imei: IMEI, fecha: "2026-11-05" }, { imei: IMEI, fecha: "2026-11-06" }], { zona: ZONA });
    expect(ts.pedidas).toHaveLength(1);
    expect(ts.pedidas[0].begin_time).toBe("2026-11-06 06:00:00");
  });

  it("hay un tope de llamadas por petición: lo que no cabe queda pendiente, no inventado", async () => {
    const ts = tracksolid();
    const pedidos = fechas("2026-10-07", 30).map((fecha) => ({ imei: IMEI, fecha }));
    const r = await historialDeCamiones(deps(ts, memoria()), pedidos, { zona: ZONA, maxLlamadas: 2 });
    expect(ts.pedidas).toHaveLength(2);
    expect(r.dias.size).toBe(14);
    expect(r.pendientes).toBe(16);
  });

  it("lo de hace más de 3 meses ya no está en TrackSolid: no se pide; lo que aún no ha empezado, tampoco", async () => {
    const ts = tracksolid();
    const r = await historialDeCamiones(deps(ts, memoria()), [{ imei: IMEI, fecha: "2026-06-01" }, { imei: IMEI, fecha: "2026-11-09" }], { zona: ZONA });
    expect(ts.pedidas).toHaveLength(0);
    expect(r.pendientes).toBe(1);
    expect(r.dias.size).toBe(0);
  });

  it("si TrackSolid falla no lanza: esos días quedan pendientes y no se guarda nada", async () => {
    const ts = tracksolid(1100), m = memoria();
    const r = await historialDeCamiones(deps(ts, m), [{ imei: IMEI, fecha: "2026-11-05" }], { zona: ZONA });
    expect(r).toMatchObject({ pendientes: 1, llamadas: 1 });
    expect(r.dias.size).toBe(0);
    expect(m.dias).toHaveLength(0);
  });

  it("sin la tabla 264 (la lectura da null) funciona igual, sin guardar", async () => {
    const ts = tracksolid();
    const guarda = vi.fn(async () => {});
    const r = await historialDeCamiones(deps(ts, { lee: async () => null, guarda }), [{ imei: IMEI, fecha: "2026-11-05" }], { zona: ZONA });
    expect(r.dias.get(`${IMEI}|2026-11-05`)).toHaveLength(24);
    expect(r.conCache).toBe(false);
    expect(guarda).not.toHaveBeenCalled();
  });

  it("nada de lo que se manda lleva el secreto, y nunca se usa un método que escriba en la cuenta", async () => {
    const ts = tracksolid();
    await historialDeCamiones(deps(ts, memoria()), [{ imei: IMEI, fecha: "2026-11-05" }], { zona: ZONA });
    for (const q of ts.pedidas) {
      expect(JSON.stringify(q)).not.toContain("secreto-que-no-sale");
      expect(q.method).toBe("jimi.device.track.list");
    }
  });
});

describe("lo que pide el mapa en vivo (D-NEXT)", () => {
  const HOY = "2026-11-06";
  const viejo = (minutos: number): DiaDeCamion => ({ imei: IMEI, fecha: HOY, puntos: [{ t: AHORA - 3_600_000, lat: 26.2, lng: -98.2, mph: 10 }], completo: false, leidoEn: AHORA - minutos * 60_000 });

  it("`refrescoDeHoyMs`: con 3 minutos, lo guardado hace 5 se vuelve a pedir; lo de hace 2, no", async () => {
    const ts = tracksolid();
    await historialDeCamiones(deps(ts, memoria([viejo(2)])), [{ imei: IMEI, fecha: HOY }], { zona: ZONA, refrescoDeHoyMs: 180_000 });
    expect(ts.pedidas).toHaveLength(0);
    await historialDeCamiones(deps(ts, memoria([viejo(5)])), [{ imei: IMEI, fecha: HOY }], { zona: ZONA, refrescoDeHoyMs: 180_000 });
    expect(ts.pedidas).toHaveLength(1);
    // Sin la opción siguen siendo 10 minutos: los Reportes no cambian.
    await historialDeCamiones(deps(ts, memoria([viejo(5)])), [{ imei: IMEI, fecha: HOY }], { zona: ZONA });
    expect(ts.pedidas).toHaveLength(1);
  });

  it("`aceptaViejo`: si TrackSolid falla, vale lo guardado aunque esté viejo (y sigue contando como pendiente)", async () => {
    const ts = tracksolid(1006);
    const con = await historialDeCamiones(deps(ts, memoria([viejo(40)])), [{ imei: IMEI, fecha: HOY }], { zona: ZONA, aceptaViejo: true });
    expect(con.pendientes).toBe(1);
    expect(con.dias.get(`${IMEI}|${HOY}`)).toHaveLength(1);
    // Sin la opción, como antes: ese día no sale y quien llama usa el teléfono.
    const sin = await historialDeCamiones(deps(ts, memoria([viejo(40)])), [{ imei: IMEI, fecha: HOY }], { zona: ZONA });
    expect(sin.pendientes).toBe(1);
    expect(sin.dias.has(`${IMEI}|${HOY}`)).toBe(false);
  });
});
