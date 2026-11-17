import { describe, it, expect } from "vitest";
import { detectaLecturaTruncada, detectaRatelimitPorIp, type EventoLeido } from "./detectores";

const AHORA = Date.parse("2026-11-17T18:00:00Z");
const hace = (min: number) => new Date(AHORA - min * 60_000).toISOString();

function rl(p: Partial<EventoLeido>): EventoLeido {
  return {
    ts: hace(2), categoria: "ratelimit", severidad: 2, usuario_id: null, rol: null, ip: "5.5.5.5", ip_pais: null,
    metodo: null, ruta: null, estado: 429, objetivo_tipo: null, objetivo_id: null, filas: null, meta: null, ...p,
  };
}

describe("lectura truncada: si una lectura llegó a su tope, se avisa", () => {
  it("una lectura en su tope produce una alerta sev 4; una por debajo, ninguna", () => {
    const h = detectaLecturaTruncada([
      { nombre: "eventos", filas: 20000, limite: 20000 },
      { nombre: "cambios-de-privilegio", filas: 12, limite: 5000 },
    ], AHORA);
    expect(h).toHaveLength(1);
    expect(h[0]).toMatchObject({ detector: "lectura-truncada", severidad: 4 });
    expect(h[0].sujeto).toContain("eventos");
  });
  it("una sola alerta por lectura y hora (la clave cambia cada hora, no cada corrida)", () => {
    const lect = [{ nombre: "eventos", filas: 20000, limite: 20000 }];
    const a = detectaLecturaTruncada(lect, AHORA)[0].sujeto;
    const b = detectaLecturaTruncada(lect, AHORA + 60_000)[0].sujeto;
    const c = detectaLecturaTruncada(lect, AHORA + 3_600_000)[0].sujeto;
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });
});

describe("límite de peticiones: cada fila cuenta sus rechazos (meta.hits)", () => {
  it("una fila con meta.hits=60 cuenta 60, así una sola fila por minuto basta para la señal", () => {
    const filas = [rl({ meta: { hits: 60 } })];
    expect(detectaRatelimitPorIp(filas, AHORA)).toEqual([expect.objectContaining({ detector: "ratelimit-ip", proponeBloqueoIp: true })]);
  });
  it("con 20 filas de 2 cada una (40 rechazos) no llega a 50", () => {
    const filas = Array.from({ length: 20 }, () => rl({ meta: { hits: 2 } }));
    expect(detectaRatelimitPorIp(filas, AHORA)).toHaveLength(0);
  });
});
