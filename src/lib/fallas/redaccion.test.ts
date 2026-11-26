import { describe, it, expect } from "vitest";
import { limpiarRuta, limpiarTexto } from "./reglas";

// Redacción (revisión de seguridad, 2026-11-25): cada regla tiene su prueba, y una entrada hostil de 1 MB no puede
// tardar más de 50 ms (el recorte a 10 000 caracteres va antes de cualquier expresión regular).

describe("claves con valor: sufijo sensible, con o sin comillas", () => {
  it("clave sin comillas, con separador = o :", () => {
    expect(limpiarTexto("secret=abc", 200)).toBe("secret=[oculto]");
    expect(limpiarTexto("pwd: hunter2", 200)).toBe("pwd: [oculto]");
  });

  it("la clave puede llevar prefijo: db_password, MY_API_KEY, x_auth", () => {
    expect(limpiarTexto("db_password=zzz", 200)).toBe("db_password=[oculto]");
    expect(limpiarTexto("MY_API_KEY=zzz", 200)).toBe("MY_API_KEY=[oculto]");
    expect(limpiarTexto("x_auth: zzz", 200)).toBe("x_auth: [oculto]");
  });

  it("con comillas alrededor de la clave y del valor (JSON)", () => {
    expect(limpiarTexto('{"token": "abc123"}', 200)).toBe('{"token": "[oculto]"}');
    expect(limpiarTexto("{'secret': 'xyz'}", 200)).toBe("{'secret': '[oculto]'}");
  });

  it("no toca palabras que solo empiezan igual: author, monkeys", () => {
    expect(limpiarTexto("author: Ana", 200)).toBe("author: Ana");
    expect(limpiarTexto("author = Ana", 200)).toBe("author = Ana");
  });
});

describe("Basic y JWT", () => {
  it("Basic seguido de base64", () => {
    expect(limpiarTexto("Authorization: Basic dXN1YXJpbzpjbGF2ZQ==", 200)).not.toContain("dXN1");
    expect(limpiarTexto("usa Basic dXN1YXJpbzpjbGF2ZQ== aquí", 200)).toBe("usa Basic [token] aquí");
  });

  it("un JWT suelto, aunque no vaya en una cabecera", () => {
    const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.abc-123_xyz";
    expect(limpiarTexto(`sesión ${jwt} caducada`, 200)).toBe("sesión [token] caducada");
  });
});

describe("teléfonos: 10 o más dígitos con separadores", () => {
  it("redacta un número con paréntesis y guiones", () => {
    expect(limpiarTexto("llamar a (956) 340-5910 hoy", 200)).toBe("llamar a [teléfono] hoy");
    expect(limpiarTexto("+1 956 340 5910", 200)).toBe("[teléfono]");
  });

  it("no toca fechas, versiones ni números cortos", () => {
    expect(limpiarTexto("2026-11-25 v1.667.1 orden 123456", 200)).toBe("2026-11-25 v1.667.1 orden 123456");
  });
});

describe("consultas de URL sin expresiones regulares", () => {
  it("corta en el primer ? o # de cada URL o ruta, y conserva los espacios y los saltos", () => {
    expect(limpiarTexto("a https://x.com/cb?code=1#f b\nc /home?next=1", 200)).toBe("a https://x.com/cb b\nc /home");
  });
});

describe("límites y rendimiento con entradas hostiles", () => {
  const TIEMPO_MAX_MS = 50;
  const hostiles: [string, string][] = [
    ["letras seguidas", "a".repeat(1_000_000)],
    ["cifras con espacio", "1 ".repeat(500_000)],
    ["correos sin fin", "x@".repeat(500_000)],
    ["JWT repetido", "eyJ".repeat(333_000)],
    ["claves repetidas", "token=".repeat(166_000)],
    ["URL con query", "/a?".repeat(333_000)],
    ["guiones y letras", "-a".repeat(500_000)],
    ["comillas y claves", "\"token\":\"".repeat(100_000)],
  ];

  for (const [nombre, entrada] of hostiles) {
    it(`1 MB de «${nombre}» se procesa en menos de ${TIEMPO_MAX_MS} ms`, () => {
      const t0 = performance.now();
      const salida = limpiarTexto(entrada, 500);
      const ms = performance.now() - t0;
      expect(ms).toBeLessThan(TIEMPO_MAX_MS);
      expect(salida.length).toBeLessThanOrEqual(500);
    });
  }

  it("la ruta también acota la entrada", () => {
    const t0 = performance.now();
    const salida = limpiarRuta("/x".repeat(500_000));
    expect(performance.now() - t0).toBeLessThan(TIEMPO_MAX_MS);
    expect(salida.length).toBeLessThanOrEqual(300);
  });

  it("nada de una entrada de 1 MB llega a la salida más allá del tope", () => {
    expect(limpiarTexto("z".repeat(1_000_000), 100).length).toBe(100);
  });
});
