import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import {
  AVISO_SISTEMA_CADA_MS, conTope, ESTADO_VIVO_MAX_MS, estadoVivoAplica, estadoVivoKey, parcheDeAlcance, parseEstadoVivo,
  RACHA_LIMPIA, RECARGA_TRAS_MS, registrarExito, registrarFallo, SANAR_CADA_MS, SANAR_TRAS_FALLOS, SANAR_TRAS_MS,
  segundosHastaSanar, tocaAvisarSistema, tocaRecargar, tocaSanar, type EstadoVivo, type Racha,
} from "./recuperacion";
import { DICT } from "./i18n";

// El incidente del 2026-11-07 (Chicago = UTC−6), medido en la base y en los registros de Supabase.
const ms = (iso: string) => new Date(iso).getTime();
const ARRANQUE = ms("2026-11-07T15:36:09Z");        // 09:36:09 — Start (app de escritorio 0.0.45)
const ULTIMO_LATIDO = ms("2026-11-07T17:22:59Z");   // 11:22:59 — último latido que entró
const VUELVE_LA_RED = ms("2026-11-07T17:40:32Z");   // 11:40:32 — tres refrescos de token, los tres 200
const PANTALLA = ms("2026-11-07T18:29:00Z");        // 12:29 — «67 min del reloj de arriba no están en la base»

/** El código sin comentarios: nombrar algo en un comentario no es usarlo. */
const codigoDe = (ruta: string) =>
  readFileSync(ruta, "utf8").split(/\r?\n/).filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");
const CRONOMETRO = "src/components/timetracker/Cronometro.tsx";
const PROVEEDOR = "src/lib/timetracker-data-provider.tsx";

describe("1 · la racha de latidos fallidos dispara la recuperación", () => {
  it("tres latidos seguidos sin entrar (~30 s) → sanar; dos no bastan", () => {
    let r: Racha = RACHA_LIMPIA;
    const t0 = VUELVE_LA_RED;
    r = registrarFallo(r, t0);
    expect(tocaSanar(r, t0)).toBe(false);
    r = registrarFallo(r, t0 + 10_000);
    expect(tocaSanar(r, t0 + 10_000)).toBe(false);
    r = registrarFallo(r, t0 + 20_000);
    expect(r.fallos).toBe(SANAR_TRAS_FALLOS);
    expect(tocaSanar(r, t0 + 20_000)).toBe(true);
    expect(r.etapa).toBe("reconectando");
  });

  it("o un fallo que dura más de dos minutos, aunque sea un solo latido registrado", () => {
    const r = registrarFallo(RACHA_LIMPIA, VUELVE_LA_RED);
    expect(tocaSanar(r, VUELVE_LA_RED + SANAR_TRAS_MS)).toBe(false);
    expect(tocaSanar(r, VUELVE_LA_RED + SANAR_TRAS_MS + 1)).toBe(true);
  });

  it("entre intentos de sanar pasan diez segundos, y el banner dice cuántos faltan", () => {
    let r = registrarFallo(registrarFallo(registrarFallo(RACHA_LIMPIA, 0), 10_000), 20_000);
    r = { ...r, ultimoSanarMs: 20_000 };
    expect(tocaSanar(r, 23_000)).toBe(false);
    expect(segundosHastaSanar(r, 23_000)).toBe(7);
    expect(tocaSanar(r, 20_000 + SANAR_CADA_MS)).toBe(true);
    expect(segundosHastaSanar(r, 20_000 + SANAR_CADA_MS)).toBe(0);
  });

  it("un latido que entra borra la racha entera", () => {
    const r = registrarFallo(registrarFallo(RACHA_LIMPIA, 0), 10_000);
    expect(registrarExito()).toEqual(RACHA_LIMPIA);
    expect(tocaSanar(registrarExito(), 20_000)).toBe(false);
    expect(r.fallos).toBe(2); // la racha vieja no se muta
  });

  it("la secuencia del incidente: red caída, JWT caducado, y la tercera vez entra con los números de memoria", async () => {
    // updateLiveSession simulado: «Failed to fetch», luego 401 con el JWT caducado, luego entra.
    const respuestas = [
      () => Promise.reject(new TypeError("Failed to fetch")),
      () => Promise.reject({ message: "JWT expired", code: "PGRST301" }),
      () => Promise.resolve(true),
    ];
    const updateLiveSession = vi.fn(() => respuestas.shift()!());
    let r: Racha = RACHA_LIMPIA;
    const escrito: unknown[] = [];
    const latido = async (ahora: number) => {
      try { await updateLiveSession(); return true; } catch { return "queued" as const; }
    };
    // Dos latidos fallan: la racha crece y todavía no sana.
    expect(await latido(VUELVE_LA_RED)).toBe("queued");
    r = registrarFallo(r, VUELVE_LA_RED);
    expect(await latido(VUELVE_LA_RED + 10_000)).toBe("queued");
    r = registrarFallo(r, VUELVE_LA_RED + 10_000);
    expect(tocaSanar(r, VUELVE_LA_RED + 10_000)).toBe(false);
    // El tercero entra, y lo que escribe es el alcance con los contadores acumulados en memoria.
    const memoria = { startMs: ARRANQUE, activeSeconds: 2308 + 1500, idleSeconds: 0, keystrokes: 9000, clicks: 700, lunchSeconds: 0, breakSeconds: 0, breakEvents: [] };
    const ahora = VUELVE_LA_RED + 20_000;
    const parche = parcheDeAlcance(memoria, ahora);
    escrito.push(parche);
    expect(await latido(ahora)).toBe(true);
    r = registrarExito();
    expect(r.fallos).toBe(0);
    expect(updateLiveSession).toHaveBeenCalledTimes(3);
    expect((escrito[0] as { endMs: number }).endMs).toBe(ahora);
    expect((escrito[0] as { durationSeconds: number }).durationSeconds).toBe(Math.floor((ahora - ARRANQUE) / 1000));
  });
});

