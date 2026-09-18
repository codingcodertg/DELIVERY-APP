import { describe, expect, it, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { NextResponse } from "next/server";

/** Antes de publicar: ¿los choferes de ESTE plan han entrado alguna vez a la app? (D-NEXT). Aviso, no bloqueo. */

const leer = (r: string) => readFileSync(join(process.cwd(), r), "utf8").split("\r\n").join("\n");
const plano = (s: string) => s.replace(/\s+/g, " ");
const sinComentarios = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").split("\n").map((l) => l.replace(/^\s*\/\/.*$/, "")).join("\n");

type Op = { tabla: string; filtros: Record<string, unknown> };
const falso = vi.hoisted(() => ({
  sesion: true, rol: "logistics", planVisible: true, paradas: [] as unknown[], ops: [] as Op[], escrituras: [] as string[],
  preguntados: [] as string[], adminCreado: 0, rolAlCrearAdmin: null as string | null, planLeidoAlCrearAdmin: false, usuarios: {} as Record<string, unknown>,
}));
vi.mock("@/lib/api-auth", () => ({
  requireUser: async () => (falso.sesion ? {
    ok: true, user: { id: "u1" },
    supabase: {
      from: (tabla: string) => {
        const o: Op = { tabla, filtros: {} };
        const lee = () => {
          falso.ops.push(o);
          if (tabla === "profiles") return { data: { role: falso.rol }, error: null };
          if (tabla === "route_plans") return { data: falso.planVisible ? { id: o.filtros["eq:id"] } : null, error: null };
          if (tabla === "route_plan_stops") return { data: falso.paradas, error: null };
          return { data: null, error: null };
        };
        const q: Record<string, unknown> = {};
        q.select = () => q;
        q.eq = (c: string, v: unknown) => { o.filtros[`eq:${c}`] = v; return q; };
        for (const m of ["insert", "update", "delete", "upsert"]) q[m] = () => { falso.escrituras.push(`${m}:${tabla}`); return q; };
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
    falso.rolAlCrearAdmin = falso.ops.some((o) => o.tabla === "profiles") ? falso.rol : "sin-comprobar";
    falso.planLeidoAlCrearAdmin = falso.ops.some((o) => o.tabla === "route_plans");
    return {
      from: () => { throw new Error("la llave de servicio no lee tablas aquí"); },
      auth: { admin: { getUserById: async (id: string) => { falso.preguntados.push(id); const u = falso.usuarios[id]; return u === "falla" ? { data: null, error: { message: "x" } } : { data: { user: u ?? null }, error: null }; } } },
    };
  },
}));
import { POST } from "@/app/api/route-plan/drivers-seen/route";

const PLAN = "11111111-1111-1111-1111-111111111111";
const pide = (cuerpo: unknown) => POST(new Request("http://localhost/api/route-plan/drivers-seen", { method: "POST", body: JSON.stringify(cuerpo) }));

beforeEach(() => {
  Object.assign(falso, {
    sesion: true, rol: "logistics", planVisible: true, ops: [], escrituras: [], preguntados: [], adminCreado: 0, rolAlCrearAdmin: null, planLeidoAlCrearAdmin: false,
    paradas: [{ driver_id: "c2", driver_name: "Beto" }, { driver_id: "c1", driver_name: "Ana" }, { driver_id: "c1", driver_name: "Ana" }, { driver_id: null, driver_name: "Se Fue" }, { driver_id: "c3", driver_name: "Caro" }],
    usuarios: { c1: { id: "c1", email: "secreto@ejemplo.test", last_sign_in_at: "2026-03-01T00:00:00Z" }, c2: { id: "c2", email: "otro@ejemplo.test", last_sign_in_at: null }, c3: "falla" },
  });
});

describe("/api/route-plan/drivers-seen", () => {
  it("sin sesión 401, sin plan_id válido 400, sin ser admin o logística 403 — y en ninguno se crea la llave de servicio", async () => {
    falso.sesion = false;
    expect((await pide({ plan_id: PLAN })).status).toBe(401);
    falso.sesion = true;
    expect((await pide({})).status).toBe(400);
    expect((await pide({ plan_id: "el-de-hoy" })).status).toBe(400);
    for (const rol of ["manager", "driver", "warehouse", "sales"]) { falso.rol = rol; expect((await pide({ plan_id: PLAN })).status).toBe(403); }
    expect(falso.adminCreado).toBe(0);
  });

  it("si quien pregunta no puede LEER ese plan con su sesión, 404 — y no se pregunta por nadie", async () => {
    falso.planVisible = false;
    expect((await pide({ plan_id: PLAN })).status).toBe(404);
    expect([falso.adminCreado, falso.preguntados]).toEqual([0, []]);
  });

  it("el rol y el plan se comprueban ANTES de la llave; los ids son SOLO los de las paradas de ese plan; y sale un booleano", async () => {
    const res = await pide({ plan_id: PLAN, driver_id: "intruso", drivers: ["intruso"], choferes: [{ driver_id: "intruso" }] });
    const b = await res.json();
    expect([falso.rolAlCrearAdmin, falso.planLeidoAlCrearAdmin]).toEqual(["logistics", true]);
    expect(falso.ops.find((o) => o.tabla === "route_plan_stops")!.filtros).toEqual({ "eq:plan_id": PLAN });
    expect([...falso.preguntados].sort()).toEqual(["c1", "c2", "c3"]);                        // cada chofer UNA vez; la parada huérfana, ninguna
    expect(b).toEqual({ ok: true, plan_id: PLAN, choferes: [
      { driver_id: "c1", nombre: "Ana", ha_entrado: true }, { driver_id: "c2", nombre: "Beto", ha_entrado: false }, { driver_id: "c3", nombre: "Caro", ha_entrado: null },
    ] });
    expect(JSON.stringify(b)).not.toMatch(/secreto|ejemplo\.test|last_sign_in|2026-03-01/);
  });

  it("solo lee: ni una escritura, ni con la sesión ni con la llave de servicio", async () => {
    await pide({ plan_id: PLAN });
    expect(falso.escrituras).toEqual([]);
    const ruta = sinComentarios(leer("src/app/api/route-plan/drivers-seen/route.ts"));
    expect(ruta).not.toMatch(/\.(insert|update|delete|upsert|rpc)\(|admin\s*\.from\(|fetch\(/);
    expect([...ruta.matchAll(/admin\.(\w+(?:\.\w+)*)\(/g)].map((m) => m[1])).toEqual(["auth.admin.getUserById"]);
  });
});

describe("el aviso en el panel", () => {
  const panel = sinComentarios(leer("src/components/PlanDelDia.tsx"));
  it("solo se pregunta por un BORRADOR, y lo preguntado vale solo para ESE plan", () => {
    expect(plano(panel)).toContain('const idDelBorrador = borrador?.status === "draft" ? borrador.plan_id : null;');
    expect(plano(panel)).toContain("const delPlan = sesiones && sesiones.plan_id === idDelBorrador ? sesiones.choferes : [];");
    expect(plano(panel)).toContain("body: JSON.stringify({ plan_id: idDelBorrador })");
  });
  it("cuenta SOLO a quien se sabe que nunca entró: «no se sabe» no es «nunca»", () => {
    expect(plano(panel)).toContain("const nuncaEntraron = delPlan.filter((c) => c.ha_entrado === false);");
  });
  it("avisa en el panel y al confirmar, y NO bloquea publicar", () => {
    expect(panel).toContain("chofer(es) de este plan no han entrado nunca a la app: no verán el aviso ni su ruta");
    expect(panel).toContain("chofer(es) no han entrado nunca a la app: no verán el aviso ni su ruta.` : \"\"}`,");
    expect(panel).toContain("Se puede publicar igual.");
    expect(plano(panel)).toContain("disabled={!!ocupado || r!.ordenes === 0}");
    expect(panel).not.toMatch(/disabled=\{[^}]*nuncaEntraron/);
  });
});
