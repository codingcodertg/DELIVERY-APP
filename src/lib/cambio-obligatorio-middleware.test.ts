import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

/**
 * El middleware con el cliente de Supabase simulado, no con `deps` (D-NEXT): es el camino de
 * producción. Fija dos cosas que con `deps` no se ven:
 *   · la marca se lee del `user_metadata` que devuelve `getUser()`;
 *   · si `getUser()` acaba de renovar las cookies, la redirección a la pantalla de cambiarla las
 *     lleva. Sin eso, con la rotación de refresh tokens, la persona acabaría en el login (D-119).
 */

const falso = vi.hoisted(() => ({
  metadata: { must_change_password: true } as Record<string, unknown>,
  renueva: true,
}));

vi.mock("@supabase/ssr", () => ({
  createServerClient: (_u: string, _k: string, opts: { cookies: { setAll: (c: { name: string; value: string; options?: Record<string, unknown> }[]) => void } }) => ({
    auth: {
      getUser: async () => {
        if (falso.renueva) opts.cookies.setAll([{ name: "sb-hub-auth-token", value: "renovada", options: { path: "/" } }]);
        return { data: { user: { id: "chofer-1", user_metadata: falso.metadata } }, error: null };
      },
    },
    // Sin la 107 o con fallo: `null`, que es «no cerrar».
    rpc: () => ({ single: async () => ({ data: null, error: { message: "no" } }) }),
  }),
}));

import { updateSession } from "@/lib/supabase/middleware";

const pedir = (ruta: string) => {
  const req = new NextRequest(new URL(`https://hub.test${ruta}`));
  req.cookies.set("sb-hub-auth-token", "vieja");
  return req;
};

beforeEach(() => {
  falso.metadata = { must_change_password: true };
  falso.renueva = true;
});

describe("updateSession con la sesión de verdad", () => {
  it("lee la marca de user_metadata y manda a cambiarla", async () => {
    const r = await updateSession(pedir("/my-route"));
    expect(r.headers.get("location")).toBe("https://hub.test/change-password?next=%2Fmy-route");
  });

  it("y la redirección lleva las cookies recién renovadas", async () => {
    const r = await updateSession(pedir("/my-route"));
    expect(r.cookies.get("sb-hub-auth-token")?.value).toBe("renovada");
  });

  it("sin la marca, la página se sirve con su cookie renovada (lo de siempre)", async () => {
    falso.metadata = {};
    const r = await updateSession(pedir("/my-route"));
    expect(r.headers.get("location")).toBeNull();
    expect(r.cookies.get("sb-hub-auth-token")?.value).toBe("renovada");
  });
});
