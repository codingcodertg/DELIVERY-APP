import { describe, it, expect, vi, beforeEach } from "vitest";
import { empaquetar } from "./impersonation-cookie";
import { candidatosParaSaltar } from "./impersonation";

/**
 * La lista de a quién se puede saltar (D-NEXT): solo lo que el panel pinta, y ya filtrada con la
 * misma regla que la ruta de saltar. Con Supabase falso: no se toca Auth ni la base.
 */

const falso = vi.hoisted(() => ({
  activa: true,
  galletaRetorno: null as string | null,
  usuarioSesion: { id: "vendedor-1" } as { id: string } | null,
  perfiles: [
    { id: "admin-1", full_name: "Ada Admin", role: "admin", store: null },
    { id: "vendedor-1", full_name: "Vera Vendedora", role: "sales", store: "Tienda Norte" },
    { id: "vendedor-2", full_name: "Víctor Vendedor", role: "sales", store: "Tienda Sur" },
    { id: "admin-2", full_name: "Otro Admin", role: "admin", store: null },
  ],
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: falso.usuarioSesion } }) } }),
}));
vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    from: (tabla: string) => ({
      select: () => ({
        order: async () => ({ data: tabla === "profiles" ? falso.perfiles : [], error: null }),
        eq: () => ({ maybeSingle: async () => ({ data: { stores: [{ name: "Tienda Norte" }, { name: "Tienda Sur" }] } }) }),
      }),
    }),
  }),
}));
vi.mock("@/lib/erp/supabase/admin", () => ({ adminKey: () => "llave-falsa" }));
vi.mock("@/lib/impersonation-flag", () => ({ impersonacionActiva: () => falso.activa }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => (falso.galletaRetorno === null ? undefined : { value: falso.galletaRetorno }) }),
}));

import { GET as candidatos } from "@/app/api/impersonate/switch/candidates/route";

const cookie = (adminId = "admin-1") => empaquetar({ refresh: "rt", adminId, comoId: "vendedor-1", inicio: Date.now() });

beforeEach(() => {
  falso.activa = true;
  falso.galletaRetorno = cookie();
  falso.usuarioSesion = { id: "vendedor-1" };
});

describe("la regla pura", () => {
  it("quita a los admin y a uno mismo, y deja solo lo que se pinta", () => {
    const lista = candidatosParaSaltar({ id: "admin-1", rol: "admin" }, [
      ...falso.perfiles, { id: "x", full_name: "Extra", role: "driver", store: null, email: "secreto@x" } as never,
    ]);
    expect(lista.map((c) => c.id)).toEqual(["vendedor-1", "vendedor-2", "x"]);
    // En TODOS, y sobre todo en «x», que trae un correo de más: mirarlo solo en el primero dejaba
    // pasar un `{ ...p }` que devolvía cada columna (lo cazó un mutante).
    for (const c of lista) expect(Object.keys(c).sort(), c.id).toEqual(["full_name", "id", "role", "store"]);
  });

  it("si quien pregunta no es admin, no hay nadie", () => {
    expect(candidatosParaSaltar({ id: "vendedor-1", rol: "sales" }, falso.perfiles)).toEqual([]);
  });
});

describe("la ruta", () => {
  it("devuelve los candidatos ya filtrados y las tiendas", async () => {
    const r = await candidatos();
    expect(r.status).toBe(200);
    const cuerpo = await r.json();
    expect(cuerpo.users.map((u: { id: string }) => u.id)).toEqual(["vendedor-1", "vendedor-2"]);
    expect(cuerpo.stores.map((s: { name: string }) => s.name)).toEqual(["Tienda Norte", "Tienda Sur"]);
  });

  it("sin cookie de retorno no hay lista: no es un salto", async () => {
    falso.galletaRetorno = null;
    expect((await candidatos()).status).toBe(409);
  });

  it("una cookie pegada a otra sesión no lista a nadie", async () => {
    falso.usuarioSesion = { id: "otro" };
    expect((await candidatos()).status).toBe(401);
  });

  it("si el admin de la cookie ya no es admin, la lista está vacía", async () => {
    falso.galletaRetorno = cookie("vendedor-2");
    const cuerpo = await (await candidatos()).json();
    expect(cuerpo.users).toEqual([]);
  });

  it("con la bandera apagada, no existe", async () => {
    falso.activa = false;
    expect((await candidatos()).status).toBe(404);
  });
});
