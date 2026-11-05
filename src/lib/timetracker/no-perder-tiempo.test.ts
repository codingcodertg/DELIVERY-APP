import { describe, expect, it } from "vitest";
import {
  inicioDeContinuacion, inicioSinSolape, leerFilasPendientes, nuevoPendiente, planTrasLatido, tocaReintentarPendiente,
  trasFallo, type Pendiente, type ResultadoLatido, type Tramo,
} from "./no-perder-tiempo";
import { huerfanasDe } from "./live-session";

// Horas del incidente en milisegundos (el día da igual: solo importan las diferencias).
const H = (h: number, m = 0, s = 0) => Date.UTC(2026, 10, 5, h, m, s);

/**
 * Una base de juguete con las dos reglas que muerden: `sessions_no_overlap` (082) y el
 * UPDATE vivo que filtra por `is_live` (D-197), más el cron de huérfanas (D-195).
 */
class BaseFalsa {
  filas: { id: string; startMs: number; endMs: number; isLive: boolean }[] = [];
  private n = 0;
  sinRed = false;
  insertar(startMs: number, endMs: number, isLive = true): string {
    if (this.sinRed) throw new Error("Failed to fetch");
    const choca = this.filas.some((f) => f.endMs > f.startMs && endMs > startMs && f.startMs < endMs && f.endMs > startMs);
    if (choca) throw Object.assign(new Error("sessions_no_overlap"), { code: "23P01" });
    const id = `s${++this.n}`;
    this.filas.push({ id, startMs, endMs, isLive });
    return id;
  }
  latido(id: string, endMs: number): ResultadoLatido {
    if (this.sinRed) return "queued";
    const f = this.filas.find((x) => x.id === id && x.isLive);
    if (!f) return "cerrada";
    if (this.filas.some((o) => o !== f && o.endMs > o.startMs && o.startMs < endMs && o.endMs > f.startMs)) return "overlap";
    f.endMs = endMs;
    return true;
  }
  cron(ahora: number) {
    const vivas = this.filas.filter((f) => f.isLive).map((f) => ({ id: f.id, startMs: f.startMs, endMs: f.endMs }));
    for (const { sesion, cierre } of huerfanasDe(vivas, ahora)) {
      const f = this.filas.find((x) => x.id === sesion.id)!;
      f.isLive = false; f.endMs = cierre.endMs;
    }
  }
  /** Segundos guardados dentro de [desde, hasta). */
  cubierto(desde: number, hasta: number): number {
    return this.filas.reduce((n, f) => n + Math.max(0, Math.min(f.endMs, hasta) - Math.max(f.startMs, desde)), 0) / 1000;
  }
}

/**
 * El cronómetro, reducido a lo que decide dónde se guarda: Start, el latido de cada 10 s y el
 * plan tras cada latido. Es la misma secuencia que sigue `Cronometro.tsx`.
 */
function cronometro(base: BaseFalsa, arranque: number) {
  let id: string | null = null;
  let pendiente: Pendiente | null = nuevoPendiente(arranque, arranque);
  let guardadoHasta: number | null = null;
  const intentar = (ahora: number) => {
    if (!pendiente || !tocaReintentarPendiente(pendiente, ahora)) return;
    const desde = inicioSinSolape(pendiente.desdeMs, ahora, base.filas);
    const p: Pendiente = pendiente;
    if (desde === null) { pendiente = trasFallo(p, ahora); return; }
    try { id = base.insertar(desde, ahora); pendiente = null; guardadoHasta = ahora; }
    catch { pendiente = trasFallo(p, ahora); }
  };
  return {
    segundo(ahora: number) {
      intentar(ahora);
      if (id && (ahora - arranque) % 10_000 === 0) {
        const r = base.latido(id, ahora);
        if (r === true) guardadoHasta = ahora;
        if (planTrasLatido(r) === "fila-nueva") {
          const desde = inicioDeContinuacion({ guardadoHastaMs: guardadoHasta, continuo: true, ahoraMs: ahora });
          id = null; pendiente = nuevoPendiente(desde, ahora);
          intentar(ahora);
        }
      }
    },
  };
}

