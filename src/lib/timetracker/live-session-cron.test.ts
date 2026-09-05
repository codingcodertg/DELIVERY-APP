import { describe, it, expect } from "vitest";
import { cerrarSesionesHuerfanas, timetrackerRestHeaders, type FetchLike } from "./live-session-cron";
import { LATIDO_MAX_MS } from "./live-session";

// D-NEXT, parte B. El cron que cierra huérfanas, probado con un fetch FALSO y datos sintéticos:
// nada toca producción. Se vigila lo que un cron puede hacer mal en silencio: leer el esquema
// equivocado (sin el perfil `timetracker` PostgREST contesta desde public), cerrar una que
// todavía late, o cerrarla "ahora" en vez de en su último latido.

const MIN = 60_000;
const URL = "https://x.supabase.co";
const KEY = "service-key";

type Call = { url: string; init?: RequestInit };
function fakeFetch(rows: unknown, opts: { getOk?: boolean; patchOkFor?: (id: string) => boolean } = {}) {
  const calls: Call[] = [];
  const f: FetchLike = async (url, init) => {
    calls.push({ url, init });
    if (!init?.method || init.method === "GET") {
      return { ok: opts.getOk ?? true, status: opts.getOk === false ? 500 : 200, json: async () => rows };
    }
    const id = decodeURIComponent(url.split("id=eq.")[1].split("&")[0]);
    const ok = opts.patchOkFor ? opts.patchOkFor(id) : true;
    return { ok, status: ok ? 204 : 500, json: async () => null };
  };
  return { f, calls };
}

describe("cerrarSesionesHuerfanas", () => {
  const now = Date.UTC(2026, 8, 5, 8, 0, 0); // 08:00Z, la hora del cron
  const T0 = now - 3 * 60 * MIN;              // arrancaron hace 3 h

  it("manda el perfil de esquema timetracker en TODAS las llamadas", () => {
    const h: Record<string, string> = timetrackerRestHeaders(KEY, { Prefer: "return=minimal" });
    expect(h["Accept-Profile"]).toBe("timetracker");
    expect(h["Content-Profile"]).toBe("timetracker");
    expect(h.Authorization).toBe(`Bearer ${KEY}`);
    expect(h.Prefer).toBe("return=minimal");
  });

  it("cierra solo las huérfanas, cada una en su último latido, y deja en paz a las que laten", async () => {
    const rows = [
      { id: "viva", start_ms: T0, end_ms: now - 5 * MIN },
      { id: "huerfana", start_ms: T0, end_ms: now - 40 * MIN },
      { id: "nunca-latio", start_ms: String(now - 20 * MIN), end_ms: null }, // bigint como string
      { id: "reciente-sin-latido", start_ms: now - 2 * MIN, end_ms: null },
    ];
    const { f, calls } = fakeFetch(rows);
    const out = await cerrarSesionesHuerfanas({ url: URL, key: KEY, now, fetchImpl: f });
    expect(out).toEqual({ ok: true, vivas: 4, huerfanas: 2, cerradas: 2, fallidas: [] });

    const get = calls[0];
    expect(get.url).toBe(`${URL}/rest/v1/sessions?select=id,start_ms,end_ms&is_live=eq.true`);
    expect((get.init?.headers as Record<string, string>)["Accept-Profile"]).toBe("timetracker");

    const patches = calls.slice(1);
    expect(patches.map((c) => c.init?.method)).toEqual(["PATCH", "PATCH"]);
    expect(patches[0].url).toBe(`${URL}/rest/v1/sessions?id=eq.huerfana&is_live=eq.true`);
    expect(JSON.parse(patches[0].init!.body as string)).toEqual({ is_live: false, end_ms: now - 40 * MIN, duration_seconds: (3 * 60 - 40) * 60 });
    expect(patches[1].url).toBe(`${URL}/rest/v1/sessions?id=eq.nunca-latio&is_live=eq.true`);
    expect(JSON.parse(patches[1].init!.body as string)).toEqual({ is_live: false, end_ms: now - 20 * MIN, duration_seconds: 0 });
    expect((patches[0].init?.headers as Record<string, string>)["Content-Profile"]).toBe("timetracker");
    expect((patches[0].init?.headers as Record<string, string>).Prefer).toBe("return=minimal");
  });

  it("usa el mismo umbral que la pantalla: a 15:00 exactos no cierra, a 15:01 sí", async () => {
    const rows = [
      { id: "en-el-umbral", start_ms: T0, end_ms: now - LATIDO_MAX_MS },
      { id: "pasada", start_ms: T0, end_ms: now - LATIDO_MAX_MS - 1000 },
    ];
    const { f, calls } = fakeFetch(rows);
    const out = await cerrarSesionesHuerfanas({ url: URL, key: KEY, now, fetchImpl: f });
    expect(out.huerfanas).toBe(1);
    expect(calls.filter((c) => c.init?.method === "PATCH").map((c) => c.url)).toEqual([`${URL}/rest/v1/sessions?id=eq.pasada&is_live=eq.true`]);
  });

  it("si el SELECT falla, no hace ningún PATCH y lo dice", async () => {
    const { f, calls } = fakeFetch([], { getOk: false });
    const out = await cerrarSesionesHuerfanas({ url: URL, key: KEY, now, fetchImpl: f });
    expect(out.ok).toBe(false);
    expect(calls).toHaveLength(1);
  });

  it("un PATCH que falla queda en `fallidas` y no para a los demás", async () => {
    const rows = [
      { id: "a", start_ms: T0, end_ms: now - 30 * MIN },
      { id: "b", start_ms: T0, end_ms: now - 30 * MIN },
    ];
    const { f } = fakeFetch(rows, { patchOkFor: (id) => id !== "a" });
    const out = await cerrarSesionesHuerfanas({ url: URL, key: KEY, now, fetchImpl: f });
    expect(out).toEqual({ ok: true, vivas: 2, huerfanas: 2, cerradas: 1, fallidas: ["a"] });
  });

  it("sin sesiones vivas no toca nada", async () => {
    const { f, calls } = fakeFetch([]);
    const out = await cerrarSesionesHuerfanas({ url: URL, key: KEY, now, fetchImpl: f });
    expect(out).toEqual({ ok: true, vivas: 0, huerfanas: 0, cerradas: 0, fallidas: [] });
    expect(calls).toHaveLength(1);
  });
});
