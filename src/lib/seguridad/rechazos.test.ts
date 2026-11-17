import { describe, it, expect } from "vitest";
import { anotaRechazo, CADA_MS_RECHAZOS } from "./rechazos";
import type { EventoSec } from "./registro";

const base = { ip: "7.7.7.7", ruta: "/api/x", estado: 429, objetivo_tipo: "clave", objetivo_id: "x" };

describe("anotaRechazo: como mucho una fila por bucket y minuto, con los rechazos acumulados", () => {
  it("de 100 rechazos seguidos del mismo bucket, escribe una sola fila (la primera, con hits=1)", () => {
    const escritos: EventoSec[] = [];
    const t0 = Date.parse("2026-11-17T18:00:00Z");
    for (let i = 0; i < 100; i++) anotaRechazo("clave-a:7.7.7.7", base, t0 + i, (e) => { escritos.push(e); });
    expect(escritos).toHaveLength(1);
    expect(escritos[0]).toMatchObject({ categoria: "ratelimit", meta: { hits: 1 } });
  });

  it("al pasar el minuto, la fila siguiente lleva los rechazos acumulados desde la última escritura", () => {
    const escritos: EventoSec[] = [];
    const t0 = Date.parse("2026-11-17T19:00:00Z");
    const w = (e: EventoSec) => { escritos.push(e); };
    anotaRechazo("clave-b:8.8.8.8", base, t0, w);           // escribe, hits 1
    for (let i = 1; i <= 40; i++) anotaRechazo("clave-b:8.8.8.8", base, t0 + i, w); // acumula 40
    anotaRechazo("clave-b:8.8.8.8", base, t0 + CADA_MS_RECHAZOS, w); // pasó el minuto: escribe con 41
    expect(escritos.map((e) => e.meta?.hits)).toEqual([1, 41]);
  });

  it("los buckets son independientes: un bucket ruidoso no silencia a otro", () => {
    const escritos: EventoSec[] = [];
    const t0 = Date.parse("2026-11-17T20:00:00Z");
    const w = (e: EventoSec) => { escritos.push(e); };
    for (let i = 0; i < 10; i++) anotaRechazo("clave-c:1.1.1.1", base, t0 + i, w);
    anotaRechazo("clave-d:1.1.1.1", base, t0 + 10, w);
    expect(escritos).toHaveLength(2);
  });

  it("la fila lleva la misma forma que antes (ip, ruta, estado) y no la clave del bucket", () => {
    const escritos: EventoSec[] = [];
    anotaRechazo("clave-e:9.9.9.9", base, Date.parse("2026-11-17T21:00:00Z"), (e) => { escritos.push(e); });
    expect(escritos[0]).toMatchObject({ ip: "7.7.7.7", ruta: "/api/x", estado: 429 });
    expect(JSON.stringify(escritos[0].meta)).not.toContain("clave-e");
  });
});
