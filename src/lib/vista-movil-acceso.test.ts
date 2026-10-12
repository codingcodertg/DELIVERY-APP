import { describe, it, expect, vi, beforeEach } from "vitest";
import { empaquetar } from "@/lib/impersonation-cookie";
import { EVENTO_ENTRAR, EVENTO_VOLVER } from "@/lib/impersonation";
import {
  esSuplantacionDeUnAdmin,
  leerSuplantacion,
  puedeAbrirLaVistaMovil,
  type PruebaDeSuplantacion,
} from "@/lib/vista-movil-acceso";

/**
 * Quién entra a la vista móvil (D-278, D-NEXT): el admin, o un admin DENTRO de la cuenta de otra persona.
 * Primero la regla, con datos; después la puerta de verdad (`layout.tsx`) con Supabase falso, para ver que
 * la pantalla usa la regla y le da lo que toca: el rastro del admin de la cookie, no el de cualquiera.
 */

const AHORA = Date.parse("2026-10-11T18:00:00Z");
const MIN = 60_000;
const hace = (min: number) => new Date(AHORA - min * MIN).toISOString();

const vuelta = (o: Partial<{ adminId: string; comoId: string; inicio: number }> = {}) => ({
  refresh: "rt", adminId: "admin-1", comoId: "chofer-1", inicio: AHORA - 10 * MIN, ...o,
});
const prueba = (o: Partial<PruebaDeSuplantacion> = {}): PruebaDeSuplantacion => ({
  vuelta: vuelta(),
  rolDeQuienEntro: "admin",
  ultimoRastro: { kind: EVENTO_ENTRAR, created_at: hace(10) },
  ...o,
});

describe("la regla: ¿es un admin dentro de la cuenta de esta persona?", () => {
  it("con todo en orden, sí", () => {
    expect(esSuplantacionDeUnAdmin(prueba(), "chofer-1", AHORA)).toBe(true);
  });

  it("la cookie tiene que ser de ESTA sesión", () => {
    expect(esSuplantacionDeUnAdmin(prueba({ vuelta: vuelta({ comoId: "otra" }) }), "chofer-1", AHORA)).toBe(false);
    expect(esSuplantacionDeUnAdmin(prueba(), "", AHORA)).toBe(false);
    expect(esSuplantacionDeUnAdmin(null, "chofer-1", AHORA)).toBe(false);
  });

  it("caducada la hora de D-243, no", () => {
    expect(esSuplantacionDeUnAdmin(prueba({ vuelta: vuelta({ inicio: AHORA - 61 * MIN }) }), "chofer-1", AHORA)).toBe(false);
    expect(esSuplantacionDeUnAdmin(prueba({ vuelta: vuelta({ inicio: AHORA - 59 * MIN }) }), "chofer-1", AHORA)).toBe(true);
  });

  it("quien la abrió tiene que ser admin HOY", () => {
    for (const rol of ["driver", "manager", "", null, undefined]) {
      expect(esSuplantacionDeUnAdmin(prueba({ rolDeQuienEntro: rol }), "chofer-1", AHORA), String(rol)).toBe(false);
    }
  });

  it("sin la fila de ENTRAR del rastro, no: la cookie sola se puede escribir a mano", () => {
    expect(esSuplantacionDeUnAdmin(prueba({ ultimoRastro: null }), "chofer-1", AHORA)).toBe(false);
    // La última fila es una vuelta: esa suplantación ya se cerró.
    expect(esSuplantacionDeUnAdmin(prueba({ ultimoRastro: { kind: EVENTO_VOLVER, created_at: hace(5) } }), "chofer-1", AHORA)).toBe(false);
    expect(esSuplantacionDeUnAdmin(prueba({ ultimoRastro: { kind: "password_reset", created_at: hace(5) } }), "chofer-1", AHORA)).toBe(false);
  });

  it("y la entrada tiene que ser de la última hora (con el minuto de margen de la cookie), con fecha que se entienda", () => {
    expect(esSuplantacionDeUnAdmin(prueba({ ultimoRastro: { kind: EVENTO_ENTRAR, created_at: hace(62) } }), "chofer-1", AHORA)).toBe(false);
    expect(esSuplantacionDeUnAdmin(prueba({ ultimoRastro: { kind: EVENTO_ENTRAR, created_at: hace(60.5) } }), "chofer-1", AHORA)).toBe(true);
    expect(esSuplantacionDeUnAdmin(prueba({ ultimoRastro: { kind: EVENTO_ENTRAR, created_at: "ayer" } }), "chofer-1", AHORA)).toBe(false);
    expect(esSuplantacionDeUnAdmin(prueba({ ultimoRastro: { kind: EVENTO_ENTRAR, created_at: null } }), "chofer-1", AHORA)).toBe(false);
    // Del futuro, más allá de un minuto de desfase de relojes: no.
    expect(esSuplantacionDeUnAdmin(prueba({ ultimoRastro: { kind: EVENTO_ENTRAR, created_at: hace(-5) } }), "chofer-1", AHORA)).toBe(false);
  });
});

