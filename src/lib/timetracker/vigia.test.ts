import { describe, it, expect, vi } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import {
  ALARMA_CADA_MS, debeMontarCronometro, esRutaDelCronometro, estadoVigia, parcheDeStop, pararPorCorteSiToca,
  REINTENTO_CADA_MS, tocaReintentar, tocaSonar, VIGIA_MAX_MS,
} from "./vigia";
import { LATIDO_MAX_MS } from "./live-session";
import { DICT } from "./i18n";

// El incidente, con sus horas reales (UTC; Chicago = UTC−5). Medidas en la base y en el
// almacenamiento local de la app de escritorio el 2026-10-04.
const ms = (iso: string) => new Date(iso).getTime();
const ARRANQUE = ms("2026-10-04T20:25:22Z");        // 15:25:22 — Start
const SALIO_A_CAPTURAS = ms("2026-10-04T21:29:28Z"); // 16:29:28 — último latido (pagehide)
const VOLVIO = ms("2026-10-04T00:41:51Z") + 24 * 3600_000; // 19:41:51 — volvió a «Registrar tiempo»

/** El código sin las líneas de comentario: un comentario que nombra algo no cuenta como usarlo. */
const codigoDe = (ruta: string) =>
  readFileSync(ruta, "utf8").split(/\r?\n/).filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");
const CRONOMETRO = "src/components/timetracker/Cronometro.tsx";
const ANFITRION = "src/components/timetracker/CronometroAnfitrion.tsx";
const LAYOUT = "src/app/timetracker/(timetracker)/layout.tsx";
const PAGINA = "src/app/timetracker/(timetracker)/page.tsx";

describe("1 · el cronómetro vive en el layout, no en su página", () => {
  it("«Registrar tiempo» es /timetracker y nada más", () => {
    expect(esRutaDelCronometro("/timetracker")).toBe(true);
    expect(esRutaDelCronometro("/timetracker/")).toBe(true);
    expect(esRutaDelCronometro("/timetracker/diary")).toBe(false);
    expect(esRutaDelCronometro("/timetracker/week")).toBe(false);
    expect(esRutaDelCronometro("/home")).toBe(false);
    expect(esRutaDelCronometro(null)).toBe(false);
  });

  it("en Capturas sigue montado (oculto): es justo la pantalla donde murió", () => {
    expect(debeMontarCronometro({ visible: false, presencial: false, esAdmin: false })).toBe(true);
    expect(debeMontarCronometro({ visible: false, presencial: false, esAdmin: true })).toBe(true);
    // El admin presencial también cronometra: su vista por defecto es el reloj.
    expect(debeMontarCronometro({ visible: false, presencial: true, esAdmin: true })).toBe(true);
  });

  it("al presencial que no es admin no se le monta fuera de su pantalla: lo suyo es el fichaje", () => {
    expect(debeMontarCronometro({ visible: false, presencial: true, esAdmin: false })).toBe(false);
    expect(debeMontarCronometro({ visible: true, presencial: true, esAdmin: false })).toBe(true);
  });

  it("el layout monta al anfitrión, y el anfitrión decide con estas dos funciones", () => {
    const layout = codigoDe(LAYOUT);
    expect(layout).toContain("<CronometroAnfitrion />");
    // Dentro del proveedor de datos y antes de la pantalla: el cronómetro usa useData().
    expect(layout.indexOf("<DataProvider")).toBeLessThan(layout.indexOf("<CronometroAnfitrion />"));
    expect(layout.indexOf("<CronometroAnfitrion />")).toBeLessThan(layout.indexOf("</DataProvider>"));
    const anfitrion = codigoDe(ANFITRION);
    expect(anfitrion).toContain("esRutaDelCronometro(pathname)");
    expect(anfitrion).toContain("debeMontarCronometro({");
    expect(anfitrion).toContain("if (!montar) return null;");
    expect(anfitrion).toContain("<Cronometro visible={visible} />");
  });

  it("y la página ya no monta el cronómetro: dos a la vez escribirían sobre la misma fila", () => {
    expect(existsSync(PAGINA)).toBe(true); // la ruta sigue existiendo
    const pagina = codigoDe(PAGINA);
    expect(pagina).not.toContain("Cronometro");
    expect(pagina).not.toContain("setInterval");
    expect(pagina).toContain("return null;");
  });

  it("oculto no pinta la pantalla, pero el aviso de «no se guarda» sí asoma", () => {
    const c = codigoDe(CRONOMETRO);
    expect(c).toContain('const oculto = visible ? undefined : { display: "none" as const };');
    expect(c).toContain("const avisoFuera = !visible && sinGuardarDesde !== null ?");
    expect(c.split("{avisoFuera}").length - 1).toBe(2); // en las dos vistas del admin
  });
});

