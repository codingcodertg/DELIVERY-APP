import { describe, expect, it } from "vitest";
import {
  ORDEN_INICIAL, PREFS_INICIALES, alternaColumna, columnasVisibles, fmtDiaCorto, mueveColumna, normalizaPrefs,
  ordenPropio, sueltaColumna, tramosDeCabecera,
} from "./columnas-de-merma";

describe("columnas de la tabla de merma a gusto", () => {
  it("por defecto: todas, en el orden de siempre, con un solo tramo «Cantidades»", () => {
    const v = columnasVisibles(PREFS_INICIALES);
    expect(v.map((c) => c.key)).toEqual(ORDEN_INICIAL);
    const tramos = tramosDeCabecera(v);
    expect(tramos.filter((t) => t.tipo === "cantidades")).toHaveLength(1);
    expect(ordenPropio(PREFS_INICIALES)).toBe(false);
  });
  it("ocultar y volver a mostrar", () => {
    const p = alternaColumna(PREFS_INICIALES, "grupo");
    expect(columnasVisibles(p).some((c) => c.key === "grupo")).toBe(false);
    expect(ordenPropio(p)).toBe(true);
    expect(columnasVisibles(alternaColumna(p, "grupo")).some((c) => c.key === "grupo")).toBe(true);
  });
  it("mover con flechas y arrastrar", () => {
    const p = mueveColumna(PREFS_INICIALES, "etapa", -1);
    expect(p.orden.slice(0, 2)).toEqual(["etapa", "reportada"]);
    const q = sueltaColumna(PREFS_INICIALES, "tienda", "reportada");
    expect(q.orden[0]).toBe("tienda");
    const r = sueltaColumna(PREFS_INICIALES, "reportada", "tienda");
    expect(r.orden.indexOf("reportada")).toBe(r.orden.indexOf("tienda") + 1);
  });
  it("una columna de cantidades que sale del bloque parte el rótulo en dos tramos", () => {
    const p = sueltaColumna(PREFS_INICIALES, "costo", "reportada");
    const tramos = tramosDeCabecera(columnasVisibles(p));
    expect(tramos.filter((t) => t.tipo === "cantidades")).toHaveLength(2);
  });
  it("lo guardado con claves viejas o faltantes se limpia", () => {
    const n = normalizaPrefs({ orden: ["no-existe", "tienda"], ocultas: ["zzz", "tipo"] });
    expect(n.orden[0]).toBe("tienda");
    expect(n.orden).toHaveLength(ORDEN_INICIAL.length);
    expect(n.ocultas).toEqual(["tipo"]);
  });
});

describe("fecha del daño corta", () => {
  it("MM/DD/YY", () => {
    expect(fmtDiaCorto("2026-11-11")).toBe("11/11/26");
    expect(fmtDiaCorto("2026-01-05")).toBe("01/05/26");
    expect(fmtDiaCorto(null)).toBe("");
  });
});
