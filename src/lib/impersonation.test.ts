import { describe, it, expect } from "vitest";
import {
  puedeEntrarComo, esAdmin, impersonacionCaducada, detalleDelRastro,
  IMPERSONACION_MINUTOS, EVENTO_ENTRAR, EVENTO_VOLVER,
} from "./impersonation";
import { ROLE_INFO } from "./constants";

const admin = { id: "a1", rol: "admin" };
const vendedor = { id: "v1", rol: "sales" };

describe("quién puede entrar como quién", () => {
  it("un admin entra como alguien que no es admin", () => {
    expect(puedeEntrarComo(admin, vendedor)).toEqual({ permitido: true });
  });

  it("quien no es admin no entra como nadie, mande lo que mande", () => {
    for (const rol of ["manager", "logistics", "accounting", "sales", "warehouse", "driver", null, undefined, ""]) {
      expect(puedeEntrarComo({ id: "x", rol }, vendedor)).toEqual({ permitido: false, motivo: "no-eres-admin" });
    }
  });

  it("y NUNCA como otro admin", () => {
    expect(puedeEntrarComo(admin, { id: "a2", rol: "admin" })).toEqual({ permitido: false, motivo: "es-admin" });
  });

  it("ni como uno mismo", () => {
    expect(puedeEntrarComo(admin, { id: "a1", rol: "sales" })).toEqual({ permitido: false, motivo: "eres-tu-mismo" });
  });

  it("sin destino no hay nada que decidir, y se mira antes que el rol", () => {
    // Primero el destino: así un id vacío da «sin-destino» y no un «no-eres-admin» que
    // despistaría a quien lea el rastro.
    expect(puedeEntrarComo(admin, null)).toEqual({ permitido: false, motivo: "sin-destino" });
    expect(puedeEntrarComo(admin, { id: "  ", rol: "sales" })).toEqual({ permitido: false, motivo: "sin-destino" });
  });

  it("sin quien entra tampoco", () => {
    expect(puedeEntrarComo(null, vendedor)).toEqual({ permitido: false, motivo: "no-eres-admin" });
    expect(puedeEntrarComo(undefined, vendedor)).toEqual({ permitido: false, motivo: "no-eres-admin" });
  });

  // El canario: recorre los roles de verdad en vez de una lista escrita a mano, así que un rol
  // nuevo entra aquí solo. Y entra por el lado seguro en las dos direcciones — no puede
  // impersonar, y sí puede ser impersonado, que es lo que un rol nuevo debe ser hasta que
  // alguien decida otra cosa.
  it("recorre ROLE_INFO: solo admin impersona, y solo admin es intocable", () => {
    const roles = Object.keys(ROLE_INFO);
    expect(roles.length).toBeGreaterThanOrEqual(7); // control: si el recorrido sale vacío, falla
    const pueden = roles.filter((r) => puedeEntrarComo({ id: "q", rol: r }, vendedor).permitido);
    expect(pueden).toEqual(["admin"]);
    const intocables = roles.filter((r) => !puedeEntrarComo(admin, { id: "d", rol: r }).permitido);
    expect(intocables).toEqual(["admin"]);
  });

  it("no se le escapa por mayúsculas ni espacios, en ninguno de los dos lados", () => {
    expect(puedeEntrarComo({ id: "a", rol: " Admin " }, vendedor)).toEqual({ permitido: true });
    expect(puedeEntrarComo(admin, { id: "d", rol: "ADMIN" })).toEqual({ permitido: false, motivo: "es-admin" });
  });
});

describe("esAdmin", () => {
  it("es una sola pregunta y no acepta parecidos", () => {
    expect(esAdmin("admin")).toBe(true);
    expect(esAdmin("Admin")).toBe(true);
    for (const r of ["administrador", "admins", "superadmin", "", null, undefined]) {
      expect(esAdmin(r)).toBe(false);
    }
  });
});

describe("cuánto dura", () => {
  it("una hora, que es lo que pidió el encargo", () => {
    expect(IMPERSONACION_MINUTOS).toBe(60);
  });

  it("caduca al cumplirse, no antes", () => {
    const t0 = 1_000_000;
    expect(impersonacionCaducada(t0, t0 + 59 * 60_000)).toBe(false);
    expect(impersonacionCaducada(t0, t0 + 60 * 60_000)).toBe(true);
  });

  it("sin hora de inicio se da por caducada, que es la dirección segura", () => {
    // Al revés que el corte de las 18:30: allí la duda no puede echar a la empresa de la app,
    // y aquí la duda no puede dejar a alguien dentro de una identidad ajena.
    expect(impersonacionCaducada(0, 1_000_000)).toBe(true);
    expect(impersonacionCaducada(NaN, 1_000_000)).toBe(true);
    expect(impersonacionCaducada(-1, 1_000_000)).toBe(true);
  });
});

describe("el rastro", () => {
  it("las dos clases de evento son distintas", () => {
    expect(EVENTO_ENTRAR).not.toBe(EVENTO_VOLVER);
  });

  it("el detalle dice como quién, y la ip cuando la hay", () => {
    expect(detalleDelRastro({ comoNombre: "Patricia Hernández" })).toBe("como Patricia Hernández");
    expect(detalleDelRastro({ comoNombre: "Patricia Hernández", desdeIp: "1.2.3.4" }))
      .toBe("como Patricia Hernández · desde 1.2.3.4");
    expect(detalleDelRastro({ comoNombre: "X", desdeIp: "   " })).toBe("como X");
  });
});
