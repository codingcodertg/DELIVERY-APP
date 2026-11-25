import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Cableado en el Gestor de Rutas (texto del código): el botón «No fue este chofer…» solo para admin y solo en las
// entregadas; Guardar hace UN updateDelivery con el parche y luego la nota; y nada de window.prompt ni window.confirm.
const pagina = readFileSync(join(process.cwd(), "src/app/(app)/routes/page.tsx"), "utf8").split("\r\n").join("\n");

const bloque = (desde: string, hasta: string) => {
  const i = pagina.indexOf(desde);
  const j = pagina.indexOf(hasta, i);
  expect(i).toBeGreaterThan(-1);
  expect(j).toBeGreaterThan(i);
  return pagina.slice(i, j);
};

describe("«No fue este chofer…» en el Gestor", () => {
  it("el botón está una sola vez, dentro del bloque que solo ve el admin en una entregada", () => {
    expect(pagina.split("data-entregada-por-otro={d.id}").length - 1).toBe(1);
    const admin = bloque('{me.role === "admin" && fp.tipo === "D" && hecho && !soloLectura && (', "data-entregada-por-otro={d.id}");
    expect(admin).toContain('<div className="acciones-de-parada" data-admin-mueve-entregada>');
    expect(admin).not.toContain("</tr>");
  });

  it("el botón abre el diálogo con la orden de esa fila", () => {
    expect(pagina).toContain("onClick={() => abreEntregadaPorOtro(d)} data-entregada-por-otro={d.id}");
    expect(pagina).toContain('👤 {t("Not this driver…", "No fue este chofer…")}</button>');
  });

  it("Guardar escribe UN updateDelivery con el parche, y después la nota", () => {
    const cuerpo = bloque("const guardaEntregadaPorOtro = async", "\n  };");
    const escrituras = cuerpo.split("await updateDelivery(").length - 1;
    expect(escrituras).toBe(1);
    expect(cuerpo).toContain("await updateDelivery(x.order.id, parcheDeEntregadaPorOtro({ quien, dia: x.dia, conRecogida: hayRecogidaGuardada, podDeLaEntrega }))");
    expect(cuerpo.indexOf("await updateDelivery(")).toBeLessThan(cuerpo.indexOf("await addNote(x.order.id, notaDeEntregadaPorOtro({ quien, dia: x.dia, anterior, podDeLaEntrega }))"));
    expect(cuerpo).not.toContain("stage");
  });

  it("con hora de entrega, el día es fijo: el campo va deshabilitado con ese día, y el parche no lleva delivery_date", () => {
    const dialogo = bloque("{entregadaPorOtro && (() => {", "{incidenciasAbiertas && (");
    expect(dialogo).toContain("disabled={diaFijo != null}");
    expect(dialogo).toContain("data-entregada-dia-fijo");
    expect(dialogo).toContain("This order has a recorded delivery time, so its day stays on ${diaFijo}.");
    expect(dialogo).toContain("Esta orden tiene hora de entrega registrada, así que su día se queda en ${diaFijo}.");
    const abre = bloque("const abreEntregadaPorOtro", "const guardaEntregadaPorOtro");
    expect(abre).toContain("podDeLaEntrega: order.pod_delivered_at");
  });

  it("el diálogo es el del Gestor (overlay + modal) y no usa window.prompt ni window.confirm", () => {
    const todo = bloque("const [entregadaPorOtro, setEntregadaPorOtro]", "const guardaEntregadaPorOtro = async");
    expect(todo).not.toContain("window.prompt");
    expect(todo).not.toContain("window.confirm");
    const guarda = bloque("const guardaEntregadaPorOtro = async", "\n  };");
    expect(guarda).not.toContain("window.prompt");
    expect(guarda).not.toContain("window.confirm");
    const dialogo = bloque("{entregadaPorOtro && (() => {", "{incidenciasAbiertas && (");
    expect(dialogo).toContain('className="overlay" data-dialogo-entregada-por-otro');
    expect(dialogo).toContain('className="modal" role="dialog"');
    expect(dialogo).toContain('<datalist id="entregada-por-otro-sugerencias">');
    expect(dialogo).toContain('type="date" max={hoy}');
  });
});