describe("2 · el vigía: un reloj que corre sin guardarse se dice", () => {
  const base = { corriendo: true, ajeno: false };

  it("el incidente: 16:30:29, un minuto y un segundo sin latido → avisa", () => {
    expect(estadoVigia({ ...base, ultimoGuardadoMs: SALIO_A_CAPTURAS, ahoraMs: SALIO_A_CAPTURAS + 61_000 })).toBe("sin-latido");
    // Y a las 19:41 llevaba 3 h 12 min así, sin que nada lo dijera.
    expect(Math.round((VOLVIO - SALIO_A_CAPTURAS) / 60_000)).toBe(192);
    expect(estadoVigia({ ...base, ultimoGuardadoMs: SALIO_A_CAPTURAS, ahoraMs: VOLVIO })).toBe("sin-latido");
  });

  it("con latidos cada diez segundos no avisa, ni justo en el minuto", () => {
    expect(estadoVigia({ ...base, ultimoGuardadoMs: ARRANQUE, ahoraMs: ARRANQUE + 10_000 })).toBe("ok");
    expect(estadoVigia({ ...base, ultimoGuardadoMs: ARRANQUE, ahoraMs: ARRANQUE + VIGIA_MAX_MS })).toBe("ok");
  });

  it("parado no avisa, y la sesión que conduce el otro cliente tampoco (D-096)", () => {
    expect(estadoVigia({ corriendo: false, ajeno: false, ultimoGuardadoMs: ARRANQUE, ahoraMs: VOLVIO })).toBe("ok");
    expect(estadoVigia({ corriendo: true, ajeno: true, ultimoGuardadoMs: ARRANQUE, ahoraMs: VOLVIO })).toBe("ok");
  });

  it("sin suelo todavía no hay con qué comparar", () => {
    expect(estadoVigia({ ...base, ultimoGuardadoMs: null, ahoraMs: VOLVIO })).toBe("ok");
  });

  it("avisa mucho antes de que la base la dé por huérfana", () => {
    // Si el umbral fuera el del freno (15 min), el aviso llegaría cuando ya no hay nada que salvar.
    expect(VIGIA_MAX_MS).toBeLessThanOrEqual(LATIDO_MAX_MS / 5);
  });

  it("el sonido: al detectarlo y cada cinco minutos, no cada cinco segundos", () => {
    expect(tocaSonar(null, VOLVIO)).toBe(true);
    expect(tocaSonar(VOLVIO, VOLVIO + 5_000)).toBe(false);
    expect(tocaSonar(VOLVIO, VOLVIO + ALARMA_CADA_MS)).toBe(true);
  });

  it("reintenta retomar la sesión solo si nadie la conduce, y cada veinte segundos", () => {
    const a = { ultimoIntentoMs: null, ahoraMs: VOLVIO };
    expect(tocaReintentar({ conduce: false, tickArmado: true, ...a })).toBe(true);  // modo mirón tras un fallo
    expect(tocaReintentar({ conduce: true, tickArmado: false, ...a })).toBe(true);  // el tick murió
    expect(tocaReintentar({ conduce: true, tickArmado: true, ...a })).toBe(false);  // conduce: lo que falla es la escritura
    expect(tocaReintentar({ conduce: false, tickArmado: true, ultimoIntentoMs: VOLVIO, ahoraMs: VOLVIO + 5_000 })).toBe(false);
    expect(tocaReintentar({ conduce: false, tickArmado: true, ultimoIntentoMs: VOLVIO, ahoraMs: VOLVIO + REINTENTO_CADA_MS })).toBe(true);
  });

  it("la pantalla lo usa: vigila en su propio intervalo, suena, avisa y reintenta", () => {
    const c = codigoDe(CRONOMETRO);
    const bloque = c.slice(c.indexOf("const ultimaAlarmaRef"), c.indexOf("const arrancandoRef"));
    expect(bloque).toContain("estadoVigia({");
    expect(bloque).toContain("setInterval(vigilar, VIGIA_CADA_MS)");
    expect(bloque).toContain("setSinGuardarDesde(sinGuardarDesdeRef.current)");
    expect(bloque).toContain("sonarAlarma();");
    expect(bloque).toContain('avisoDeSistema(t("track.notRecordingTitle"), t("track.notRecording"))');
    expect(bloque).toContain("void adoptarRef.current(() => false, true);");
  });

  it("y el suelo se pone donde toca: al arrancar, al adoptar y al montar con miga", () => {
    const c = codigoDe(CRONOMETRO);
    expect(c).toContain("if (liveHint) ultimoGuardadoRef.current = Date.now();");
    // start, adopción, ya-corriendo, reabrir, reanudar: cinco sitios donde pasa a conducir.
    expect(c.split("conduceRef.current = true;").length - 1).toBe(5);
    expect(c.split("ultimoGuardadoRef.current = Date.now();").length - 1).toBeGreaterThanOrEqual(6);
  });

  it("un arranque nuevo baja la marca de Stop: si no, el vigía daría la segunda sesión por parada", () => {
    const c = codigoDe(CRONOMETRO);
    const start = c.slice(c.indexOf("async function start()"), c.indexOf("async function stop()"));
    expect(start).toContain("stoppedRef.current = false;");
    expect(c).toContain("corriendo: runningRef.current && !stoppedRef.current,");
  });

  it("los textos del aviso existen en los dos idiomas", () => {
    for (const k of ["track.notRecording", "track.notRecordingTitle", "track.goToTimer"]) {
      expect(DICT.en[k], k).toBeTruthy();
      expect(DICT.es[k], k).toBeTruthy();
    }
  });
});

