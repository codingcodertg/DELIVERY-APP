import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { estiloDeParada, FONDO_DE_PARADA } from "./colores-de-mi-ruta";

// D-535 · «pickup in driver view should be 1 color and deliveries another like light green and delivery light blue».

describe("colores de Mi ruta", () => {
  // Nota D-547: decía «recogida verde claro, entrega azul claro». El dueño, 2026-10-14: «pickups change to color blue and
  // deliveries to the orgiinal clear color». La recogida, azul claro; la entrega, sin fondo propio (la fila de siempre).
  it("D-547: recogida azul claro, entrega sin fondo; la siguiente con borde de acento, no con otro fondo", () => {
    expect(FONDO_DE_PARADA).toEqual({ P: "var(--accent-soft)", D: undefined });
    expect(estiloDeParada("P", false)).toEqual({ background: "var(--accent-soft)" });
    expect(estiloDeParada("D", false)).toEqual({});
    expect(estiloDeParada("P", true)).toEqual({ background: "var(--accent-soft)", boxShadow: "inset 0 0 0 2px var(--accent)" });
    expect(estiloDeParada("D", true)).toEqual({ boxShadow: "inset 0 0 0 2px var(--accent)" });
  });
  it("los dos tokens existen en el CSS, también en oscuro", () => {
    const css = readFileSync("src/app/globals.css", "utf8");
    expect((css.match(/--green-soft:/g) ?? []).length).toBeGreaterThanOrEqual(2);
    expect((css.match(/--accent-soft:/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });
  it("Mi ruta los usa en las filas de recogida, en las de entrega y en la tarjeta de Siguiente parada", () => {
    const src = readFileSync("src/app/(app)/my-route/page.tsx", "utf8").split("\r\n").join("\n");
    expect(src).toContain('data-fila-de-ruta={fi} data-tipo-de-fila={f.tipo}');
    expect(src).toContain('...estiloDeParada(f.tipo, f.tipo === "P" && f.ordenes.some((id) => esLaSiguiente(id, "P")))');
    expect(src).toContain('style={{ alignItems: "flex-start", ...estiloDeParada("D", isNext) }}');
    expect(src).toContain("background: FONDO_DE_PARADA[tipoDeLaSiguiente]");
    expect(src).not.toContain('background: isNext ? "var(--accent-soft)" : undefined');
  });
});
