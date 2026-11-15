import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

// `POST /api/indeed-bot/ingest`: sin variable 503, con límite 429, sin token o token malo 401, cuerpo grande 413 y,
// con el token bueno, los elementos pasan por la misma lógica que el buzón (aquí, un solicitud sin teléfono, que se
// omite antes de tocar nada). La base es falsa; si la ruta intentara crear algo, la prueba lo vería.

const h = vi.hoisted(() => ({
  creados: 0,
  limite: { ok: true } as { ok: true } | { ok: false; reset: number },
  registro: new Map<string, Record<string, unknown>>(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => {
    h.creados++;
    return {
      schema: () => ({
        from: () => ({
          insert: (row: Record<string, unknown>) => {
            if (h.registro.has(row.message_id as string)) return { error: { code: "23505", message: "dup" } };
            h.registro.set(row.message_id as string, { ...row });
            return { error: null };
          },
          update: (cambios: Record<string, unknown>) => ({
            eq: (_c: string, v: string) => {
              Object.assign(h.registro.get(v) ?? {}, cambios);
              return { error: null };
            },
          }),
        }),
      }),
    } as unknown as SupabaseClient;
  },
}));

vi.mock("@/lib/rate-limit", () => ({
  limita: async () => h.limite,
  respuesta429: (reset: number) => new Response(JSON.stringify({ error: "Too many requests" }), { status: 429, headers: { "Retry-After": String(reset) } }),
}));

import { POST } from "@/app/api/indeed-bot/ingest/route";

const TOKEN = "t0k3n-de-prueba";
const SIN_TELEFONO = { items: [{ kind: "application", externalId: "r-1", receivedAt: "2026-11-13T14:05:00Z", candidateName: "Ana Peña" }] };

function pide(cuerpo: unknown, cabecera?: string) {
  return new Request("http://x/api/indeed-bot/ingest", {
    method: "POST",
    headers: { "content-type": "application/json", ...(cabecera !== undefined ? { authorization: cabecera } : {}) },
    body: typeof cuerpo === "string" ? cuerpo : JSON.stringify(cuerpo),
  });
}

beforeEach(() => {
  h.creados = 0;
  h.limite = { ok: true };
  h.registro = new Map();
  vi.stubEnv("INDEED_BOT_TOKEN", TOKEN);
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("POST /api/indeed-bot/ingest", () => {
  it("sin INDEED_BOT_TOKEN en el servidor: 503 y no se crea nada", async () => {
    vi.stubEnv("INDEED_BOT_TOKEN", "");
    const r = await POST(pide(SIN_TELEFONO, `Bearer ${TOKEN}`));
    expect(r.status).toBe(503);
    expect(h.creados).toBe(0);
  });

  it("sin cabecera o con otro token: 401 y no se crea nada", async () => {
    expect((await POST(pide(SIN_TELEFONO))).status).toBe(401);
    expect((await POST(pide(SIN_TELEFONO, "Bearer otro"))).status).toBe(401);
    expect((await POST(pide(SIN_TELEFONO, `Basic ${TOKEN}`))).status).toBe(401);
    expect(h.creados).toBe(0);
  });

  it("pasado el límite por IP: 429", async () => {
    h.limite = { ok: false, reset: Math.floor(Date.now() / 1000) + 30 };
    const r = await POST(pide(SIN_TELEFONO, `Bearer ${TOKEN}`));
    expect(r.status).toBe(429);
    expect(h.creados).toBe(0);
  });

  it("cuerpo que pasa de 4 MB: 413", async () => {
    const r = await POST(pide("x".repeat(4 * 1024 * 1024 + 1), `Bearer ${TOKEN}`));
    expect(r.status).toBe(413);
    expect(h.creados).toBe(0);
  });

  it("JSON roto o forma no válida: 400", async () => {
    expect((await POST(pide("{no json", `Bearer ${TOKEN}`))).status).toBe(400);
    const r = await POST(pide({ items: [] }, `Bearer ${TOKEN}`));
    expect(r.status).toBe(400);
    expect((await r.json()).error).toContain("items");
  });

  it("con el token bueno: 200, un resultado por elemento, y reenviar lo mismo no duplica", async () => {
    const primera = await POST(pide(SIN_TELEFONO, `Bearer ${TOKEN}`));
    expect(primera.status).toBe(200);
    const cuerpo = await primera.json();
    expect(cuerpo.results).toEqual([
      expect.objectContaining({ externalId: "r-1", result: "skipped", error: "sin teléfono ni correo del candidato" }),
    ]);
    expect(h.creados).toBe(1);

    const segunda = await POST(pide(SIN_TELEFONO, `Bearer ${TOKEN}`));
    const otra = await segunda.json();
    expect(otra.results[0]).toMatchObject({ externalId: "r-1", result: "skipped" });
    expect(otra.results[0].error).toContain("ya recibido antes");
  });
});