describe("3 · Stop sobre una sesión que esta página no condujo solo la cierra", () => {
  // Lo que la pantalla recién montada tenía en memoria a las 19:41:51: la miga y ceros.
  const deLaMiga = {
    endMs: VOLVIO, durationSeconds: Math.floor((VOLVIO - ARRANQUE) / 1000),
    activeSeconds: 0, idleSeconds: 0, keystrokes: 0, clicks: 0, lunchSeconds: 0, breakSeconds: 0, breakEvents: [],
  };

  it("el incidente: esos contadores son exactamente la fila que quedó (15389 s, 0 de actividad)", () => {
    expect(deLaMiga.durationSeconds).toBe(15389);
  });

  it("sin conducir: cierra y no toca ni la duración ni la actividad", () => {
    expect(parcheDeStop(false, deLaMiga)).toEqual({ isLive: false, liveNote: null });
  });

  it("conduciendo: escribe todos sus contadores, como siempre", () => {
    const mios = { ...deLaMiga, activeSeconds: 987, keystrokes: 5000, clicks: 120 };
    expect(parcheDeStop(true, mios)).toEqual({ ...mios, liveNote: null, isLive: false });
  });

  it("la pantalla para con parcheDeStop y con su propio «¿conduzco?»", () => {
    const c = codigoDe(CRONOMETRO);
    const stop = c.slice(c.indexOf("async function stop()"), c.indexOf("stopRef.current = stop;"));
    expect(stop).toContain("const patch = parcheDeStop(conduceRef.current, {");
    expect(stop).not.toMatch(/isLive: false,\s*\n\s*\};/); // el parche a mano de antes
    // El modo mirón deja de conducir: su Stop tampoco escribe contadores.
    const miron = c.slice(c.indexOf("function watchRemote("), c.indexOf("async function reabrirTrasCarga("));
    expect(miron).toContain("conduceRef.current = false;");
  });
});

