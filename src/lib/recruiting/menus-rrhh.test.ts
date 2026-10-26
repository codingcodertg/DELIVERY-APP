import { describe, expect, it } from "vitest";
import { TABS } from "@/lib/recruiting/constants";
import { menusDeRrhh, pestanaActiva } from "@/lib/recruiting/menus-rrhh";

const ids = (xs: { id: string }[]) => xs.map((x) => x.id);

describe("D-704: RR. HH. en dos menús", () => {
  it("cada pestaña cae en su menú, y Ajustes queda suelto", () => {
    const g = Object.fromEntries(TABS.map((t) => [t.id, t.grupo]));
    expect(g).toEqual({
      today: "recruiting", calls: "recruiting", candidates: "recruiting", board: "recruiting", outcomes: "recruiting",
      questions: "recruiting", metrics: "recruiting", calendar: "recruiting",
      employees: "hr", "user-creation": "hr", settings: null,
    });
  });

  it("«Crear usuarios» es una página de RR. HH., no el hub", () => {
    expect(TABS.find((t) => t.id === "user-creation")?.href).toBe("/recruiting/user-creation");
  });

  it("el admin de RR. HH. que es admin del hub ve los dos menús enteros", () => {
    const m = menusDeRrhh(TABS, "admin", "admin");
    expect(m.grupos.map((g) => g.grupo)).toEqual(["recruiting", "hr"]);
    expect(ids(m.grupos[1].items)).toEqual(["employees", "user-creation"]);
    expect(ids(m.grupos[0].items)).toHaveLength(8);
    expect(ids(m.sueltas)).toEqual(["settings"]);
  });

  it("sin ser admin del hub, HR no trae «Crear usuarios»", () => {
    expect(ids(menusDeRrhh(TABS, "admin", "sales").grupos[1].items)).toEqual(["employees"]);
  });

  it("el gerente ve Empleados; el reclutador no tiene menú HR", () => {
    expect(ids(menusDeRrhh(TABS, "manager", "admin").grupos[1].items)).toEqual(["employees"]);
    const r = menusDeRrhh(TABS, "recruiter", "admin");
    expect(r.grupos.map((g) => g.grupo)).toEqual(["recruiting"]);
    expect(ids(r.grupos[0].items)).toContain("today");
  });

  it("el gerente de tienda: solo Recruiting con Candidatos, sin Ajustes", () => {
    const m = menusDeRrhh(TABS, "store_manager", "admin");
    expect(m.grupos.map((g) => [g.grupo, ids(g.items)])).toEqual([["recruiting", ["candidates"]]]);
    expect(m.sueltas).toEqual([]);
  });

  it("Candidatos se enciende solo en /recruiting exacto", () => {
    expect(pestanaActiva("/recruiting", "/recruiting")).toBe(true);
    expect(pestanaActiva("/recruiting", "/recruiting/board")).toBe(false);
    expect(pestanaActiva("/recruiting/board", "/recruiting/board")).toBe(true);
  });
});
