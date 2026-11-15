import { describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { AAD_REFRESH_TOKEN, cifrar, claveDelEntorno, claveDesdeTexto, descifrar } from "./cifrado";

const clave = randomBytes(32);

describe("cifrado del refresh token", () => {
  it("ida y vuelta: lo que se cifra se descifra igual", () => {
    const token = "0.AVEA-refresh-token-de-prueba_123";
    expect(descifrar(cifrar(token, clave), clave)).toBe(token);
  });

  it("no guarda el texto plano en el resultado", () => {
    const token = "secreto-muy-largo-del-token-0123456789";
    const c = cifrar(token, clave);
    expect(c).not.toContain(token);
    expect(c.startsWith("v1:")).toBe(true);
    expect(c.split(":")).toHaveLength(4);
  });

  it("dos cifrados del mismo texto no son iguales (IV aleatorio)", () => {
    expect(cifrar("igual", clave)).not.toBe(cifrar("igual", clave));
  });

  it("con otra llave no descifra, y el error no dice por qué", () => {
    const c = cifrar("dato", clave);
    expect(() => descifrar(c, randomBytes(32))).toThrow(/No se pudo descifrar/);
  });

  it("un texto alterado no descifra (la etiqueta GCM lo detecta)", () => {
    const c = cifrar("dato", clave);
    const partes = c.split(":");
    const cuerpo = Buffer.from(partes[3], "base64");
    cuerpo[0] ^= 0x01;
    partes[3] = cuerpo.toString("base64");
    expect(() => descifrar(partes.join(":"), clave)).toThrow();
  });

  it("el aad liga el cifrado a su uso", () => {
    const c = cifrar("dato", clave, AAD_REFRESH_TOKEN);
    expect(() => descifrar(c, clave, "otro-uso")).toThrow();
    expect(descifrar(c, clave, AAD_REFRESH_TOKEN)).toBe("dato");
  });

  it("rechaza formatos que no son suyos", () => {
    expect(() => descifrar("texto-plano", clave)).toThrow(/Formato/);
    expect(() => descifrar("v2:a:b:c", clave)).toThrow(/Formato/);
  });

  it("cifrar exige una llave de 32 bytes", () => {
    expect(() => cifrar("x", Buffer.alloc(16))).toThrow(/32 bytes/);
  });
});

describe("llave desde el entorno", () => {
  it("acepta 32 bytes en base64", () => {
    const b64 = randomBytes(32).toString("base64");
    expect(claveDesdeTexto(b64)?.length).toBe(32);
    expect(claveDelEntorno({ OUTLOOK_TOKEN_KEY: b64 }).length).toBe(32);
  });

  it("rechaza vacía, de otra longitud o con basura", () => {
    expect(claveDesdeTexto(undefined)).toBeNull();
    expect(claveDesdeTexto("")).toBeNull();
    expect(claveDesdeTexto(randomBytes(16).toString("base64"))).toBeNull();
    expect(claveDesdeTexto("no-es-base64!!")).toBeNull();
  });

  it("el error nombra la variable y no muestra su valor", () => {
    const valorMalo = "valor-malo-que-no-debe-salir";
    try {
      claveDelEntorno({ OUTLOOK_TOKEN_KEY: valorMalo });
      expect.fail("debió lanzar");
    } catch (e) {
      const msg = (e as Error).message;
      expect(msg).toContain("OUTLOOK_TOKEN_KEY");
      expect(msg).not.toContain(valorMalo);
    }
  });
});
