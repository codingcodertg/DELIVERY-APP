import { describe, it, expect, vi, beforeEach } from "vitest";
import { COOKIE_RETORNO, empaquetar, desempaquetar } from "./impersonation-cookie";
import { EVENTO_ENTRAR, EVENTO_VOLVER } from "./impersonation";

/**
 * Saltar de un usuario a otro sin volver antes a la propia cuenta (D-NEXT).
 *
 * El dueño: «si estoy en otro usuario ya con el switch, que siga la opción para seguir switcheando».
 *
 * Mientras se suplanta, la sesión ES la de la otra persona (D-243), así que entrar en un tercero con
 * ella no vale: `/api/impersonate` tomaría el refresh token del suplantado (paso 6) y la cookie de
 * vuelta llevaría a él, no al admin. Hoy eso lo para el 403 de `puedeEntrarComo`, por accidente y no
 * por diseño. Esta ruta lo hace por diseño: **primero restaura al admin**, y todo lo demás se decide
 * con esa sesión.
 *
 * Nada de esto llama a Auth de verdad: Supabase, cookies, rastro y revocación son falsos, como en
 * `cierre-sesion-local.test.ts`. Lo que se mira es el ORDEN de las llamadas y con qué datos se escribe
 * la cookie, que es exactamente lo que decide a quién vuelve el admin.
 */

const falso = vi.hoisted(() => ({
  llamadas: [] as string[],
  // La sesión con la que llega la petición (la del suplantado) y la que devuelve refreshSession.
  sesionActual: { access_token: "jwt-del-vendedor-1", refresh_token: "rt-del-vendedor-1", user: { id: "vendedor-1" } } as
    { access_token: string; refresh_token: string; user: { id: string } } | null,
  refreshFalla: false,
  perfiles: [
    { id: "admin-1", role: "admin", full_name: "Ada Admin" },
    { id: "vendedor-1", role: "sales", full_name: "Vera Vendedora" },
    { id: "vendedor-2", role: "sales", full_name: "Víctor Vendedor" },
    { id: "admin-2", role: "admin", full_name: "Otro Admin" },
  ],
  cuentaExiste: true,
  enlaceFalla: false,
  canjeFalla: false,
  rastroFalla: false,
  activa: true,
  galletaRetorno: null as string | null,
  galletasPuestas: [] as { nombre: string; valor: string }[],
  borradas: [] as string[],
  rastro: [] as { actorId: string | null; targetId: string | null; kind: string; detail?: string | null }[],
  revocados: [] as (string | null | undefined)[],
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getSession: async () => { falso.llamadas.push("getSession"); return { data: { session: falso.sesionActual } }; },
      refreshSession: async (args: { refresh_token: string }) => {
        falso.llamadas.push("refreshSession:" + args.refresh_token);
        if (falso.refreshFalla) return { data: { session: null }, error: { message: "refresh caducado" } };
        // Supabase rota el refresh token al usarlo: el de la sesión nueva NO es el que se pasó.
        falso.sesionActual = { access_token: "jwt-del-admin", refresh_token: "rt-del-admin-ROTADO", user: { id: "admin-1" } };
        return { data: { session: falso.sesionActual }, error: null };
      },
      signOut: async (o?: unknown) => { falso.llamadas.push("signOut:" + JSON.stringify(o)); return { error: null }; },
      verifyOtp: async () => {
        falso.llamadas.push("verifyOtp");
        if (falso.canjeFalla) return { error: { message: "canje" } };
        falso.sesionActual = { access_token: "jwt-del-vendedor-2", refresh_token: "rt-del-vendedor-2", user: { id: "vendedor-2" } };
        return { error: null };
      },
    },
  }),
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    from: () => ({
      select: () => ({
        in: async (_col: string, ids: string[]) => ({ data: falso.perfiles.filter((p) => ids.includes(p.id)), error: null }),
      }),
    }),
    auth: {
      admin: {
        getUserById: async (id: string) => {
          falso.llamadas.push("getUserById:" + id);
          return falso.cuentaExiste
            ? { data: { user: { id, email: id + "@users.test" } }, error: null }
            : { data: { user: null }, error: { message: "no existe" } };
        },
        generateLink: async () => {
          falso.llamadas.push("generateLink");
          return falso.enlaceFalla
            ? { data: null, error: { message: "enlace" } }
            : { data: { properties: { hashed_token: "hash-x" } }, error: null };
        },
      },
    },
  }),
}));

