import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

// D-406: la ruta de cron que reprograma las Intertiendas. Exige el secreto, `ensayo` no escribe, y
// sin ensayo escribe fecha + evento. El cliente de Supabase es falso: nada sale de esta máquina.

const falso = vi.hoisted(() => ({ creados: 0, ops: [] as { tabla: string; op: string; valor?: unknown }[] }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => {
    falso.creados++;
    return {
      from: (tabla: string) => {
        const op = { tabla, op: "select", valor: undefined as unknown };
        const resuelve = () => {
          falso.ops.push(op);
          if (tabla === "settings") return { data: { order_type_rules: { Intertienda: { storeToStore: true, homeIsDestination: true } }, order_types: ["Intertienda"] }, error: null };
          if (tabla === "deliveries" && op.op === "select") return { data: [{ id: "x1", order_type: "Intertienda", stage: "ready", delivery_date: "2000-01-01", is_training: false }], error: null };
          if (tabla === "deliveries") return { data: [{ id: "x1" }], error: null };
          return { data: null, error: null };
        };
        const q: Record<string, unknown> = {};
        for (const m of ["select", "eq", "lt", "not"]) q[m] = () => q;
        q.update = (v: unknown) => { op.op = "update"; op.valor = v; return q; };
        q.insert = (v: unknown) => { op.op = "insert"; op.valor = v; return q; };
        q.maybeSingle = async () => resuelve();
        q.then = (ok: (v: unknown) => unknown) => Promise.resolve(resuelve()).then(ok);
        return q;
      },
    };
  },
}));
import { GET } from "@/app/api/cron/reprogramar-intertiendas/route";

const RUTA = "http://localhost/api/cron/reprogramar-intertiendas";
const pide = (qs = "", cabeceras: Record<string, string> = {}) => GET(new Request(RUTA + qs, { headers: cabeceras }));
const escrituras = () => falso.ops.filter((x) => x.op !== "select");

beforeEach(() => { falso.creados = 0; falso.ops = []; vi.stubEnv("CRON_SECRET", "s3creto"); vi.spyOn(console, "log").mockImplementation(() => {}); });
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe("la ruta exige el secreto", () => {
  it("sin cabecera: 401 y ni se crea el cliente de servicio", async () => {
    const r = await pide("?ensayo=1");
    expect(r.status).toBe(401);
    expect(falso.creados).toBe(0);
  });
  it("con un secreto equivocado: 401", async () => {
    expect((await pide("", { authorization: "Bearer otro" })).status).toBe(401);
    expect(falso.creados).toBe(0);
  });
  it("sin CRON_SECRET configurado no pasa nadie, ni con «Bearer » vacío", async () => {
    vi.stubEnv("CRON_SECRET", "");
    expect((await pide("", { authorization: "Bearer " })).status).toBe(401);
    expect(falso.creados).toBe(0);
  });
  it("verify=1 confirma el secreto sin leer ni escribir", async () => {
    const r = await pide("?verify=1", { authorization: "Bearer s3creto" });
    expect(r.status).toBe(200);
    expect(falso.creados).toBe(0);
  });
});

describe("ensayo y ejecución", () => {
  it("?ensayo=1 no escribe nada y dice lo que haría", async () => {
    const r = await pide("?ensayo=1", { authorization: "Bearer s3creto" });
    expect(r.status).toBe(200);
    const cuerpo = await r.json();
    expect(cuerpo).toMatchObject({ ok: true, ensayo: true, movidas: 1 });
    expect(cuerpo.ordenes[0]).toMatchObject({ id: "x1", antes: "2000-01-01" });
    expect(escrituras()).toEqual([]);
  });
  it("sin ensayo escribe la fecha y el evento con el valor anterior", async () => {
    const r = await pide("", { authorization: "Bearer s3creto" });
    expect(r.status).toBe(200);
    const w = escrituras();
    expect(w.map((x) => `${x.tabla}:${x.op}`)).toEqual(["deliveries:update", "order_events:insert"]);
    expect((w[1].valor as { note: string }).note).toMatch(/^Reprogramada automáticamente: 2000-01-01 → \d{4}-\d{2}-\d{2} \(no se entregó\)$/);
  });
});

describe("programada en vercel.json", () => {
  const vercel = JSON.parse(readFileSync(join(process.cwd(), "vercel.json"), "utf8")) as { crons: { path: string; schedule: string }[] };
  it("una vez al día a las 07:05 UTC: pasada la medianoche de Texas en verano (02:05) y en invierno (01:05)", () => {
    const c = vercel.crons.find((x) => x.path === "/api/cron/reprogramar-intertiendas");
    expect(c?.schedule).toBe("5 7 * * *");
    expect(existsSync(join(process.cwd(), "src/app/api/cron/reprogramar-intertiendas/route.ts"))).toBe(true);
  });
  it("todas las entradas son diarias (Vercel Hobby rechaza el despliegue si alguna corre más de una vez al día)", () => {
    for (const c of vercel.crons) expect(c.schedule, c.path).toMatch(/^\d{1,2} \d{1,2} \* \* \*$/);
  });
});
