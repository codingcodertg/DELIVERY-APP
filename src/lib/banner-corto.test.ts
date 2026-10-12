import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

// D-483. El dueño, 2026-10-06: «lo único que salga ahí es, ok, estás login como Robert y ya. Pero no quiero ese timeout y
// esa cosa porque quita mucho espacio».
const banner = readFileSync("src/components/ImpersonationBanner.tsx", "utf8");

describe("el aviso de «Estás como…» es una línea corta, sin los minutos (D-483)", () => {
  it("dice solo con quién estás", () => {
    // D-NEXT: en el idioma del admin, no en español fijo (el render en los dos idiomas está en
    // `aviso-de-suplantacion.test.ts`). Sigue siendo UN idioma a la vez: nada del texto doble de antes de D-483.
    expect(banner).toContain('{t("👤 Signed in as", "👤 Estás como")} {p.como}');
    expect(banner).not.toContain("You are signed in as");
  });
  it("no pinta los minutos que quedan", () => {
    expect(banner).not.toMatch(/\{quedan\} min/);
    expect(banner).not.toContain("setQuedan");
  });
  it("la vuelta automática a la hora sigue: la red de seguridad no se quita", () => {
    expect(banner).toContain("IMPERSONACION_MINUTOS * 60_000 - Date.now()");
    expect(banner).toContain('if (restan <= 0 && !volviendo) void volver("expired");');
  });
  it("los dos botones siguen, más cortos", () => {
    expect(banner).toContain("↩ Volver a mi cuenta");
    expect(banner).toContain("⇄ Cambiar usuario");
  });
});
