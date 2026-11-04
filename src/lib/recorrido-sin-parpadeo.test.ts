import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

/** D-837: el dueño, viendo a Maximo en el Recorrido: «se ve súper, pero no deja de flicker cada segundo». */
const leer = (r: string) => readFileSync(r, "utf8").split("\r\n").join("\n");

describe("el Recorrido no parpadea con las posiciones en vivo", () => {
  const g = leer("src/components/GoogleMapView.tsx");
  it("las líneas se alargan (setPath) y los camiones se mueven (setPosition); los pines iguales no se repintan", () => {
    expect(g).toContain("previa.poly.setPath(offsetPath(line.positions, off));");
    expect(g).toContain("it.marker.setPosition(pos);");
    expect(g).toContain("if (sig === pointsSigRef.current && markersRef.current.length) return;");
  });
  it("el mapa se encuadra al cambiar de chofer o de día, no con cada punto; los pines van en una lista estable", () => {
    const p = leer("src/app/(app)/track/page.tsx");
    expect(p).toContain("fitTo={encuadre}");
    expect(p).toContain("points={puntosDelMapa}");
    expect(p).toContain("if (!pts.length || ultimoEncuadreRef.current === clave) return;");
  });
});
