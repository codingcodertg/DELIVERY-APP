import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { RECARGA_AL_VOLVER_MS } from "./data-provider";

/**
 * D-805: al volver a la app se recarga todo (una vez cada 20 s como mucho). Roberto: el chofer «skipped the Edinburg
 * stop because it didn't show on the app and he had to refresh it».
 */
const p = readFileSync(join(process.cwd(), "src/lib/data-provider.tsx"), "utf8").replace(/\r\n/g, "\n");

describe("recarga al volver a la app", () => {
  it("escucha online, focus y visibilitychange, ignora el irse, y recarga por reloadAllRef con freno", () => {
    const i = p.indexOf("const alVolver = () => {");
    expect(i).toBeGreaterThan(0);
    const efecto = p.slice(i, p.indexOf("}, []);", i));
    expect(efecto).toContain('if (document.visibilityState === "hidden") return;');
    expect(efecto).toContain("if (ahora - ultimaRecargaAlVolver.current < RECARGA_AL_VOLVER_MS) return;");
    expect(efecto).toContain("void reloadAllRef.current?.();");
    for (const ev of ['window.addEventListener("online", alVolver);', 'window.addEventListener("focus", alVolver);', 'document.addEventListener("visibilitychange", alVolver);']) expect(efecto).toContain(ev);
    expect(RECARGA_AL_VOLVER_MS).toBe(20_000);
  });
});
