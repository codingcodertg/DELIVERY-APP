import { describe, expect, it } from "vitest";
import {
  accionDelAviso, appDelAviso, appsConAvisos, avisosDeLaClase, filtrarPorApp, sinLeerPorApp, unificarAvisos,
  type AvisoRrhh,
} from "@/lib/notificaciones-todas";
import { AVISO_CLIENTE_NUEVA } from "@/lib/customers/avisos-de-solicitud";
import type { AppNotification } from "@/lib/notifications";

function aviso(p: Partial<AppNotification> & { id: string }): AppNotification {
  return {
    user_id: "yo",
    delivery_id: null,
    order_no: null,
    kind: "pending",
    message: "msg",
    read: false,
    created_at: "2026-11-14T10:00:00.000Z",
    ...p,
  };
}

function rrhh(p: Partial<AvisoRrhh> & { id: string }): AvisoRrhh {
  return { message: "fichaje", read: false, created_at: "2026-11-14T11:00:00.000Z", ...p };
}

describe("appDelAviso: a qué app pertenece un aviso de la tabla común", () => {
  it("los de Clientes son de Clientes", () => {
    expect(appDelAviso(AVISO_CLIENTE_NUEVA)).toBe("clientes");
    expect(appDelAviso("cliente_solicitud_rechazada")).toBe("clientes");
  });
  it("todo lo demás es de Entregas, incluido un kind nuevo", () => {
    expect(appDelAviso("canceled")).toBe("entregas");
    expect(appDelAviso("ayuda_atendida")).toBe("entregas");
    expect(appDelAviso("kind_que_no_existe")).toBe("entregas");
    expect(appDelAviso(null)).toBe("entregas");
  });
});

describe("unificarAvisos: una sola lista, el más nuevo primero", () => {
  const base = [
    aviso({ id: "b1", kind: "pending", created_at: "2026-11-14T08:00:00.000Z" }),
    aviso({ id: "b2", kind: AVISO_CLIENTE_NUEVA, created_at: "2026-11-16T09:00:00.000Z" }),
  ];
  const hr = [rrhh({ id: "r1", created_at: "2026-11-15T12:00:00.000Z" })];

  it("junta las tres apps y ordena por fecha, de la más nueva a la más vieja", () => {
    const u = unificarAvisos({ base, rrhh: hr });
    expect(u.map((n) => n.id)).toEqual(["b2", "r1", "b1"]);
    expect(u.map((n) => n.app)).toEqual(["clientes", "rrhh", "entregas"]);
  });

  it("cada aviso lleva su app y las claves no chocan entre tablas", () => {
    const u = unificarAvisos({ base: [aviso({ id: "x" })], rrhh: [rrhh({ id: "x" })] });
    expect(new Set(u.map((n) => n.key)).size).toBe(2);
    expect(u.find((n) => n.app === "rrhh")?.base).toBeNull();
    expect(u.find((n) => n.app === "rrhh")?.message).toBe("fichaje");
  });

  it("no toca las listas de entrada", () => {
    const antes = JSON.stringify(base);
    unificarAvisos({ base, rrhh: hr });
    expect(JSON.stringify(base)).toBe(antes);
  });

  it("sin RRHH (no hay sesión de HR) solo están Entregas y Clientes", () => {
    expect(unificarAvisos({ base, rrhh: [] }).map((n) => n.app)).toEqual(["clientes", "entregas"]);
  });
});

describe("filtrarPorApp y appsConAvisos", () => {
  const u = unificarAvisos({
    base: [aviso({ id: "e" }), aviso({ id: "c", kind: AVISO_CLIENTE_NUEVA })],
    rrhh: [rrhh({ id: "r" })],
  });

  it("«todas» deja pasar todo; una app, solo la suya", () => {
    expect(filtrarPorApp(u, "todas")).toHaveLength(3);
    expect(filtrarPorApp(u, "rrhh").map((n) => n.id)).toEqual(["r"]);
    expect(filtrarPorApp(u, "clientes").map((n) => n.id)).toEqual(["c"]);
  });

  it("appsConAvisos solo nombra las apps con avisos, en orden fijo", () => {
    expect(appsConAvisos(u)).toEqual(["entregas", "clientes", "rrhh"]);
    expect(appsConAvisos(unificarAvisos({ base: [aviso({ id: "e" })], rrhh: [] }))).toEqual(["entregas"]);
    expect(appsConAvisos([])).toEqual([]);
  });
});

describe("sinLeerPorApp", () => {
  it("cuenta los no leídos de cada app, y cero donde no hay", () => {
    const u = unificarAvisos({
      base: [aviso({ id: "e1" }), aviso({ id: "e2", read: true }), aviso({ id: "c1", kind: AVISO_CLIENTE_NUEVA })],
      rrhh: [rrhh({ id: "r1" }), rrhh({ id: "r2", read: true })],
    });
    expect(sinLeerPorApp(u)).toEqual({ entregas: 1, clientes: 1, rrhh: 1 });
    expect(sinLeerPorApp(unificarAvisos({ base: [], rrhh: [] }))).toEqual({ entregas: 0, clientes: 0, rrhh: 0 });
  });
});

describe("avisosDeLaClase: las secciones de D-880 no cambian", () => {
  it("«importante» solo deja los importantes de la tabla común; RRHH no tiene sección", () => {
    const u = unificarAvisos({
      base: [
        aviso({ id: "anulada", kind: "canceled" }),
        aviso({ id: "pendiente", kind: "pending" }),
        aviso({ id: "cliente", kind: AVISO_CLIENTE_NUEVA }),
      ],
      rrhh: [rrhh({ id: "r" })],
    });
    expect(avisosDeLaClase(u, "importante").map((n) => n.id)).toEqual(["anulada", "cliente"]);
    expect(avisosDeLaClase(u, "secundario").map((n) => n.id)).toEqual(["pendiente"]);
  });
});

describe("accionDelAviso: se va a la orden solo si está en esta app; si no, tarjeta en el panel", () => {
  it("una orden de Entregas vista desde Entregas: ir a la orden (como siempre)", () => {
    const [n] = unificarAvisos({ base: [aviso({ id: "e", delivery_id: "abc" })], rrhh: [] });
    expect(accionDelAviso(n, "entregas")).toEqual({ tipo: "ir", href: "/?order=abc" });
  });

  it("una orden de Entregas vista desde Clientes: tarjeta, con su enlace a Entregas como secundario", () => {
    const [n] = unificarAvisos({ base: [aviso({ id: "e", delivery_id: "abc" })], rrhh: [] });
    expect(accionDelAviso(n, "clientes")).toEqual({ tipo: "tarjeta", app: "entregas", href: "/?order=abc" });
  });

  it("un aviso de RRHH nunca navega: tarjeta sin enlace", () => {
    const [n] = unificarAvisos({ base: [], rrhh: [rrhh({ id: "r" })] });
    expect(accionDelAviso(n, "entregas")).toEqual({ tipo: "tarjeta", app: "rrhh", href: null });
  });

  it("un aviso de la app actual sin destino: tarjeta sin enlace", () => {
    const [n] = unificarAvisos({ base: [aviso({ id: "c", kind: AVISO_CLIENTE_NUEVA })], rrhh: [] });
    expect(accionDelAviso(n, "clientes")).toEqual({ tipo: "tarjeta", app: "clientes", href: null });
  });
});
