import { describe, expect, it } from "vitest";
import { correoValido, enlaceCorreo, enlaceHttps, enlaceLlamar, enlaceMensaje, enlaceWhatsApp, telefonoValido } from "./contacto";

describe("teléfonos y enlaces de contacto", () => {
  it("normaliza un teléfono a +dígitos", () => {
    expect(telefonoValido("+1 (956) 617-2659")).toBe("+19566172659");
    expect(telefonoValido("9566172659")).toBe("+9566172659");
  });

  it("rechaza lo que no es un teléfono", () => {
    for (const t of ["", "   ", "abc", "+1 956 call", "123", "+1 956 617 2659 999999999", "tel:+19566172659", "+19566<script>"]) {
      expect([t, telefonoValido(t)]).toEqual([t, null]);
    }
    expect(telefonoValido(null)).toBeNull();
  });

  it("hace los enlaces de llamada, mensaje y WhatsApp solo con teléfonos válidos", () => {
    expect(enlaceLlamar("+19566172659")).toBe("tel:+19566172659");
    expect(enlaceMensaje("+19566172659")).toBe("sms:+19566172659");
    expect(enlaceWhatsApp("+19566172659", "Hola Ana")).toBe("https://wa.me/19566172659?text=Hola%20Ana");
    expect(enlaceLlamar("basura")).toBeNull();
    expect(enlaceMensaje("")).toBeNull();
    expect(enlaceWhatsApp("x", "hola")).toBeNull();
  });

  it("valida el correo y el mailto", () => {
    expect(correoValido("jose@axen-growth.com")).toBe("jose@axen-growth.com");
    expect(correoValido("  ana.b+x@rdztilegroup.net ")).toBe("ana.b+x@rdztilegroup.net");
    for (const c of ["", "sin-arroba", "a@b", "a b@c.com", "a@b.c", "a\"<script>@x.com", "x@y.com?subject=hola"]) {
      expect([c, correoValido(c)]).toEqual([c, null]);
    }
    expect(enlaceCorreo("ana@x.com")).toBe("mailto:ana@x.com");
    expect(enlaceCorreo("nope")).toBeNull();
  });

  it("solo deja pasar enlaces https", () => {
    expect(enlaceHttps("https://rdztilegroup.com")).toBe("https://rdztilegroup.com/");
    expect(enlaceHttps("http://rdztilegroup.com")).toBeNull();
    expect(enlaceHttps("javascript:alert(1)")).toBeNull();
    expect(enlaceHttps("no es url")).toBeNull();
  });
});
