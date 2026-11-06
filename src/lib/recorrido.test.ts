import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { MANAGER_TABS } from "./timetracker/constants";

/** D-832: la pestaña «Recorrido» y lo que enseña: turno, cargas y entregas, reproducción, 20 000 posiciones por día. */
const leer = (r: string) => readFileSync(r, "utf8").split("\r\n").join("\n");

describe("D-832: recorrido del chofer", () => {
  const pagina = leer("src/app/(app)/track/page.tsx");
  it("lee hasta 20 000 posiciones por día (a 10 m / 5 s un día largo son ~6 000)", () => {
    // D-909: el tope vive en `recorrido-del-telefono` y es POR CHOFER, leído de 1.000 en 1.000. El `.limit()` de una
    // sola petición que había aquí no servía: PostgREST corta en 1.000 filas y la línea se acababa a media mañana.
    expect(leer("src/lib/recorrido-del-telefono.ts")).toContain("export const FIXES_POR_DIA = 20_000;");
    expect(pagina).toContain("leeRecorridoDelTelefono(supabase, idsDelDia, fecha)");
    expect(pagina).not.toContain(".limit(FIXES_POR_DIA");
    expect(leer("src/lib/useRecorridoDelDia.ts")).not.toContain(".limit(FIXES_POR_DIA");
    expect(pagina).not.toContain(".limit(5000)");
  });
  it("los días con recorrido salen de los turnos, no de las posiciones", () => {
    expect(pagina).toContain('.from("driver_shifts")');
    expect(pagina).not.toContain('.select("recorded_at")');
  });
  it("enseña el turno del día, las cargas y entregas marcadas, y reproduce el recorrido", () => {
    expect(pagina).toContain('data-bloque="turnos"');
    expect(pagina).toContain('data-bloque="hitos"');
    expect(pagina).toContain('.in("kind", ["picked_up", "delivered"])');
    expect(pagina).toContain('data-accion="reproducir"');
    expect(pagina).toContain("liveDrivers={camiones}"); // D-833
  });
  it("D-833: como el Route Manager: tarjetas por chofer, todos los recorridos en el mapa, camiones en vivo, pulsar para ver uno", () => {
    expect(pagina).toContain("const TODOS = \"todos\";");
    expect(pagina).toContain("useState<string>(TODOS)");
    expect(pagina).toContain('data-bloque="choferes"');
    expect(pagina).toContain('.in("driver_id", idsDelDia)');
    expect(pagina).toContain("choferesEnVivo(posicionesAhora, nameById, color)"); // D-903: teléfono + rastreador del camión
    expect(pagina).toContain("onLineClick={(id) => { const chofer = id.split(\":\")[0];");
    expect(pagina).toContain("const ultima = dia.fixes[dia.fixes.length - 1];");
  });
  it("Time Tracker tiene la pestaña Recorrido para el admin, que lleva a /track", () => {
    expect(MANAGER_TABS.find((x) => x.id === "recorrido")?.href).toBe("/track");
    const i18n = leer("src/lib/timetracker/i18n.ts");
    expect(i18n).toContain("'tab.recorrido': '🛣 Driver track'");
    expect(i18n).toContain("'tab.recorrido': '🛣 Recorrido'");
  });
});
