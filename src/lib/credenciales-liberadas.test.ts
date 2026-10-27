import { describe, expect, it } from "vitest";
import { aliasDeBaja, credencialesAGuardar, DOMINIO_BAJA, esAliasDeBaja, hayQueLiberar, notaConCredenciales } from "./credenciales-liberadas";
import { INTERNAL_EMAIL_DOMAIN, isSyntheticEmail } from "./username";

const ID = "3f2a9c1e-0b7d-4e55-9a1c-77d0e2b4c901";
const OTRO = "a1b2c3d4-0000-4000-8000-000000000001";

describe("aliasDeBaja", () => {
  it("es determinista", () => { expect(aliasDeBaja(ID)).toBe(aliasDeBaja(ID)); });
  it("dos cuentas, dos alias", () => { expect(aliasDeBaja(ID)).not.toBe(aliasDeBaja(OTRO)); });
  it("tiene forma de correo y cae en el dominio de bajas", () => {
    const a = aliasDeBaja(ID);
    expect(a).toMatch(/^[a-z0-9-]+@[a-z0-9.-]+\.[a-z]+$/);
    expect(a).toBe(`${ID}@baja.users.rdztilegroup.net`);
    expect(esAliasDeBaja(a)).toBe(true);
  });
  it("nunca es el correo original ni una dirección de usuario", () => {
    for (const orig of ["acctphr2@rdztilegroup.net", `${ID}@users.rdztilegroup.net`]) {
      expect(aliasDeBaja(ID)).not.toBe(orig);
      expect(esAliasDeBaja(orig)).toBe(false);
    }
    expect(isSyntheticEmail(aliasDeBaja(ID))).toBe(false);
    expect(DOMINIO_BAJA).toBe(`baja.${INTERNAL_EMAIL_DOMAIN}`);
  });
  it("sin id no inventa", () => { expect(() => aliasDeBaja("")).toThrow(); });
});

describe("credenciales", () => {
  const ahora = new Date("2026-10-26T12:00:00Z");
  it("guarda lo que tenía", () => {
    expect(credencialesAGuardar({ email: "acctphr2@rdztilegroup.net", username: "scruz" }, ahora))
      .toEqual({ email: "acctphr2@rdztilegroup.net", username: "scruz", at: "2026-10-26T12:00:00.000Z" });
  });
  it("un alias no se guarda como original", () => {
    expect(credencialesAGuardar({ email: aliasDeBaja(ID), username: "" }, ahora).email).toBeNull();
  });
  it("hayQueLiberar", () => {
    expect(hayQueLiberar({ email: "x@rdztilegroup.net", username: null })).toBe(true);
    expect(hayQueLiberar({ email: aliasDeBaja(ID), username: "scruz" })).toBe(true);
    expect(hayQueLiberar({ email: aliasDeBaja(ID), username: null })).toBe(false);
  });
  it("la nota no se duplica", () => {
    const c = credencialesAGuardar({ email: "a@b.com", username: null }, ahora);
    const una = notaConCredenciales("Se fue", c);
    expect(una).toBe("Se fue\n[Credenciales liberadas: email a@b.com]");
    expect(notaConCredenciales(una, c)).toBe(una);
    expect(notaConCredenciales(null, c)).toBe("[Credenciales liberadas: email a@b.com]");
  });
});
