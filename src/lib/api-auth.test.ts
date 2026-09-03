import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * La puerta de las rutas API (D-172).
 *
 * Se prueba con un cliente falso porque lo que importa es la DECISIÓN —sin usuario, 401;
 * con usuario, pasa— y no Supabase. El fallo que esto cierra fue que diez rutas no la
 * llamaban; la prueba de que la llaman está en la prueba en vivo de cada ruta (D-172), no
 * aquí. Aquí se garantiza que, llamada, hace lo que dice.
 */
let usuario: { id: string; email?: string } | null = null;

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: usuario } }) },
  }),
}));

import { requireUser } from "./api-auth";

describe("requireUser", () => {
  beforeEach(() => { usuario = null; });

  it("sin sesión devuelve un 401 listo para responder", async () => {
    const r = await requireUser();
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.response.status).toBe(401);
    expect(await r.response.json()).toEqual({ error: "Not signed in." });
  });

  it("con sesión devuelve el usuario y el cliente", async () => {
    usuario = { id: "acf43ad5-0000-4000-8000-000000000000", email: "x@y.z" };
    const r = await requireUser();
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.user.id).toBe(usuario.id);
    expect(r.supabase).toBeTruthy();
  });

  it("no mira el rol: eso es de cada ruta", async () => {
    // Un usuario cualquiera pasa. Si algún día esto empezara a exigir rol, las rutas de
    // mapas —que usa todo el mundo— dejarían de funcionar para la mitad de la empresa.
    usuario = { id: "00000000-0000-4000-8000-000000000001" };
    expect((await requireUser()).ok).toBe(true);
  });
});
