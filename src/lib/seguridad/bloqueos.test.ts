import { describe, it, expect, vi } from "vitest";
import { creaCacheDeBloqueos, cargaBloqueosActivos, type BloqueoActivo } from "./bloqueos";

const ahoraRef = { ms: Date.parse("2026-11-17T18:00:00Z") };
const ahora = () => ahoraRef.ms;
const en = (min: number) => new Date(ahoraRef.ms + min * 60_000).toISOString();

describe("cache de bloqueos por IP", () => {
  it("bloquea una IP con bloqueo vigente y no otra", async () => {
    const carga = vi.fn(async (): Promise<BloqueoActivo[]> => [{ alcance: "ip", valor: "1.1.1.1", hasta: en(30) }]);
    const c = creaCacheDeBloqueos(carga, { ahora });
    expect(await c.ipBloqueada("1.1.1.1")).toBe(true);
    expect(await c.ipBloqueada("2.2.2.2")).toBe(false);
  });

  it("no vuelve a consultar dentro de 60 s, y sí después", async () => {
    const carga = vi.fn(async (): Promise<BloqueoActivo[]> => []);
    const c = creaCacheDeBloqueos(carga, { ahora });
    await c.ipBloqueada("1.1.1.1");
    await c.ipBloqueada("1.1.1.1");
    expect(carga).toHaveBeenCalledTimes(1);
    ahoraRef.ms += 61_000;
    await c.ipBloqueada("1.1.1.1");
    expect(carga).toHaveBeenCalledTimes(2);
    ahoraRef.ms -= 61_000;
  });

  it("un bloqueo vencido deja de contar aunque siga en la lista cacheada", async () => {
    const carga = vi.fn(async (): Promise<BloqueoActivo[]> => [{ alcance: "ip", valor: "3.3.3.3", hasta: en(-1) }]);
    const c = creaCacheDeBloqueos(carga, { ahora });
    expect(await c.ipBloqueada("3.3.3.3")).toBe(false);
  });

  it("si la carga falla, no bloquea nada que no conozca (fail-open) y no lanza", async () => {
    const carga = vi.fn(async (): Promise<BloqueoActivo[]> => { throw new Error("sin red"); });
    const c = creaCacheDeBloqueos(carga, { ahora });
    await expect(c.ipBloqueada("4.4.4.4")).resolves.toBe(false);
  });

  it("si la carga falla después de una buena, conserva lo conocido (sin lanzar)", async () => {
    let fallar = false;
    const carga = vi.fn(async (): Promise<BloqueoActivo[]> => {
      if (fallar) throw new Error("caido");
      return [{ alcance: "ip", valor: "5.5.5.5", hasta: en(30) }];
    });
    const c = creaCacheDeBloqueos(carga, { ahora });
    expect(await c.ipBloqueada("5.5.5.5")).toBe(true);
    fallar = true;
    ahoraRef.ms += 61_000;
    expect(await c.ipBloqueada("5.5.5.5")).toBe(true);
    ahoraRef.ms -= 61_000;
  });

  it("sin IP no bloquea", async () => {
    const c = creaCacheDeBloqueos(async () => [], { ahora });
    expect(await c.ipBloqueada(null)).toBe(false);
  });
});

describe("cargaBloqueosActivos", () => {
  it("sin variables de entorno lanza (y el cache lo convierte en fail-open)", async () => {
    const prev = process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    await expect(cargaBloqueosActivos(vi.fn() as unknown as typeof fetch)).rejects.toThrow();
    if (prev !== undefined) process.env.NEXT_PUBLIC_SUPABASE_URL = prev;
  });
});