describe("2 · la recarga suave: solo con red, con el sitio contestando y tras cinco minutos", () => {
  const racha = (desde: number) => ({ ...registrarFallo(RACHA_LIMPIA, desde), fallos: 30 });
  it("sin red no se recarga: sería perder el reloj por nada", () => {
    expect(tocaRecargar(racha(0), RECARGA_TRAS_MS, { online: false, sitioResponde: true })).toBe(false);
    expect(tocaRecargar(racha(0), RECARGA_TRAS_MS, { online: true, sitioResponde: false })).toBe(false);
  });
  it("con red y el sitio contestando, pero sin poder escribir cinco minutos: lo roto es la página", () => {
    expect(tocaRecargar(racha(0), RECARGA_TRAS_MS - 1, { online: true, sitioResponde: true })).toBe(false);
    expect(tocaRecargar(racha(0), RECARGA_TRAS_MS, { online: true, sitioResponde: true })).toBe(true);
  });
  it("sin racha no hay nada que recargar", () => {
    expect(tocaRecargar(RACHA_LIMPIA, RECARGA_TRAS_MS * 2, { online: true, sitioResponde: true })).toBe(false);
  });
});

describe("3 · el estado vivo sobrevive a la recarga y la página continúa la MISMA sesión", () => {
  const estado = (at: number, extra: Partial<EstadoVivo> = {}): string => JSON.stringify({
    sessionId: "a550e937", startMs: ARRANQUE, activeSeconds: 3808, idleSeconds: 0, keystrokes: 9000, clicks: 700,
    lunchSeconds: 0, breakSeconds: 0, breakEvents: [], guardadoHastaMs: ULTIMO_LATIDO, guardadoNeto: 6410, arrastre: 0,
    source: "desktop", at, ...extra,
  });

  it("escrito hace segundos: vale, y es de esa fila", () => {
    const e = parseEstadoVivo(estado(PANTALLA - 3_000), PANTALLA);
    expect(e).not.toBeNull();
    expect(estadoVivoAplica(e, "a550e937")).toBe(true);
    expect(estadoVivoAplica(e, "otra")).toBe(false);
    expect(estadoVivoAplica(null, "a550e937")).toBe(false);
  });

  it("más viejo que dos minutos NO vale: ahí nadie midió, y el hueco no se paga (D-098, D-246)", () => {
    expect(parseEstadoVivo(estado(PANTALLA - ESTADO_VIVO_MAX_MS - 1), PANTALLA)).toBeNull();
    expect(parseEstadoVivo(estado(PANTALLA - ESTADO_VIVO_MAX_MS), PANTALLA)).not.toBeNull();
    // Y tampoco uno del futuro (reloj de pared cambiado), ni basura.
    expect(parseEstadoVivo(estado(PANTALLA + 120_000), PANTALLA)).toBeNull();
    expect(parseEstadoVivo("{nope", PANTALLA)).toBeNull();
    expect(parseEstadoVivo(JSON.stringify({ at: PANTALLA }), PANTALLA)).toBeNull();
    expect(parseEstadoVivo(null, PANTALLA)).toBeNull();
  });

  it("la clave va por persona", () => {
    expect(estadoVivoKey("u1")).not.toBe(estadoVivoKey("u2"));
  });

  it("el latido de alcance lleva EXACTAMENTE lo medido: reloj de pared menos pausas, nunca más", () => {
    const e = parseEstadoVivo(estado(PANTALLA - 3_000, { lunchSeconds: 600, idleSeconds: 120 }), PANTALLA)!;
    const p = parcheDeAlcance(e, PANTALLA);
    const pared = Math.floor((PANTALLA - ARRANQUE) / 1000);
    expect(p.endMs).toBe(PANTALLA);
    expect(p.durationSeconds).toBe(pared - 600 - 120);
    expect(p.durationSeconds).toBeLessThan(pared);
    expect(p.activeSeconds).toBe(3808);
    expect(p.keystrokes).toBe(9000);
    expect(p.clicks).toBe(700);
    expect(p.lunchSeconds).toBe(600);
    expect(p.liveNote).toBe("active");
    // Los 67 minutos de la pantalla: la fila estaba en 11:22 y pasa a 12:29 con esos números.
    expect(Math.round((p.endMs - ULTIMO_LATIDO) / 60_000)).toBe(66);
  });

  it("la actividad nunca supera la duración, y un arranque en el futuro da cero, no negativo", () => {
    const p = parcheDeAlcance({ startMs: PANTALLA + 5_000, activeSeconds: 99, idleSeconds: 0, keystrokes: 0, clicks: 0, lunchSeconds: 0, breakSeconds: 0, breakEvents: [] }, PANTALLA);
    expect(p.durationSeconds).toBe(0);
    expect(p.activeSeconds).toBe(0);
  });
});

