import { describe, expect, it } from "vitest";
import { TIPOS_QR, tipoDesdeParam, tiposVisibles } from "./tipos";

describe("los tipos de QR Codes", () => {
  it("el admin ve los dos tipos; quien no es admin, solo Encuestas", () => {
    expect(tiposVisibles(true).map((t) => t.clave)).toEqual(["encuestas", "tarjetas"]);
    expect(tiposVisibles(false).map((t) => t.clave)).toEqual(["encuestas"]);
  });

  it("una tarjeta de admin no sale para quien no lo es, aunque la pidan por la URL", () => {
    const sinAdmin = tiposVisibles(false);
    expect(tipoDesdeParam("tarjetas", sinAdmin)).toBeNull();
    expect(tipoDesdeParam("encuestas", sinAdmin)).toBe("encuestas");
  });

  it("un valor desconocido o vacío no abre nada: vuelve al selector", () => {
    for (const v of [null, undefined, "", "catalogos", "../x"]) expect(tipoDesdeParam(v, tiposVisibles(true))).toBeNull();
  });

  it("añadir un tipo nuevo es una entrada más en la lista", () => {
    const extra = [...TIPOS_QR, { ...TIPOS_QR[0], clave: "encuestas" as const, soloAdmin: false }];
    expect(tiposVisibles(false, extra)).toHaveLength(2);
  });
});
