import { describe, it, expect, beforeEach } from "vitest";
import { anotaRechazo, claveDeRechazo, vaciaRechazosParaPruebas, bucketsEnMemoria } from "./rechazos";
import type { EventoSec } from "./registro";

beforeEach(() => vaciaRechazosParaPruebas());

describe("desalojo de buckets: al pasar el tope se ESCRIBEN los rechazos pendientes antes de soltarlos", () => {
  it("el bucket más viejo sale con sus rechazos pendientes (no se pierden)", () => {
    const escritos: EventoSec[] = [];
    const w = (e: EventoSec) => { escritos.push(e); };
    const t0 = Date.parse("2030-01-01T00:00:00Z");
    // El primero: una escritura (hits 1) y dos rechazos pendientes.
    anotaRechazo("viejo", { ip: "viejo-ip", estado: 429 }, t0, w);
    anotaRechazo("viejo", { ip: "viejo-ip", estado: 429 }, t0, w);
    anotaRechazo("viejo", { ip: "viejo-ip", estado: 429 }, t0, w);
    // 2.000 buckets más: el 2.001 obliga a desalojar al más viejo.
    for (let i = 0; i < 2000; i++) anotaRechazo(`b${i}`, { ip: `ip-${i}`, estado: 429 }, t0 + 1 + i, w);
    expect(bucketsEnMemoria()).toBeLessThanOrEqual(2000);
    const flush = escritos.find((e) => e.ip === "viejo-ip" && e.meta?.hits === 2);
    expect(flush).toBeDefined();
  });

  it("un bucket desalojado sin pendientes no escribe nada extra", () => {
    const escritos: EventoSec[] = [];
    const w = (e: EventoSec) => { escritos.push(e); };
    const t0 = Date.parse("2030-02-01T00:00:00Z");
    anotaRechazo("limpio", { ip: "limpio-ip", estado: 429 }, t0, w); // escribe hits 1, sin pendientes
    const antes = escritos.length;
    for (let i = 0; i < 2000; i++) anotaRechazo(`c${i}`, { ip: `x-${i}`, estado: 429 }, t0 + 1 + i, w);
    expect(escritos.filter((e) => e.ip === "limpio-ip")).toHaveLength(1);
    expect(escritos.length).toBeGreaterThan(antes);
  });
});

describe("clave de acumulación: bucket e IP juntos", () => {
  it("el mismo bucket desde dos IPs no comparte rechazos", () => {
    expect(claveDeRechazo("usuario:u1", "1.1.1.1")).not.toBe(claveDeRechazo("usuario:u1", "2.2.2.2"));
  });
  it("con anotaRechazo, dos IPs con el mismo bucket escriben cada una su fila (con su IP)", () => {
    const escritos: EventoSec[] = [];
    const w = (e: EventoSec) => { escritos.push(e); };
    const t0 = Date.parse("2030-03-01T00:00:00Z");
    anotaRechazo(claveDeRechazo("usuario:u1", "1.1.1.1"), { ip: "1.1.1.1" }, t0, w);
    anotaRechazo(claveDeRechazo("usuario:u1", "2.2.2.2"), { ip: "2.2.2.2" }, t0, w);
    expect(escritos.map((e) => e.ip).sort()).toEqual(["1.1.1.1", "2.2.2.2"]);
  });
});
