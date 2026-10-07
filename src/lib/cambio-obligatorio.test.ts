import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { NextRequest } from "next/server";
import { updateSession, type PuertaDeSesion } from "@/lib/supabase/middleware";
import { COOKIE_RETORNO, empaquetar } from "@/lib/impersonation-cookie";
import {
  CONTRASENA_TEMPORAL,
  MIN_CONTRASENA_NUEVA,
  PONER_MARCA,
  QUITAR_MARCA,
  RUTA_CAMBIO_OBLIGATORIO,
  debeCambiarContrasena,
  decideCambioObligatorio,
  destinoTrasCambio,
  mensajeCambioObligatorio,
  validaNuevaObligatoria,
  type CodigoCambioObligatorio,
} from "./cambio-obligatorio";

/**
 * Cambiar la contraseña temporal al entrar (D-NEXT). Tres clases de prueba:
 *   1. Lo que se decide sin red: la marca, quién pasa, a dónde vuelve, qué contraseña vale.
 *   2. El middleware de verdad (`updateSession`) con la sesión simulada: que ninguna app se salta
 *      la puerta, que la salida queda abierta, y que «Entrar como» pasa.
 *   3. Que la pantalla y el formulario usan estas funciones, y no unas suyas.
 */

const src = (f: string) => readFileSync(f, "utf8");

describe("la marca", () => {
  it("solo `true` obliga", () => {
    expect(debeCambiarContrasena({ user_metadata: { must_change_password: true } })).toBe(true);
    expect(debeCambiarContrasena({ user_metadata: { must_change_password: false } })).toBe(false);
    expect(debeCambiarContrasena({ user_metadata: { must_change_password: "true" } })).toBe(false);
    expect(debeCambiarContrasena({ user_metadata: {} })).toBe(false);
    expect(debeCambiarContrasena({})).toBe(false);
    expect(debeCambiarContrasena(null)).toBe(false);
  });

  it("poner y quitar escriben la misma clave que se lee", () => {
    expect(debeCambiarContrasena({ user_metadata: { ...PONER_MARCA } })).toBe(true);
    expect(debeCambiarContrasena({ user_metadata: { ...PONER_MARCA, ...QUITAR_MARCA } })).toBe(false);
    expect(PONER_MARCA).toEqual({ must_change_password: true });
    expect(QUITAR_MARCA).toEqual({ must_change_password: false });
  });
});

describe("quién pasa (decideCambioObligatorio)", () => {
  const d = (pathWithSearch: string, debeCambiar = true, suplantando = false) =>
    decideCambioObligatorio({ pathWithSearch, debeCambiar, suplantando });

  it("con la marca, cualquier pantalla de cualquier app va a cambiarla, recordando a dónde iba", () => {
    for (const p of ["/", "/home", "/my-route", "/timetracker", "/timetracker/clock-in", "/recruiting", "/erp", "/estimator", "/home/profile"]) {
      expect(d(p), p).toEqual({ kind: "redirect", to: `${RUTA_CAMBIO_OBLIGATORIO}?next=${encodeURIComponent(p)}` });
    }
    expect(d("/?order=42")).toEqual({ kind: "redirect", to: "/change-password?next=%2F%3Forder%3D42" });
  });

  it("sin la marca, nada", () => {
    expect(d("/home", false)).toEqual({ kind: "next" });
  });

  it("un admin dentro de «Entrar como» pasa aunque esa persona tenga la marca", () => {
    expect(d("/home", true, true)).toEqual({ kind: "next" });
  });

  it("la propia pantalla, la salida y lo público quedan abiertos: nadie queda encerrado", () => {
    for (const p of [RUTA_CAMBIO_OBLIGATORIO, `${RUTA_CAMBIO_OBLIGATORIO}?next=%2Fhome`, "/auth/signout", "/login", "/track/abc", "/no-access"]) {
      expect(d(p), p).toEqual({ kind: "next" });
    }
  });

  it("una ruta que solo EMPIEZA igual no cuela", () => {
    expect(d("/change-passwordx").kind).toBe("redirect");
  });
});

describe("a dónde vuelve (destinoTrasCambio)", () => {
  it("al inicio por defecto, que manda al chofer a «Mi ruta»", () => {
    expect(destinoTrasCambio(null)).toBe("/home");
    expect(destinoTrasCambio("/my-route")).toBe("/my-route");
  });
  it("nunca a fuera ni a la propia pantalla", () => {
    expect(destinoTrasCambio("//evil.com")).toBe("/home");
    expect(destinoTrasCambio("/change-password")).toBe("/home");
    expect(destinoTrasCambio("/change-password?next=%2Fhome")).toBe("/home");
    expect(destinoTrasCambio("/change-password/x")).toBe("/home");
  });
});

