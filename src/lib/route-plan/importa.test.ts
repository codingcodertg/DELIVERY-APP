import { describe, expect, it, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { NextResponse } from "next/server";
import { evaluaPlan, parteOrdenesGrandes, type Parametros } from "@/lib/route-engine";
import { cacheEnMemoria } from "@/lib/route-times/tiempos";
import type { ProveedorDeTiempos } from "@/lib/route-times/proveedores";
import { planificaElDia, type Borrador } from "./borrador";
import { estadoDeParadas } from "./ajuste";
import { filasValidas, planImportado } from "./importa";
import type { FilaDeHoja } from "./hoja";
import type { DatosDelDia } from "./entrada";

/** Importar la hoja del despachador (D-326): el plan `manual_import`, la ruta y la pantalla. Hojas INVENTADAS. */

const leer = (r: string) => readFileSync(join(process.cwd(), r), "utf8").split("\r\n").join("\n");
const plano = (s: string) => s.replace(/\s+/g, " ");
const sinComentarios = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").split("\n").map((l) => l.replace(/^\s*\/\/.*$/, "")).join("\n");

const AHORA = "2026-03-02T12:00:00.000Z";
const proveedor: ProveedorDeTiempos = {
  nombre: "osrm", conTrafico: false,
  async matriz(os, ds) { return os.map(() => ds.map(() => ({ minutos: 10, millas: 5 }))); },
  async tramo() { return { minutos: 10, millas: 5 }; },
};
const IDS = ["a", "b", "c", "d"];
const datos = (): DatosDelDia => ({
  ordenes: IDS.map((id, k) => ({
    id, stage: "approved", order_code: id.toUpperCase(), order_type: "ACliente", store: "Tienda Norte", pickup_name: null, delivery_name: null,
    delivery_lat: 26.35 + k / 100, delivery_lng: -98.25, delivery_windows: "0830-1730", est_pallets: 2, actual_pallets: null,
    pickup_duration: "8 min", delivery_duration: "10 min", assigned_driver: null, input_date: "2026-03-03", input_time: `090${k}`, account: null, customer_type: null,
    is_training: false, updated_at: `2026-03-03T15:00:0${k}.000000+00:00`,
  })),
  choferes: [{ id: "c1", full_name: "Chofer Uno", role: "driver" as const }, { id: "c2", full_name: "Chofer Dos", role: "driver" as const }],
  ajustesDeChofer: ["c1", "c2"].map((profile_id) => ({ profile_id, base_store: "Tienda Norte", capacity_pallets: 10, shift_start: "08:00", shift_end: "17:30", returns_to_base: true, routable: true })),
  settings: { stores: [{ name: "Tienda Norte", address: "1 Calle", lat: 26.3, lng: -98.2 }], order_type_rules: { ACliente: { storeToStore: false } } },
});
const DEL_DIA = [...IDS.map((id) => ({ id, invoice_num: `F-${id}`, po2: null, so_num: null })), { id: "de-otra-etapa", invoice_num: "F-otra", po2: null, so_num: null }];
const fila = (renglon: number, invoice: string, chofer: string, carga: number | null, extra: Partial<FilaDeHoja> = {}): FilaDeHoja => ({
  renglon, po: "", so: "", invoice, deliveryDate: null, chofer, carga, pallets: null, ventana: "", account: "", orderType: "", store: "", pickupName: "", deliveryAddress: "", ...extra,
});
const motorDe = (b: Borrador) => {
  const e = b.plan.input.entrada;
  return evaluaPlan({ secuencias: estadoDeParadas(b.paradas).secuencias, ordenes: parteOrdenesGrandes(e.ordenes, e.choferes).ordenes, choferes: e.choferes, matriz: e.matriz, porHora: e.porHora, parametros: b.plan.params as unknown as Parametros });
};
const planifica = () => planificaElDia(datos(), "2026-03-04", "America/Chicago", { cache: cacheEnMemoria(), proveedores: [proveedor], ahoraISO: AHORA });

describe("las filas que manda el navegador", () => {
  const buena = { renglon: 2, po: "", so: "", invoice: "F-a", chofer: "Chofer Uno", carga: 0, deliveryDate: null };
  it("pasan limpias: del resto de la hoja —dirección, cuenta— no viaja nada aunque lo manden", () => {
    const r = filasValidas([{ ...buena, deliveryAddress: "Calle Secreta 1", account: "Cuenta Secreta" }])!;
    expect(r).toHaveLength(1);
    expect(JSON.stringify(r)).not.toMatch(/Secreta/);
    expect(r[0]).toMatchObject({ renglon: 2, invoice: "F-a", chofer: "Chofer Uno", carga: 0 });
  });
  it("lo que no encaja tumba la hoja ENTERA: no se importa media", () => {
    const malas: unknown[] = [null, [], "filas", [null], [{ ...buena, renglon: 1 }], [{ ...buena, renglon: "2" }], [{ ...buena, carga: -1 }], [{ ...buena, carga: 1.5 }], [{ ...buena, carga: "0" }],
      [{ ...buena, invoice: 7 }], [{ ...buena, chofer: undefined }], [{ ...buena, deliveryDate: "3/4/2026" }], [{ ...buena, invoice: "x".repeat(201) }], [buena, { ...buena, carga: 5000 }],
      Array.from({ length: 501 }, () => buena)];
    expect(malas.map(filasValidas)).toEqual(malas.map(() => null));
    expect(filasValidas(Array.from({ length: 500 }, () => buena))).toHaveLength(500);
  });
});

describe("el plan importado", () => {
  it("es `manual_import`, hijo del plan del motor, con `writes` VACÍO: ni publicado por error escribiría una orden", async () => {
    const b = await planifica();
    const r = planImportado(b.plan, "plan-del-motor", motorDe(b), [fila(2, "F-a", "Chofer Dos", 0), fila(3, "F-b", "chofer dos ", 1), fila(4, "F-c", "Chofer Uno", 0), fila(5, "F-d", "Chofer Uno", 0)], DEL_DIA, "2026-03-04", datos().settings.stores!);
    expect([r.plan.source, r.plan.parent_plan_id, r.plan.writes, r.plan.plan_date]).toEqual(["manual_import", "plan-del-motor", [], "2026-03-04"]);
    expect(b.plan.writes.length).toBe(4);                       // el del motor sí los lleva: el vacío no es casualidad
    expect(r.plan.input).toBe(b.plan.input);
    expect(r.respuesta.casadas).toBe(4);
    expect(r.paradas.filter((p) => p.kind === "D").map((p) => [p.order_ref, p.driver_id]).sort()).toEqual([["a", "c2"], ["b", "c2"], ["c", "c1"], ["d", "c1"]]);
    // Las cargas de la hoja mandan: con Chofer Dos, «a» se recoge antes que «b».
    expect(r.paradas.filter((p) => p.kind === "P" && p.driver_id === "c2").map((p) => p.order_ref)).toEqual(["a", "b"]);
    expect([r.respuesta.delMotor, r.respuesta.sinCasar, r.respuesta.entregasDelMotor]).toEqual([[], [], true]);
    expect(r.respuesta.comparacion.cuenta.comparadas).toBe(4);
  });

  it("nada se adivina: sin casar, fuera del plan, chofer desconocido, sin chofer o sin carga — cada una en su lista, y sus órdenes las coloca el motor", async () => {
    const b = await planifica();
    const r = planImportado(b.plan, "p", motorDe(b), [
      fila(2, "F-a", "Chofer Uno", 0), fila(3, "F-b", "Chofer Tres", 0), fila(4, "F-c", "", 0), fila(5, "F-d", "Chofer Dos", null),
      fila(6, "F-nadie", "Chofer Uno", 1), fila(7, "F-otra", "Chofer Uno", 1),
    ], DEL_DIA, "2026-03-04", datos().settings.stores!);
    expect(r.respuesta.sinCasar).toEqual([{ renglon: 6, motivo: "no_esta_en_la_app" }]);
    expect(r.respuesta.fueraDelPlan).toEqual([{ renglon: 7, ordenId: "de-otra-etapa" }]);
    expect(r.respuesta.sinAsignarEnHoja).toEqual([{ renglon: 3, ordenId: "b", motivo: "chofer_desconocido" }, { renglon: 4, ordenId: "c", motivo: "sin_chofer" }, { renglon: 5, ordenId: "d", motivo: "sin_carga" }]);
    expect(r.respuesta.delMotor).toEqual(["b", "c", "d"]);
    expect(r.respuesta.comparacion.cuenta.comparadas).toBe(1);
    // Los dos planes llevan LAS MISMAS órdenes: por eso los totales se pueden comparar.
    expect([...new Set(r.paradas.map((p) => p.delivery_id))].sort()).toEqual(IDS);
  });

  it("órdenes del plan que la hoja no trae: se dicen, y también las coloca el motor", async () => {
    const b = await planifica();
    const r = planImportado(b.plan, "p", motorDe(b), [fila(2, "F-a", "Chofer Uno", 0)], DEL_DIA, "2026-03-04", datos().settings.stores!);
    expect(r.respuesta.soloEnLaApp).toEqual(["b", "c", "d"]);            // «de-otra-etapa» no está en el plan: no cuenta
    expect(r.respuesta.delMotor).toEqual(["b", "c", "d"]);
  });

  it("de la hoja NO se guarda el contenido: en el plan quedan renglones, motivos e ids — ni direcciones ni cuentas", async () => {
    const b = await planifica();
    const conDatos = [fila(2, "F-a", "Chofer Uno", 0, { deliveryAddress: "Calle Secreta 1", account: "Cuenta Secreta", ventana: "0830-1000" }), fila(3, "F-nadie", "Chofer Uno", 1, { account: "Otra Secreta" })];
    const r = planImportado(b.plan, "p", motorDe(b), conDatos, DEL_DIA, "2026-03-04", datos().settings.stores!);
    expect(JSON.stringify(r.plan.result.hoja)).not.toMatch(/Secreta|F-nadie|F-a/);
    expect(JSON.stringify(r.respuesta)).not.toMatch(/Secreta/);
    expect(Object.keys(r.plan.result.hoja!).sort()).toEqual(["asignaciones", "casadas", "comparacion", "delMotor", "entregasDelMotor", "fueraDelPlan", "sinAsignarEnHoja", "sinCasar", "soloEnLaApp"]);
  });
});

// ---------------------------------------------------------------------------------------------------------------
type Op = { tabla: string; op: string; filtros: Record<string, unknown>; valor?: unknown };
const falso = vi.hoisted(() => ({
  sesion: true, rol: "logistics", ref: null as Record<string, unknown> | null, paradas: [] as unknown[], ops: [] as Op[], rpc: [] as string[],
  fallaParadas: false, fallaDescartar: false,
}));
vi.mock("@/lib/api-auth", () => ({
  requireUser: async () => (falso.sesion ? {
    ok: true, user: { id: "u1" },
    supabase: {
      rpc: async (fn: string) => { falso.rpc.push(fn); return { data: null, error: null }; },
      from: (tabla: string) => {
        const o: Op = { tabla, op: "select", filtros: {} };
        const q: Record<string, unknown> = {};
        const lee = () => {
          falso.ops.push(o);
          if (o.op === "insert" && tabla === "route_plans") return { data: { id: "nuevo", version: 7 }, error: null };
          if (o.op === "insert" && tabla === "route_plan_stops") return { data: null, error: falso.fallaParadas ? { message: "no caben" } : null };
          if (o.op === "update") return { data: null, error: falso.fallaDescartar ? { message: "no se deja" } : null };
          if (tabla === "profiles") return { data: { role: falso.rol }, error: null };
          if (tabla === "route_plans") return { data: falso.ref, error: null };
          if (tabla === "route_plan_stops") return { data: falso.paradas, error: null };
          if (tabla === "deliveries") return { data: DEL_DIA, error: null };
          if (tabla === "settings") return { data: { stores: datos().settings.stores }, error: null };
          return { data: null, error: null };
        };
        for (const m of ["select", "order", "limit"]) q[m] = () => q;
        for (const m of ["eq", "neq", "in"]) q[m] = (c: string, v: unknown) => { o.filtros[`${m}:${c}`] = v; return q; };
        q.insert = (v: unknown) => { o.op = "insert"; o.valor = v; return q; };
        q.update = (v: unknown) => { o.op = "update"; o.valor = v; return q; };
        q.maybeSingle = async () => lee();
        q.then = (ok: (v: unknown) => unknown) => ok(lee());
        return q;
      },
    },
  } : { ok: false, response: NextResponse.json({ error: "Not signed in." }, { status: 401 }) }),
}));
import { POST } from "@/app/api/route-plan/import/route";

const pide = (cuerpo: unknown) => POST(new Request("http://localhost/api/route-plan/import", { method: "POST", body: JSON.stringify(cuerpo) }));
const HOJA = [{ renglon: 2, po: "", so: "", invoice: "F-a", chofer: "Chofer Uno", carga: 0, deliveryDate: null }, { renglon: 3, po: "", so: "", invoice: "F-b", chofer: "Chofer Dos", carga: 0, deliveryDate: null }];
const escrituras = () => falso.ops.filter((o) => o.op !== "select").map((o) => `${o.op}:${o.tabla}`);

beforeEach(async () => {
  const b = await planifica();
  Object.assign(falso, { sesion: true, rol: "logistics", ops: [], rpc: [], fallaParadas: false, fallaDescartar: false, paradas: b.paradas, ref: { id: "plan-del-motor", ...b.plan } });
});

describe("/api/route-plan/import", () => {
  it("sin sesión 401, sin fecha o sin filas válidas 400, sin ser admin o logística 403 — y en ninguno se escribe nada", async () => {
    falso.sesion = false;
    expect((await pide({ date: "2026-03-04", filas: HOJA })).status).toBe(401);
    falso.sesion = true;
    expect((await pide({ date: "hoy", filas: HOJA })).status).toBe(400);
    expect((await pide({ date: "2026-03-04", filas: [{ renglon: 2 }] })).status).toBe(400);
    falso.rol = "manager";
    expect((await pide({ date: "2026-03-04", filas: HOJA })).status).toBe(403);
    expect(escrituras()).toEqual([]);
  });

  it("sin un plan del motor para esa fecha no hay contra qué comparar: 409, y no se escribe nada", async () => {
    falso.ref = null;
    const res = await pide({ date: "2026-03-04", filas: HOJA });
    expect([res.status, (await res.json()).error]).toEqual([409, "NO_PLAN"]);
    expect(escrituras()).toEqual([]);
  });

  it("el plan contra el que se compara es el último del motor de ESA fecha, nunca otra hoja importada", async () => {
    await pide({ date: "2026-03-04", filas: HOJA });
    expect(falso.ops.find((o) => o.tabla === "route_plans" && o.op === "select")!.filtros).toEqual({ "eq:plan_date": "2026-03-04", "in:status": ["draft", "published"], "neq:source": "manual_import" });
  });

  it("guarda el plan, luego sus paradas, y lo deja DESCARTADO — en ese orden; y NUNCA toca una orden, ni avisa, ni publica", async () => {
    const res = await pide({ date: "2026-03-04", filas: HOJA });
    const b = await res.json();
    expect([res.status, b.ok, b.plan_id, b.contra.plan_id, b.casadas]).toEqual([200, true, "nuevo", "plan-del-motor", 2]);
    expect(escrituras()).toEqual(["insert:route_plans", "insert:route_plan_stops", "update:route_plans"]);
    const [plan, paradas, cierre] = falso.ops.filter((o) => o.op !== "select");
    expect(plan.valor).toMatchObject({ source: "manual_import", writes: [], parent_plan_id: "plan-del-motor" });
    expect((paradas.valor as { plan_id: string }[]).every((p) => p.plan_id === "nuevo")).toBe(true);
    expect([cierre.valor, cierre.filtros]).toEqual([{ status: "discarded" }, { "eq:id": "nuevo" }]);
    expect(falso.rpc).toEqual([]);
    expect(falso.ops.filter((o) => o.tabla === "deliveries").map((o) => o.op)).toEqual(["select"]);
    expect(falso.ops.some((o) => o.tabla === "notifications")).toBe(false);
  });

  it("si las paradas no se guardan, el plan se descarta IGUAL y se dice; si no se puede descartar, también se dice", async () => {
    falso.fallaParadas = true;
    const res = await pide({ date: "2026-03-04", filas: HOJA });
    expect([res.status, (await res.json()).detail]).toEqual([500, "no caben"]);
    expect(escrituras()).toEqual(["insert:route_plans", "insert:route_plan_stops", "update:route_plans"]);
    falso.ops = []; falso.fallaParadas = false; falso.fallaDescartar = true;
    const otra = await pide({ date: "2026-03-04", filas: HOJA });
    expect([otra.status, (await otra.json()).detail]).toEqual([500, "no se deja"]);
  });

  it("la ruta no llama a ningún proveedor de tiempos ni usa la llave de servicio", () => {
    const ruta = sinComentarios(leer("src/app/api/route-plan/import/route.ts"));
    expect(ruta).not.toMatch(/createAdminClient|admin\s*\.|fetch\(|proveedor|planificaElDia|\.rpc\(|from\("notifications"\)/);
  });
});

describe("la pantalla", () => {
  const vista = sinComentarios(leer("src/components/ComparaConLaHoja.tsx"));
  it("el fichero se lee en el navegador y al servidor solo viaja lo mínimo de cada fila", () => {
    expect(plano(vista)).toContain("body: JSON.stringify({ date, filas: filas.map(filaParaEnviar) })");
    expect(vista).not.toMatch(/FormData|supabase|upload|from\("/i);      // (la memoria de columnas va en localStorage: solo cabeceras)
    expect([...vista.matchAll(/fetch\("([^"]+)"/g)].map((m) => m[1])).toEqual(["/api/route-plan/import"]);
  });
  it("dice que las ENTREGAS del lado de la hoja las puso el motor, y que importar no asigna ni avisa", () => {
    expect(vista).toContain("El orden de ENTREGAS del lado de la hoja lo puso el motor");
    expect(vista).toContain("Importar nunca asigna órdenes ni avisa a nadie.");
    expect(vista).toContain("no se adivina nada");
  });
  it("cada motivo de «sin casar» y de «sin asignar en la hoja» tiene su frase", () => {
    for (const m of ["sin_identificador", "no_esta_en_la_app", "varias_ordenes", "identificadores_en_conflicto", "otra_fecha", "repetida_en_la_hoja", "sin_chofer", "chofer_desconocido", "sin_carga"]) expect(vista).toContain(`${m}: [`);
  });
});
