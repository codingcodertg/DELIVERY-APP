import { describe, expect, it, vi } from "vitest";
import { destinoDelAviso, enviarAvisoDeAyuda, extracto, textoDelAviso } from "./aviso-de-ayuda";
import { proveedorStub, type Proveedor } from "./mensajeria";

describe("destinoDelAviso", () => {
  it("vacío o inválido → null (no se manda nada)", () => {
    expect(destinoDelAviso(null)).toBeNull();
    expect(destinoDelAviso("")).toBeNull();
    expect(destinoDelAviso("555-01")).toBeNull();
  });
  it("la forma del hub y otras → E.164", () => {
    expect(destinoDelAviso("(956) 555-0100")).toBe("+19565550100");
    expect(destinoDelAviso("1 956 555 0100")).toBe("+19565550100");
  });
});

describe("textoDelAviso", () => {
  it("formato completo con enlace", () => {
    expect(textoDelAviso({ quien: "Ana", rol: "Sales", pagina: "/orders", mensaje: "no\nme deja", fotos: 2, enlace: "https://x/home/solicitudes-de-ayuda/7/copiar" }))
      .toBe('🆘 RTG Help: Ana (Sales) · /orders — "no me deja" · 📷 2\nhttps://x/home/solicitudes-de-ayuda/7/copiar');
  });
  it("sin rol, página, fotos ni enlace", () => {
    expect(textoDelAviso({ quien: "", mensaje: "hola", fotos: 0 })).toBe('🆘 RTG Help: A user — "hola"');
  });
  it("corta a 100 caracteres", () => {
    const e = extracto("a".repeat(150));
    expect(e).toBe("a".repeat(100) + "…");
    expect(extracto("corto")).toBe("corto");
  });
});

describe("enviarAvisoDeAyuda", () => {
  it("usa el proveedor inyectado (nada sale de la máquina)", async () => {
    const p = proveedorStub();
    await enviarAvisoDeAyuda(p, "+19565550100", "hola");
    expect(p.envios).toEqual([{ canal: "sms", to: "+19565550100", texto: "hola" }]);
  });
  it("si el proveedor lanza, devuelve el error sin lanzar", async () => {
    const p: Proveedor = { sms: vi.fn().mockRejectedValue(new Error("boom")), correo: vi.fn() };
    expect(await enviarAvisoDeAyuda(p, "+1", "x")).toEqual({ ok: false, error: "boom" });
  });
  it("si tarda, se da por perdido", async () => {
    const p: Proveedor = { sms: () => new Promise(() => {}), correo: vi.fn() };
    const r = await enviarAvisoDeAyuda(p, "+1", "x", 10);
    expect(r).toMatchObject({ ok: false, error: expect.stringContaining("timed out") });
  });
});