describe("el reloj nunca cuenta en el vacío (incidente 2026-11-04/05)", () => {
  it("reproduce: la fila la cierra el cron con el reloj corriendo, y el tiempo de después se guarda en otra", () => {
    const base = new BaseFalsa();
    const reloj = cronometro(base, H(22, 45));
    // Tres cuartos de hora guardando bien.
    for (let t = H(22, 45); t <= H(23, 30); t += 1000) reloj.segundo(t);
    // La fila deja de aceptar latidos (red caída: los latidos se encolan) y el cron la cierra en
    // su último latido. Es lo que le pasó a 625a70d6: `closed:cron` en 23:46:17.
    base.sinRed = true;
    for (let t = H(23, 30, 1); t <= H(23, 50); t += 1000) reloj.segundo(t);
    base.cron(H(23, 50));
    expect(base.filas[0]).toMatchObject({ isLive: false, endMs: H(23, 30) });
    // Vuelve la red: el siguiente latido dice «cerrada». Antes, aviso y nada más.
    base.sinRed = false;
    for (let t = H(23, 50, 1); t <= H(24, 30); t += 1000) reloj.segundo(t);
    // Todo lo contado está en la base, sin huecos ni solapes.
    expect(base.cubierto(H(22, 45), H(24, 30))).toBe((H(24, 30) - H(22, 45)) / 1000);
    expect(base.filas.filter((f) => f.isLive)).toHaveLength(1);
  });

  it("reproduce: Start sin red al despertar no deja la pantalla a 0:00 sin fila — reintenta y guarda desde el clic", () => {
    const base = new BaseFalsa();
    base.sinRed = true;
    const reloj = cronometro(base, H(8, 43));
    for (let t = H(8, 43); t <= H(8, 50); t += 1000) reloj.segundo(t);
    expect(base.filas).toHaveLength(0);
    base.sinRed = false;
    for (let t = H(8, 50, 1); t <= H(9, 27); t += 1000) reloj.segundo(t);
    expect(base.filas[0].startMs).toBe(H(8, 43));
    expect(base.cubierto(H(8, 43), H(9, 27))).toBe((H(9, 27) - H(8, 43)) / 1000);
  });

  it("un solape no para ni pierde: recorta el arranque hasta después de lo ya fichado", () => {
    const base = new BaseFalsa();
    // Una entrada manual ya fichada que cae en medio, como 88a329ff (18:15 → 18:40:23).
    base.insertar(H(18, 15), H(18, 40, 23), false);
    const reloj = cronometro(base, H(18, 0));
    for (let t = H(18, 0); t <= H(19, 0); t += 1000) reloj.segundo(t);
    // 18:00 → 18:15 en una fila, 18:15 → 18:40:23 la manual, y de ahí a las 19:00 otra.
    expect(base.cubierto(H(18, 0), H(19, 0))).toBe(3600);
    expect(base.filas.some((f) => f.startMs === H(18, 40, 23) && f.isLive)).toBe(true);
  });
});

describe("piezas", () => {
  it("planTrasLatido", () => {
    expect(planTrasLatido(true)).toBe("ok");
    expect(planTrasLatido("cerrada")).toBe("fila-nueva");
    expect(planTrasLatido("overlap")).toBe("fila-nueva");
    expect(planTrasLatido("queued")).toBe("esperar");
    expect(planTrasLatido("auth")).toBe("esperar");
  });

  it("inicioDeContinuacion: el hueco de una máquina dormida no se paga (D-098)", () => {
    expect(inicioDeContinuacion({ guardadoHastaMs: H(23, 46), continuo: true, ahoraMs: H(23, 50) })).toBe(H(23, 46));
    expect(inicioDeContinuacion({ guardadoHastaMs: H(23, 46), continuo: false, ahoraMs: H(8, 43) + 86_400_000 })).toBe(H(8, 43) + 86_400_000);
    expect(inicioDeContinuacion({ guardadoHastaMs: null, continuo: true, ahoraMs: H(9) })).toBe(H(9));
    expect(inicioDeContinuacion({ guardadoHastaMs: H(10), continuo: true, ahoraMs: H(9) })).toBe(H(9));
  });

  it("inicioSinSolape", () => {
    const t: Tramo[] = [{ startMs: H(10), endMs: H(11) }, { startMs: H(11), endMs: H(12) }];
    expect(inicioSinSolape(H(9), H(13), [])).toBe(H(9));
    expect(inicioSinSolape(H(10, 30), H(13), t)).toBe(H(12));
    expect(inicioSinSolape(H(10, 30), H(11, 30), t)).toBeNull();
    // Un tramo de cero segundos no cuenta, como en la restricción.
    expect(inicioSinSolape(H(9), H(13), [{ startMs: H(10), endMs: H(10) }])).toBe(H(9));
    // Lo que cubre el presente no deja hueco: se espera en vez de escribir encima.
    expect(inicioSinSolape(H(12, 30), H(12, 30), [{ startMs: H(12), endMs: H(13) }])).toBeNull();
  });

  it("el tiempo pendiente no se toca entre reintentos y la espera crece", () => {
    let p = nuevoPendiente(H(8, 43), H(8, 43));
    expect(tocaReintentarPendiente(p, H(8, 43))).toBe(true);
    p = trasFallo(p, H(8, 43));
    expect(p.desdeMs).toBe(H(8, 43));
    expect(tocaReintentarPendiente(p, H(8, 43, 1))).toBe(false);
    expect(tocaReintentarPendiente(p, H(8, 43, 2))).toBe(true);
    p = trasFallo(trasFallo(p, H(8, 44)), H(8, 45));
    expect(p.desdeMs).toBe(H(8, 43));
    expect(p.proximoMs - H(8, 45)).toBe(8_000);
  });

  it("leerFilasPendientes tolera basura", () => {
    expect(leerFilasPendientes(null)).toEqual([]);
    expect(leerFilasPendientes("{")).toEqual([]);
    expect(leerFilasPendientes(JSON.stringify([{ startMs: 1, endMs: 0, payload: {} }, { startMs: 1, endMs: 2, durationSeconds: 1, payload: {} }]))).toHaveLength(1);
  });
});
