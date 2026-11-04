import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { filasDeIngesta, firmaLlaveDeGps, HORAS_DE_LA_LLAVE, verificaLlaveDeGps } from "./gps-token";

/**
 * D-838 (APK 7): Android sube las posiciones solo. Medido el 2026-11-04: con el teléfono bloqueado llegaban con una mediana
 * de 23 minutos de retraso, porque las subía la página y Android la congela.
 */
const leer = (r: string) => readFileSync(r, "utf8").split("\r\n").join("\n");
const CLAVE = "secreto-de-prueba";
const T0 = Date.parse("2026-11-04T16:00:00Z");

describe("la llave del turno", () => {
  it("dice el chofer mientras vale; caducada, alterada o con otra clave, no", () => {
    const { token, expira } = firmaLlaveDeGps("chofer-1", T0, CLAVE);
    expect(expira).toBe(T0 + HORAS_DE_LA_LLAVE * 3_600_000);
    expect(verificaLlaveDeGps(token, T0 + 3_600_000, CLAVE)).toBe("chofer-1");
    expect(verificaLlaveDeGps(token, expira + 1, CLAVE)).toBeNull();
    expect(verificaLlaveDeGps(token, T0, "otra-clave")).toBeNull();
    const [p, s] = token.split(".");
    const otro = Buffer.from(JSON.stringify({ d: "chofer-2", e: expira })).toString("base64url");
    expect(verificaLlaveDeGps(`${otro}.${s}`, T0, CLAVE)).toBeNull();
    expect(verificaLlaveDeGps(`${p}.`, T0, CLAVE)).toBeNull();
    expect(verificaLlaveDeGps(null, T0, CLAVE)).toBeNull();
  });
});

describe("lo que se acepta de la app", () => {
  const fix = (o: Record<string, unknown> = {}) => ({ lat: 26.2, lng: -98.2, accuracy_m: 6, speed_mps: 10, heading: 90, battery_pct: 77, recorded_at: new Date(T0 - 60_000).toISOString(), ...o });
  it("guarda las buenas con el chofer de la llave, nunca el que diga el cuerpo", () => {
    const filas = filasDeIngesta("chofer-1", { fixes: [fix({ driver_id: "intruso" })] }, T0);
    expect(filas).toHaveLength(1);
    expect(filas[0].driver_id).toBe("chofer-1");
    expect(filas[0].battery_pct).toBe(77);
  });
  it("tira coordenadas imposibles, más de 65 m de error, horas del futuro o de hace más de 3 días", () => {
    const malas = [fix({ lat: 95 }), fix({ lat: 0, lng: 0 }), fix({ accuracy_m: 93 }), fix({ recorded_at: new Date(T0 + 3_600_000).toISOString() }),
      fix({ recorded_at: new Date(T0 - 4 * 86_400_000).toISOString() }), fix({ recorded_at: "ayer" }), { lat: "26" }];
    expect(filasDeIngesta("c", { fixes: malas }, T0)).toEqual([]);
    expect(filasDeIngesta("c", { nada: 1 }, T0)).toEqual([]);
  });
  it("como mucho 500 por envío", () => {
    expect(filasDeIngesta("c", { fixes: Array.from({ length: 600 }, () => fix()) }, T0)).toHaveLength(500);
  });
});

describe("cableado", () => {
  it("el servidor: la llave solo para choferes; la ingesta con la llave, con la llave de servicio, y 5xx (nunca 400) si falla lo nuestro", () => {
    const tok = leer("src/app/api/gps/token/route.ts");
    expect(tok).toContain('if (perfil?.role !== "driver")');
    const ing = leer("src/app/api/gps/ingest/route.ts");
    expect(ing).toContain("verificaLlaveDeGps(");
    expect(ing).toContain('createAdminClient().from("driver_locations").insert(filas)');
    expect(ing).toContain("status: 503");
  });
  it("la página usa la subida de Android si la APK la tiene, y entonces no sube nada ella", () => {
    const h = leer("src/lib/useLiveLocation.ts");
    expect(h).toContain("if (directUploadAvailable()) {");
    expect(h).toContain("/api/gps/ingest");
    expect(h).toContain("if (directRef.current) { setLastAt(new Date().toISOString()); return; }");
  });
  it("Android: sube él mismo, cada 5 s / 10 m, sin puntos de más de 65 m, con cola guardada", () => {
    const j = leer("mobile/android/app/src/main/java/net/rdztilegroup/deliveries/BatteryGuardPlugin.java");
    expect(j).toContain("public void startDirectUpload(PluginCall call)");
    expect(j).toContain("if (loc.hasAccuracy() && loc.getAccuracy() > 65f) return;");
    expect(j).toContain("loc.distanceTo(ultimoEnviado) >= 10f");
    const e = leer("mobile/android/app/src/main/java/net/rdztilegroup/deliveries/EnvioDeGps.java");
    expect(e).toContain('c.setRequestProperty("Authorization", "Bearer " + token);');
    expect(e).toContain("private static final int MAX = 2000;");
  });
});