vi.mock("@/lib/erp/supabase/admin", () => ({ adminKey: () => "llave-falsa" }));
vi.mock("@/lib/impersonation-flag", () => ({ impersonacionActiva: () => falso.activa }));
vi.mock("@/lib/impersonation-log", () => ({
  apuntarImpersonacion: async (a: { actorId: string | null; targetId: string | null; kind: string; detail?: string | null }) => {
    falso.llamadas.push("rastro:" + a.kind);
    if (falso.rastroFalla) return false;
    falso.rastro.push(a);
    return true;
  },
}));
vi.mock("@/lib/impersonation-revoke", () => ({
  revocarSesionImpersonada: async (jwt: string | null | undefined) => { falso.llamadas.push("revocar:" + jwt); falso.revocados.push(jwt); return true; },
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: () => (falso.galletaRetorno === null ? undefined : { value: falso.galletaRetorno }),
    set: (nombre: string, valor: string) => { falso.galletasPuestas.push({ nombre, valor }); },
    delete: (nombre: string) => { falso.borradas.push(nombre); },
  }),
}));

import { POST as saltar } from "@/app/api/impersonate/switch/route";

const INICIO = Date.now() - 12 * 60_000;
// La cookie dice «admin-9» a propósito: la sesión que devuelve `refreshSession` es la de «admin-1», y
// es ESA la que manda. Con los dos ids iguales, un mutante que leyera el admin de la cookie pasaba.
const dentroDeVendedor1 = () =>
  empaquetar({ refresh: "rt-del-admin-ORIGINAL", adminId: "admin-9", comoId: "vendedor-1", inicio: INICIO });
const pedir = (targetId: unknown) =>
  new Request("https://hub.test/api/impersonate/switch", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": "10.0.0.7" },
    body: JSON.stringify({ targetId }),
  });

beforeEach(() => {
  falso.llamadas = [];
  falso.sesionActual = { access_token: "jwt-del-vendedor-1", refresh_token: "rt-del-vendedor-1", user: { id: "vendedor-1" } };
  falso.refreshFalla = false;
  falso.cuentaExiste = true;
  falso.enlaceFalla = false;
  falso.canjeFalla = false;
  falso.rastroFalla = false;
  falso.activa = true;
  falso.galletaRetorno = dentroDeVendedor1();
  falso.galletasPuestas = [];
  falso.borradas = [];
  falso.rastro = [];
  falso.revocados = [];
});

describe("el salto restaura al admin ANTES de decidir nada", () => {
  it("el orden: sesión ajena → refresh del admin → roles → revocar la anterior → rastro → enlace → cookie", async () => {
    const r = await saltar(pedir("vendedor-2"));
    expect(r.status).toBe(200);
    const i = (s: string) => falso.llamadas.findIndex((l) => l.startsWith(s));
    // Se toma el token de la sesión ajena antes de restaurar: después ya no está.
    expect(i("getSession")).toBeLessThan(i("refreshSession:"));
    // Y el refresh que se usa es el de la cookie, el del admin.
    expect(falso.llamadas).toContain("refreshSession:rt-del-admin-ORIGINAL");
    // La sesión del vendedor anterior se cierra, solo esa.
    expect(falso.revocados).toEqual(["jwt-del-vendedor-1"]);
    expect(i("refreshSession:")).toBeLessThan(i("revocar:"));
    // El rastro va antes del enlace: sin fila no hay sesión, como al entrar.
    expect(i("rastro:" + EVENTO_ENTRAR)).toBeLessThan(i("generateLink"));
    expect(i("generateLink")).toBeLessThan(i("verifyOtp"));
  });

  it("la cookie nueva lleva al ADMIN, con el refresh rotado de la sesión restaurada, y conserva el inicio", async () => {
    await saltar(pedir("vendedor-2"));
    expect(falso.galletasPuestas.map((g) => g.nombre)).toEqual([COOKIE_RETORNO]);
    const guardado = desempaquetar(falso.galletasPuestas[0].valor)!;
    // NO el refresh viejo de la cookie (Supabase lo rotó al usarlo) y NO el del vendedor.
    expect(guardado.refresh).toBe("rt-del-admin-ROTADO");
    // El admin es el de la sesión restaurada, no lo que dijera la cookie.
    expect(guardado.adminId).toBe("admin-1");
    expect(guardado.comoId).toBe("vendedor-2");
    // El reloj de 60 minutos NO se reinicia: saltar no lo estira (D-245 lo llama límite de seguridad).
    expect(guardado.inicio).toBe(INICIO);
  });

  it("deja dos filas: el fin del anterior diciendo que fue un salto, y el principio del nuevo diciendo desde quién", async () => {
    await saltar(pedir("vendedor-2"));
    expect(falso.rastro.map((f) => f.kind)).toEqual([EVENTO_VOLVER, EVENTO_ENTRAR]);
    const [fin, principio] = falso.rastro;
    expect([fin.actorId, fin.targetId]).toEqual(["admin-1", "vendedor-1"]);
    expect(fin.detail).toContain("motivo: switch");
    expect(fin.detail).toContain("12 min");
    expect([principio.actorId, principio.targetId]).toEqual(["admin-1", "vendedor-2"]);
    expect(principio.detail).toContain("desde: Vera Vendedora");
  });

  it("y la cookie se escribe SOLO al final: si algo falla antes, no queda apuntando a nadie", async () => {
    falso.canjeFalla = true;
    const r = await saltar(pedir("vendedor-2"));
    expect(r.status).not.toBe(200);
    expect(falso.galletasPuestas).toEqual([]);
  });
});

