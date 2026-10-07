import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";
import { empaquetar } from "@/lib/impersonation-cookie";

/**
 * Las piezas de servidor de «cambia tu contraseña al entrar» (D-NEXT), llamadas de verdad con Auth
 * falso. Nada de esto toca Supabase: se mira con qué se llama a `updateUser`, a `updateUserById` y
 * al registro de seguridad.
 */

const falso = vi.hoisted(() => ({
  sesion: { ok: true as boolean, metadata: { must_change_password: true } as Record<string, unknown> },
  retorno: null as string | null,
  updateUser: vi.fn(async (_a?: unknown) => ({ error: null as unknown })),
  logSecurity: vi.fn(async (_a?: unknown) => true),
  updateUserById: vi.fn(async (_id?: unknown, _a?: unknown) => ({ error: null as unknown })),
  usuarioSsr: { id: "chofer-1", email: "maximogarza@users.rtg", user_metadata: { must_change_password: true } as Record<string, unknown> },
  rolSsr: "admin",
}));

const tabla = () => ({
  select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { full_name: "Máximo Garza", role: falso.rolSsr }, error: null }) }) }),
});

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => (falso.retorno === null ? undefined : { value: falso.retorno }), delete: () => {} }),
}));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => { throw new Error(`REDIRECT:${url}`); },
}));
vi.mock("@/lib/api-auth", () => ({
  requireUser: async () =>
    falso.sesion.ok
      ? {
          ok: true,
          user: { id: "chofer-1", email: "maximogarza@users.rtg", user_metadata: falso.sesion.metadata },
          supabase: { auth: { updateUser: falso.updateUser }, from: tabla },
        }
      : { ok: false, response: NextResponse.json({ error: "Not signed in." }, { status: 401 }) },
}));
vi.mock("@/lib/security-log-server", () => ({ logSecurity: falso.logSecurity }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: falso.usuarioSsr }, error: null }) },
    from: tabla,
  }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    auth: { admin: { getUserById: async () => ({ data: { user: { email: "x@y" } } }), updateUserById: falso.updateUserById } },
    from: tabla,
  }),
}));

import { POST as cambiar } from "@/app/api/profile/password/forced/route";
import { POST as restablecer } from "@/app/api/reset-password/route";
import { GET as estado } from "@/app/api/impersonate/state/route";
import ChangePasswordPage from "@/app/change-password/page";

const pide = (cuerpo: unknown) =>
  cambiar(new Request("http://localhost/api/profile/password/forced", { method: "POST", body: JSON.stringify(cuerpo) }));
const retornoValido = () => empaquetar({ refresh: "rt", adminId: "admin-1", comoId: "chofer-1", inicio: Date.now() });

beforeEach(() => {
  falso.sesion = { ok: true, metadata: { must_change_password: true } };
  falso.retorno = null;
  falso.usuarioSsr = { id: "chofer-1", email: "maximogarza@users.rtg", user_metadata: { must_change_password: true } };
  falso.rolSsr = "admin";
  for (const s of [falso.updateUser, falso.logSecurity, falso.updateUserById]) s.mockClear();
  falso.updateUser.mockImplementation(async () => ({ error: null }));
});

