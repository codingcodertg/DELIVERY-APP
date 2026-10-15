import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { ETAPAS_QUE_REPROGRAMA_ALMACEN, fechaPropuesta, notaDeReprogramacion, puedeReprogramar, reprogramacionValida } from "./reprogramar-orden";

describe("«📅 Reprogramar» en el Gestor (D-500)", () => {
  it("quién puede: logística, gerente y oficina en las etapas abiertas; admin también en camino; nadie en entregada o anulada", () => {
    for (const rol of ["logistics", "manager", "accounting"]) {
      for (const etapa of ["draft", "pending", "approved", "fulfilling", "ready"]) expect([rol, etapa, puedeReprogramar(rol, etapa)]).toEqual([rol, etapa, true]);
      expect(puedeReprogramar(rol, "picked_up")).toBe(false);
    }
    expect(puedeReprogramar("admin", "picked_up")).toBe(true);
    for (const rol of ["admin", "logistics"]) {
      expect(puedeReprogramar(rol, "delivered")).toBe(false);
      expect(puedeReprogramar(rol, "canceled")).toBe(false);
    }
    // Nota D-549: ventas reprograma SU orden (tercer argumento, `esSuya`); sin decir que es suya, sigue en no.
    expect(puedeReprogramar("sales", "approved")).toBe(false);
    expect(puedeReprogramar("sales", "approved", true)).toBe(true);
    expect(puedeReprogramar("driver", "ready")).toBe(false);
    expect(puedeReprogramar("driver", "ready", true)).toBe(false);
    expect(puedeReprogramar("logistics", null)).toBe(false);
  });
  // D-534 · «warehouse as an option to rescheduled and or change delivery dates» (el dueño, 2026-10-12).
  it("D-534: almacén reprograma en aprobada, preparando y lista (su cola, donde el guard le deja escribir); no en las demás", () => {
    for (const etapa of ["approved", "fulfilling", "ready"]) expect([etapa, puedeReprogramar("warehouse", etapa)]).toEqual([etapa, true]);
    for (const etapa of ["draft", "pending", "rejected", "picked_up", "delivered", "canceled"]) expect([etapa, puedeReprogramar("warehouse", etapa)]).toEqual([etapa, false]);
    expect(ETAPAS_QUE_REPROGRAMA_ALMACEN).toEqual(["approved", "fulfilling", "ready"]);
    // Y la base se lo permite: la rama de almacén del guard deja la misma etapa en esas tres.
    const guard = readFileSync("supabase/migrations/169_fotos_del_chofer.sql", "utf8");
    expect(guard).toContain("if r = 'warehouse'  and old_stage in ('approved','fulfilling','ready','picked_up','delivered') then return NEW; end if;");
  });
  it("D-534: Almacén monta el MISMO cuadro del Gestor en la Cola, en Recepción y en la Ruta del día, sin abrir la ficha", () => {
    const wh = readFileSync("src/app/(app)/warehouse/page.tsx", "utf8").split("\r\n").join("\n");
    expect(wh).toContain('import { ReprogramarOrden } from "@/components/ReprogramarOrden";');
    expect(wh).toContain("const reprogramar = (d: Delivery) => puedeReprogramar(me?.role, d.stage)");
    // Nota D-549: el cuadro ya no recibe `updateDelivery`/`addNote` sino `reprogramarOrden` (la función de la base 173, con
    // el camino de antes como respaldo).
    expect(wh).toContain("<ReprogramarOrden pedido={d} lang={lang} t={t} reprogramarOrden={reprogramarOrden} notify={notify} />");
    expect(wh.split("accionDeFila={reprogramar}").length - 1).toBe(1);
    expect(wh).toContain("const repro = reprogramar(d);");
    expect(wh).toContain("<td onClick={(e) => e.stopPropagation()}>{reprogramar(d)}</td>");
  });

  it("la fecha que propone: el día siguiente al más tarde entre hoy y la que tiene", () => {
    expect(fechaPropuesta("2026-10-05", "2026-10-08")).toBe("2026-10-09");
    expect(fechaPropuesta("2026-10-12", "2026-10-08")).toBe("2026-10-13");
    expect(fechaPropuesta(null, "2026-10-08")).toBe("2026-10-09");
  });

  it("se guarda con fecha válida, no antes de hoy, distinta de la actual y con nota", () => {
    expect(reprogramacionValida("2026-10-09", "2026-10-08", "2026-10-08", "cliente no está")).toBe(true);
    expect(reprogramacionValida("2026-10-07", "2026-10-05", "2026-10-08", "cliente no está")).toBe(false);
    expect(reprogramacionValida("2026-10-08", "2026-10-08", "2026-10-08", "cliente no está")).toBe(false);
    expect(reprogramacionValida("2026-10-09", "2026-10-08", "2026-10-08", " x ")).toBe(false);
    expect(reprogramacionValida("", "2026-10-08", "2026-10-08", "cliente no está")).toBe(false);
    expect(reprogramacionValida("2026-10-08", null, "2026-10-08", "sin fecha antes")).toBe(true);
  });

  it("la nota del historial dice de dónde a dónde y por qué", () => {
    expect(notaDeReprogramacion("2026-10-08", "2026-10-09", "  cliente   no está ", "es")).toBe("Reprogramada de 2026-10-08 a 2026-10-09: cliente no está");
    expect(notaDeReprogramacion(null, "2026-10-09", "site closed", "en")).toBe("Rescheduled from no date to 2026-10-09: site closed");
  });

  it("la tabla del Gestor lleva el botón en las filas que se pueden reprogramar, y no en solo lectura", () => {
    const pagina = readFileSync("src/app/(app)/routes/page.tsx", "utf8");
    expect(pagina).toContain("{!hecha && !soloLectura && puedeReprogramar(me?.role, d.stage) && (");
    expect(pagina).toContain("<ReprogramarOrden pedido={d}");
  });
});
