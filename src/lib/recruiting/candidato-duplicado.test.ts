import { describe, expect, it } from "vitest";
import { buscaDuplicado, digitosTel, patronNombre, patronTel } from "./candidato-duplicado";

const base = [
  { id: "itiel-1", name: "Itiel de Leon", phone: "(956) 317-9574" },
  { id: "vidal-1", name: "Vidal Contereas", phone: "(956) 355-2525" },
  { id: "jose", name: "José Pérez", phone: null },
];

describe("candidatos duplicados (se pregunta a la base antes de crear)", () => {
  it("el teléfono se compara por dígitos, en cualquier formato", () => {
    expect(digitosTel("+1 (956) 317-9574")).toBe("9563179574");
    expect(buscaDuplicado(base, { name: "Otro", phone: "956.317.9574" })?.id).toBe("itiel-1");
    expect(buscaDuplicado(base, { name: "Vidal Contreras", phone: "9563552525" })?.id).toBe("vidal-1");
  });
  it("sin teléfono que coincida, por nombre normalizado (acentos y espacios)", () => {
    expect(buscaDuplicado(base, { name: "  jose   perez ", phone: "" })?.id).toBe("jose");
    expect(buscaDuplicado(base, { name: "ITIEL DE LEÓN", phone: "1112223333" })?.id).toBe("itiel-1");
  });
  it("persona nueva: nada", () => {
    expect(buscaDuplicado(base, { name: "Bianca Sanchez", phone: "(956) 510-4610" })).toBeNull();
  });
  it("patrones para la base", () => {
    expect(patronTel("(956) 317-9574")).toBe("%9%5%6%3%1%7%9%5%7%4%");
    expect(patronTel("123")).toBeNull();
    expect(patronNombre("50%_off")).toBe("50\\%\\_off");
    expect(patronNombre("ab")).toBeNull();
  });
});
