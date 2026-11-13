import { describe, expect, it } from "vitest";
import {
  ORDEN_INICIAL, PREFS_INICIALES, alternaColumna, columnasVisibles, fmtDiaCorto, mueveColumna, normalizaPrefs,
  ocultasPorDefecto, ordenPropio, prefsAlAbrir, prefsIniciales, sueltaColumna, tramosDeCabecera,
} from "./columnas-de-merma";

describe("columnas de la tabla de merma a gusto", () => {
  it("por defecto: todas menos «Tipo» y «Tienda» (12 nov), en el orden de siempre, con un solo tramo «Cantidades»", () => {
    const v = columnasVisibles(PREFS_INICIALES);
    expect(v.map((c) => c.key)).toEqual(ORDEN_INICIAL.filter((k) => k !== "tipo" && k !== "tienda"));
    expect(ORDEN_INICIAL).toContain("tipo"); // siguen en ⚙ Columnas
    expect(ORDEN_INICIAL).toContain("tienda");
    const tramos = tramosDeCabecera(v);
    expect(tramos.filter((t) => t.tipo === "cantidades")).toHaveLength(1);
    expect(ordenPropio(PREFS_INICIALES)).toBe(false);
  });
  it("12 nov: en el teléfono de almacén se ocultan además «Grupo» y «Fecha del daño»; quitarlas todas no es «orden propio» ahí", () => {
    expect(ocultasPorDefecto()).toEqual(["tipo", "tienda"]);
    expect(ocultasPorDefecto({ telefonoDeAlmacen: true })).toEqual(["tipo", "tienda", "grupo", "fecha"]);
    const tel = prefsIniciales({ telefonoDeAlmacen: true });
    expect(columnasVisibles(tel).map((c) => c.key)).not.toContain("grupo");
    expect(columnasVisibles(tel).map((c) => c.key)).not.toContain("fecha");
    expect(ordenPropio(tel, ocultasPorDefecto({ telefonoDeAlmacen: true }))).toBe(false);
    expect(ordenPropio(tel)).toBe(true); // contra lo de fábrica del escritorio sí es distinto
    expect(ordenPropio({ ...PREFS_INICIALES, ocultas: [] })).toBe(true); // enseñar «Tipo» ya es una elección propia
  });
  it("12 nov: al abrir manda lo guardado nuevo; si solo hay lo viejo, conserva su orden y suma lo oculto de ahora", () => {
    const nuevo = { orden: ["etapa", "reportada"], ocultas: [] };
    expect(prefsAlAbrir(nuevo, null).ocultas).toEqual([]); // eligió verlas todas: se respeta
    expect(prefsAlAbrir(nuevo, null).orden.slice(0, 2)).toEqual(["etapa", "reportada"]);
    const viejo = { orden: ["codigo", "reportada"], ocultas: ["comentarios"] };
    const p = prefsAlAbrir(null, viejo);
    expect(p.orden.slice(0, 2)).toEqual(["codigo", "reportada"]);
    expect(p.ocultas.sort()).toEqual(["comentarios", "tienda", "tipo"]);
    expect(prefsAlAbrir(null, null)).toEqual(PREFS_INICIALES);
    expect(prefsAlAbrir("basura", 7, { telefonoDeAlmacen: true }).ocultas).toEqual(["tipo", "tienda", "grupo", "fecha"]);
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
