import { describe, expect, it } from "vitest";
import { claseDelAviso, cuentaPorClase, sinLeerDeLaClase } from "@/lib/clase-del-aviso";
import { avisoDeReprogramacion, notificationsForStage } from "@/lib/notifications";
import type { Profile } from "@/lib/types";

describe("claseDelAviso (D-880): cada kind conocido", () => {
  const tabla: [string, "importante" | "secundario"][] = [
    // Clientes (D-867)
    ["cliente_solicitud_nueva", "importante"],
    ["cliente_solicitud_aprobada", "importante"],
    ["cliente_solicitud_rechazada", "importante"],
    ["cliente_solicitud_revisar", "importante"],
    // Entregas: anulada, rechazada, reprogramada
    ["canceled", "importante"],
    ["rejected", "importante"],
    ["customer_rejected", "importante"],
    ["rescheduled", "importante"],
    // Todo lo demás
    ["pending", "secundario"],
    ["approved", "secundario"],
    ["ready", "secundario"],
    ["picked_up", "secundario"],
    ["delivered", "secundario"],
    ["pending_deadline_manager", "secundario"],
    ["pending_deadline_sales", "secundario"],
    ["material_added", "secundario"],
    ["picked_up_not_ready", "secundario"],
    ["assigned", "secundario"],
    ["route_published", "secundario"],
    ["assign_request", "secundario"],
    ["assign_request_approved", "secundario"],
    ["assign_request_rejected", "secundario"],
    ["tomada_por_chofer", "secundario"],
    ["ayuda_atendida", "secundario"],
    ["ayuda_respuesta", "secundario"],
    ["ayuda_mensaje", "secundario"],
    ["chat", "secundario"],
    ["algo_que_no_existe", "secundario"],
    ["", "secundario"],
  ];
  it.each(tabla)("%s → %s", (kind, clase) => expect(claseDelAviso(kind)).toBe(clase));
  it("null/undefined → secundario", () => {
    expect(claseDelAviso(null)).toBe("secundario");
    expect(claseDelAviso(undefined)).toBe("secundario");
  });
});

describe("cuentaPorClase y sinLeerDeLaClase", () => {
  const avisos = [
    { id: "1", kind: "canceled", read: false },
    { id: "2", kind: "cliente_solicitud_nueva", read: true },
    { id: "3", kind: "assigned", read: false },
    { id: "4", kind: "approved", read: false },
    { id: "5", kind: "chat", read: true },
  ];
  it("cuenta por sección; el número rojo es solo importantes sin leer", () => {
    expect(cuentaPorClase(avisos)).toEqual({ importante: { total: 2, sinLeer: 1 }, secundario: { total: 3, sinLeer: 2 } });
    expect(cuentaPorClase([])).toEqual({ importante: { total: 0, sinLeer: 0 }, secundario: { total: 0, sinLeer: 0 } });
  });
  it("marca todo leído solo de la sección", () => {
    expect(sinLeerDeLaClase(avisos, "importante")).toEqual(["1"]);
    expect(sinLeerDeLaClase(avisos, "secundario")).toEqual(["3", "4"]);
  });
});

describe("avisos nuevos de Entregas (D-880)", () => {
  const users = [
    { id: "kevin", role: "sales", full_name: "Kevin" },
    { id: "jefa", role: "manager", full_name: "Jefa" },
  ] as unknown as Profile[];

  it("anular avisa siempre al vendedor de la orden", () => {
    const seeds = notificationsForStage({ stage: "canceled", order_no: 5, order_code: "FV5", delivery_id: "d5", creatorId: "kevin", actorId: "jefa", actorRole: "manager", users, reason: "Duplicada" });
    expect(seeds).toEqual([{ user_id: "kevin", delivery_id: "d5", order_no: 5, kind: "canceled", message: "Your order #FV5 was canceled: Duplicada" }]);
  });

  it("reprogramar avisa al vendedor, no a quien reprograma", () => {
    const base = { order_no: 7, order_code: "FV7", delivery_id: "d7", fechaAntes: "2026-11-05", fechaNueva: "2026-11-07" };
    expect(avisoDeReprogramacion({ ...base, ownerId: "kevin", actorId: "jefa" })).toEqual({
      user_id: "kevin", delivery_id: "d7", order_no: 7, kind: "rescheduled", message: "Your order #FV7 was rescheduled from 2026-11-05 to 2026-11-07",
    });
    expect(avisoDeReprogramacion({ ...base, ownerId: "kevin", actorId: "kevin" })).toBeNull();
    expect(avisoDeReprogramacion({ ...base, ownerId: null, actorId: "jefa" })).toBeNull();
    expect(claseDelAviso("rescheduled")).toBe("importante");
  });
});
