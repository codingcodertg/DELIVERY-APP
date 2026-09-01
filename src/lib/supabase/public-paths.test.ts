import { describe, it, expect } from "vitest";
import { isPublicPath } from "./middleware";

/**
 * Qué se ve sin haber entrado (D-156).
 *
 * Esta lista es la razón por la que el guard de rutas llevaba parado desde D-119. No era
 * prudencia de más: escrito como estaba, habría roto dos cosas el mismo minuto que se
 * conectara. La prueba está para que la siguiente ruta pública que alguien olvide salte
 * aquí y no en un teléfono el lunes por la mañana.
 */
describe("isPublicPath", () => {
  it("deja pasar el seguimiento del cliente", () => {
    // La página que se le manda al CLIENTE por SMS y correo. No tiene cuenta y no la va a
    // tener; mandarlo a /login convierte el enlace en una puerta cerrada.
    expect(isPublicPath("/track/8f3a1c22-0000-4000-8000-000000000000")).toBe(true);
  });

  it("deja pasar las rutas de datos, estén donde estén", () => {
    // Una llamada sin sesión debe contestar 401, no el HTML del login con estado 200 —
    // que el fetch intentaría leer como JSON y fallaría en un sitio sin relación.
    expect(isPublicPath("/api/track/abc")).toBe(true);
    expect(isPublicPath("/api/version")).toBe(true);
    // Anidada: por eso se busca el segmento en cualquier posición y no al principio.
    expect(isPublicPath("/timetracker/clock-in/api/punch")).toBe(true);
  });

  it("deja pasar la puerta y lo que hace falta para cruzarla", () => {
    expect(isPublicPath("/login")).toBe(true);
    expect(isPublicPath("/auth/callback")).toBe(true);
    // Se llega desde un correo, sin sesión — que es justo cuando no se puede entrar.
    expect(isPublicPath("/reset-password")).toBe(true);
    // Aquí aterriza quien SÍ entró pero no tiene ningún módulo: mandarlo a login es un bucle.
    expect(isPublicPath("/no-access")).toBe(true);
  });

  it("NO deja pasar nada de la aplicación", () => {
    for (const p of ["/", "/dashboard", "/warehouse", "/routes", "/settings",
                     "/recruiting", "/recruiting/employees", "/timetracker", "/erp/catalog", "/home"]) {
      expect(isPublicPath(p), p).toBe(false);
    }
  });

  it("no se deja engañar por una ruta que solo EMPIECE parecido", () => {
    // "/tracking-secreto" no es "/track/…". Un startsWith("/track") a secas lo abriría.
    expect(isPublicPath("/tracking-interno")).toBe(false);
    expect(isPublicPath("/logins")).toBe(false);
  });
});
