import { describe, expect, it } from "vitest";
import { ENLACE_DE_LA_ENCUESTA, ENLACE_VIEJO_DE_LA_ENCUESTA, enlaceDeTienda } from "./qr";

/** La encuesta vive en el dominio propio (D-777): ningún enlace nuevo dice «vercel». */

describe("el enlace de la encuesta", () => {
  it("es el dominio propio, con https y sin barra final", () => {
    expect(ENLACE_DE_LA_ENCUESTA).toBe("https://survey.rdztilegroup.com");
  });
  it("los enlaces por tienda salen del dominio propio y no mencionan vercel", () => {
    const e = enlaceDeTienda("RDZ Mission");
    expect(e).toBe("https://survey.rdztilegroup.com/?tienda=RDZ%20Mission");
    expect(e).not.toContain("vercel");
    expect(enlaceDeTienda(null)).toBe(ENLACE_DE_LA_ENCUESTA);
  });
  it("la dirección vieja queda documentada: el QR general impreso sigue apuntando a ella", () => {
    expect(ENLACE_VIEJO_DE_LA_ENCUESTA).toBe("https://rtg-encuesta.vercel.app");
  });
});