describe("POST /api/profile/password/forced", () => {
  it("con la marca: cambia la contraseña y QUITA la marca en la misma llamada, y lo apunta", async () => {
    const r = await pide({ nueva: "camion-azul-9" });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true });
    expect(falso.updateUser.mock.calls).toEqual([[{ password: "camion-azul-9", data: { must_change_password: false } }]]);
    expect(falso.logSecurity).toHaveBeenCalledTimes(1);
    const fila = falso.logSecurity.mock.calls[0][0] as Record<string, unknown>;
    expect(fila).toMatchObject({ actorId: "chofer-1", targetId: "chofer-1", targetName: "Máximo Garza", kind: "password_changed" });
    // Nunca la contraseña en el registro.
    expect(JSON.stringify(fila)).not.toContain("camion-azul-9");
  });

  it("sin la marca no cambia nada: el camino sin la actual es SOLO para la temporal", async () => {
    falso.sesion.metadata = { must_change_password: false };
    const r = await pide({ nueva: "camion-azul-9" });
    expect(r.status).toBe(409);
    expect((await r.json()).codigo).toBe("no_hace_falta");
    expect(falso.updateUser).not.toHaveBeenCalled();
    expect(falso.logSecurity).not.toHaveBeenCalled();
  });

  it("dentro de «Entrar como», el admin no puede cambiársela", async () => {
    falso.retorno = retornoValido();
    const r = await pide({ nueva: "camion-azul-9" });
    expect(r.status).toBe(403);
    expect((await r.json()).codigo).toBe("suplantando");
    expect(falso.updateUser).not.toHaveBeenCalled();
  });

  it("sin sesión: 401", async () => {
    falso.sesion.ok = false;
    expect((await pide({ nueva: "camion-azul-9" })).status).toBe(401);
    expect(falso.updateUser).not.toHaveBeenCalled();
  });

  it("la misma regla que la pantalla: ni `tracker` ni corta", async () => {
    for (const [nueva, codigo] of [["tracker", "temporal"], ["corta", "corta"], ["", "corta"]] as const) {
      const r = await pide({ nueva });
      expect(r.status, nueva).toBe(400);
      expect((await r.json()).codigo, nueva).toBe(codigo);
    }
    expect(falso.updateUser).not.toHaveBeenCalled();
  });

  it("si Supabase la rechaza, se dice por qué y no se apunta nada", async () => {
    falso.updateUser.mockImplementation(async () => ({ error: { code: "weak_password", reasons: ["pwned"] } }));
    const r = await pide({ nueva: "password123" });
    expect(r.status).toBe(400);
    expect(await r.json()).toEqual({ ok: false, codigo: "debil", motivos: ["pwned"] });
    expect(falso.logSecurity).not.toHaveBeenCalled();
  });
});

describe("POST /api/reset-password pone la marca", () => {
  it("la contraseña generada va con must_change_password: true, en la misma llamada", async () => {
    const r = await restablecer(new Request("http://localhost/api/reset-password", { method: "POST", body: JSON.stringify({ id: "chofer-1" }) }));
    expect(r.status).toBe(200);
    const { password } = await r.json();
    expect(password).toMatch(/^[A-Z][a-z]+-[A-Z][a-z]+-\d{4}$/);
    expect(falso.updateUserById.mock.calls).toEqual([["chofer-1", { password, user_metadata: { must_change_password: true } }]]);
  });
});

describe("GET /api/impersonate/state cuenta la marca al banner", () => {
  it("dentro de «Entrar como», dice si esa persona la tiene", async () => {
    falso.retorno = retornoValido();
    expect((await (await estado(new Request("http://localhost/api/impersonate/state"))).json()).cambiaContrasena).toBe(true);
    falso.usuarioSsr.user_metadata = {};
    expect((await (await estado(new Request("http://localhost/api/impersonate/state"))).json()).cambiaContrasena).toBe(false);
  });
});

describe("la página /change-password", () => {
  const abre = (next?: string) => ChangePasswordPage({ searchParams: Promise.resolve(next ? { next } : {}) });

  it("con la marca, enseña el formulario con el nombre y el destino saneado", async () => {
    const el = (await abre("/my-route")) as unknown as { props: Record<string, unknown> };
    expect(el.props).toMatchObject({ nombre: "Máximo Garza", destino: "/my-route" });
  });

  it("un next de fuera no se cuela como destino", async () => {
    const el = (await abre("//evil.com")) as unknown as { props: Record<string, unknown> };
    expect(el.props.destino).toBe("/home");
  });

  it("sin la marca, sigue a su destino", async () => {
    falso.usuarioSsr.user_metadata = {};
    await expect(abre("/my-route")).rejects.toThrow("REDIRECT:/my-route");
  });

  it("dentro de «Entrar como», tampoco se queda aquí", async () => {
    falso.retorno = retornoValido();
    await expect(abre()).rejects.toThrow("REDIRECT:/home");
  });
});
