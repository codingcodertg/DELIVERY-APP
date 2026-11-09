import { describe, expect, it } from "vitest";
import {
  MODULOS_DE_GERENTE,
  conteoPorModulo,
  conteoPorRol,
  esSoloMarketing,
  etiquetaDeModulo,
  modulosDeUsuario,
  planDarLosOcho,
  planToggleModulo,
  resumenDeUsuario,
  tieneModulo,
  todosTienenLosOcho,
  usuariosConModulo,
  usuariosPorRol,
} from "./hub-usuarios-permisos";
import type { Profile } from "./types";

const u = (id: string, full_name: string, role: Profile["role"], module_access: string[] | null = []): Profile =>
  ({ id, full_name, role, module_access } as Profile);

/** Como `u`, pero con los roles de escalafón, para probar la fila «drifteada» (D-936). */
const uRol = (
  id: string,
  full_name: string,
  role: Profile["role"],
  module_access: string[] | null,
  extra: { recruiting_role?: string | null; timetracker_role?: string | null },
): Profile => ({ id, full_name, role, module_access, ...extra } as Profile);

describe("los 8 módulos de gerente", () => {
  it("son exactamente estos 8, sin surveys ni inventory", () => {
    expect(MODULOS_DE_GERENTE).toEqual([
      "deliveries", "leads", "recruiting", "timetracker", "promos", "customers", "warehouse_ops", "estimator",
    ]);
    expect(MODULOS_DE_GERENTE).not.toContain("surveys");
    expect(MODULOS_DE_GERENTE).not.toContain("erp");
    expect(MODULOS_DE_GERENTE.length).toBe(8);
  });
  it("surveys es solo marketing", () => {
    expect(esSoloMarketing("surveys")).toBe(true);
    expect(esSoloMarketing("leads")).toBe(false);
  });
});

describe("tieneModulo / modulosDeUsuario", () => {
  it("el admin los tiene todos por su rol", () => {
    const a = u("a", "Ana", "admin", []);
    expect(tieneModulo(a, "promos")).toBe(true);
    expect(modulosDeUsuario(a)).toEqual(MODULOS_DE_GERENTE);
  });
  it("los demás, solo lo que está en module_access", () => {
    const v = u("v", "Beto", "sales", ["deliveries", "leads"]);
    expect(tieneModulo(v, "deliveries")).toBe(true);
    expect(tieneModulo(v, "promos")).toBe(false);
    expect(modulosDeUsuario(v)).toEqual(["deliveries", "leads"]);
  });
  it("'clockin' viejo cuenta como timetracker", () => {
    const v = u("v", "Cleo", "manager", ["clockin"]);
    expect(tieneModulo(v, "timetracker")).toBe(true);
  });
  it("fila drifteada: con recruiting_role pero sin el módulo, cuenta como que SÍ lo tiene (D-936)", () => {
    const v = uRol("v", "Dani", "manager", [], { recruiting_role: "recruiter" });
    expect(tieneModulo(v, "recruiting")).toBe(true);
    expect(modulosDeUsuario(v)).toEqual(["recruiting"]);
    // y así se puede revocar desde el toggle en bloque
    expect(planToggleModulo([v], "recruiting", false)).toEqual([{ userId: "v", key: "recruiting", conceder: false }]);
  });
  it("fila drifteada: con timetracker_role pero sin el módulo, también cuenta", () => {
    const v = uRol("v", "Eva", "sales", ["deliveries"], { timetracker_role: "employee" });
    expect(tieneModulo(v, "timetracker")).toBe(true);
    // dar los 8 ya no se lo re-concede
    expect(planDarLosOcho([v]).some((p) => p.key === "timetracker")).toBe(false);
  });
});

