import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { horasCortas } from "@/components/PanelDeChoferes";

// D-1208: Gestor de Rutas, vista compacta (solicitud de ayuda del dueño, 27 nov, y sus notas sobre la maqueta).
const pagina = readFileSync("src/app/(app)/routes/page.tsx", "utf8").split("
").join("
");
const panel = readFileSync("src/components/PanelDeChoferes.tsx", "utf8").split("
").join("
");

describe("Gestor compacto (D-1208)", () => {
  it("la hora del chofer va como 4:36", () => {
    expect(horasCortas(276)).toBe("4:36");
    expect(horasCortas(5)).toBe("0:05");
    expect(horasCortas(-3)).toBe("0:00");
  });
  it("en la compacta el selector de vista ocupa el lugar del título", () => {
    expect(pagina).toContain("{!soloLectura && eficiente\n          ? selectorDeVista");
    expect(pagina).toContain("{!soloLectura && !eficiente && selectorDeVista}");
  });
  it("sin «＋ Ruta» en la compacta; el chofer en 2 filas y sin barra", () => {
    expect(pagina).toContain("{!eficiente && <button className=\"btn btn-ghost btn-sm\" onClick={() => addBucket()}");
    expect(panel).not.toContain('background: over ? "var(--red)" : "var(--green)"');
    expect(panel).toContain("⏱ {horasCortas(u.info.minutes)}");
  });
  it("encabezado de la ruta: sin punto, camión solo icono, textos cortos", () => {
    expect(pagina).toContain("soloIcono={eficienteAqui}");
    expect(pagina).toContain('eficienteAqui ? "+8 h"');
    expect(pagina).toContain("eficienteAqui ? `${entregas.entregadas}/${entregas.total}`");
  });
});
