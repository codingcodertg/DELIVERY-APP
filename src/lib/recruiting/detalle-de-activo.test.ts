import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

// D-NEXT (2026-10-29) · el dueño: «apretar el número, correo, la row esa, ahí puedo ver el historial … este es el botón de
// editar, yo aquí también quiero ver los detalles de ese número y el historial». Puertas sobre la página de activos.
const pagina = readFileSync("src/app/recruiting/(recruiting)/assets/page.tsx", "utf8");

describe("el detalle de un correo o número", () => {
  it("la fila abre el detalle; la celda de botones no lo abre al pulsar un botón", () => {
    expect(pagina).toContain("data-abre-detalle onClick={() => setDetalleId(a.id)}");
    const fila = pagina.indexOf("data-abre-detalle");
    const celda = pagina.indexOf('style={{ textAlign: "right", whiteSpace: "nowrap" }} onClick={(e) => e.stopPropagation()}', fila);
    expect(celda).toBeGreaterThan(fila);
  });

  it("el detalle se lee de las filas cargadas (una acción lo refresca), lleva los botones de la fila y SU historial", () => {
    expect(pagina).toContain("const a = rows.find((x) => x.id === detalleId);");
    const d = pagina.slice(pagina.indexOf("function DetalleDeActivo("), pagina.indexOf("function EditarActivo("));
    expect(d).toContain('data-dialogo="detalle-de-activo"');
    for (const accion of ["asignar", "liberar", "respaldado", "editar-activo"]) expect(d).toContain(`data-accion="${accion}"`);
    expect(d).toContain("<HistorialDeRrhh assetId={a.id} recarga={recarga} />");
    // Borrado desde «editar», el detalle se cierra: ya no hay fila que leer.
    expect(pagina).toContain('if (ok && accion === "borrar") { setEditando(null); setDetalleId(null); }');
  });
});