describe("ver por usuario", () => {
  it("resumen: rol, lo que tiene y lo que falta", () => {
    const v = u("v", "Dora", "manager", ["deliveries", "leads"]);
    const r = resumenDeUsuario(v, "es");
    expect(r.rolTexto).toBe("Gerente de Oficina");
    expect(r.tiene).toEqual(["deliveries", "leads"]);
    expect(r.faltan).toEqual(["recruiting", "timetracker", "promos", "customers", "warehouse_ops", "estimator"]);
  });
  it("etiqueta bilingüe de un módulo", () => {
    expect(etiquetaDeModulo("recruiting", "es")).toBe("Gestión de RR. HH.");
    expect(etiquetaDeModulo("recruiting", "en")).toBe("HR Management");
    expect(etiquetaDeModulo("estimator", "en")).toBe("Quote Builder");
  });
});

describe("ver por rol / por módulo", () => {
  const users = [
    u("1", "Zoe", "sales", ["deliveries"]),
    u("2", "Ada", "sales", ["deliveries", "customers"]),
    u("3", "Max", "manager", ["deliveries", "customers"]),
    u("4", "Ana", "admin", []),
  ];
  it("por rol: solo ese rol, ordenado por nombre", () => {
    expect(usuariosPorRol(users, "sales").map((x) => x.full_name)).toEqual(["Ada", "Zoe"]);
  });
  it("por módulo: quién lo tiene (el admin siempre), ordenado por nombre", () => {
    expect(usuariosConModulo(users, "customers").map((x) => x.full_name)).toEqual(["Ada", "Ana", "Max"]);
  });
  it("conteo por rol en el orden canónico", () => {
    const c = conteoPorRol(users);
    expect(c.find((x) => x.role === "sales")?.n).toBe(2);
    expect(c.find((x) => x.role === "admin")?.n).toBe(1);
    expect(c[0].role).toBe("admin"); // ROLE_ORDER empieza por admin
  });
  it("conteo por módulo cuenta al admin", () => {
    const c = conteoPorModulo(users);
    expect(c.find((x) => x.key === "customers")?.n).toBe(3); // Ada, Max y el admin
    expect(c.find((x) => x.key === "promos")?.n).toBe(1); // solo el admin
  });
});

describe("permisos rápidos (bulk)", () => {
  it("dar los 8: solo los que faltan, nunca al admin", () => {
    const users = [
      u("v", "Beto", "sales", ["deliveries", "leads"]),
      u("a", "Ana", "admin", []),
    ];
    const plan = planDarLosOcho(users);
    expect(plan.every((p) => p.userId === "v")).toBe(true);
    expect(plan.every((p) => p.conceder)).toBe(true);
    expect(plan.map((p) => p.key)).toEqual(["recruiting", "timetracker", "promos", "customers", "warehouse_ops", "estimator"]);
  });
  it("dar los 8 a quien no tiene nada: exactamente los 8, en orden", () => {
    const plan = planDarLosOcho([u("v", "Nil", "sales", [])]);
    expect(plan.map((p) => p.key)).toEqual([...MODULOS_DE_GERENTE]);
    expect(plan.every((p) => p.conceder && p.userId === "v")).toBe(true);
  });
  it("toggle de un módulo: solo donde cambia, nunca al admin", () => {
    const users = [
      u("1", "Zoe", "sales", ["deliveries"]),
      u("2", "Ada", "sales", ["deliveries", "promos"]),
      u("3", "Ana", "admin", []),
    ];
    // conceder promos: solo a Zoe (Ada ya lo tiene, el admin no se toca)
    expect(planToggleModulo(users, "promos", true)).toEqual([{ userId: "1", key: "promos", conceder: true }]);
    // quitar promos: solo a Ada
    expect(planToggleModulo(users, "promos", false)).toEqual([{ userId: "2", key: "promos", conceder: false }]);
  });
  it("todosTienenLosOcho", () => {
    expect(todosTienenLosOcho([u("a", "Ana", "admin", [])])).toBe(true);
    expect(todosTienenLosOcho([u("v", "Beto", "sales", ["deliveries"])])).toBe(false);
  });
});
