import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { CLAVES_DE_TIENDA, MARCA, TIENDAS, enlaceDeMapa, enlaceDeResena, idDeVideo } from "./datos";
import { TARJETAS_DEMO, filaDemoPorSlug, filaDemoPorToken } from "./demo";
import { iniciales, primerNombre, tarjetaPublicaDesdeFila, type FilaPublica } from "./tarjeta";
import { mensajeDeWhatsApp, idiomaDesdeTexto } from "./textos";

const BASE = "https://proyecto.supabase.co";

const fila: FilaPublica = {
  slug: "jose-perez",
  full_name: "  Jose Perez ",
  role_es: "Marketing",
  role_en: "",
  store: "brownsville",
  phone: "+19568171588",
  whatsapp: "+19566172659",
  email: "jose@axen-growth.com",
  photo_path: "5b0f3c2e-8a1d-4e6b-9c7f-123456789abc/foto-1.jpg",
  cover_path: null,
};

describe("la tarjeta pública", () => {
  it("pasa la fila de la base a lo que pinta, con la foto en la URL pública", () => {
    const t = tarjetaPublicaDesdeFila(fila, BASE);
    expect(t).toMatchObject({
      slug: "jose-perez", nombre: "Jose Perez", rolEs: "Marketing", rolEn: "Marketing", tienda: "brownsville",
      telefono: "+19568171588", celular: "+19566172659", correo: "jose@axen-growth.com", portadaUrl: null,
    });
    expect(t.fotoUrl).toBe(`${BASE}/storage/v1/object/public/business-cards/${fila.photo_path}`);
  });

  it("nunca lleva el token ni el id, aunque la fila los trajera", () => {
    const sucia = { ...fila, edit_token: "a".repeat(64), id: "x", profile_id: "y" } as FilaPublica;
    const t = tarjetaPublicaDesdeFila(sucia, BASE);
    expect(JSON.stringify(t)).not.toMatch(/a{64}|"id"|profile/);
  });

  it("una tienda que no es de las seis queda vacía", () => {
    expect(tarjetaPublicaDesdeFila({ ...fila, store: "chihuahua" }, BASE).tienda).toBeNull();
    expect(tarjetaPublicaDesdeFila({ ...fila, store: null }, BASE).tienda).toBeNull();
  });

  it("el celular es el de WhatsApp, o el de la tienda si no hay WhatsApp", () => {
    expect(tarjetaPublicaDesdeFila({ ...fila, whatsapp: "" }, BASE).celular).toBe("+19568171588");
  });

  it("las iniciales y el primer nombre", () => {
    expect(iniciales("Jose Perez")).toBe("JP");
    expect(iniciales("Ana")).toBe("A");
    expect(primerNombre("  Roberto Contreras ")).toBe("Roberto");
  });

  it("el mensaje de WhatsApp toma el idioma y el primer nombre", () => {
    expect(mensajeDeWhatsApp("es", "Ana")).toBe("Hola Ana, te contacto desde tu tarjeta de Rodriguez Tile Group.");
    expect(mensajeDeWhatsApp("en", "Ana")).toBe("Hi Ana, reaching out from your Rodriguez Tile Group card.");
    expect(idiomaDesdeTexto("en")).toBe("en");
    expect(idiomaDesdeTexto("fr")).toBe("es");
  });
});

describe("datos de la marca copiados del original", () => {
  it("las seis tiendas y sus valores tal cual están en el index.html del contratista", () => {
    expect(CLAVES_DE_TIENDA).toEqual(["brownsville", "pharr", "mcallen", "edinburg", "mission", "weslaco"]);
    expect(TIENDAS.weslaco.direccion).toBe("1102 W Expressway, Weslaco, TX 78599");
    expect(TIENDAS.weslaco.placeId).toBe("ChIJZyEwJKB3ZYYRGP7nOUt2j7U");
    expect(TIENDAS.brownsville.direccion).toBe("3913 North Expy, Brownsville, TX 78520");
    expect(TIENDAS.brownsville.placeId).toBe("ChIJ-9kC47uWb4YR1qU7LnqFXAU");
    expect(TIENDAS.mcallen.direccion).toBe("4301 W US Business 83, McAllen, TX 78501");
    expect(TIENDAS.mcallen.placeId).toBe("ChIJfZ-tE6GnZYYRZkSoag-EiQc");
    expect(TIENDAS.pharr.direccion).toBe("1120 E Expressway 83, Pharr, TX 78577");
    expect(TIENDAS.pharr.placeId).toBe("ChIJ-7Sw2mWgZYYR5jJeYPWP8Jg");
    expect(TIENDAS.mission.direccion).toBe("4105 N Conway Ave, Palmhurst, TX 78573");
    expect(TIENDAS.mission.placeId).toBe("ChIJb2Zal5CoZYYRD2YhYZxt1X0");
    expect(TIENDAS.edinburg.direccion).toBe("4201 W University Dr, Edinburg, TX 78539");
    expect(TIENDAS.edinburg.placeId).toBe("ChIJTeIcybejZYYRrFbNApAcf6I");
    expect(TIENDAS.edinburg.fotos).toEqual([]);
  });

  it("cada foto de tienda existe en public/tarjetas/stores", () => {
    for (const t of Object.values(TIENDAS)) {
      for (const f of t.fotos) expect([f, existsSync(join(process.cwd(), "public", f))]).toEqual([f, true]);
    }
  });

  it("los enlaces de reseña y mapa llevan el id del lugar", () => {
    expect(enlaceDeResena(TIENDAS.pharr)).toBe("https://search.google.com/local/writereview?placeid=ChIJ-7Sw2mWgZYYR5jJeYPWP8Jg");
    const mapa = enlaceDeMapa(TIENDAS.mission);
    expect(mapa).toContain("query_place_id=ChIJb2Zal5CoZYYRD2YhYZxt1X0");
    expect(mapa).toContain(encodeURIComponent("Rodriguez Tile Group 4105 N Conway Ave, Palmhurst, TX 78573"));
  });

  it("la marca y el video", () => {
    expect(MARCA.web).toBe("https://rdztilegroup.com");
    expect(idDeVideo(MARCA.youtube)).toBe("svAk4OJ_84k");
    expect(idDeVideo("https://example.com")).toBeNull();
  });
});

describe("tarjetas inventadas del demo", () => {
  it("son ficticias y una inactiva no se sirve ni se abre con su token", () => {
    expect(TARJETAS_DEMO.every((f) => (f.email ?? "").endsWith("example.com"))).toBe(true);
    expect(filaDemoPorSlug("marta-prueba")).toBeNull();
    expect(filaDemoPorToken("c".repeat(64))).toBeNull();
    expect(filaDemoPorToken("a".repeat(64))?.slug).toBe("ana-demo");
  });
});