describe("4 · el paro de las 18:30 pregunta antes de parar", () => {
  const escena = (over: Partial<Parameters<typeof pararPorCorteSiToca>[0]> = {}) => {
    const parar = vi.fn();
    const consultar = vi.fn(async () => null as boolean | null);
    return { parar, consultar, args: { exentoConocido: null, consultar, sigueCorriendo: () => true, parar, ...over } };
  };

  it("el incidente: montada pasado el corte, sin haber preguntado, y es exento → NO para", async () => {
    const e = escena({ consultar: vi.fn(async () => true) });
    expect(await pararPorCorteSiToca(e.args)).toBe(false);
    expect(e.parar).not.toHaveBeenCalled();
    expect(e.args.consultar).toHaveBeenCalledTimes(1);
  });

  it("sin respuesta DESPUÉS de preguntar sigue parando: es el caso del no exento tras el corte", async () => {
    const e = escena();
    expect(await pararPorCorteSiToca(e.args)).toBe(true);
    expect(e.parar).toHaveBeenCalledTimes(1);
  });

  it("un «no» para", async () => {
    const e = escena({ consultar: vi.fn(async () => false) });
    expect(await pararPorCorteSiToca(e.args)).toBe(true);
    expect(e.parar).toHaveBeenCalledTimes(1);
  });

  it("un «no» ya conocido para sin volver a preguntar, y un «sí» conocido ni pregunta", async () => {
    const no = escena({ exentoConocido: false });
    expect(await pararPorCorteSiToca(no.args)).toBe(true);
    expect(no.consultar).not.toHaveBeenCalled();
    const si = escena({ exentoConocido: true });
    expect(await pararPorCorteSiToca(si.args)).toBe(false);
    expect(si.consultar).not.toHaveBeenCalled();
    expect(si.parar).not.toHaveBeenCalled();
  });

  it("si mientras preguntaba se pulsó Stop, no para dos veces", async () => {
    const e = escena({ sigueCorriendo: () => false });
    expect(await pararPorCorteSiToca(e.args)).toBe(false);
    expect(e.parar).not.toHaveBeenCalled();
  });

  it("la pantalla para por aquí, con la consulta compartida, y ya no en seco", () => {
    const c = codigoDe(CRONOMETRO);
    const bloque = c.slice(c.indexOf("const paradoPorCorteRef"), c.indexOf("const ultimaAlarmaRef"));
    expect(bloque).toContain("void pararPorCorteSiToca({");
    expect(bloque).toContain("consultar: consultarExencion,");
    expect(bloque).toContain("exentoConocido: exentoDelCorte,");
    // Lo de antes: el paro directo dentro de `mirar`, sin esperar a nadie.
    expect(bloque).not.toMatch(/if \(!runningRef\.current \|\| stoppedRef\.current\) return;\s*\n\s*paradoPorCorteRef\.current = true;/);
  });
});

describe("5 · en el escritorio la actividad se mide como escritorio también tras adoptar", () => {
  const c = codigoDe(CRONOMETRO);
  const tick = c.slice(c.indexOf("function beginTicking()"), c.indexOf("const ultimoGuardadoRef"));

  it("el tick pregunta isDesktop() en el momento y no lee el estado del primer render", () => {
    expect(tick).toContain("const enEscritorio = isDesktop();");
    expect(tick).toContain("if (enEscritorio) {");
    expect(tick).toContain("if (smartIdle && enEscritorio && !onBreakRef.current && !windowedActive) {");
    expect(tick).not.toContain("isDesktopClient");
  });

  it("y nunca hay dos ticks: armar uno apaga el anterior", () => {
    expect(tick.indexOf("if (tickRef.current) clearInterval(tickRef.current);")).toBeGreaterThan(-1);
    expect(tick.indexOf("if (tickRef.current) clearInterval(tickRef.current);")).toBeLessThan(tick.indexOf("tickRef.current = setInterval("));
  });

  it("al salir del módulo sin recargar también deja grabado el último latido", () => {
    expect(c).toContain("useEffect(() => () => { grabarRef.current(); if (tickRef.current) clearInterval(tickRef.current); }, []);");
  });
});
