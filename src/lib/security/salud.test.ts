import { describe, expect, it } from "vitest";
import {
  etiquetaDeConsulta, horasDesde, muestraDeDisco, nivelPorPiso, nivelPorUmbral, porHora, ritmoDeDisco, veredictos,
  DEPLOYS_DIA_ROJO, type EntradaDeVeredictos,
} from "./salud";

const base: EntradaDeVeredictos = {
  ritmoDisco: null, discoConfigurado: false, escriturasHora: null, walMBHora: null, principalEscritor: null,
  deploys24h: null, deploysFallidos24h: null, archivosGBMes: null, capturasGBMes: null, baseGB: null,
  conexiones: null, conexionesMax: null, cache: null, sinRls: null, definerAnon: null, compute: null,
};

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
});
