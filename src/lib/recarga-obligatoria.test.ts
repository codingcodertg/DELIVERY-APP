import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { recargaObligatoria } from "./app-update";
import { APP_VERSIONS, RECARGA_OBLIGATORIA } from "./app-versions";

/** D-836: el dueño, tras D-835: «haz que ellos tengan que reiniciar el app o mándales un refresh para que tome efecto». */
const leer = (r: string) => readFileSync(r, "utf8").split("\r\n").join("\n");

describe("recarga obligatoria", () => {
  it("compara número a número; sin mínima, nunca", () => {
    expect(recargaObligatoria("1.523.0", "1.524.0")).toBe(true);
    expect(recargaObligatoria("1.524.0", "1.524.0")).toBe(false);
    expect(recargaObligatoria("1.99.0", "1.100.0")).toBe(true);
    expect(recargaObligatoria("1.523.0", undefined)).toBe(false);
  });
  it("la versión publicada nunca está por debajo de su propia mínima (no se recarga en bucle)", () => {
    for (const [app, min] of Object.entries(RECARGA_OBLIGATORIA)) expect(recargaObligatoria(APP_VERSIONS[app as keyof typeof APP_VERSIONS], min)).toBe(false);
  });
  it("el servidor la anuncia, el aviso recarga ya (con 3 min de espera si hay algo abierto) y el teléfono dice su versión", () => {
    expect(leer("src/app/api/version/route.ts")).toContain("obligatoria: RECARGA_OBLIGATORIA");
    const b = leer("src/components/AppUpdateBanner.tsx");
    expect(b).toContain("recargaObligatoria(APP_VERSIONS[app], info.obligatoria?.[app])");
    expect(b).toContain("Date.now() - desde < ESPERA_MAXIMA_OBLIGATORIA_MS");
    expect(leer("src/lib/data-provider.tsx")).toContain("app: `${appActual()} · web ${APP_VERSIONS.deliveries}`");
    expect(leer("src/app/(app)/track/page.tsx")).toContain("data-version-app");
  });
});
