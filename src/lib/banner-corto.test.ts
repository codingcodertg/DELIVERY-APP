import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

// D-483. El dueño, 2026-10-06: «lo único que salga ahí es, ok, estás login como Robert y ya. Pero no quiero ese timeout y
// esa cosa porque quita mucho espacio».
//
// D-NEXT (2026-11-04) va más lejos: ni franja. El aviso es la burbuja naranja («Estás como Robert») y la vuelta, el
// botón rojo de encima. Lo que D-483 pedía sigue: una frase corta, sin los minutos, y la vuelta sola a la hora intacta.
const lib = readFileSync("src/lib/suplantacion-en-burbuja.ts", "utf8");
const sup = readFileSync("src/components/SuplantacionEnBurbuja.tsx", "utf8");

describe("el aviso de «Estás como…» es corto, sin los minutos (D-483, en la burbuja desde D-NEXT)", () => {
  it("dice solo con quién estás, en el idioma del admin (D-516)", () => {
    expect(lib).toContain("etiqueta: t(`You're viewing as ${a.como}`, `Estás como ${a.como}`),");
    expect(lib).not.toContain("You are signed in as");
  });
  it("no pinta los minutos que quedan", () => {
    for (const f of [lib, sup]) {
      expect(f).not.toMatch(/\{quedan\} min/);
      expect(f).not.toContain("setQuedan");
    }
  });
  it("la vuelta automática a la hora sigue: la red de seguridad no se quita", () => {
    expect(lib).toContain("return s !== null && impersonacionCaducada(s.inicio, ahora);");
    expect(sup).toContain('if (!volviendo && tocaVolverSolo(estado, Date.now())) void volver("expired");');
    expect(sup).toContain("const id = setInterval(tic, 30_000);");
  });
  it("los dos botones siguen: volver (el rojo) y cambiar usuario (en el menú de la burbuja)", () => {
    expect(lib).toContain('t("↩ Back to my user", "↩ Volver a mi usuario")');
    expect(readFileSync("src/components/BotonGeneral.tsx", "utf8")).toContain('tAdmin("Switch user", "Cambiar usuario")');
  });
});
