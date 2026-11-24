import { describe, it, expect } from "vitest";
import { claveDeEleccion, guardarEleccion, leerEleccion, seccionAbierta } from "./seccion-plegable";

describe("seccionAbierta: el valor por defecto", () => {
  it("una sección de pendientes se abre si tiene algo pendiente", () => {
    expect(seccionAbierta({ abreConPendientes: true, hayPendientes: true, recordado: null })).toBe(true);
  });

  it("y se cierra si no tiene nada", () => {
    expect(seccionAbierta({ abreConPendientes: true, hayPendientes: false, recordado: null })).toBe(false);
  });

  it("el historial y las excepciones empiezan cerrados aunque tengan filas", () => {
    expect(seccionAbierta({ abreConPendientes: false, hayPendientes: true, recordado: null })).toBe(false);
  });
});

describe("seccionAbierta: la elección recordada gana al valor por defecto", () => {
  it("cerrada a mano, se queda cerrada aunque haya pendientes", () => {
    expect(seccionAbierta({ abreConPendientes: true, hayPendientes: true, recordado: false })).toBe(false);
  });

  it("abierta a mano, se queda abierta aunque no haya nada", () => {
    expect(seccionAbierta({ abreConPendientes: true, hayPendientes: false, recordado: true })).toBe(true);
    expect(seccionAbierta({ abreConPendientes: false, hayPendientes: false, recordado: true })).toBe(true);
  });
});

describe("claveDeEleccion", () => {
  it("una clave por sección", () => {
    expect(claveDeEleccion("historial")).toBe("tt_bandeja_abierta_historial");
    expect(claveDeEleccion("ausencias")).not.toBe(claveDeEleccion("excepciones"));
  });
});

function almacenFalso(inicial: Record<string, string> = {}) {
  const datos = new Map(Object.entries(inicial));
  return {
    datos,
    getItem: (k: string) => datos.get(k) ?? null,
    setItem: (k: string, v: string) => { datos.set(k, v); },
  };
}

describe("leerEleccion y guardarEleccion", () => {
  it("guarda 1 o 0 y lo lee de vuelta", () => {
    const a = almacenFalso();
    guardarEleccion(a, "k", true);
    expect(a.datos.get("k")).toBe("1");
    expect(leerEleccion(a, "k")).toBe(true);
    guardarEleccion(a, "k", false);
    expect(leerEleccion(a, "k")).toBe(false);
  });

  it("sin nada guardado, o con un valor raro, no hay elección", () => {
    expect(leerEleccion(almacenFalso(), "k")).toBeNull();
    expect(leerEleccion(almacenFalso({ k: "tal vez" }), "k")).toBeNull();
  });

  it("sin almacén (servidor o navegador bloqueado) no revienta", () => {
    expect(leerEleccion(null, "k")).toBeNull();
    expect(() => guardarEleccion(null, "k", true)).not.toThrow();
  });

  it("si el almacén lanza al leer o al escribir, se trata como sin elección", () => {
    const roto = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("quota"); } };
    expect(leerEleccion(roto, "k")).toBeNull();
    expect(() => guardarEleccion(roto, "k", true)).not.toThrow();
  });
});
