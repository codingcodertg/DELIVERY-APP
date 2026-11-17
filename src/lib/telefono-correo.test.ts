import { describe, it, expect } from "vitest";
import { correoValido, telefonoUSaE164 } from "./telefono-correo";

describe("telefonoUSaE164 (teléfono de EE. UU. para llamar y mandar SMS)", () => {
  it("acepta los formatos que escribe la gente y los deja en E.164", () => {
    expect(telefonoUSaE164("2145551234")).toBe("+12145551234");
    expect(telefonoUSaE164("(214) 555-1234")).toBe("+12145551234");
    expect(telefonoUSaE164("214.555.1234")).toBe("+12145551234");
    expect(telefonoUSaE164("12145551234")).toBe("+12145551234");
    expect(telefonoUSaE164("+1 214 555 1234")).toBe("+12145551234");
    expect(telefonoUSaE164("+12145551234")).toBe("+12145551234");
  });

  it("descarta la extensión al final", () => {
    expect(telefonoUSaE164("214-555-1234 ext. 12")).toBe("+12145551234");
    expect(telefonoUSaE164("214-555-1234 x5")).toBe("+12145551234");
  });

  it("rechaza lo que no es un número de EE. UU. (y los números de servicio o inventados)", () => {
    expect(telefonoUSaE164("")).toBeNull();
    expect(telefonoUSaE164("555-1234")).toBeNull(); // 7 dígitos
    expect(telefonoUSaE164("+44 20 7946 0958")).toBeNull(); // Reino Unido
    expect(telefonoUSaE164("+52 55 1234 5678")).toBeNull(); // México
    expect(telefonoUSaE164("1214555123")).toBeNull(); // área con 1 en el primer dígito
    expect(telefonoUSaE164("0145551234")).toBeNull(); // empieza por 0
    expect(telefonoUSaE164("2140551234")).toBeNull(); // central con 0
    expect(telefonoUSaE164("911")).toBeNull();
    expect(telefonoUSaE164("2145551234; DROP TABLE")).toBeNull();
    expect(telefonoUSaE164("tel: 2145551234")).toBeNull();
  });

  it("no acepta lo que no es texto", () => {
    expect(telefonoUSaE164(2145551234)).toBeNull();
    expect(telefonoUSaE164(null)).toBeNull();
    expect(telefonoUSaE164(undefined)).toBeNull();
  });
});

describe("correoValido", () => {
  it("acepta un correo con forma de correo, recortado y en minúsculas", () => {
    expect(correoValido("  Ana@Empresa.com ")).toBe("ana@empresa.com");
  });

  it("rechaza lo que no tiene forma de correo, o es demasiado largo", () => {
    expect(correoValido("sin-arroba.com")).toBeNull();
    expect(correoValido("a@b")).toBeNull();
    expect(correoValido("a b@c.com")).toBeNull();
    expect(correoValido("a@" + "b".repeat(260) + ".com")).toBeNull();
    expect(correoValido(42)).toBeNull();
  });
});
