import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock del cliente de servicio CRUDO (el limitador usa createClient directo, sin el wrapper de enseñanza): cada prueba
// decide qué devuelve la RPC.
const rpc = vi.fn();
vi.mock("@supabase/supabase-js", () => ({ createClient: () => ({ rpc }) }));

import { ipDe, limita, respuesta429 } from "./rate-limit";

const pet = (headers: Record<string, string>) => new Request("https://x/api/notify", { headers });

beforeEach(() => {
  rpc.mockReset();
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://x.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "svc-test";
});

describe("ipDe", () => {
  it("toma el primer salto de x-forwarded-for", () => {
    expect(ipDe(pet({ "x-forwarded-for": "1.2.3.4, 5.6.7.8" }))).toBe("1.2.3.4");
  });
  it("cae a x-real-ip", () => {
    expect(ipDe(pet({ "x-real-ip": "9.9.9.9" }))).toBe("9.9.9.9");
  });
  it("sin cabeceras, devuelve un marcador", () => {
    expect(ipDe(pet({}))).toBe("ip-desconocida");
  });
});

describe("limita", () => {
  it("deja pasar cuando la RPC dice allowed", async () => {
    rpc.mockResolvedValue({ data: { allowed: true, hits: 1, limit: 60, reset: 100 }, error: null });
    const r = await limita(pet({ "x-forwarded-for": "1.1.1.1" }), { clave: "notify", max: 60, ventanaSeg: 60 });
    expect(r.ok).toBe(true);
    expect(rpc).toHaveBeenCalledWith("check_rate_limit", { p_bucket: "notify:1.1.1.1", p_max: 60, p_window_seconds: 60 });
  });

  it("corta cuando la RPC dice NO allowed, con el reset", async () => {
    rpc.mockResolvedValue({ data: { allowed: false, hits: 61, limit: 60, reset: 12345 }, error: null });
    const r = await limita(pet({ "x-forwarded-for": "2.2.2.2" }), { clave: "notify", max: 60, ventanaSeg: 60 });
    expect(r).toEqual({ ok: false, reset: 12345 });
  });

  it("FALLA ABIERTO si la RPC devuelve error (p. ej. migración no aplicada)", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "42883", message: "function does not exist" } });
    const r = await limita(pet({ "x-forwarded-for": "3.3.3.3" }), { clave: "notify", max: 60, ventanaSeg: 60 });
    expect(r.ok).toBe(true);
  });

  it("FALLA ABIERTO si la llamada lanza", async () => {
    rpc.mockRejectedValue(new Error("boom"));
    const r = await limita(pet({ "x-forwarded-for": "4.4.4.4" }), { clave: "notify", max: 60, ventanaSeg: 60 });
    expect(r.ok).toBe(true);
  });
});

describe("respuesta429", () => {
  it("es 429 con Retry-After", async () => {
    const reset = Math.floor(Date.now() / 1000) + 30;
    const res = respuesta429(reset);
    expect(res.status).toBe(429);
    const ra = Number(res.headers.get("Retry-After"));
    expect(ra).toBeGreaterThan(0);
    expect(ra).toBeLessThanOrEqual(30);
    const cuerpo = await res.json();
    expect(cuerpo.error).toBe("Too many requests");
  });
});
