import { describe, expect, it } from "vitest";
import { esClaseDeFoto, esFirmaDeImagen, extensionDeFoto, rutaDeFoto, rutaDeFotoValida, urlPublicaDeFoto, TAMANO_MAX_FOTO } from "./fotos";

const ID = "5b0f3c2e-8a1d-4e6b-9c7f-123456789abc";

describe("fotos de la tarjeta", () => {
  it("acepta solo jpeg, png y webp, y el tope es 5 MB", () => {
    expect(extensionDeFoto("image/jpeg")).toBe("jpg");
    expect(extensionDeFoto("image/png")).toBe("png");
    expect(extensionDeFoto("image/webp")).toBe("webp");
    expect(extensionDeFoto("image/gif")).toBeNull();
    expect(extensionDeFoto("text/html")).toBeNull();
    expect(TAMANO_MAX_FOTO).toBe(5 * 1024 * 1024);
  });

  it("solo las clases foto y portada", () => {
    expect(esClaseDeFoto("foto")).toBe(true);
    expect(esClaseDeFoto("portada")).toBe(true);
    expect(esClaseDeFoto("logo")).toBe(false);
  });

  it("comprueba la firma del archivo, no solo el tipo que dice el navegador", () => {
    const jpg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]);
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
    const webp = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);
    expect(esFirmaDeImagen(jpg, "image/jpeg")).toBe(true);
    expect(esFirmaDeImagen(png, "image/png")).toBe(true);
    expect(esFirmaDeImagen(webp, "image/webp")).toBe(true);
    expect(esFirmaDeImagen(jpg, "image/png")).toBe(false);
    expect(esFirmaDeImagen(new TextEncoder().encode("<html>"), "image/jpeg")).toBe(false);
    expect(esFirmaDeImagen(new Uint8Array(), "image/jpeg")).toBe(false);
  });

  it("la ruta nueva va en la carpeta de la tarjeta (su id) y valida con la misma regla que la base", () => {
    const ruta = rutaDeFoto(ID, "foto", "jpg", 1763510400000);
    expect(ruta).toBe(`${ID}/foto-1763510400000.jpg`);
    expect(rutaDeFotoValida(ID, ruta)).toBe(true);
    expect(rutaDeFotoValida(ID, rutaDeFoto(ID, "portada", "webp", 5))).toBe(true);
  });

  it("una ruta fuera de la carpeta de la tarjeta o con otro nombre no vale", () => {
    const otra = "11111111-2222-4333-8444-555555555555";
    for (const r of [
      `${otra}/foto-1.jpg`,
      `${ID}/../${otra}/foto-1.jpg`,
      `${ID}/foto-1.jpg/../../x`,
      `${ID}/foto-1.gif`,
      `${ID}/foto-abc.jpg`,
      `${ID}/otra-1.jpg`,
      `${ID}/sub/foto-1.jpg`,
      `/${ID}/foto-1.jpg`,
    ]) {
      expect([r, rutaDeFotoValida(ID, r)]).toEqual([r, false]);
    }
    expect(rutaDeFotoValida("no-es-un-id", `no-es-un-id/foto-1.jpg`)).toBe(false);
  });

  it("la URL pública apunta al bucket business-cards", () => {
    expect(urlPublicaDeFoto("https://proyecto.supabase.co/", `${ID}/foto-1.jpg`))
      .toBe(`https://proyecto.supabase.co/storage/v1/object/public/business-cards/${ID}/foto-1.jpg`);
  });
});
