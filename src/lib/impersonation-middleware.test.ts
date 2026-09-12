import { describe, it, expect } from "vitest";
import { NextRequest } from "next/server";
import { readFileSync } from "node:fs";
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

  it("una cookie ilegible no corta la sesión, pero SE BARRE", async () => {
    // Ignorarla la dejaba viva hasta una hora llevando dentro el refresh token de un admin, y
    // sin poder usarse para nada bueno: `desempaquetar` ya dijo que no vale. Lo que no se puede
    // usar, se tira. La sesión que haya la resuelve el guard de siempre.
    const r = await updateSession(pedir("no soy json"), { getUser: async () => true });
    expect(r.status).not.toBe(307);
    expect(r.cookies.getAll().map((c) => c.name)).toContain(COOKIE_RETORNO);
  });

  // El agujero que abría arreglar la vuelta sin arreglar esto: el admin entra como Patricia,
  // pulsa «Cerrar sesión» en la barra en vez de «Volver», y se va. Su refresh token sigue vivo
  // en la cookie hasta una hora. El siguiente que entre en ese equipo vería el banner y un botón
  // que le daría la sesión del admin.
  it("una cookie de retorno sin sesión es huérfana y se barre", async () => {
    const r = await updateSession(pedir(vuelta(Date.now())), { getUser: async () => false });
    expect(r.cookies.getAll().map((c) => c.name)).toContain(COOKIE_RETORNO);
  });

  it("y con sesión viva y dentro de la hora NO se barre, que es el control", async () => {
    const r = await updateSession(pedir(vuelta(Date.now())), { getUser: async () => true });
    expect(r.cookies.getAll().map((c) => c.name)).not.toContain(COOKIE_RETORNO);
  });
});

// ---- Los dos caminos que no tienen prueba de comportamiento, fijados por forma --------------
// El canje contra el proveedor de Auth no se puede probar sin el proveedor de verdad, así que
// lo que se fija aquí es la llamada. No es lo mismo que probar que funciona, y por eso está
// dicho; pero sí impide que vuelva la versión que no funcionaba nunca.
describe("la vuelta usa la llamada que sí restaura", () => {
  const src = readFileSync("src/app/api/impersonate/return/route.ts", "utf8");
  const codigo = src.split(/\r?\n/).filter((l) => {
    const t = l.trim();
    return !t.startsWith("//") && !t.startsWith("*") && !t.startsWith("/*");
  }).join("\n");

  it("llama a refreshSession con el refresh token", () => {
    expect(codigo).toMatch(/refreshSession\(\{\s*refresh_token:/);
  });

  it("y NO a setSession con un access_token vacío, que fallaba siempre", () => {
    // Medido en @supabase/auth-js 2.112.4: `_setSession` lanza AuthSessionMissingError si el
    // access_token viene vacío, y esa comprobación va antes de mirar el refresh token.
    expect(codigo).not.toContain("setSession");
    expect(codigo).not.toContain('access_token: ""');
  });
});

describe("el cierre de sesión de servidor se lleva la cookie de retorno", () => {
  it("la borra", () => {
    const src = readFileSync("src/app/auth/signout/route.ts", "utf8");
    expect(src).toContain("COOKIE_RETORNO");
    expect(src).toMatch(/delete\(COOKIE_RETORNO\)/);
  });
});

// Y el barrido se dispara con «no hay usuario» CONFIRMADO, no con «no pude preguntar». Un fallo
// de red de un instante tiene la misma forma que una sesión inexistente —`getUser` devuelve
// `user: null` con `error` en los dos casos—, y borrar la cookie ahí le quitaría al admin la
// vuelta dejándolo en el login con la sesión de la otra persona aún viva.
describe("el barrido distingue una respuesta de un fallo", () => {
  const src = readFileSync("src/lib/supabase/middleware.ts", "utf8");
  const codigo = src.split(/\r?\n/).filter((l) => !l.trim().startsWith("//")).join("\n");

  it("captura el error de getUser en vez de descartarlo", () => {
    expect(codigo).toMatch(/error:\s*errUsuario\s*\}\s*=\s*await supabase\.auth\.getUser\(\)/);
    expect(codigo).toContain("sinUsuarioConfirmado = !user && !errUsuario");
  });

  it("y barre por esa bandera, no por hasUser a secas", () => {
    expect(codigo).toContain("!!cruda && sinUsuarioConfirmado");
    expect(codigo).not.toContain("!!cruda && !hasUser");
  });
});
