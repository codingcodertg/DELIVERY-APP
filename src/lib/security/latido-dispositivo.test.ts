import { describe, expect, it } from "vitest";
import { guardaUltimoLatido, LATIDO_DISPOSITIVO_MS, MIN_ENTRE_RUTAS_MS, tocaAvisar, ultimaMarca, ultimoLatidoGuardado } from "./latido-dispositivo";

describe("latido del dispositivo (Disk IO, D-1004)", () => {
  it("primera vez avisa", () => { expect(tocaAvisar(null, 5, false)).toBe(true); });
  it("cambio de ruta: solo tras 1 min", () => {
    expect(tocaAvisar(0, MIN_ENTRE_RUTAS_MS - 1, true)).toBe(false);
    expect(tocaAvisar(0, MIN_ENTRE_RUTAS_MS, true)).toBe(true);
  });
  it("reloj: cada 5 min", () => {
    expect(tocaAvisar(0, LATIDO_DISPOSITIVO_MS - 1, false)).toBe(false);
    expect(tocaAvisar(0, LATIDO_DISPOSITIVO_MS, false)).toBe(true);
  });
});

describe("una vez por aparato, no por pestaña (D-1004)", () => {
  // Almacén en memoria con la forma de localStorage, para medir sin navegador.
  const memoria = () => {
    const m = new Map<string, string>();
    return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); } };
  };

  it("lo que una pestaña anotó, las demás lo ven y se callan", () => {
    const almacen = memoria();
    guardaUltimoLatido(almacen, 1_000_000);
    expect(ultimoLatidoGuardado(almacen)).toBe(1_000_000);
    // Otra pestaña, 1 min después, con su reloj de 5 min: no avisa.
    expect(tocaAvisar(ultimaMarca(null, ultimoLatidoGuardado(almacen)), 1_000_000 + 60_000, false)).toBe(false);
    // Pasados los 5 min, avisa una de ellas.
    expect(tocaAvisar(ultimaMarca(null, ultimoLatidoGuardado(almacen)), 1_000_000 + LATIDO_DISPOSITIVO_MS, false)).toBe(true);
  });

  it("sin marca guardada, o con un valor basura, cuenta como nunca avisó", () => {
    expect(ultimoLatidoGuardado(memoria())).toBeNull();
    const roto = { getItem: () => "no-es-numero" };
    expect(ultimoLatidoGuardado(roto)).toBeNull();
  });

  it("sin almacenamiento (modo privado, bloqueado) no lanza nada", () => {
    const lanza = { getItem: () => { throw new Error("denied"); }, setItem: () => { throw new Error("denied"); } };
    expect(ultimoLatidoGuardado(lanza)).toBeNull();
    expect(() => guardaUltimoLatido(lanza, 5)).not.toThrow();
    expect(() => guardaUltimoLatido(null, 5)).not.toThrow();
  });

  it("ultimaMarca toma la más reciente, ignorando las vacías", () => {
    expect(ultimaMarca(null, null)).toBeNull();
    expect(ultimaMarca(3, null)).toBe(3);
    expect(ultimaMarca(null, 7)).toBe(7);
    expect(ultimaMarca(3, 7)).toBe(7);
  });
});