describe("4 · la notificación de Windows no se repite más de una vez cada diez minutos", () => {
  it("la primera sí; luego no hasta pasados diez minutos", () => {
    expect(tocaAvisarSistema(null, 0)).toBe(true);
    expect(tocaAvisarSistema(0, 5 * 60_000)).toBe(false);
    expect(tocaAvisarSistema(0, AVISO_SISTEMA_CADA_MS - 1)).toBe(false);
    expect(tocaAvisarSistema(0, AVISO_SISTEMA_CADA_MS)).toBe(true);
    expect(AVISO_SISTEMA_CADA_MS).toBe(10 * 60_000);
  });
});

describe("5 · un latido colgado cuenta como fallo", () => {
  it("conTope rechaza pasado el tope y deja pasar lo que contesta a tiempo", async () => {
    vi.useFakeTimers();
    const colgado = conTope(new Promise<boolean>(() => {}), 1_000);
    const rechazo = colgado.catch((e: Error) => e.message);
    vi.advanceTimersByTime(1_000);
    expect(await rechazo).toBe("timeout");
    expect(await conTope(Promise.resolve(true), 1_000)).toBe(true);
    vi.useRealTimers();
  });
});

describe("6 · el código del cronómetro y del proveedor hacen lo que dice esto", () => {
  it("el cierre de la fila anterior se reintenta antes de insertar, y un 092 cierra la viva propia", () => {
    const c = codigoDe(CRONOMETRO);
    // Ya no es «fire-and-forget».
    expect(c).not.toContain("updateSession(anterior, { isLive: false }).catch(() => {})");
    expect(c).toContain("anteriorPorCerrarRef.current = filaAnteriorIdRef.current;");
    expect(c).toContain("await updateSession(anteriorPorCerrarRef.current, { isLive: false }); anteriorPorCerrarRef.current = null;");
    expect(c).toContain("if (isAlreadyRunning(e)) {");
  });

  it("updateSession reintenta con token fresco, como la vía viva", () => {
    const p = codigoDe(PROVEEDOR);
    const bloque = p.slice(p.indexOf('const updateSession = useCallback<DataState["updateSession"]>'), p.indexOf("const refrescarSesion"));
    expect(bloque).toContain("if (error && isRlsError(error)) {");
    expect(bloque).toContain("await forceRefresh();");
    expect(p).toContain("setSupabase(createClient());");
  });

  it("el estado vivo se guarda en cada latido y se mira ANTES de dar la fila por huérfana", () => {
    const c = codigoDe(CRONOMETRO);
    expect(c.indexOf("guardarEstadoVivo(id);")).toBeLessThan(c.indexOf("void writeSession(id, {"));
    const adopcion = c.indexOf("if (estadoVivoAplica(estadoVivoGuardado, mine.id)");
    expect(adopcion).toBeGreaterThan(0);
    expect(adopcion).toBeLessThan(c.indexOf("if (esHuerfana(mine, Date.now())) {"));
    // Y Stop lo borra: una sesión parada no se continúa.
    expect(c).toContain("localStorage.removeItem(LS_ESTADO_VIVO)");
  });

  it("el latido va con tope, la racha sana y la notificación del sistema va aparte del sonido", () => {
    const c = codigoDe(CRONOMETRO);
    expect(c).toContain("conTope(updateLiveSession(id, patch), LATIDO_TIMEOUT_MS)");
    expect(c).toContain("if (tocaSanar(rachaRef.current, Date.now())) void sanarRef.current();");
    expect(c).toContain("if (tocaAvisarSistema(ultimoAvisoSistemaRef.current, ahora)) {");
    expect(c).toContain('fetch("/api/version", { cache: "no-store", keepalive: false })');
    expect(c).toContain("window.location.reload();");
  });

  it("el banner dice qué hace, en los dos idiomas", () => {
    for (const k of ["track.healReconnecting", "track.healCaughtUp", "track.healReloading"]) {
      expect(DICT.en[k as keyof typeof DICT.en]).toBeTruthy();
      expect(DICT.es[k as keyof typeof DICT.es]).toBeTruthy();
    }
    expect(DICT.en["track.healReconnecting"]).toContain("{s}");
    expect(DICT.es["track.healReconnecting"]).toContain("{s}");
  });
});
