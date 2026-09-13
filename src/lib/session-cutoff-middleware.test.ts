import { describe, it, expect } from "vitest";
import { NextRequest } from "next/server";
import { updateSession, type PuertaDeSesion } from "@/lib/supabase/middleware";

// El cierre de las 18:30 pasa por el middleware, que es el único punto por el que va cada
// navegación. Aquí se prueba ESE camino y no solo la regla pura: que el rebote ocurre, que
// lleva el `next`, que borra las cookies de sesión, y —lo que más importa— que un fallo al
// leer la puerta NO echa a nadie.
const pedir = (ruta = "/home") => {
  const req = new NextRequest(new URL(`https://hub.test${ruta}`));
  req.cookies.set("sb-access-token", "x");
  req.cookies.set("rtg_algo_nuestro", "y");
  return req;
};

const conSesion = async () => true;
const manana = new Date("2026-09-11T14:00:00Z");        // 09:00 en Chicago
const sesionDeAyer = "2026-09-10T15:00:00Z";
const sesionDeHoy = "2026-09-11T13:00:00Z";
const puerta = (p: Partial<PuertaDeSesion>): PuertaDeSesion => ({
  session_created_at: null, deliveries_role: null, clockin_role: null, ...p,
});

describe("el middleware cierra la sesión caducada por la hora", () => {
  it("una sesión de ayer, esta mañana: al login, con la ruta a la que iba", async () => {
    const r = await updateSession(pedir("/erp/review"), {
      getUser: conSesion, ahora: manana,
      gate: async () => puerta({ session_created_at: sesionDeAyer, deliveries_role: "sales" }),
    });
    expect(r.status).toBe(307);
    expect(r.headers.get("location")).toBe("https://hub.test/login?next=%2Ferp%2Freview");
  });

  it("y se lleva por delante las cookies de sesión, solo esas", async () => {
    const r = await updateSession(pedir(), {
      getUser: conSesion, ahora: manana,
      gate: async () => puerta({ session_created_at: sesionDeAyer, deliveries_role: "sales" }),
    });
    // Borrar una cookie es mandarla vacía y caducada; lo que se comprueba es que la de sesión
    // aparece en la respuesta y la nuestra no se toca.
    const puestas = r.cookies.getAll().map((c) => c.name);
    expect(puestas).toContain("sb-access-token");
    expect(puestas).not.toContain("rtg_algo_nuestro");
  });

  it("el admin y el owner siguen dentro con esa misma sesión de ayer", async () => {
    for (const rol of [{ deliveries_role: "admin" }, { clockin_role: "owner" }]) {
      const r = await updateSession(pedir(), {
        getUser: conSesion, ahora: manana,
        gate: async () => puerta({ session_created_at: sesionDeAyer, ...rol }),
      });
      expect(r.status).not.toBe(307);
    }
  });

  it("quien entró hoy sigue trabajando", async () => {
    const r = await updateSession(pedir(), {
      getUser: conSesion, ahora: manana,
      gate: async () => puerta({ session_created_at: sesionDeHoy, deliveries_role: "sales" }),
    });
    expect(r.status).not.toBe(307);
  });

  // Los dos que deciden si esto se puede desplegar sin romper nada: la 107 puede no estar
  // aplicada cuando el código llegue, y la llamada puede fallar por cualquier motivo.
  it("si la puerta no devuelve nada, NO cierra a nadie", async () => {
    const r = await updateSession(pedir(), { getUser: conSesion, ahora: manana, gate: async () => null });
    expect(r.status).not.toBe(307);
  });

  it("si la puerta revienta, tampoco", async () => {
    const r = await updateSession(pedir(), {
      getUser: conSesion, ahora: manana,
      gate: async () => { throw new Error("function public.session_gate() does not exist"); },
    });
    expect(r.status).not.toBe(307);
  });

  it("sin hora de sesión pero con rol, tampoco: la hora es la que manda", async () => {
    const r = await updateSession(pedir(), {
      getUser: conSesion, ahora: manana,
      gate: async () => puerta({ deliveries_role: "sales" }),
    });
    expect(r.status).not.toBe(307);
  });

  it("y sin sesión no se pregunta siquiera: eso ya lo resuelve el guard de rutas", async () => {
    let preguntado = false;
    const r = await updateSession(pedir(), {
      getUser: async () => false, ahora: manana,
      gate: async () => { preguntado = true; return puerta({ session_created_at: sesionDeAyer }); },
    });
    expect(preguntado).toBe(false);
    expect(r.headers.get("location")).toContain("/login");
  });
});
