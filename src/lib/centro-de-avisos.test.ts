import { describe, expect, it } from "vitest";
import type { AvisoUnificado } from "@/lib/notificaciones-todas";
import {
  avisosDelCentro, etiquetaDelTipo, gruposDelCentro, SELECCION_INICIAL, tipoDelAviso,
} from "@/lib/centro-de-avisos";

/** Un aviso de la lista unida. Sin `tipo` ni `base` salvo que se pidan: así se ve la forma real de cada uno. */
function base(id: string, kind: string, read = false): AvisoUnificado {
  return {
    key: `base-${id}`, app: kind.startsWith("cliente_") ? "clientes" : "entregas", id, read,
    created_at: "2026-11-20T10:00:00.000Z",
    base: { id, user_id: "yo", delivery_id: null, order_no: null, kind, message: "m", read, created_at: "2026-11-20T10:00:00.000Z" },
    message: null,
  };
}

function rrhh(id: string, tipo: string, read = false): AvisoUnificado {
  return {
    key: `rrhh-${id}`, app: "rrhh", id, read, created_at: "2026-11-20T11:00:00.000Z",
    base: null, message: "fichaje", tipo,
  };
}

describe("etiquetaDelTipo: un nombre en los dos idiomas para cada tipo que existe hoy", () => {
  it("las etapas de una orden (Entregas)", () => {
    expect(etiquetaDelTipo("pending")).toEqual({ en: "Awaiting approval", es: "Por aprobar" });
    expect(etiquetaDelTipo("approved")).toEqual({ en: "Approved", es: "Aprobada" });
    expect(etiquetaDelTipo("rejected")).toEqual({ en: "Rejected order", es: "Orden rechazada" });
    expect(etiquetaDelTipo("ready")).toEqual({ en: "Ready for delivery", es: "Lista para entregar" });
    expect(etiquetaDelTipo("picked_up")).toEqual({ en: "Picked up", es: "Recogida" });
    expect(etiquetaDelTipo("delivered")).toEqual({ en: "Delivered", es: "Entregada" });
    expect(etiquetaDelTipo("canceled")).toEqual({ en: "Canceled", es: "Anulada" });
    expect(etiquetaDelTipo("rescheduled")).toEqual({ en: "Rescheduled", es: "Reprogramada" });
  });

  it("los demás avisos de Entregas: asignación, chat, solicitudes y ayuda", () => {
    for (const kind of [
      "assigned", "tomada_por_chofer", "customer_rejected", "chat",
      "assign_request", "assign_request_approved", "assign_request_rejected",
      "ayuda_atendida", "ayuda_respuesta", "ayuda_mensaje",
    ]) {
      const e = etiquetaDelTipo(kind);
      expect([kind, e.en !== kind && e.es !== kind]).toEqual([kind, true]);
    }
  });

  it("las solicitudes de cliente (Clientes)", () => {
    expect(etiquetaDelTipo("cliente_solicitud_nueva").es).toBe("Solicitud de cliente nuevo");
    expect(etiquetaDelTipo("cliente_solicitud_aprobada").es).toBe("Cliente aprobado");
    expect(etiquetaDelTipo("cliente_solicitud_rechazada").es).toBe("Solicitud de cliente rechazada");
    expect(etiquetaDelTipo("cliente_solicitud_revisar").es).toBe("Solicitud de cliente a revisar");
  });

  it("los tipos de RRHH (el `type` de su tabla), y uno vacío como «Sin tipo»", () => {
    expect(etiquetaDelTipo("out_of_radius")).toEqual({ en: "Clock-in out of range", es: "Fichaje fuera de rango" });
    expect(etiquetaDelTipo("leaving_while_clocked_in")).toEqual({ en: "Left while clocked in", es: "Salida con el fichaje abierto" });
    expect(etiquetaDelTipo("other")).toEqual({ en: "Other", es: "Otros" });
    expect(etiquetaDelTipo("")).toEqual({ en: "No type", es: "Sin tipo" });
  });

  it("un tipo desconocido sale con su nombre crudo: no se oculta nada", () => {
    expect(etiquetaDelTipo("algo_nuevo")).toEqual({ en: "algo_nuevo", es: "algo_nuevo" });
    expect(etiquetaDelTipo("constructor")).toEqual({ en: "constructor", es: "constructor" });
  });
});

