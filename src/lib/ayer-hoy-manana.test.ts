import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { paradasDelChofer } from "./ordenes-del-dia";
import { shiftDateISO } from "./utils";

// D-469. El dueño, 2026-10-04: «que los conductores puedan ver ayer, hoy y mañana… en donde salen mis rutas… Al igual que
// en el mapa… pueden ver las rutas de ayer, hoy y mañana todas las personas».
const leer = (p: string) => readFileSync(join(process.cwd(), p), "utf8").replace(/\r\n/g, "\n");

describe("ayer, hoy y mañana (D-469)", () => {
  it("las paradas del chofer salen del día que se le pide, no siempre de hoy", () => {
    const hoy = "2026-07-15";
    const o = (id: string, f: string) => ({ id, assigned_driver: "Ana", stage: "ready", delivery_date: f });
    const todas = [o("ayer", shiftDateISO(hoy, -1)), o("hoy", hoy), o("man", shiftDateISO(hoy, 1))];
    const ids = (f: string) => paradasDelChofer(todas as never, "Ana", f, "dia").map((d) => d.id);
    expect(ids(shiftDateISO(hoy, -1))).toEqual(["ayer"]);
    expect(ids(hoy)).toEqual(["hoy"]);
    expect(ids(shiftDateISO(hoy, 1))).toEqual(["man"]);
  });
  it("«Mi ruta» tiene los tres botones y pide las paradas y el plan del día elegido", () => {
    const p = leer("src/app/(app)/my-route/page.tsx");
    expect(p).toContain("const dia = shiftDateISO(todayISO(), desfase);");
    expect(p).toContain('paradasDelChofer(deliveries, driverName, dia, verAtrasadas ? "atrasadas" : "dia")');
    expect(p).toContain("usePlanPublicadoDelChofer(dia)");
    expect(p).toContain('[[-1, t("Yesterday", "Ayer")], [0, t("Today", "Hoy")], [1, t("Tomorrow", "Mañana")]]');
  });
  it("«Ruta de hoy» tiene los tres botones, para cualquier rol", () => {
    const m = leer("src/app/(app)/map/page.tsx");
    expect(m).toContain("data-ayer-hoy-manana");
    expect(m).toContain("const f = shiftDateISO(todayISO(), d);");
  });
});
