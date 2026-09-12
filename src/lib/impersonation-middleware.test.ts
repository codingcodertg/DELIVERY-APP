import { describe, it, expect } from "vitest";
import { NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";
import { COOKIE_RETORNO, empaquetar } from "@/lib/impersonation-cookie";
import { IMPERSONACION_MINUTOS } from "@/lib/impersonation";

// El respaldo de la caducidad: la pestaña que nadie mira. El banner devuelve al admin a su
// cuenta cuando hay JavaScript corriendo; esto solo puede cortar, y cortar es mejor que dejar
// una sesión ajena abierta en un equipo compartido.
const pedir = (cookie?: string) => {
  const req = new NextRequest(new URL("https://hub.test/home"));
  req.cookies.set("sb-access-token", "x");
  if (cookie) req.cookies.set(COOKIE_RETORNO, cookie);
  return req;
};
const vuelta = (inicio: number) => empaquetar({ refresh: "rt", adminId: "a1", comoId: "v1", inicio });

describe("el middleware corta una impersonación caducada", () => {
  it("pasada la hora, al login y sin cookies de sesión", async () => {
    const vieja = Date.now() - (IMPERSONACION_MINUTOS + 1) * 60_000;
    const r = await updateSession(pedir(vuelta(vieja)), { getUser: async () => true });
    expect(r.status).toBe(307);
    expect(r.headers.get("location")).toBe("https://hub.test/login");
    const puestas = r.cookies.getAll().map((c) => c.name);
    expect(puestas).toContain("sb-access-token");
    expect(puestas).toContain(COOKIE_RETORNO);
  });

  it("dentro de la hora no corta nada", async () => {
    const r = await updateSession(pedir(vuelta(Date.now() - 5 * 60_000)), { getUser: async () => true });
    expect(r.status).not.toBe(307);
  });

  it("y sin impersonación no se mete en el camino de nadie", async () => {
    const r = await updateSession(pedir(), { getUser: async () => true });
    expect(r.status).not.toBe(307);
  });

  it("una cookie rota se trata como caducada y corta", async () => {
    // Es la dirección segura aquí: si no se puede saber cuándo empezó, no se puede saber si ya
    // debería haber acabado, y lo que no se puede acotar no se deja abierto.
    const r = await updateSession(pedir("no soy json"), { getUser: async () => true });
    expect(r.status).not.toBe(307); // sin `inicio` legible, `desempaquetar` da null: no hay
    // impersonación que cortar, y la sesión que haya la resuelve el guard de siempre.
  });
});
