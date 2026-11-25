import { describe, it, expect } from "vitest";
import { planAuto, chipAuto, avisoDePisar, claveDeRutaAuto } from "./auto-optimiza-la-ruta";

const base = {
  bloqueada: false,
  pendientes: [{ id: "a", route_seq: 1, route_fixed: false }, { id: "b", route_seq: 2, route_fixed: false }],
  delLote: ["c"],
  huellaAhora: "h1",
  guardado: null,
};

describe("planAuto", () => {
  it("ruta bloqueada: no se toca, aunque tenga pendientes y lote", () => {
    expect(planAuto({ ...base, bloqueada: true, delLote: ["c"] })).toEqual({ que: "nada", motivo: "bloqueada" });
  });

  it("sin paradas pendientes: nada (ruta vacia)", () => {
    expect(planAuto({ ...base, pendientes: [] })).toEqual({ que: "nada", motivo: "ruta_vacia" });
  });

  it("huella igual y estado 'hecha': nada, sin gastar una consulta de tiempos", () => {
    expect(planAuto({ ...base, guardado: { estado: "hecha", huella: "h1" } })).toEqual({ que: "nada", motivo: "sin_cambios" });
  });

  it("huella distinta con estado 'hecha': no basta, se sigue decidiendo", () => {
    expect(planAuto({ ...base, guardado: { estado: "hecha", huella: "vieja" } })).toEqual({ que: "optimizar_todo" });
  });

  it("huella igual con estado 'fallo': se reintenta (no cuenta como hecha)", () => {
    expect(planAuto({ ...base, guardado: { estado: "fallo", huella: "h1" } })).toEqual({ que: "optimizar_todo" });
  });

  it("huella igual con estado 'pendiente': no se da por hecha", () => {
    expect(planAuto({ ...base, guardado: { estado: "pendiente", huella: "h1" } })).toEqual({ que: "optimizar_todo" });
  });

  it("ninguna parada fijada: optimizar toda la ruta", () => {
    expect(planAuto(base)).toEqual({ que: "optimizar_todo" });
  });

  it("alguna parada fijada: insertar las del lote, en el orden de entrada", () => {
    const e = { ...base, pendientes: [{ id: "a", route_seq: 1, route_fixed: true }, { id: "b", route_seq: 2 }], delLote: ["x", "y"] };
    expect(planAuto(e)).toEqual({ que: "insertar", nuevas: ["x", "y"] });
  });

  it("insertar: una orden del lote ya fijada a mano no se vuelve a colocar", () => {
    const e = { ...base, pendientes: [{ id: "a", route_seq: 1, route_fixed: true }, { id: "b", route_seq: 2 }], delLote: ["a", "x"] };
    expect(planAuto(e)).toEqual({ que: "insertar", nuevas: ["x"] });
  });

  it("insertar: un id repetido en el lote se cuenta una vez", () => {
    const e = { ...base, pendientes: [{ id: "a", route_seq: 1, route_fixed: true }], delLote: ["x", "x"] };
    expect(planAuto(e)).toEqual({ que: "insertar", nuevas: ["x"] });
  });

  it("insertar: si el lote solo trae fijadas, no hay nada que colocar: nada", () => {
    const e = { ...base, pendientes: [{ id: "a", route_seq: 1, route_fixed: true }], delLote: ["a"] };
    expect(planAuto(e)).toEqual({ que: "nada", motivo: "sin_cambios" });
  });

  it("la huella solo corta cuando el estado es 'hecha': con una fijada y huella igual, sigue", () => {
    const e = { ...base, pendientes: [{ id: "a", route_seq: 1, route_fixed: true }], delLote: ["x"], guardado: { estado: "hecha" as const, huella: "h1" } };
    expect(planAuto(e)).toEqual({ que: "nada", motivo: "sin_cambios" });
  });
});

describe("chipAuto", () => {
  it("pendiente: el chip de calculando, en los dos idiomas", () => {
    expect(chipAuto("pendiente")).toEqual({ en: "⏳ optimising…", es: "⏳ optimizando…", clase: "calculando" });
  });

  it("fallo: el chip de reintentar, en los dos idiomas", () => {
    expect(chipAuto("fallo")).toEqual({ en: "↻ not optimised — retry", es: "↻ sin optimizar — reintentar", clase: "fallo" });
  });

  it("hecha, sin estado o nulo: ningun chip", () => {
    expect(chipAuto("hecha")).toBeNull();
    expect(chipAuto(null)).toBeNull();
    expect(chipAuto(undefined)).toBeNull();
  });
});

describe("avisoDePisar", () => {
  it("ninguna fijada: null (no hay aviso)", () => {
    expect(avisoDePisar([{ route_fixed: false }, {}])).toBeNull();
    expect(avisoDePisar([])).toBeNull();
  });

  it("una fijada: el aviso en singular-plural como en la especificacion", () => {
    expect(avisoDePisar([{ route_fixed: true }])).toEqual({
      n: 1,
      en: "Optimize will rearrange the whole route and overwrite 1 stop(s) you placed by hand. Continue?",
      es: "Optimizar va a reacomodar toda la ruta y pisar 1 parada(s) que colocaste a mano. ¿Continuar?",
    });
  });

  it("varias fijadas: cuenta solo las fijadas", () => {
    const r = avisoDePisar([{ route_fixed: true }, { route_fixed: false }, { route_fixed: true }, { route_fixed: null }]);
    expect(r?.n).toBe(2);
    expect(r?.es).toBe("Optimizar va a reacomodar toda la ruta y pisar 2 parada(s) que colocaste a mano. ¿Continuar?");
  });
});

describe("claveDeRutaAuto", () => {
  it("dia y ruta separados por |", () => {
    expect(claveDeRutaAuto("2026-11-24", "Juan")).toBe("2026-11-24|Juan");
  });
});