describe("lo que no puede pasar", () => {
  it("sin cookie de retorno no hay salto: no se restaura nada ni se escribe nada", async () => {
    falso.galletaRetorno = null;
    const r = await saltar(pedir("vendedor-2"));
    expect(r.status).toBe(409);
    expect(await r.json()).toEqual({ error: "sin_impersonacion" });
    expect(falso.llamadas.some((l) => l.startsWith("refreshSession:"))).toBe(false);
    expect(falso.galletasPuestas).toEqual([]);
  });

  it("si el refresh del admin ya no vale, se sale del todo: cookie fuera, sesión local cerrada, al login", async () => {
    falso.refreshFalla = true;
    const r = await saltar(pedir("vendedor-2"));
    expect(r.status).toBe(401);
    expect(await r.json()).toEqual({ ok: false, salida: "login" });
    expect(falso.borradas).toContain(COOKIE_RETORNO);
    expect(falso.llamadas).toContain('signOut:{"scope":"local"}');
    expect(falso.galletasPuestas).toEqual([]);
  });

  it("quien no es admin en la sesión RESTAURADA no salta, aunque la cookie diga adminId", async () => {
    // La cookie no decide quién es admin: el rol se lee de la base para la sesión que devolvió
    // refreshSession. Aquí esa sesión resulta ser de un vendedor.
    falso.perfiles = falso.perfiles.map((p) => (p.id === "admin-1" ? { ...p, role: "sales" } : p));
    const r = await saltar(pedir("vendedor-2"));
    expect(r.status).toBe(403);
    expect(falso.galletasPuestas).toEqual([]);
    falso.perfiles = falso.perfiles.map((p) => (p.id === "admin-1" ? { ...p, role: "admin" } : p));
  });

  it("no se salta a otro admin ni a uno mismo", async () => {
    expect((await saltar(pedir("admin-2"))).status).toBe(403);
    expect((await saltar(pedir("admin-1"))).status).toBe(403);
    expect(falso.galletasPuestas).toEqual([]);
  });

  it("con la bandera apagada la ruta no existe", async () => {
    falso.activa = false;
    expect((await saltar(pedir("vendedor-2"))).status).toBe(404);
  });
});

describe("cuando el destino falla DESPUÉS de restaurar al admin", () => {
  it("el estado final es «admin restaurado, banner fuera», y la respuesta lo dice para que la pantalla recargue", async () => {
    const r = await saltar(pedir("admin-2"));
    expect(r.status).toBe(403);
    const cuerpo = await r.json();
    expect(cuerpo.salida).toBe("admin");
    // La sesión del vendedor anterior se cerró igualmente, la cookie se borró, y quedó su fila de fin.
    expect(falso.revocados).toEqual(["jwt-del-vendedor-1"]);
    expect(falso.borradas).toContain(COOKIE_RETORNO);
    expect(falso.rastro.map((f) => f.kind)).toEqual([EVENTO_VOLVER]);
    expect(falso.galletasPuestas).toEqual([]);
  });

  it("lo mismo si la cuenta de destino no existe en Auth, o el enlace no se genera", async () => {
    falso.cuentaExiste = false;
    let r = await saltar(pedir("vendedor-2"));
    expect([r.status, (await r.json()).salida]).toEqual([404, "admin"]);
    falso.cuentaExiste = true;
    falso.enlaceFalla = true;
    r = await saltar(pedir("vendedor-2"));
    expect([r.status, (await r.json()).salida]).toEqual([502, "admin"]);
    expect(falso.galletasPuestas).toEqual([]);
  });

  it("y si no se puede escribir el rastro del nuevo, no hay sesión nueva: el admin se queda restaurado", async () => {
    falso.rastroFalla = true;
    const r = await saltar(pedir("vendedor-2"));
    expect([r.status, (await r.json()).salida]).toEqual([503, "admin"]);
    expect(falso.llamadas).not.toContain("generateLink");
    expect(falso.galletasPuestas).toEqual([]);
  });
});
