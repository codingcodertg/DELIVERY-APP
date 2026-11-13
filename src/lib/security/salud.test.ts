import { describe, expect, it } from "vitest";
import {
  etiquetaDeConsulta, horasDesde, muestraDeDisco, nivelPorPiso, nivelPorUmbral, porHora, ritmoDeDisco, veredictos,
  ejecutaParte, MotivoPlano, DEPLOYS_DIA_ROJO, type EntradaDeVeredictos,
} from "./salud";

const base: EntradaDeVeredictos = {
  ritmoDisco: null, discoConfigurado: false, escriturasHora: null, walMBHora: null, principalEscritor: null,
  deploys24h: null, deploysFallidos24h: null, archivosGBMes: null, capturasGBMes: null, baseGB: null,
  conexiones: null, conexionesMax: null, cache: null, sinRls: null, definerAnon: null, compute: null,
};

/** Frases que dicen «va bien». Una tarjeta sin datos no puede llevar ninguna. */
const FRASES_SANAS = /Ritmo sano|Holgado|Sin hallazgos|Bien:|Muy por debajo|Casi todo se lee|Crecimiento normal|El disco va holgado/;

describe("salud del sistema (lógica pura)", () => {
  it("nombra las sentencias que más escriben", () => {
    expect(etiquetaDeConsulta('WITH pgrst_source AS (UPDATE "timetracker"."sessions" SET "active_seconds" = 1')).toBe("Time Tracker · sesiones (cronómetro)");
    expect(etiquetaDeConsulta('UPDATE "refresh_tokens" AS refresh_tokens SET')).toBe("Inicio de sesión · tokens");
    expect(etiquetaDeConsulta("with sub_tables as ( select rr.entity from pg_publication_tables pub")).toBe("Realtime (pantallas en vivo)");
    expect(etiquetaDeConsulta('INSERT INTO "public"."driver_locations"')).toBe("GPS de choferes");
  });

  it("ritmos por hora desde el reinicio", () => {
    const ahora = new Date("2026-11-12T12:00:00Z");
    expect(horasDesde("2026-11-12T10:00:00Z", ahora)).toBe(2);
    expect(porHora(6000, 2)).toBe(3000);
    expect(horasDesde(null, ahora)).toBeNull();
  });

  it("lee el disco del texto Prometheus y saca el ritmo entre dos muestras, ignorando discos virtuales", () => {
    const txt = (io: number, w: number) => [
      `node_disk_io_time_seconds_total{device="nvme0n1"} ${io}`,
      `node_disk_io_time_seconds_total{device="loop0"} 999`,
      `node_disk_read_bytes_total{device="nvme0n1"} 1048576`,
      `node_disk_written_bytes_total{device="nvme0n1"} ${w}`,
    ].join("\n");
    const a = muestraDeDisco(txt(100, 0), 0)!;
    const b = muestraDeDisco(txt(130, 60 * 1048576), 60_000)!;
    expect(a.ioSegundos).toBe(100);
    const r = ritmoDeDisco(a, b)!;
    expect(r.ocupado).toBeCloseTo(0.5);
    expect(r.escritosMBs).toBeCloseTo(1);
    expect(ritmoDeDisco(a, muestraDeDisco(txt(101, 0), 10_000))).toBeNull(); // menos de 30 s
    expect(muestraDeDisco("nada", 0)).toBeNull();
  });

  it("semáforo por umbral y por piso", () => {
    expect(nivelPorUmbral(5, 6, 10)).toBe("verde");
    expect(nivelPorUmbral(6, 6, 10)).toBe("amarillo");
    expect(nivelPorUmbral(10, 6, 10)).toBe("rojo");
    expect(nivelPorUmbral(null, 6, 10)).toBe("gris");
    expect(nivelPorPiso(99.5, 99, 95)).toBe("verde");
    expect(nivelPorPiso(94, 99, 95)).toBe("rojo");
  });

  it("veredictos: muchas publicaciones → rojo con «junta cambios»; sin token, gris con cómo configurarlo", () => {
    const v = veredictos({ ...base, deploys24h: DEPLOYS_DIA_ROJO });
    const d = v.find((x) => x.id === "deploys")!;
    expect(d.nivel).toBe("rojo");
    expect(d.queHacer).toMatch(/junta cambios/);
    const sin = veredictos(base).find((x) => x.id === "deploys")!;
    expect(sin.nivel).toBe("gris");
    expect(sin.valor).toMatch(/VERCEL_TOKEN/);
  });

  it("veredictos: el primer renglón es el Disk IO y nombra al que más escribe", () => {
    const v = veredictos({ ...base, discoConfigurado: true, ritmoDisco: { ocupado: 0.7, leidosMBs: 0.1, escritosMBs: 2, segundos: 60 }, principalEscritor: "Time Tracker · sesiones (cronómetro)" });
    expect(v[0].id).toBe("disco");
    expect(v[0].nivel).toBe("rojo");
    expect(v[0].queHacer).toMatch(/Time Tracker/);
  });

  it("veredictos: capturas que crecen mucho piden definir retención", () => {
    const a = veredictos({ ...base, archivosGBMes: 4, capturasGBMes: 3.5 }).find((x) => x.id === "archivos")!;
    expect(a.nivel).toBe("rojo");
    expect(a.queHacer).toMatch(/cuántos días guardarlas/);
  });

  it("sin datos: TODAS las tarjetas son grises, dicen «No data — …» y ninguna lleva consejo de «va bien»", () => {
    const v = veredictos(base);
    expect(v.length).toBeGreaterThanOrEqual(8);
    for (const x of v) {
      expect(x.nivel, x.id).toBe("gris");
      expect(x.valor, x.id).toMatch(/^No data — /);
      expect(`${x.valor} ${x.queHacer}`, x.id).not.toMatch(FRASES_SANAS);
    }
  });

  it("sin datos por la base: el motivo de cada grupo sale en su tarjeta, y el consejo no cambia a sano", () => {
    const v = veredictos({ ...base, motivoBase: "tardó demasiado. Intenta de nuevo.", motivoEscrituras: "tardó demasiado. Intenta de nuevo.", motivoRevision: "falta aplicar la migración 307" });
    const esc = v.find((x) => x.id === "escrituras")!;
    expect(esc.valor).toBe("No data — tardó demasiado. Intenta de nuevo.");
    expect(v.find((x) => x.id === "seguridad")!.valor).toBe("No data — falta aplicar la migración 307");
    expect(esc.nivel).toBe("gris");
    expect(`${esc.valor} ${esc.queHacer}`).not.toMatch(FRASES_SANAS);
  });

  it("con datos sanos, sí aparece el consejo de «va bien»", () => {
    const v = veredictos({ ...base, escriturasHora: 10, walMBHora: 1, sinRls: 0, definerAnon: 0, baseGB: 0.1, cache: 99.9, conexiones: 2, conexionesMax: 60, archivosGBMes: 0.1 });
    expect(v.find((x) => x.id === "escrituras")!.queHacer).toMatch(/Ritmo sano/);
    expect(v.find((x) => x.id === "seguridad")!.queHacer).toMatch(/Sin hallazgos/);
  });
});

