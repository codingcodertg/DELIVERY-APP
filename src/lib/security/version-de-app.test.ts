import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { versionDeApp } from "./version-de-app";
import { ESCRITORIO_MINIMO } from "@/lib/desktop-version";
import { LATEST_APK_VERSION_CODE } from "@/lib/app-update";

/** D-815: el dueño, «quiero ver que app version usan y si hace falta que actualicen». */
const CHROME = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

describe("qué app y qué versión", () => {
  it("la app de escritorio: su versión, y si va por detrás de la mínima", () => {
    expect(versionDeApp(`${CHROME} RTGHub/1.1.1`)).toMatchObject({ app: "desktop", texto: "RTG Hub 1.1.1", actualizar: true, minima: ESCRITORIO_MINIMO });
    expect(versionDeApp(`${CHROME} RTGHub/${ESCRITORIO_MINIMO}`)).toMatchObject({ app: "desktop", actualizar: false, minima: null });
  });
  it("la app Android del Time Tracker: su versionCode, y si va por detrás de la última", () => {
    expect(versionDeApp(`Mozilla/5.0 (Linux; Android 13) Chrome/120 Mobile RDZDeliveries/${LATEST_APK_VERSION_CODE - 1}`)).toMatchObject({ app: "android", actualizar: true, minima: `v${LATEST_APK_VERSION_CODE}` });
    expect(versionDeApp(`Mozilla/5.0 (Linux; Android 13) RDZDeliveries/${LATEST_APK_VERSION_CODE}`)).toMatchObject({ app: "android", texto: `Time Tracker v${LATEST_APK_VERSION_CODE}`, actualizar: false });
  });
  it("un navegador: cuál y su versión mayor; nunca «actualizar»", () => {
    expect(versionDeApp(CHROME)).toEqual({ app: "browser", texto: "Chrome 130", version: "130", actualizar: false, minima: null });
    expect(versionDeApp(`${CHROME} Edg/130.0.0.0`).texto).toBe("Edge 130");
    expect(versionDeApp("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1").texto).toBe("Safari 17");
    expect(versionDeApp(null)).toMatchObject({ app: "browser", actualizar: false });
  });
  it("el panel enseña la columna en las dos tablas, el aviso de los que van viejos y el filtro «Por actualizar»", () => {
    const panel = readFileSync("src/app/security/PanelDeSeguridad.tsx", "utf8");
    expect(panel.match(/<Version ua=/g)?.length).toBeGreaterThanOrEqual(3);
    expect(panel).toContain(`data-bloque="por-actualizar"`);
    expect(panel).toContain(`"actualizar"] as const`);
  });
});
