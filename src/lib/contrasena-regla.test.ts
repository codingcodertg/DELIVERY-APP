import { describe, it, expect } from "vitest";
import { falloDeRegla, MIN_CONTRASENA, mensajeDeRegla, reglaTexto } from "./contrasena-regla";
import { generaContrasenaTemporal } from "./contrasena-temporal";

const es = (en: string, esp: string) => esp;

describe("falloDeRegla (10 caracteres, letras y números)", () => {
  it("el mínimo es 10", () => {
    expect(MIN_CONTRASENA).toBe(10);
  });

  it("cumple la regla con letras y números, a partir de 10 caracteres", () => {
    expect(falloDeRegla("abcdefghi1")).toBeNull(); // 10
    expect(falloDeRegla("Tuerca2024!")).toBeNull();
    expect(falloDeRegla("contraseña7x")).toBeNull(); // letra acentuada cuenta como letra
  });

  it("dice qué falta: longitud, letra o número", () => {
    expect(falloDeRegla("abc1")).toBe("corta");
    expect(falloDeRegla("abcdefghi")).toBe("corta"); // 9 caracteres, aunque no tenga cifra
    expect(falloDeRegla("abcdefghij")).toBe("sin_digito"); // 10 sin cifra
    expect(falloDeRegla("1234567890")).toBe("sin_letra"); // 10 sin letra
    expect(falloDeRegla("")).toBe("corta");
  });

  it("el texto de la regla y de cada fallo salen en los dos idiomas", () => {
    expect(reglaTexto((en) => en)).toMatch(/10 characters/);
    expect(reglaTexto(es)).toMatch(/10 caracteres/);
    expect(mensajeDeRegla("corta", (en) => en)).toMatch(/10/);
    expect(mensajeDeRegla("sin_letra", es)).toMatch(/letra/);
    expect(mensajeDeRegla("sin_digito", es)).toMatch(/número/);
  });
});

describe("generaContrasenaTemporal", () => {
  it("siempre cumple la regla del hub, y tiene la forma Palabra-Palabra-1234-xy", () => {
    for (let i = 0; i < 200; i++) {
      const pw = generaContrasenaTemporal();
      expect(falloDeRegla(pw)).toBeNull();
      expect(pw).toMatch(/^[A-Za-z]+-[A-Za-z]+-\d{4}-[a-z]{2}$/);
    }
  });

  it("las dos letras finales no llevan ninguna de las ambiguas (i, l, o)", () => {
    for (let i = 0; i < 200; i++) {
      const sufijo = generaContrasenaTemporal().split("-")[3];
      expect(sufijo).not.toMatch(/[ilo]/);
    }
  });

  it("no repite siempre la misma (es aleatoria)", () => {
    const vistas = new Set<string>();
    for (let i = 0; i < 50; i++) vistas.add(generaContrasenaTemporal());
    expect(vistas.size).toBeGreaterThan(40);
  });
});
