import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

/**
 * El límite de tiempo del middleware (auditoría lote 2). Con el cliente de Supabase simulado,
 * como en `cambio-obligatorio-middleware.test.ts`: el camino de producción, no `deps`.
 *
 * Fija:
 *   · Supabase colgado → 503 a los ~4 s, sin redirigir a nadie (ni al login ni a la página).
 *   · Supabase con fallo de red → 503, y NO se confunde con «no hay sesión» (eso sigue al login).
 *   · Sesión normal → pasa, como siempre.
 *   · Ruta pública sin sesión → se sirve como antes aunque Supabase esté colgado.
 */

const falso = vi.hoisted(() => ({
  // Lo que devuelve `auth.getUser()` en la próxima llamada. Por defecto: la promesa nunca resuelve.
  getUser: (() => new Promise(() => {})) as () => Promise<unknown>,
}));

vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({
    auth: {
      getUser: () => falso.getUser(),
      getSession: async () => ({ data: { session: null } }),
    },
    // La puerta de sesión y la de dispositivo: sin regla (`null`), que es la dirección segura.
    rpc: () => ({ single: async () => ({ data: null, error: null }) }),
  }),
}));

import { updateSession, respuestaSinServicio, LIMITE_SUPABASE_MS } from "@/lib/supabase/middleware";

const pedir = (path: string) => new NextRequest(new URL(`https://hub.test${path}`));

describe("updateSession con Supabase que no responde", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("el límite es de unos 4 segundos", () => {
    expect(LIMITE_SUPABASE_MS).toBe(4000);
  });

  it("getUser colgado: a los 4 s responde 503 de página, sin redirigir", async () => {
    falso.getUser = () => new Promise(() => {}); // nunca resuelve
    let contestada = false;
    const promesa = updateSession(pedir("/home")).then((r) => {
      contestada = true;
      return r;
    });

    await vi.advanceTimersByTimeAsync(LIMITE_SUPABASE_MS - 1);
    expect(contestada).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    const r = await promesa;
    expect(r.status).toBe(503);
    expect(r.headers.get("location")).toBeNull();
    expect(r.headers.get("retry-after")).toBe("30");
    expect(r.headers.get("cache-control")).toBe("no-store");
    expect(r.headers.get("content-type")).toContain("text/html");
    const html = await r.text();
    expect(html).toContain("Servicio no disponible");
    expect(html).toContain("Service unavailable");
    expect(html).toContain('href="/home"');
  });

  it("fallo de red del servidor de auth: 503, no el login", async () => {
    falso.getUser = async () => ({
      data: { user: null },
      error: { name: "AuthRetryableFetchError", message: "fetch failed", status: 0 },
    });
    const r = await updateSession(pedir("/tracker"));
    expect(r.status).toBe(503);
    expect(r.headers.get("location")).toBeNull();
  });

  it("un 5xx del servidor de auth también es «no responde»", async () => {
    falso.getUser = async () => ({
      data: { user: null },
      error: { name: "AuthApiError", message: "bad gateway", status: 502 },
    });
    const r = await updateSession(pedir("/tracker"));
    expect(r.status).toBe(503);
  });

  it("ruta pública sin sesión: se sirve como antes, aunque Supabase esté colgado", async () => {
    falso.getUser = () => new Promise(() => {});
    const promesa = updateSession(pedir("/login"));
    await vi.advanceTimersByTimeAsync(LIMITE_SUPABASE_MS);
    const r = await promesa;
    expect(r.status).not.toBe(503);
    expect(r.headers.get("location")).toBeNull();
  });
});

describe("updateSession cuando Supabase sí contesta", () => {
  it("un error de auth normal (sin sesión) NO es 503: sigue al login con su next", async () => {
    falso.getUser = async () => ({
      data: { user: null },
      error: { name: "AuthSessionMissingError", message: "Auth session missing!", status: 400 },
    });
    const r = await updateSession(pedir("/ventas?x=1"));
    expect(r.status).toBe(307);
    expect(r.headers.get("location")).toBe(
      "https://hub.test/login?next=" + encodeURIComponent("/ventas?x=1"),
    );
  });

  it("sesión normal: pasa sin redirigir y sin 503", async () => {
    falso.getUser = async () => ({
      data: { user: { id: "u1", user_metadata: {} } },
      error: null,
    });
    const r = await updateSession(pedir("/home"));
    expect(r.status).toBe(200);
    expect(r.headers.get("location")).toBeNull();
  });
});

describe("respuestaSinServicio", () => {
  it("una ruta de API recibe JSON 503 con su código", async () => {
    const r = respuestaSinServicio(pedir("/api/orders"));
    expect(r.status).toBe(503);
    expect(r.headers.get("retry-after")).toBe("30");
    expect(r.headers.get("cache-control")).toBe("no-store");
    expect(await r.json()).toEqual({ error: "service_unavailable" });
  });

  it("una página recibe HTML bilingüe con Reintentar, y el enlace escapa lo que venga en la URL", async () => {
    const r = respuestaSinServicio(pedir('/home?q="><script>'));
    expect(r.status).toBe(503);
    const html = await r.text();
    expect(html).toContain("Servicio no disponible");
    expect(html).toContain("Service unavailable");
    expect(html).toContain("Reintentar");
    expect(html).not.toContain("<script>");
  });
});

describe("el enlace Reintentar solo vuelve a una ruta propia", () => {
  it("rechaza //host y /\host", async () => {
    const { readFileSync } = await import("node:fs");
    const s = readFileSync("src/lib/supabase/middleware.ts", "utf8");
    expect(s).toContain('/^\/(?![/\\])/.test(destino) ? destino : "/"');
  });
});
