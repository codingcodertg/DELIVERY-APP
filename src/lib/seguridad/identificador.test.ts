import { describe, it, expect } from "vitest";
import { cuerpoLoginFallido, hashIdentificador } from "./identificador";

describe("login fallido: el cuerpo solo lleva el hash", () => {
  it("acepta exactamente { identificador_hash } con un SHA-256 en hex", async () => {
    const h = await hashIdentificador("usuario.ejemplo");
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(cuerpoLoginFallido({ identificador_hash: h })).toEqual({ identificador_hash: h });
  });

  it("rechaza cualquier clave extra (un correo o una contraseña no pasan)", async () => {
    const h = await hashIdentificador("x");
    expect(cuerpoLoginFallido({ identificador_hash: h, email: "a@b.com" })).toBeNull();
    expect(cuerpoLoginFallido({ identificador_hash: h, password: "secreto" })).toBeNull();
  });

  it("rechaza texto plano, tipos raros y hashes mal formados", () => {
    expect(cuerpoLoginFallido({ identificador_hash: "juan@ejemplo.com" })).toBeNull();
    expect(cuerpoLoginFallido({ identificador_hash: "ABC" })).toBeNull();
    expect(cuerpoLoginFallido({ identificador_hash: 123 })).toBeNull();
    expect(cuerpoLoginFallido(["x"])).toBeNull();
    expect(cuerpoLoginFallido(null)).toBeNull();
    expect(cuerpoLoginFallido({})).toBeNull();
  });

  it("normaliza: mayúsculas y espacios dan el mismo hash", async () => {
    expect(await hashIdentificador("  Juan@Ejemplo.COM ")).toBe(await hashIdentificador("juan@ejemplo.com"));
  });
});