describe("cada lectura por separado (ejecutaParte)", () => {
  it("una lectura que falla no tumba a las demás", async () => {
    const [mala, buena] = await Promise.all([
      ejecutaParte(async () => { throw new Error("boom interno"); }, 1000),
      ejecutaParte(async () => ({ ok: 1 }), 1000),
    ]);
    expect(mala.datos).toBeNull();
    expect(mala.error).toBeTruthy();
    expect(buena).toEqual({ datos: { ok: 1 }, error: null });
  });

  it("el tiempo agotado tiene su propio mensaje y no bloquea", async () => {
    const t = Date.now();
    const r = await ejecutaParte(() => new Promise<never>(() => {}), 300);
    expect(r.datos).toBeNull();
    expect(r.error).toBe("no respondió en 0 s");
    expect(Date.now() - t).toBeLessThan(2000);
  });

  it("el error crudo de la base («canceling statement due to statement timeout») no llega a la pantalla", async () => {
    const r = await ejecutaParte(async () => { throw { message: "canceling statement due to statement timeout", code: "57014" }; }, 1000);
    expect(r.error).toBe("Tardó demasiado. Intenta de nuevo.");
    expect(r.error).not.toMatch(/canceling|statement|timeout/i);
  });

  it("un fallo con motivo ya en español se muestra tal cual", async () => {
    const r = await ejecutaParte(async () => { throw new MotivoPlano("la Metrics API respondió 503"); }, 1000);
    expect(r.error).toBe("la Metrics API respondió 503");
  });
});
