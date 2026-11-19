import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { GUION_DE_HOST_DE_TARJETAS, HOST_DE_TARJETAS, esHostDeTarjetas, rutaEnHostDeTarjetas } from "./host";

describe("el dominio de las tarjetas", () => {
  it("el nombre del host es el único y es el de la tarjeta", () => {
    expect(HOST_DE_TARJETAS).toBe("businesscard.rdztilegroup.com");
  });

  it("reconoce el host con mayúsculas, puerto o punto final, y no confunde otros", () => {
    expect(esHostDeTarjetas("businesscard.rdztilegroup.com")).toBe(true);
    expect(esHostDeTarjetas("BusinessCard.RDZTileGroup.com")).toBe(true);
    expect(esHostDeTarjetas("businesscard.rdztilegroup.com:3550")).toBe(true);
    expect(esHostDeTarjetas("businesscard.rdztilegroup.com.")).toBe(true);
    expect(esHostDeTarjetas("rtg-hub.vercel.app")).toBe(false);
    expect(esHostDeTarjetas("evil-businesscard.rdztilegroup.com")).toBe(false);
    expect(esHostDeTarjetas("businesscard.rdztilegroup.com.evil.com")).toBe(false);
    expect(esHostDeTarjetas("localhost:3550")).toBe(false);
    expect(esHostDeTarjetas(null)).toBe(false);
    expect(esHostDeTarjetas("")).toBe(false);
  });

  it("sirve la tarjeta por slug y el editor por /editar, con la ruta interna", () => {
    expect(rutaEnHostDeTarjetas("/jose-perez")).toEqual({ kind: "reescribe", to: "/tarjeta/jose-perez" });
    expect(rutaEnHostDeTarjetas("/editar")).toEqual({ kind: "reescribe", to: "/tarjeta/editar" });
  });

  it("deja pasar solo los ficheros de la página y la API de tarjetas", () => {
    expect(rutaEnHostDeTarjetas("/_next/static/chunk.js")).toEqual({ kind: "pasa" });
    expect(rutaEnHostDeTarjetas("/tarjetas/cover.jpg")).toEqual({ kind: "pasa" });
    expect(rutaEnHostDeTarjetas("/api/tarjetas/foto")).toEqual({ kind: "pasa" });
  });

  it("todo lo demás es la 404 de tarjetas: la raíz, el login, el hub y su API", () => {
    for (const ruta of ["/", "/login/x", "/home/x", "/api/notify", "/api/security/seen", "/tarjeta/jose-perez", "/tarjeta/editar",
      "/tarjetas", "/track/123", "/surveys/x", "/editar/extra", "/api", "/editar2/x", "/jose.json"]) {
      expect([ruta, rutaEnHostDeTarjetas(ruta).kind]).toEqual([ruta, "no-encontrada"]);
    }
  });

  it("un slug de una sola parte que no es tarjeta llega a la página de tarjetas, que responde 404 si no existe", () => {
    // «/erp» tiene forma de slug: la página busca la tarjeta y, si no la hay, responde la 404 de tarjetas.
    expect(rutaEnHostDeTarjetas("/erp")).toEqual({ kind: "reescribe", to: "/tarjeta/erp" });
  });

  it("un slug reservado o mal formado no se sirve como tarjeta", () => {
    for (const ruta of ["/api", "/tarjeta", "/login", "/Jose", "/jose_perez", "/-x", "/x-"]) {
      expect([ruta, rutaEnHostDeTarjetas(ruta).kind]).toEqual([ruta, "no-encontrada"]);
    }
  });

  it("el guion previo a pintar marca el <html> solo en el host de tarjetas", () => {
    expect(GUION_DE_HOST_DE_TARJETAS).toContain('"businesscard.rdztilegroup.com"');
    expect(GUION_DE_HOST_DE_TARJETAS).toContain('data-tarjetas');
  });

  it("la página de la 404 existe en el código", () => {
    expect(existsSync(join(process.cwd(), "src/app/tarjeta/no-encontrada/page.tsx"))).toBe(true);
  });
});