describe("tipoDelAviso", () => {
  it("el kind de un aviso de la tabla común, el type de uno de RRHH", () => {
    expect(tipoDelAviso(base("1", "pending"))).toBe("pending");
    expect(tipoDelAviso(rrhh("2", "out_of_radius"))).toBe("out_of_radius");
    expect(tipoDelAviso(rrhh("3", ""))).toBe("");
  });
});

describe("gruposDelCentro", () => {
  const avisos: AvisoUnificado[] = [
    base("e1", "pending"),
    base("e2", "pending", true),
    base("e3", "pending"),
    base("e4", "delivered"),
    base("e5", "assigned", true),
    base("c1", "cliente_solicitud_nueva"),
    base("c2", "cliente_solicitud_nueva", true),
    rrhh("r1", "out_of_radius"),
    rrhh("r2", "out_of_radius"),
    rrhh("r3", "out_of_radius", true),
    rrhh("r4", "other"),
  ];

  it("cuenta el total y los sin leer en todo, y en cada app", () => {
    const g = gruposDelCentro(avisos);
    expect([g.total, g.sinLeer]).toEqual([11, 7]);
    expect(g.apps.map((a) => [a.app, a.total, a.sinLeer])).toEqual([
      ["entregas", 5, 3],
      ["clientes", 2, 1],
      ["rrhh", 4, 3],
    ]);
  });

  it("dentro de cada app, los tipos van del más numeroso al menos", () => {
    const g = gruposDelCentro(avisos);
    const entregas = g.apps.find((a) => a.app === "entregas")!;
    expect(entregas.tipos).toEqual([
      { tipo: "pending", total: 3, sinLeer: 2 },
      { tipo: "assigned", total: 1, sinLeer: 0 },
      { tipo: "delivered", total: 1, sinLeer: 1 },
    ]);
    const rr = g.apps.find((a) => a.app === "rrhh")!;
    expect(rr.tipos).toEqual([
      { tipo: "out_of_radius", total: 3, sinLeer: 2 },
      { tipo: "other", total: 1, sinLeer: 1 },
    ]);
  });

  it("las apps van en el orden de siempre, y una app sin avisos no sale", () => {
    const g = gruposDelCentro([rrhh("r1", "other"), base("e1", "pending")]);
    expect(g.apps.map((a) => a.app)).toEqual(["entregas", "rrhh"]);
  });

  it("sin avisos, no hay grupos", () => {
    expect(gruposDelCentro([])).toEqual({ total: 0, sinLeer: 0, apps: [] });
  });

  it("empate de total: el tipo sale por orden alfabético, para que no salte al recargar", () => {
    const g = gruposDelCentro([base("1", "delivered"), base("2", "approved")]);
    expect(g.apps[0].tipos.map((t) => t.tipo)).toEqual(["approved", "delivered"]);
  });
});

describe("avisosDelCentro", () => {
  const avisos: AvisoUnificado[] = [
    base("e1", "pending"),
    base("e2", "pending", true),
    base("e3", "delivered"),
    base("c1", "cliente_solicitud_nueva"),
    rrhh("r1", "out_of_radius", true),
  ];

  it("sin selección, todos, en su orden", () => {
    expect(avisosDelCentro(avisos, SELECCION_INICIAL, false).map((n) => n.id)).toEqual(["e1", "e2", "e3", "c1", "r1"]);
  });

  it("una app", () => {
    expect(avisosDelCentro(avisos, { app: "entregas", tipo: null }, false).map((n) => n.id)).toEqual(["e1", "e2", "e3"]);
    expect(avisosDelCentro(avisos, { app: "rrhh", tipo: null }, false).map((n) => n.id)).toEqual(["r1"]);
  });

  it("un tipo dentro de la app", () => {
    expect(avisosDelCentro(avisos, { app: "entregas", tipo: "pending" }, false).map((n) => n.id)).toEqual(["e1", "e2"]);
  });

  it("solo los sin leer, si se pide", () => {
    expect(avisosDelCentro(avisos, SELECCION_INICIAL, true).map((n) => n.id)).toEqual(["e1", "e3", "c1"]);
    expect(avisosDelCentro(avisos, { app: "rrhh", tipo: null }, true)).toEqual([]);
  });
});