describe("la puerta: el admin, o un admin suplantando", () => {
  it("el admin entra sin más, haya lo que haya", () => {
    expect(puedeAbrirLaVistaMovil({ rolDeLaSesion: "admin", usuarioId: "a", suplantacion: null, ahora: AHORA })).toBe(true);
  });

  it("cualquier otro rol, sin suplantación válida, no", () => {
    for (const rol of ["driver", "sales", "manager", "warehouse", "logistics", "accounting", null]) {
      expect(puedeAbrirLaVistaMovil({ rolDeLaSesion: rol, usuarioId: "chofer-1", suplantacion: null, ahora: AHORA }), String(rol)).toBe(false);
      expect(puedeAbrirLaVistaMovil({ rolDeLaSesion: rol, usuarioId: "chofer-1", suplantacion: prueba({ rolDeQuienEntro: "driver" }), ahora: AHORA }), String(rol)).toBe(false);
    }
  });

  it("con una suplantación válida de un admin, sí", () => {
    expect(puedeAbrirLaVistaMovil({ rolDeLaSesion: "driver", usuarioId: "chofer-1", suplantacion: prueba(), ahora: AHORA })).toBe(true);
  });
});

describe("reunir la prueba", () => {
  const lectores = () => ({
    rolDe: vi.fn(async (_id: string) => "admin" as string | null),
    ultimoRastro: vi.fn(async (_a: string, _u: string) => ({ kind: EVENTO_ENTRAR, created_at: hace(3) })),
  });

  it("sin cookie no pregunta nada a la base: es la visita de casi todos los que no son admin", async () => {
    const l = lectores();
    expect(await leerSuplantacion({ cookie: undefined, usuarioId: "chofer-1", ...l })).toBeNull();
    expect(await leerSuplantacion({ cookie: "no-es-json", usuarioId: "chofer-1", ...l })).toBeNull();
    expect(l.rolDe).not.toHaveBeenCalled();
    expect(l.ultimoRastro).not.toHaveBeenCalled();
  });

  it("con la cookie de OTRA persona tampoco", async () => {
    const l = lectores();
    expect(await leerSuplantacion({ cookie: empaquetar(vuelta({ comoId: "otra" })), usuarioId: "chofer-1", ...l })).toBeNull();
    expect(l.rolDe).not.toHaveBeenCalled();
  });

  it("pregunta el rol del ADMIN de la cookie (no el de la sesión) y el rastro entre él y esta persona", async () => {
    const l = lectores();
    const p = await leerSuplantacion({ cookie: empaquetar(vuelta()), usuarioId: "chofer-1", ...l });
    expect(l.rolDe.mock.calls).toEqual([["admin-1"]]);
    expect(l.ultimoRastro.mock.calls).toEqual([["admin-1", "chofer-1"]]);
    expect(p).toEqual({ vuelta: vuelta(), rolDeQuienEntro: "admin", ultimoRastro: { kind: EVENTO_ENTRAR, created_at: hace(3) } });
  });

  it("si una lectura falla, no hay prueba (y la puerta dice que no)", async () => {
    const l = lectores();
    l.ultimoRastro.mockImplementation(async () => { throw new Error("red"); });
    expect(await leerSuplantacion({ cookie: empaquetar(vuelta()), usuarioId: "chofer-1", ...l })).toBeNull();
  });
});

// ---- La puerta de verdad: layout.tsx + vista-movil-servidor.ts, con Supabase falso ---------------------

const f = vi.hoisted(() => ({
  user: { id: "chofer-1", user_metadata: {} } as { id: string; user_metadata: Record<string, unknown> } | null,
  rolSesion: "driver" as string,
  cookie: null as string | null,
  rolAdmin: "admin" as string | null,
  rastro: [] as { kind: string; created_at: string }[],
  consultas: [] as Record<string, unknown>[],
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (n: string) => (n === "rtg_impersonation_return" && f.cookie !== null ? { value: f.cookie } : undefined) }),
}));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => { throw new Error(`REDIRECT:${url}`); },
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: f.user } }) },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { role: f.rolSesion, module_access: [] }, error: null }) }) }) }),
  }),
}));
vi.mock("@/lib/erp/supabase/admin", () => ({ adminKey: () => "sb_secret_de_prueba" }));
vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    from: (tabla: string) => {
      const filtros: Record<string, unknown> = { tabla };
      const b = {
        select: () => b,
        eq: (c: string, v: unknown) => { filtros[c] = v; return b; },
        in: (c: string, v: unknown) => { filtros[c] = v; return b; },
        order: () => b,
        limit: async () => { f.consultas.push(filtros); return { data: f.rastro, error: null }; },
        maybeSingle: async () => { f.consultas.push(filtros); return { data: { role: f.rolAdmin }, error: null }; },
      };
      return b;
    },
  }),
}));

