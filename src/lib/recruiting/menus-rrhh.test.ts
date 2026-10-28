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
      employees: "hr", assets: "hr", settings: null,
    });
  });

  it("D-720: «Crear usuarios» ya no es una página: HR es solo Empleados", () => {
    expect(TABS.find((t) => t.id === "user-creation")).toBeUndefined();
    expect(TABS.some((t) => t.href.includes("user-creation"))).toBe(false);
  });

  it("el admin de RR. HH. ve los dos menús enteros", () => {
    const m = menusDeRrhh(TABS, "admin");
    expect(m.grupos.map((g) => g.grupo)).toEqual(["recruiting", "hr"]);
    expect(ids(m.grupos[1].items)).toEqual(["employees", "assets"]);
    expect(ids(m.grupos[0].items)).toHaveLength(8);
    expect(ids(m.sueltas)).toEqual(["settings"]);
  });

  it("el gerente ve Empleados; el reclutador no tiene menú HR", () => {
    expect(ids(menusDeRrhh(TABS, "manager").grupos[1].items)).toEqual(["employees", "assets"]);
    const r = menusDeRrhh(TABS, "recruiter");
    expect(r.grupos.map((g) => g.grupo)).toEqual(["recruiting"]);
    expect(ids(r.grupos[0].items)).toContain("today");
  });

  it("el gerente de tienda: solo Recruiting con Candidatos, sin Ajustes", () => {
    const m = menusDeRrhh(TABS, "store_manager");
    expect(m.grupos.map((g) => [g.grupo, ids(g.items)])).toEqual([["recruiting", ["candidates"]]]);
    expect(m.sueltas).toEqual([]);
  });

  it("Candidatos se enciende solo en /recruiting exacto", () => {
    expect(pestanaActiva("/recruiting", "/recruiting")).toBe(true);
    expect(pestanaActiva("/recruiting", "/recruiting/board")).toBe(false);
    expect(pestanaActiva("/recruiting/board", "/recruiting/board")).toBe(true);
  });
});
