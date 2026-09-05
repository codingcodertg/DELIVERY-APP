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

  // Lo que importa no es la cadena sino a qué HOST acaba yendo la redirección: el callback
  // hace `new URL(next, request.url)`, y el analizador de URL elimina tabuladores y saltos
  // de línea antes de resolver, así que "/\t/evil.com" se convertía en "//evil.com" y salía
  // del sitio (hallazgo del auditor, reproducido con ?next=/%09/evil.com). Por eso cada caso
  // se resuelve contra el host real y se exige que siga siendo el nuestro.
  const HOST = "rtg-hub.vercel.app";
  const hostOf = (next: string) => new URL(safeNext(next), `https://${HOST}/auth/callback`).host;

  it("rechaza destinos externos, con o sin esquema, y la redirección se queda en nuestro host", () => {
    for (const x of ["https://evil.com/", "//evil.com/x", "/\\evil.com", "evil.com", "/x\r\nLocation: y"]) {
      expect(safeNext(x), x).toBe("/home");
      expect(hostOf(x), x).toBe(HOST);
    }
  });

  it("rechaza caracteres de control: el tabulador que el analizador de URL borra, y el resto", () => {
    for (const x of ["/\t/evil.com", "/\t\t/evil.com", "/\x0B/evil.com", "/\x0C/evil.com", "/\x00/evil.com", "/ok\x7F"]) {
      expect(safeNext(x), JSON.stringify(x)).toBe("/home");
      expect(hostOf(x), JSON.stringify(x)).toBe(HOST);
    }
    // Y la prueba de que el hueco era real: sin sanear, el tabulador sale del sitio.
    expect(new URL("/\t/evil.com", `https://${HOST}/auth/callback`).host).toBe("evil.com");
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
