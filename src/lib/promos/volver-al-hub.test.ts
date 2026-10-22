import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// D-378: al quitar la lista de rondas (D-375) se fue el único enlace de vuelta, y el dueño lo notó
// el mismo día. Desde D-NEXT la vuelta es la casa de la barra de todas las apps (`BarraSencilla`), que
// monta el layout del módulo: vale para la ronda —demo y base— y para la pantalla sin rondas.
const leer = (r: string) => readFileSync(r, "utf8").split("\r\n").join("\n");
const layout = leer("src/app/promos/layout.tsx");
const ronda = leer("src/app/promos/[id]/page.tsx");

describe("la ronda de promos tiene cómo volver al hub", () => {
  it("la barra con la casa está en el layout, en el demo y en la de verdad", () => {
    expect(layout).toContain('import { BarraSencilla } from "@/components/BarraDeApp";');
    expect(layout.match(/<BarraSencilla /g) ?? []).toHaveLength(2);
    expect(layout.indexOf("if (LOCAL_MODE) return <><BarraSencilla ")).toBeGreaterThan(-1);
  });

  it("y la ronda ya no pinta su propio «Volver al hub»: la casa es una sola", () => {
    expect(ronda).not.toContain("VolverAlHub");
    expect(ronda).not.toContain('href="/home"');
  });
});
