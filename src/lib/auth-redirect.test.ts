import { describe, it, expect } from "vitest";
import { safeNext } from "./auth-redirect";

// D-NEXT. `?next=` llega por URL, desde el middleware o desde el enlace de restablecer
// contraseña. Solo se acepta una ruta interna: nada externo, nada que vuelva al login.
describe("safeNext", () => {
  it("acepta rutas internas tal cual, con su query", () => {
    expect(safeNext("/timetracker")).toBe("/timetracker");
    expect(safeNext("/reset-password")).toBe("/reset-password");
    expect(safeNext("/timetracker/payroll?period=2026-09-04")).toBe("/timetracker/payroll?period=2026-09-04");
  });

  it("vacío o ausente cae al hub", () => {
    expect(safeNext(null)).toBe("/home");
    expect(safeNext(undefined)).toBe("/home");
    expect(safeNext("")).toBe("/home");
    expect(safeNext("   ")).toBe("/home");
  });

  it("rechaza destinos externos, con o sin esquema", () => {
    expect(safeNext("https://evil.com/")).toBe("/home");
    expect(safeNext("//evil.com/x")).toBe("/home");
    expect(safeNext("/\\evil.com")).toBe("/home");
    expect(safeNext("evil.com")).toBe("/home");
    expect(safeNext("/x\r\nLocation: y")).toBe("/home");
  });

  it("rechaza el propio login, que sería un bucle", () => {
    expect(safeNext("/login")).toBe("/home");
    expect(safeNext("/login/")).toBe("/home");
    expect(safeNext("/login?next=/x")).toBe("/home");
    expect(safeNext("/loginx")).toBe("/loginx"); // otra ruta que solo empieza igual
  });

  it("respeta un fallback distinto", () => {
    expect(safeNext("//evil.com", "/")).toBe("/");
  });
});
