import { describe, it, expect } from "vitest";
import { NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";
import { COOKIE_RETORNO, AJUSTES_COOKIE, empaquetar } from "@/lib/impersonation-cookie";
import { IMPERSONACION_MINUTOS, rutaConSesionDeCorreo, sesionDeEntrarComo } from "@/lib/impersonation";
import { marcaPerdidaDelEstado } from "@/lib/suplantacion-en-burbuja";

// El caso del dueño: entró como Zulema, cerró el equipo, la cookie de retorno (61 min) caducó, las `sb-` no, y al
// volver estaba DENTRO de Zulema sin burbuja ni vuelta.

const b64url = (o: unknown) =>
  Buffer.from(JSON.stringify(o)).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const jwt = (amr: unknown) => `${b64url({ alg: "HS256" })}.${b64url({ sub: "z1", amr })}.firma`;

describe("sesionDeEntrarComo: la marca sale del token, no de la cookie", () => {
  it("un magic link (lo que mina «Entrar como») es suplantación", () => {
    expect(sesionDeEntrarComo(jwt([{ method: "magiclink", timestamp: 1 }]))).toBe(true);
    expect(sesionDeEntrarComo(jwt([{ method: "otp", timestamp: 1 }]))).toBe(true);
    expect(sesionDeEntrarComo(jwt(["magiclink"]))).toBe(true);
  });
  it("una entrada con contraseña no lo es", () => {
    expect(sesionDeEntrarComo(jwt([{ method: "password", timestamp: 1 }]))).toBe(false);
  });
  it("basura, vacío o sin amr: no", () => {
    expect(sesionDeEntrarComo(null)).toBe(false);
    expect(sesionDeEntrarComo("")).toBe(false);
    expect(sesionDeEntrarComo("a.b.c")).toBe(false);
    expect(sesionDeEntrarComo(jwt(undefined))).toBe(false);
  });
  it("las pantallas de correo legítimo quedan fuera", () => {
    expect(rutaConSesionDeCorreo("/reset-password")).toBe(true);
    expect(rutaConSesionDeCorreo("/auth/callback")).toBe(true);
    expect(rutaConSesionDeCorreo("/home")).toBe(false);
  });
});

const pedir = (path: string, cookie?: string) => {
  const req = new NextRequest(new URL(`https://hub.test${path}`));
  req.cookies.set("sb-access-token", "x");
  if (cookie) req.cookies.set(COOKIE_RETORNO, cookie);
  return req;
};

describe("el middleware no deja a nadie dentro de una suplantación sin marca", () => {
  it("sesión de «Entrar como» SIN cookie de retorno: al restaurador con motivo lost", async () => {
    const r = await updateSession(pedir("/home"), { getUser: async () => true, deEntrarComo: true });
    expect(r.status).toBe(307);
    expect(r.headers.get("location")).toBe("https://hub.test/api/impersonate/auto-return?motivo=lost");
  });

  it("con su cookie dentro de la hora, sigue (la burbuja se pinta)", async () => {
    const c = empaquetar({ refresh: "rt", adminId: "a1", comoId: "z1", inicio: Date.now() - 5 * 60_000 });
    const r = await updateSession(pedir("/home", c), { getUser: async () => true, deEntrarComo: true });
    expect(r.status).not.toBe(307);
  });

  it("con su cookie pasada la hora, al restaurador por caducidad", async () => {
    const c = empaquetar({ refresh: "rt", adminId: "a1", comoId: "z1", inicio: Date.now() - (IMPERSONACION_MINUTOS + 1) * 60_000 });
    const r = await updateSession(pedir("/home", c), { getUser: async () => true, deEntrarComo: true });
    expect(r.headers.get("location")).toBe("https://hub.test/api/impersonate/auto-return?motivo=expired");
  });

  it("una sesión normal (contraseña) sin cookie no se toca", async () => {
    const r = await updateSession(pedir("/home"), { getUser: async () => true, deEntrarComo: false });
    expect(r.status).not.toBe(307);
  });

  it("en /reset-password una sesión de correo es legítima", async () => {
    const r = await updateSession(pedir("/reset-password"), { getUser: async () => true, deEntrarComo: true });
    expect(r.headers.get("location") ?? "").not.toContain("auto-return");
  });

  it("la cookie de retorno ya no caduca antes que la sesión: dura días, la hora la decide `inicio`", () => {
    expect(AJUSTES_COOKIE.maxAge).toBeGreaterThanOrEqual(24 * 60 * 60);
  });
});

describe("la burbuja se entera de la marca perdida", () => {
  it("marcaPerdidaDelEstado", () => {
    expect(marcaPerdidaDelEstado({ marcaPerdida: true })).toBe(true);
    expect(marcaPerdidaDelEstado({})).toBe(false);
    expect(marcaPerdidaDelEstado(null)).toBe(false);
  });
});