import VistaMovilLayout from "@/app/home/vista-movil/layout";
import VistaMovilPage from "@/app/home/vista-movil/page";

const abre = () => VistaMovilLayout({ children: "la vista" });
const ahoraIso = (minAtras: number) => new Date(Date.now() - minAtras * MIN).toISOString();

beforeEach(() => {
  f.user = { id: "chofer-1", user_metadata: {} };
  f.rolSesion = "driver";
  f.cookie = null;
  f.rolAdmin = "admin";
  f.rastro = [];
  f.consultas = [];
});

describe("la puerta de /home/vista-movil, de verdad", () => {
  it("el admin entra, y no se le pregunta nada más", async () => {
    f.rolSesion = "admin";
    expect(await abre()).toBeTruthy();
    expect(f.consultas).toEqual([]);
  });

  it("un chofer sin suplantación va a su pantalla, sin preguntar a la base", async () => {
    await expect(abre()).rejects.toThrow(/^REDIRECT:\//);
    expect(f.consultas).toEqual([]);
  });

  it("un admin dentro de la cuenta del chofer entra: cookie de esta sesión, admin hoy y su fila de entrar", async () => {
    f.cookie = empaquetar({ refresh: "rt", adminId: "admin-1", comoId: "chofer-1", inicio: Date.now() - 5 * MIN });
    f.rastro = [{ kind: EVENTO_ENTRAR, created_at: ahoraIso(5) }];
    expect(await abre()).toBeTruthy();
    // Lo que se preguntó: el rol del admin de la cookie, y el rastro entre ÉL y la persona de la sesión.
    expect(f.consultas).toContainEqual({ tabla: "profiles", id: "admin-1" });
    expect(f.consultas).toContainEqual({
      tabla: "security_events", actor_id: "admin-1", target_id: "chofer-1", kind: [EVENTO_ENTRAR, EVENTO_VOLVER],
    });
  });

  it("una cookie escrita a mano, sin fila de entrar del rastro, no abre la puerta", async () => {
    f.cookie = empaquetar({ refresh: "x", adminId: "admin-1", comoId: "chofer-1", inicio: Date.now() });
    await expect(abre()).rejects.toThrow(/^REDIRECT:/);
  });

  it("ni con fila de entrar si quien figura ya no es admin, ni si después volvió", async () => {
    f.cookie = empaquetar({ refresh: "rt", adminId: "admin-1", comoId: "chofer-1", inicio: Date.now() - 5 * MIN });
    f.rastro = [{ kind: EVENTO_ENTRAR, created_at: ahoraIso(5) }];
    f.rolAdmin = "manager";
    await expect(abre()).rejects.toThrow(/^REDIRECT:/);
    f.rolAdmin = "admin";
    f.rastro = [{ kind: EVENTO_VOLVER, created_at: ahoraIso(1) }];
    await expect(abre()).rejects.toThrow(/^REDIRECT:/);
  });

  it("sin sesión, al login", async () => {
    f.user = null;
    await expect(abre()).rejects.toThrow("REDIRECT:/login?next=/home/vista-movil");
  });
});

describe("la página: sin ruta, el marco abre el inicio del rol de la sesión (D-NEXT)", () => {
  const props = async (q: { ruta?: string }) =>
    ((await VistaMovilPage({ searchParams: Promise.resolve(q) })) as unknown as { props: Record<string, unknown> }).props;

  it("dentro de la cuenta de un chofer, `/driver`; para el admin, la portada de siempre", async () => {
    expect(await props({})).toMatchObject({ rutaInicial: "/driver", rutaDeInicio: "/driver" });
    expect(await props({ ruta: "//evil.com" })).toMatchObject({ rutaInicial: "/driver" });
    expect(await props({ ruta: "/my-route" })).toMatchObject({ rutaInicial: "/my-route" });
    f.rolSesion = "admin";
    expect(await props({})).toMatchObject({ rutaInicial: "/", rutaDeInicio: "/" });
  });
});
