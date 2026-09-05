import { describe, it, expect } from "vitest";
import { pruneDriverLocations, PRUNE_KEEP_DAYS, PRUNE_KEEP_DAYS_MIN, type FetchLike } from "./driver-locations-prune";

// G-23 (D-200). La poda se prueba con un fetch FALSO: nada toca producción. Se vigila lo que
// un cron puede hacer mal en silencio: la RPC equivocada, la clave equivocada (tiene que ser la
// de servicio), el perfil de esquema, y el número de días.

type Call = { url: string; init?: RequestInit };
function fakeFetch(reply: { ok: boolean; status: number; body: unknown }) {
  const calls: Call[] = [];
  const f: FetchLike = async (url, init) => {
    calls.push({ url, init });
    return { ok: reply.ok, status: reply.status, json: async () => reply.body, text: async () => String(reply.body) };
  };
  return { f, calls };
}

describe("pruneDriverLocations", () => {
  it("llama a la RPC con la clave de servicio, perfil public y keep_days = 90 por defecto", async () => {
    const { f, calls } = fakeFetch({ ok: true, status: 200, body: 1234 });
    const out = await pruneDriverLocations({ url: "https://x.supabase.co", key: "service-key", fetchImpl: f });
    expect(out).toEqual({ ok: true, keepDays: 90, removed: 1234 });
    expect(PRUNE_KEEP_DAYS).toBe(90);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://x.supabase.co/rest/v1/rpc/prune_driver_locations");
    expect(calls[0].init?.method).toBe("POST");
    const h = calls[0].init?.headers as Record<string, string>;
    expect(h.apikey).toBe("service-key");
    expect(h.Authorization).toBe("Bearer service-key");
    expect(h["Content-Profile"]).toBe("public");
    expect(JSON.parse(calls[0].init!.body as string)).toEqual({ keep_days: 90 });
  });

  it("respeta un keep_days distinto, y NUNCA baja del suelo de 30 días", async () => {
    // Observación del auditor: con el secreto filtrado, keep_days=1 habría vaciado la tabla.
    expect(PRUNE_KEEP_DAYS_MIN).toBe(30);
    const { f, calls } = fakeFetch({ ok: true, status: 200, body: 0 });
    await pruneDriverLocations({ url: "u", key: "k", keepDays: 45, fetchImpl: f });
    expect(JSON.parse(calls[0].init!.body as string)).toEqual({ keep_days: 45 });
    // 30 justo: pasa tal cual (es el suelo, no "más de").
    const en30 = await pruneDriverLocations({ url: "u", key: "k", keepDays: 30, fetchImpl: f });
    expect(JSON.parse(calls[1].init!.body as string)).toEqual({ keep_days: 30 });
    expect(en30).toEqual({ ok: true, keepDays: 30, removed: 0 });
    for (const bajo of [29, 1, 0, -5]) {
      const out = await pruneDriverLocations({ url: "u", key: "k", keepDays: bajo, fetchImpl: f });
      expect(JSON.parse(calls[calls.length - 1].init!.body as string)).toEqual({ keep_days: 30 });
      expect(out).toEqual({ ok: true, keepDays: 30, removed: 0 });
    }
  });

  it("un fallo de PostgREST se devuelve con su estado y su texto, sin lanzar", async () => {
    const { f } = fakeFetch({ ok: false, status: 401, body: "permission denied" });
    const out = await pruneDriverLocations({ url: "u", key: "k", fetchImpl: f });
    expect(out).toEqual({ ok: false, keepDays: 90, status: 401, error: "permission denied" });
  });

  it("si la RPC contesta con un número como texto, lo lee igual", async () => {
    const { f } = fakeFetch({ ok: true, status: 200, body: "42" });
    const out = await pruneDriverLocations({ url: "u", key: "k", fetchImpl: f });
    expect(out).toEqual({ ok: true, keepDays: 90, removed: 42 });
  });
});