describe("qué contraseña vale (validaNuevaObligatoria)", () => {
  it("la temporal no, ni dentro de otra, ni en mayúsculas — y se dice eso, no que es corta", () => {
    expect(validaNuevaObligatoria({ nueva: CONTRASENA_TEMPORAL })).toBe("temporal");
    expect(validaNuevaObligatoria({ nueva: "Tracker2026" })).toBe("temporal");
  });
  it(`al menos ${MIN_CONTRASENA_NUEVA} caracteres`, () => {
    expect(MIN_CONTRASENA_NUEVA).toBe(8);
    expect(validaNuevaObligatoria({ nueva: "a".repeat(7) })).toBe("corta");
    expect(validaNuevaObligatoria({ nueva: "a".repeat(8) })).toBeNull();
  });
  it("repetirla tiene que coincidir; el servidor no la recibe y no la mira", () => {
    expect(validaNuevaObligatoria({ nueva: "camion-azul", confirmacion: "camion-azu" })).toBe("no_coinciden");
    expect(validaNuevaObligatoria({ nueva: "camion-azul", confirmacion: "camion-azul" })).toBeNull();
    expect(validaNuevaObligatoria({ nueva: "camion-azul" })).toBeNull();
  });
  it("cada código tiene su texto en los dos idiomas, y distinto", () => {
    const codigos: CodigoCambioObligatorio[] = ["temporal", "corta", "no_coinciden", "no_hace_falta", "suplantando"];
    const en = codigos.map((c) => mensajeCambioObligatorio(c, (e) => e));
    const es = codigos.map((c) => mensajeCambioObligatorio(c, (_e, s) => s));
    expect(new Set(en).size).toBe(codigos.length);
    expect(new Set(es).size).toBe(codigos.length);
    expect(en.every((m, i) => m !== es[i])).toBe(true);
  });
});

describe("el middleware: ninguna app se salta la puerta", () => {
  const pedir = (ruta: string, retorno?: string) => {
    const req = new NextRequest(new URL(`https://hub.test${ruta}`));
    req.cookies.set("sb-access-token", "x");
    if (retorno) req.cookies.set(COOKIE_RETORNO, retorno);
    return req;
  };
  const sinCorte = async () => null;

  it("con la marca, /my-route va a cambiarla", async () => {
    const r = await updateSession(pedir("/my-route"), { getUser: async () => true, gate: sinCorte, debeCambiar: true });
    expect(r.status).toBe(307);
    expect(r.headers.get("location")).toBe("https://hub.test/change-password?next=%2Fmy-route");
  });

  it("y el fichaje del teléfono también", async () => {
    const r = await updateSession(pedir("/timetracker/clock-in"), { getUser: async () => true, gate: sinCorte, debeCambiar: true });
    expect(r.headers.get("location")).toBe("https://hub.test/change-password?next=%2Ftimetracker%2Fclock-in");
  });

  it("la pantalla de cambiarla y la API que usa se sirven", async () => {
    for (const p of ["/change-password", "/api/profile/password/forced"]) {
      const r = await updateSession(pedir(p), { getUser: async () => true, gate: sinCorte, debeCambiar: true });
      expect(r.headers.get("location"), p).toBeNull();
    }
  });

  it("sin la marca, se pasa", async () => {
    const r = await updateSession(pedir("/my-route"), { getUser: async () => true, gate: sinCorte, debeCambiar: false });
    expect(r.headers.get("location")).toBeNull();
  });

  it("con «Entrar como» vivo, el admin pasa", async () => {
    const retorno = empaquetar({ refresh: "rt", adminId: "a1", comoId: "c1", inicio: Date.now() });
    const r = await updateSession(pedir("/my-route", retorno), { getUser: async () => true, gate: sinCorte, debeCambiar: true });
    expect(r.headers.get("location")).toBeNull();
  });

  it("el cierre de las 18:30 manda antes: sesión cerrada va al login, tenga o no la marca", async () => {
    const manana = new Date("2026-09-11T14:00:00Z");
    const puerta: PuertaDeSesion = { session_created_at: "2026-09-10T15:00:00Z", deliveries_role: "driver", clockin_role: null };
    const r = await updateSession(pedir("/my-route"), { getUser: async () => true, gate: async () => puerta, ahora: manana, debeCambiar: true });
    expect(r.headers.get("location")).toBe("https://hub.test/login?next=%2Fmy-route");
  });
});

describe("la pantalla, el formulario y el banner usan esto mismo", () => {
  it("la página mira la marca, la suplantación, y el destino con las funciones de aquí", () => {
    const p = src("src/app/change-password/page.tsx");
    expect(p).toMatch(/suplantando \|\| !debeCambiarContrasena\(user\)/);
    expect(p).toMatch(/destinoTrasCambio\(/);
  });
  it("el formulario valida con la misma regla que el servidor y llama a la ruta forzada", () => {
    const f = src("src/components/CambioObligatorioForm.tsx");
    expect(f).toMatch(/validaNuevaObligatoria\(\{ nueva, confirmacion: repetida \}\)/);
    expect(f).toContain('fetch("/api/profile/password/forced"');
    expect(f).toContain('action="/auth/signout"');
    expect(f).toContain("window.location.href = destino");
  });
  it("el banner de «Entrar como» enseña el aviso cuando el estado lo dice", () => {
    const b = src("src/components/ImpersonationBanner.tsx");
    expect(b).toMatch(/\{estado\.cambiaContrasena && \(/);
    expect(b).toMatch(/cambiaContrasena: d\.cambiaContrasena === true/);
  });
  it("el diálogo de Usuarios avisa al admin de que se le pedirá cambiarla", () => {
    expect(src("src/components/UserDialog.tsx")).toContain("Al entrar se le pedirá que elija una suya.");
  });
});
