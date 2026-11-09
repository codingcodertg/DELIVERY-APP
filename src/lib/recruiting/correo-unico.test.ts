import { describe, expect, it } from "vitest";
import { duenoDelCorreo, esCorreoValido, mensajeCorreoEnUso, normalizaCorreo } from "./correo-unico";

describe("correo-unico", () => {
  it("normaliza correos para comparar", () => {
    expect(normalizaCorreo("  JC@Mail.com ")).toBe("jc@mail.com");
    expect(normalizaCorreo(null)).toBe("");
  });

  it("valida la forma del correo", () => {
    expect(esCorreoValido("jc@mail.com")).toBe(true);
    expect(esCorreoValido(" JC@MAIL.COM ")).toBe(true);
    expect(esCorreoValido("no-es-correo")).toBe(false);
    expect(esCorreoValido("")).toBe(false);
    expect(esCorreoValido(null)).toBe(false);
  });

  const filas = [
    { id: "a", nombre: "Ana Pérez", correos: ["ana@rtg.com", null] },
    { id: "b", nombre: "Beto Ruiz", correos: [" BETO@rtg.com ", "beto.personal@gmail.com"] },
    { id: "c", nombre: "  ", correos: ["sincorreo"] },
  ];

  it("encuentra al dueño del correo, sin importar mayúsculas ni espacios", () => {
    expect(duenoDelCorreo("ANA@RTG.COM", filas)).toEqual({ id: "a", nombre: "Ana Pérez" });
    expect(duenoDelCorreo("beto.personal@gmail.com", filas)).toEqual({ id: "b", nombre: "Beto Ruiz" });
  });

  it("devuelve null si está libre o el correo va vacío", () => {
    expect(duenoDelCorreo("nuevo@rtg.com", filas)).toBeNull();
    expect(duenoDelCorreo("", filas)).toBeNull();
    expect(duenoDelCorreo(null, filas)).toBeNull();
  });

  it("ignora el propio registro que se está guardando", () => {
    expect(duenoDelCorreo("ana@rtg.com", filas, ["a"])).toBeNull();
    expect(duenoDelCorreo("ana@rtg.com", filas, ["b"])).toEqual({ id: "a", nombre: "Ana Pérez" });
  });

  it("si el dueño no tiene nombre, usa un guion", () => {
    expect(duenoDelCorreo("sincorreo", filas)).toEqual({ id: "c", nombre: "—" });
  });

  it("arma el aviso bilingüe", () => {
    expect(mensajeCorreoEnUso("Ana Pérez")).toEqual({
      en: "That email is already used by Ana Pérez",
      es: "Ese correo ya está en uso por Ana Pérez",
    });
    expect(mensajeCorreoEnUso("  ")).toEqual({
      en: "That email is already used by someone else",
      es: "Ese correo ya está en uso por otra persona",
    });
  });
});
