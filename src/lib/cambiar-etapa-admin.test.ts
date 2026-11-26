import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  accionesDeEtapaParaAdmin, escrituraCambiarEtapaAdmin, preguntaCambiarEtapaAdmin, puedeCambiarEtapaAqui,
} from "./cambiar-etapa-admin";
import type { Delivery } from "./types";

const leer = (r: string) => readFileSync(join(process.cwd(), r), "utf8").split("\r\n").join("\n");
const t = (en: string) => en;
const ADMIN = { id: "a", role: "admin", full_name: "Ana Admin" };
const pedido = { id: "d1", order_no: 1, stage: "approved", assigned_driver: "Diego Driver", est_pallets: 3, actual_pallets: null } as unknown as Delivery;

describe("«Cambiar etapa» del Gestor de rutas: solo admin", () => {
  it("el interruptor y sus acciones son solo para admin", () => {
    expect(puedeCambiarEtapaAqui("admin")).toBe(true);
    for (const r of ["driver", "warehouse", "manager", "logistics", "sales", "accounting", null, undefined]) {
      expect(puedeCambiarEtapaAqui(r), String(r)).toBe(false);
    }
  });

  it("«Recogido» desde aprobada, preparando o lista; «Entregado» desde esas y desde en reparto", () => {
    expect(accionesDeEtapaParaAdmin("approved")).toEqual(["recoger", "entregar"]);
    expect(accionesDeEtapaParaAdmin("fulfilling")).toEqual(["recoger", "entregar"]);
    expect(accionesDeEtapaParaAdmin("ready")).toEqual(["recoger", "entregar"]);
    expect(accionesDeEtapaParaAdmin("picked_up")).toEqual(["entregar"]);
  });

  it("entregada, anulada, borrador, pendiente o rechazada: ninguna acción, solo la insignia", () => {
    for (const s of ["delivered", "canceled", "draft", "pending", "rejected"]) {
      expect(accionesDeEtapaParaAdmin(s), s).toEqual([]);
    }
  });

  it("la pregunta nombra la factura y la etapa nueva, y dice que queda como cambio de admin desde el Gestor", () => {
    const r = preguntaCambiarEtapaAdmin("recoger", "INV-9", t);
    expect(r.mensaje).toContain("INV-9");
    expect(r.mensaje).toContain("as picked up");
    expect(r.mensaje).toContain("changed by the admin from the Route Manager");
    expect(r.confirmar).toBe("Picked up");
    expect(preguntaCambiarEtapaAdmin("entregar", "INV-9", t).mensaje).toContain("as delivered");
  });

  it("recoger escribe picked_up con la nota de la recogida y la marca de admin; sin GPS, con la hora", () => {
    const e = escrituraCambiarEtapaAdmin({ accion: "recoger", pedido, me: ADMIN, t });
    expect(e.stage).toBe("picked_up");
    expect(e.note).toMatch(/^Loaded: 3 pallets · Changed by the admin from the Route Manager$/);
    expect(e.extra).toMatchObject({ actual_pallets: 3 });
    expect(e.extra).toHaveProperty("pickup_gps_at");
    expect(e.extra).not.toHaveProperty("pickup_lat");
    // Sin asignar el admin no se queda con la orden (solo el chofer se reclama).
    expect(e.extra).not.toHaveProperty("assigned_driver");
  });

  it("entregar escribe delivered con la marca de admin y sin prueba de entrega", () => {
    const e = escrituraCambiarEtapaAdmin({ accion: "entregar", pedido, me: ADMIN, t });
    expect(e).toEqual({ stage: "delivered", note: "Delivered · Changed by the admin from the Route Manager", extra: {} });
  });

  it("la página: el interruptor solo para admin y la celda de etapa lo consulta con el mismo setStage", () => {
    const pagina = leer("src/app/(app)/routes/page.tsx");
    expect(pagina).toContain("const [cambiarEtapa, setCambiarEtapa] = useState(false);");
    expect(pagina).toContain("puedeCambiarEtapaAqui(me?.role) && (");
    expect(pagina).toContain('data-cambiar-etapa-accion={a}');
    expect(pagina).toContain("if (await setStage(d.id, e.stage, e.note, e.extra)) notify(");
    expect(pagina).toContain("if (accion !== \"entregar\" && !(await confirmAction(mensaje, { confirmLabel: confirmar }))) return;");
  });
});
