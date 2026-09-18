import { describe, expect, it, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { NextResponse } from "next/server";

/** `/api/route-plan/actuals` (D-NEXT): qué lee, qué escribe —solo `actual_*`—, y las tres condiciones de la llave de servicio. */

const leer = (r: string) => readFileSync(join(process.cwd(), r), "utf8").split("\r\n").join("\n");
const plano = (s: string) => s.replace(/\s+/g, " ");
const sinComentarios = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").split("\n").map((l) => l.replace(/^\s*\/\/.*$/, "")).join("\n");

type Op = { tabla: string; op: string; filtros: Record<string, unknown>; valor?: unknown };
const falso = vi.hoisted(() => ({
  sesion: true, rol: "logistics", plan: null as { id: string; version: number } | null, paradas: [] as Record<string, unknown>[], posiciones: [] as unknown[],
  ordenes: [] as unknown[], eventos: [] as unknown[], turnos: [] as unknown[], ops: [] as Op[],
  preguntados: [] as string[], adminCreado: 0, rolAlCrearAdmin: null as string | null, usuarios: {} as Record<string, unknown>, noSeDejaGuardar: [] as string[],
}));
vi.mock("@/lib/api-auth", () => ({
  requireUser: async () => (falso.sesion ? {
    ok: true, user: { id: "u1" },
    supabase: {
      from: (tabla: string) => {
        const o: Op = { tabla, op: "select", filtros: {} };
        const lee = () => {
          falso.ops.push(o);
          if (o.op === "update") return { data: falso.noSeDejaGuardar.includes(String(o.filtros["eq:id"])) ? [] : [{ id: o.filtros["eq:id"] }], error: null };
          if (tabla === "profiles") return { data: { role: falso.rol }, error: null };
          if (tabla === "route_plans") return { data: falso.plan, error: null };
          if (tabla === "route_plan_stops") return { data: falso.paradas, error: null };
          if (tabla === "driver_locations") return { data: falso.posiciones, error: null };
          if (tabla === "deliveries") return { data: falso.ordenes, error: null };
          if (tabla === "order_events") return { data: falso.eventos, error: null };
          if (tabla === "driver_shifts") return { data: falso.turnos, error: null };
          return { data: null, error: null };
        };
        const q: Record<string, unknown> = {};
        q.select = () => q;
        for (const m of ["eq", "in", "gte", "lt"]) q[m] = (c: string, v: unknown) => { o.filtros[`${m}:${c}`] = v; return q; };
        q.update = (v: unknown) => { o.op = "update"; o.valor = v; return q; };
        q.maybeSingle = async () => lee();
        q.then = (ok: (v: unknown) => unknown) => ok(lee());
        return q;
      },
    },
  } : { ok: false, response: NextResponse.json({ error: "Not signed in." }, { status: 401 }) }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => {
    falso.adminCreado++;
    // Cuando se crea la llave de servicio, el rol YA tiene que haberse leído.
    falso.rolAlCrearAdmin = falso.ops.some((o) => o.tabla === "profiles") ? falso.rol : "sin-comprobar";
    return {
      from: () => { throw new Error("la llave de servicio no lee tablas aquí"); },
      auth: { admin: { getUserById: async (id: string) => { falso.preguntados.push(id); const u = falso.usuarios[id]; return u === "falla" ? { data: null, error: { message: "x" } } : { data: { user: u ?? null }, error: null }; } } },
    };
  },
}));
import { POST } from "@/app/api/route-plan/actuals/route";

const pide = (cuerpo: unknown) => POST(new Request("http://localhost/api/route-plan/actuals", { method: "POST", body: JSON.stringify(cuerpo) }));
const parada = (id: string, driver_id: string | null, seq: number, kind: "P" | "D", lat: number, delivery_id: string) =>
  ({ id, driver_id, driver_name: driver_id ? `Chofer ${driver_id}` : "", delivery_id, seq, kind, lat, lng: -98.2, eta: 480 + seq * 30, etd: 490 + seq * 30 });
// 2026-03-04 en Chicago es UTC−6: las 08:00 locales son las 14:00Z.
const pos = (driver_id: string, hhmmZ: string, lat: number, dia = "2026-03-04") => ({ driver_id, lat, lng: -98.2, accuracy_m: 10, recorded_at: `${dia}T${hhmmZ}:00.000Z` });

beforeEach(() => {
  Object.assign(falso, {
    sesion: true, rol: "logistics", plan: { id: "plan-publicado", version: 3 }, ops: [], preguntados: [], adminCreado: 0, rolAlCrearAdmin: null, noSeDejaGuardar: [],
    paradas: [parada("s1", "c1", 0, "P", 26.2, "a"), parada("s2", "c1", 1, "D", 26.21, "a"), parada("s3", "c2", 0, "P", 26.2, "b"), parada("s4", "c2", 1, "D", 26.25, "b")],
    posiciones: [pos("c1", "14:05", 26.2), pos("c1", "14:50", 26.21), pos("c1", "03:00", 26.2, "2026-03-04")],
    ordenes: [{ id: "a", pickup_gps_at: null, pod_delivered_at: null }, { id: "b", pickup_gps_at: "2026-03-04T14:10:00.000Z", pod_delivered_at: "2026-03-04T15:00:00.000Z" }],
    eventos: [{ delivery_id: "b", kind: "picked_up", created_by: "c2", created_at: "2026-03-04T14:10:00.000Z" }, { delivery_id: "b", kind: "delivered", created_by: "alguien-de-oficina", created_at: "2026-03-04T15:00:00.000Z" }],
    // c2 abrió turno AL DÍA SIGUIENTE: no es un turno de este día.
    turnos: [{ driver_id: "c1", started_at: "2026-03-04T13:55:00.000Z" }, { driver_id: "c2", started_at: "2026-03-05T14:00:00.000Z" }],
    usuarios: { c1: { id: "c1", email: "secreto@ejemplo.test", last_sign_in_at: "2026-03-01T00:00:00Z" }, c2: { id: "c2", email: "otro@ejemplo.test", last_sign_in_at: null } },
  });
});
const escrituras = () => falso.ops.filter((o) => o.op !== "select");

describe("/api/route-plan/actuals", () => {
  it("sin sesión 401, sin fecha 400, sin ser admin o logística 403 — y en ninguno se crea la llave de servicio ni se escribe", async () => {
    falso.sesion = false;
    expect((await pide({ date: "2026-03-04" })).status).toBe(401);
    falso.sesion = true;
    expect((await pide({ date: "ayer" })).status).toBe(400);
    for (const rol of ["manager", "driver", "warehouse", "sales"]) { falso.rol = rol; expect((await pide({ date: "2026-03-04" })).status).toBe(403); }
    expect([falso.adminCreado, escrituras()]).toEqual([0, []]);
  });

  it("sin plan publicado: `plan: null`, sin llave de servicio y sin escribir", async () => {
    falso.plan = null;
    expect(await (await pide({ date: "2026-03-04" })).json()).toEqual({ ok: true, plan: null });
    expect([falso.adminCreado, escrituras()]).toEqual([0, []]);
    expect(falso.ops.find((o) => o.tabla === "route_plans")!.filtros).toEqual({ "eq:plan_date": "2026-03-04", "eq:status": "published" });
  });

  it("la llave de servicio: el rol se comprueba ANTES; los ids son los del PLAN, nunca los del cuerpo; y sale un booleano, nada más", async () => {
    const res = await pide({ date: "2026-03-04", driver_id: "intruso", drivers: ["intruso"], choferes: ["intruso"] });
    const b = await res.json();
    expect(falso.rolAlCrearAdmin).toBe("logistics");
    expect(falso.preguntados.sort()).toEqual(["c1", "c2"]);
    expect(b.choferes.map((c: Record<string, unknown>) => [c.driver_id, c.ha_entrado])).toEqual([["c1", true], ["c2", false]]);
    expect(Object.keys(b.choferes[0]).sort()).toEqual(["con_turno", "driver_id", "ha_entrado", "nombre", "posiciones"]);
    expect(JSON.stringify(b)).not.toMatch(/secreto|ejemplo\.test|last_sign_in|2026-03-01/);
  });

  it("si preguntar por un chofer falla, es «no se sabe» — no «nunca ha entrado» — y no cuenta como que sí", async () => {
    falso.usuarios = { c1: "falla", c2: { id: "c2", last_sign_in_at: "2026-02-01T00:00:00Z" } };
    const b = await (await pide({ date: "2026-03-04" })).json();
    expect(b.choferes.map((c: { ha_entrado: boolean | null }) => c.ha_entrado)).toEqual([null, true]);
    expect(b.reporte.captura.hanIniciadoSesion).toBe(1);
  });

  it("GPS para c1, toque para la recogida de c2, y la entrega de c2 la marcó OTRA persona: no cuenta. Y el día es el LOCAL", async () => {
    const b = await (await pide({ date: "2026-03-04" })).json();
    expect(b.paradas.map((p: Record<string, unknown>) => [p.id, p.fuente, p.motivo])).toEqual([["s1", "gps", null], ["s2", "gps", null], ["s3", "toque", null], ["s4", null, "la_marco_otra_persona"]]);
    expect(b.reporte).toMatchObject({ paradas: 4, conGPS: 2, conToque: 1, captura: { choferesConRuta: 2, hanIniciadoSesion: 1, conTurno: 1, conPosiciones: 1 } });
    // La posición de las 03:00Z es de la noche ANTERIOR en Texas: no es de este día.
    expect(b.choferes.map((c: { posiciones: number }) => c.posiciones)).toEqual([2, 0]);
    expect(b.choferes.map((c: { con_turno: boolean }) => c.con_turno)).toEqual([true, false]);
  });

  it("escribe SOLO `actual_*`, solo en paradas de ESE plan y solo donde hay dato; la llegada, solo si es de GPS", async () => {
    const b = await (await pide({ date: "2026-03-04" })).json();
    expect(escrituras().map((o) => [o.tabla, o.filtros["eq:id"], o.filtros["eq:plan_id"], Object.keys(o.valor as object).sort()])).toEqual([
      ["route_plan_stops", "s1", "plan-publicado", ["actual_arrival_at", "actual_departure_at"]],
      ["route_plan_stops", "s2", "plan-publicado", ["actual_arrival_at", "actual_departure_at"]],
      ["route_plan_stops", "s3", "plan-publicado", ["actual_arrival_at", "actual_departure_at"]],
    ]);
    expect(escrituras().map((o) => (o.valor as { actual_arrival_at: string | null }).actual_arrival_at)).toEqual(["2026-03-04T14:05:00.000Z", "2026-03-04T14:50:00.000Z", null]);
    expect([b.guardadas, b.noGuardadas]).toEqual([3, []]);
  });

  it("un UPDATE que no alcanza ninguna fila NO cuenta como guardado", async () => {
    falso.noSeDejaGuardar = ["s2"];
    const b = await (await pide({ date: "2026-03-04" })).json();
    expect([b.guardadas, b.noGuardadas]).toEqual([2, ["s2"]]);
  });

  it("no toca órdenes, ni avisa, ni llama a ningún proveedor; y la llave de servicio no lee ninguna tabla", () => {
    const ruta = sinComentarios(leer("src/app/api/route-plan/actuals/route.ts"));
    expect(ruta).not.toMatch(/from\("deliveries"\)\s*\.(update|insert|delete|upsert)|from\("notifications"\)|\.rpc\(|fetch\(|proveedor/);
    expect(ruta).not.toMatch(/admin\s*\.from\(/);
    expect([...ruta.matchAll(/admin\.(\w+(?:\.\w+)*)\(/g)].map((m) => m[1])).toEqual(["auth.admin.getUserById"]);
    expect([...ruta.matchAll(/\.(update|insert|delete|upsert)\(/g)].length).toBe(1);
    expect(plano(ruta)).toContain(".update({ actual_arrival_at: a.actual_arrival_at, actual_departure_at: a.actual_departure_at }).eq(\"id\", a.id).eq(\"plan_id\", plan.id).select(\"id\")");
  });
});

describe("la pantalla del reporte", () => {
  const vista = sinComentarios(leer("src/components/PrecisionDelPlan.tsx"));
  it("PRIMERO cuánto dato hay y de quién; DESPUÉS por qué falta; y al final el error, por fuente y sin mezclar", () => {
    const p = (s: string) => { const k = vista.indexOf(s); if (k < 0) throw new Error(s); return k; };
    const orden = ["Cuánto dato hay", "han entrado alguna vez a la app", "Por qué no hay dato", "LLEGADA real (GPS) contra llegada estimada", "TOQUE del chofer (parada cerrada) contra salida estimada", "no se combinan nunca"].map(p);
    expect(orden).toEqual([...orden].sort((a, b) => a - b));
    expect(vista).toContain("muy pocas para decir nada (menos de 8)");
    expect(vista).toContain("NUNCA ha entrado a la app — no ve avisos ni su ruta");
    expect(vista).toContain("no se sabe si ha entrado");
  });
  it("cada motivo de «sin dato» tiene su frase, y solo sale con un plan PUBLICADO", () => {
    for (const m of ["sin_chofer", "sin_punto", "sin_posiciones_ese_dia", "sin_posiciones_cerca", "la_marco_otra_persona"]) expect(vista).toContain(`${m}: [`);
    expect(plano(sinComentarios(leer("src/components/PlanDelDia.tsx")))).toContain('{borrador!.status === "published" && <PrecisionDelPlan date={date} />}');
  });
});
