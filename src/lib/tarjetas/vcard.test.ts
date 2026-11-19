import { describe, expect, it } from "vitest";
import { construyeVcard, escapaVcard, nombreDeArchivoVcard, plegaLinea, type DatosDeVcard } from "./vcard";

const base: DatosDeVcard = {
  nombre: "José Pérez",
  rolEs: "Ventas",
  rolEn: "Sales",
  idioma: "es",
  marca: "Rodriguez Tile Group",
  tienda: { ciudad: "Brownsville", direccion: "3913 North Expy, Brownsville, TX 78520" },
  celular: "+19566172659",
  trabajo: "+19568171588",
  correo: "jose@axen-growth.com",
  url: "https://businesscard.rdztilegroup.com/jose-perez",
};

describe("la tarjeta de contacto (vCard)", () => {
  it("escapa punto y coma, coma, barra y saltos de línea", () => {
    expect(escapaVcard("a;b,c\\d\ne")).toBe("a\\;b\\,c\\\\d\\ne");
  });

  it("arma un vCard 3.0 con nombre, puesto, teléfonos, correo, dirección y URL", () => {
    const v = construyeVcard(base);
    expect(v.startsWith("BEGIN:VCARD\r\nVERSION:3.0\r\n")).toBe(true);
    expect(v).toContain("N:Pérez;José;;;");
    expect(v).toContain("FN:José Pérez");
    expect(v).toContain("ORG:Rodriguez Tile Group — Brownsville");
    expect(v).toContain("TITLE:Ventas");
    expect(v).toContain("TEL;TYPE=CELL:+19566172659");
    expect(v).toContain("TEL;TYPE=WORK:+19568171588");
    expect(v).toContain("EMAIL;TYPE=WORK:jose@axen-growth.com");
    expect(v).toContain("URL:https://businesscard.rdztilegroup.com/jose-perez");
    expect(v.endsWith("END:VCARD\r\n")).toBe(true);
  });

  it("usa el rol en inglés cuando la tarjeta está en inglés", () => {
    expect(construyeVcard({ ...base, idioma: "en" })).toContain("TITLE:Sales");
  });

  it("no repite el teléfono de la tienda si es el mismo celular, y omite lo que falta", () => {
    const v = construyeVcard({ ...base, trabajo: "+19566172659", tienda: null, correo: null });
    expect(v).not.toContain("TEL;TYPE=WORK");
    expect(v).not.toContain("EMAIL");
    expect(v).not.toContain("ADR");
    expect(v).not.toContain("ORG:Rodriguez Tile Group —");
  });

  it("un nombre con comas o punto y coma no rompe el archivo", () => {
    const v = construyeVcard({ ...base, nombre: "Ana; Maria, Jr" });
    expect(v).toContain("N:Maria\\, Jr;Ana\\;;;;"); // nombre de pila «Ana;», apellido «Maria, Jr», ambos escapados
    expect(v).toContain("FN:Ana\\; Maria\\, Jr");
  });

  it("parte las líneas largas a 75 octetos con continuación", () => {
    const largo = "A".repeat(200);
    const pliegue = plegaLinea(largo);
    for (const trozo of pliegue.split("\r\n")) expect(new TextEncoder().encode(trozo.replace(/^ /, "")).length).toBeLessThanOrEqual(75);
    expect(pliegue.replace(/\r\n /g, "")).toBe(largo);
  });

  it("la foto va en base64 y plegada", () => {
    const foto = "QUJD".repeat(60);
    const v = construyeVcard({ ...base, fotoBase64: foto });
    expect(v).toContain("PHOTO;ENCODING=b;TYPE=JPEG:");
    expect(v.replace(/\r\n /g, "")).toContain(`PHOTO;ENCODING=b;TYPE=JPEG:${foto}`);
  });

  it("el archivo se llama con el nombre sin acentos ni espacios", () => {
    expect(nombreDeArchivoVcard("José Pérez")).toBe("Jose_Perez.vcf");
    expect(nombreDeArchivoVcard("!!!")).toBe("contacto.vcf");
  });
});
