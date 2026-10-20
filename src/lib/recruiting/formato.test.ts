import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { correoEstandar, estandarizaCandidato, nombreEstandar, telefonoEstandar } from "./formato";

// D-610 (2026-10-20) · El dueño: «todo esté estandarizado … si el teléfono viene todo pegado, que el sistema automáticamente lo
// ponga como debe de ser». Datos de prueba, no los del dueño.

describe("formatos estándar del candidato", () => {
  it("teléfono: diez dígitos → (956) 340-5910, venga pegado, con guiones, paréntesis sueltos o con el 1 del país", () => {
    expect(telefonoEstandar("9563405910")).toBe("(956) 340-5910");
    expect(telefonoEstandar("956)735-4681")).toBe("(956) 735-4681");
    expect(telefonoEstandar("956-715-1463 ")).toBe("(956) 715-1463");
    expect(telefonoEstandar("(956) 599-3449")).toBe("(956) 599-3449");
    expect(telefonoEstandar("1 956 599 3449")).toBe("(956) 599-3449");
    expect(telefonoEstandar("+1 (956) 599-3449")).toBe("(956) 599-3449");
  });
  it("teléfono: lo que no son diez dígitos se deja limpio, no se inventa", () => {
    expect(telefonoEstandar("+52 899 123 4567")).toBe("+52 899 123 4567");
    expect(telefonoEstandar("  12345  ")).toBe("12345");
    expect(telefonoEstandar("")).toBe("");
    expect(telefonoEstandar(null)).toBe("");
  });
  it("nombre: cada palabra con mayúscula inicial, partículas en minúscula, guiones y apóstrofos respetados, acentos como vienen", () => {
    expect(nombreEstandar("MARIA DE LA CRUZ")).toBe("Maria de la Cruz");
    expect(nombreEstandar("enrique silva-garcia")).toBe("Enrique Silva-Garcia");
    expect(nombreEstandar("  jOsé   ángel   o'neil ")).toBe("José Ángel O'Neil");
    expect(nombreEstandar("de los santos, alfredo")).toBe("De los Santos, Alfredo");
    expect(nombreEstandar("")).toBe("");
  });
  it("correo: minúsculas y sin espacios", () => {
    expect(correoEstandar("  Ana.Perez@Mail.COM ")).toBe("ana.perez@mail.com");
  });
  it("el parche: solo los campos que vienen; los extra en lista, sin vacíos; un correo vacío queda null", () => {
    expect(estandarizaCandidato({ name: "ana lopez", phone: "9563405910", notes: "x" })).toEqual({ name: "Ana Lopez", phone: "(956) 340-5910", notes: "x" });
    expect(estandarizaCandidato({ status: "phone" })).toEqual({ status: "phone" });
    expect(estandarizaCandidato({ email: "  " })).toEqual({ email: null });
    expect(estandarizaCandidato({ extra_phones: ["9560000000", " "], extra_emails: ["A@B.C"] })).toEqual({ extra_phones: ["(956) 000-0000"], extra_emails: ["a@b.c"] });
  });
  it("puerta: el proveedor estandariza en el alta Y en la edición (toda escritura pasa por ahí)", () => {
    const p = readFileSync(new URL("../recruiting-data-provider.tsx", import.meta.url), "utf8");
    expect(p).toContain('from "@/lib/recruiting/formato"');
    expect(p).toContain("const payload = { ...estandarizaCandidato(c), created_by: me?.id ?? null };");
    expect(p).toContain("const finalPatch: Partial<Candidate> = estandarizaCandidato(");
  });
});
