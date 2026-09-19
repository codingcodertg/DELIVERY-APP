import { describe, expect, it, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { NextResponse } from "next/server";
import { evaluaPlan, parteOrdenesGrandes, planifica } from "@/lib/route-engine";
import { cacheEnMemoria } from "@/lib/route-times/tiempos";
import type { ProveedorDeTiempos } from "@/lib/route-times/proveedores";
import { errorDePublicar, planificaElDia, resumenDelPlan, rutasDeParadas } from "./borrador";
import { ETAPAS_RUTEABLES, ROUTE_PUBLISHED_KIND } from "./publicar";
import type { DatosDelDia } from "./entrada";

/**
 * El borrador, publicar y la 133 (D-320). **Ni una llamada real:** los tiempos los da un proveedor de mentira,
 * la caché vive en memoria, y las rutas de servidor hablan con un cliente de Supabase falso que apunta lo que
 * se le pide. Tiendas, choferes y órdenes inventados.
 */

const leer = (r: string) => readFileSync(join(process.cwd(), r), "utf8").split("\r\n").join("\n");
const plano = (s: string) => s.replace(/\s+/g, " ");
const sinComentarios = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").split("\n").map((l) => l.replace(/^\s*\/\/.*$/, "")).join("\n");

const AHORA = "2026-03-02T12:00:00.000Z";
const proveedor = (nombre: ProveedorDeTiempos["nombre"], conTrafico: boolean, minutos = 10): ProveedorDeTiempos => ({
  nombre, conTrafico,
  async matriz(os, ds) { return os.map(() => ds.map(() => ({ minutos, millas: 6 }))); },
  async tramo() { return { minutos: minutos + 4, millas: 6 }; },
});

const datos = (extra: Partial<DatosDelDia> = {}): DatosDelDia => ({
  ordenes: ["a", "b"].map((id, k) => ({
    id, stage: "approved", order_code: id.toUpperCase(), order_type: "ACliente", store: "Tienda Norte", pickup_name: null, delivery_name: null,
    delivery_lat: 26.35 + k / 100, delivery_lng: -98.25, delivery_windows: "0830-1730", est_pallets: 2, actual_pallets: null, pickup_duration: "8 min",
    delivery_duration: "10 min", assigned_driver: null, input_date: "2026-03-03", input_time: `090${k}`, account: null, customer_type: null,
    is_training: false, updated_at: `2026-03-03T15:00:0${k}.000000+00:00`,
  })),
  choferes: [{ id: "c1", full_name: "Chofer Uno", role: "driver" }],
  ajustesDeChofer: [{ profile_id: "c1", base_store: "Tienda Norte", capacity_pallets: 10, shift_start: "08:00", shift_end: "17:30", returns_to_base: true, routable: true }],
  settings: { stores: [{ name: "Tienda Norte", address: "1 Calle", lat: 26.3, lng: -98.2 }], order_type_rules: { ACliente: { storeToStore: false } } },
  ...extra,
});

describe("planificar el día deja un borrador completo, y reproducible", () => {
  it("la fila del plan: la foto de las órdenes, qué se escribirá, los totales y con qué tiempos se hizo", async () => {
    const b = await planificaElDia(datos(), "2026-03-04", "America/Chicago", { cache: cacheEnMemoria(), proveedores: [proveedor("google", true)], ahoraISO: AHORA });
    expect(b.plan.input.ordenes).toEqual([{ id: "a", updated_at: "2026-03-03T15:00:00.000000+00:00", factura: null }, { id: "b", updated_at: "2026-03-03T15:00:01.000000+00:00", factura: null }]);
    expect(b.plan.writes).toEqual([
      { id: "a", assigned_driver: "Chofer Uno", load_no: 1, route_seq: 0, load_auto: true },
      { id: "b", assigned_driver: "Chofer Uno", load_no: 1, route_seq: 1, load_auto: true },
    ]);
    expect(b.plan).toMatchObject({ plan_date: "2026-03-04", source: "engine", provider: "google", traffic: true, converged: true, unassigned_count: 0, late_minutes: 0 });
    expect(b.plan.algorithm_version).toBe("motor-1");
    expect(b.paradas.map((p) => p.label)).toEqual(["P1", "P2", "D1", "D2"]);
    expect(b.plan.total_minutes).toBe(b.paradas[3].etd + 14 - 480);   // hasta volver a la base, con tráfico
  });

  it("con lo guardado —paradas, matriz y tráfico por hora— EVALUAR el plan da las mismas horas sin preguntarle nada a nadie", async () => {
    const b = await planificaElDia(datos(), "2026-03-04", "America/Chicago", { cache: cacheEnMemoria(), proveedores: [proveedor("google", true)], ahoraISO: AHORA });
    const e = b.plan.input.entrada;
    const secuencias: Record<string, { orden: string; tipo: "P" | "D" }[]> = {};
    for (const p of [...b.paradas].sort((x, y) => x.seq - y.seq)) (secuencias[p.driver_id] ??= []).push({ orden: p.order_ref, tipo: p.kind });
    const otraVez = evaluaPlan({ secuencias, ordenes: parteOrdenesGrandes(e.ordenes, e.choferes).ordenes, choferes: e.choferes, matriz: e.matriz, porHora: e.porHora, parametros: b.plan.params as never });
    expect(b.paradas.length).toBeGreaterThan(0);
    expect(otraVez.rutas.flatMap((r) => r.paradas).map((p) => [p.etiqueta, p.llegada, p.salida])).toEqual(b.paradas.map((p) => [p.label, p.eta, p.etd]));
    expect(otraVez.coste.tardeMin).toBe(b.plan.late_minutes);
    // Las horas guardadas llevan el tráfico de SUS tramos: sin `porHora` salen otras (más tempranas).
    const sinTrafico = evaluaPlan({ secuencias, ordenes: parteOrdenesGrandes(e.ordenes, e.choferes).ordenes, choferes: e.choferes, matriz: e.matriz, parametros: b.plan.params as never });
    expect(sinTrafico.rutas.flatMap((r) => r.paradas).map((p) => p.llegada)).not.toEqual(b.paradas.map((p) => p.eta));
    // Y aguanta ir y volver de JSON, que es como se guarda.
    expect(JSON.parse(JSON.stringify(b.plan.input))).toEqual(b.plan.input);
  });

  it("volver a PLANIFICAR con el tráfico guardado NO es la garantía: solo lo hay para los tramos probados", async () => {
    // Se deja escrito para que nadie vuelva a prometerlo: la otra secuencia usa tramos sin tráfico pedido.
    const b = await planificaElDia(datos(), "2026-03-04", "America/Chicago", { cache: cacheEnMemoria(), proveedores: [proveedor("google", true)], ahoraISO: AHORA });
    const otraVez = planifica(b.plan.input.entrada, b.plan.params as never);
    expect(otraVez.rutas.flatMap((r) => r.paradas).map((p) => p.etiqueta)).not.toEqual(b.paradas.map((p) => p.label));
  });

  it("el resumen de un plan recién hecho: lo que la pantalla enseña, con lo que dejó sin resolver el tráfico", async () => {
    const b = await planificaElDia(datos(), "2026-03-04", "America/Chicago", { cache: cacheEnMemoria(), proveedores: [proveedor("osrm", false)], ahoraISO: AHORA });
    const r = resumenDelPlan(b.plan, b.paradas.length);
    expect([r.paradas, r.ordenes, r.proveedor, r.trafico, r.traficoSinResolver, r.minutos, r.millas, r.tarde]).toEqual([4, 2, "osrm", false, false, b.plan.total_minutes, b.plan.total_miles, b.plan.late_minutes]);
    expect(resumenDelPlan({ ...b.plan, total_miles: "12.50" as unknown as number, result: { ...b.plan.result, traficoSinResolver: true } }, 4)).toMatchObject({ millas: 12.5, traficoSinResolver: true });
  });

  it("dice el PEOR proveedor de los dos pasos: matriz estimada + tráfico de Google = plan estimado", async () => {
    const soloTrafico: ProveedorDeTiempos = { ...proveedor("google", true), async matriz() { throw new Error("caído"); } };
    const b = await planificaElDia(datos(), "2026-03-04", "America/Chicago", { cache: cacheEnMemoria(), proveedores: [soloTrafico, proveedor("estimado", false)], ahoraISO: AHORA });
    expect(b.plan.provider).toBe("estimado");
    expect(b.plan.result.tiempos.proveedor).toBe("estimado");
  });

  it("lo que queda fuera cuenta, con su porqué: sin asignar por el motor, y lo que ni entró", async () => {
    const d = datos();
    const conBucket = datos({ ordenes: [{ ...d.ordenes[0], assigned_driver: "Ruta Extra" }, { ...d.ordenes[1], delivery_lat: null, delivery_lng: null }], settings: { ...d.settings, route_buckets: ["Ruta Extra"] } });
    const b = await planificaElDia(conBucket, "2026-03-04", "America/Chicago", { cache: cacheEnMemoria(), proveedores: [proveedor("osrm", false)], ahoraISO: AHORA });
    expect(b.plan.result.fuera).toEqual([{ id: "a", motivo: "en_un_carril_manual" }]);
    expect(b.plan.result.sinAsignar).toEqual([{ orden: "b", motivo: "sin_punto" }]);
    expect([b.plan.unassigned_count, b.plan.writes, b.paradas, b.plan.traffic]).toEqual([2, [], [], false]);
  });

  it("las paradas guardadas se leen de vuelta como rutas, por chofer y en orden", () => {
    expect(rutasDeParadas([
      { driver_id: "c2", seq: 0, kind: "P", order_ref: "z", eta: 480 },
      { driver_id: "c1", seq: 1, kind: "D", order_ref: "a", eta: 520 },
      { driver_id: "c1", seq: 0, kind: "P", order_ref: "a", eta: 480 },
    ])).toEqual({ rutas: [
      { chofer: "c1", paradas: [{ tipo: "P", orden: "a", llegada: 480 }, { tipo: "D", orden: "a", llegada: 520 }] },
      { chofer: "c2", paradas: [{ tipo: "P", orden: "z", llegada: 480 }] },
    ] });
  });

  it("los errores de publicar, por su prefijo: qué pasó y con qué código se cuenta", () => {
    expect(errorDePublicar('ROUTE_PLAN_STALE: [{"id": "a", "motivo": "cambio"}]')).toEqual({ codigo: "STALE", status: 409, detalle: [{ id: "a", motivo: "cambio" }] });
    expect(errorDePublicar("ROUTE_PLAN_UNSEEN: 2 of 14 orders could not be written")).toMatchObject({ codigo: "UNSEEN", status: 409 });
    expect(errorDePublicar("ROUTE_PLAN_FORBIDDEN: only admin or logistics publish a route")).toMatchObject({ codigo: "FORBIDDEN", status: 403 });
    expect(errorDePublicar("ROUTE_PLAN_NOT_DRAFT: published")).toMatchObject({ codigo: "NOT_DRAFT", status: 409, detalle: "published" });
    expect(errorDePublicar("ROUTE_PLAN_NOT_FOUND")).toMatchObject({ codigo: "NOT_FOUND", status: 404 });
    expect(errorDePublicar("ROUTE_PLAN_BAD_NOTICE: x")).toMatchObject({ codigo: "BAD_NOTICE", status: 400 });
    expect(errorDePublicar("You cannot edit an order in the picked_up stage")).toEqual({ codigo: "ERROR", status: 500, detalle: "You cannot edit an order in the picked_up stage" });
  });
});

// ---- La ruta de publicar, con un cliente de Supabase de mentira --------------------------------------------
const falso = vi.hoisted(() => ({
  sesion: true,
  plan: { id: "11111111-1111-1111-1111-111111111111", plan_date: "2026-03-04", status: "draft" } as Record<string, unknown> | null,
  vigente: null as { id: string } | null,
  paradas: {} as Record<string, unknown[]>,
  rpc: [] as { fn: string; args: Record<string, unknown> }[],
  respuesta: { data: { written: 2, notifications: [{ driver_id: "c1", notification_id: "n1" }] } as unknown, error: null as { message: string } | null },
  tablasEscritas: [] as string[],
  filtrosDelVigente: null as Record<string, unknown> | null,
}));

vi.mock("@/lib/api-auth", () => ({
  requireUser: async () => (falso.sesion ? {
    ok: true, user: { id: "u1" },
    supabase: {
      from: (tabla: string) => {
        const filtros: Record<string, unknown> = {};
        const q = {
          select: () => q,
          eq: (c: string, v: unknown) => { filtros[c] = v; return q; },
          insert: () => { falso.tablasEscritas.push(tabla); return q; }, update: () => { falso.tablasEscritas.push(tabla); return q; },
          maybeSingle: async () => { if (filtros.status === "published") falso.filtrosDelVigente = { ...filtros }; return q.fila(); },
          fila: () => ({ data: tabla === "route_plans" ? (filtros.status === "published" ? falso.vigente : falso.plan) : null, error: null }),
          then: (ok: (v: unknown) => unknown) => ok({ data: falso.paradas[String(filtros.plan_id)] ?? [], error: null }),
        };
        return q;
      },
      rpc: async (fn: string, args: Record<string, unknown>) => { falso.rpc.push({ fn, args }); return falso.respuesta; },
    },
  } : { ok: false, response: NextResponse.json({ error: "Not signed in." }, { status: 401 }) }),
}));

import { POST as publica } from "@/app/api/route-plan/publish/route";

const PLAN = "11111111-1111-1111-1111-111111111111";
const pide = (cuerpo: unknown) => publica(new Request("http://localhost/api/route-plan/publish", { method: "POST", body: JSON.stringify(cuerpo) }));
const parada = (driver_id: string | null, seq: number, kind: "P" | "D", order_ref: string, eta = 480) => ({ driver_id, seq, kind, order_ref, eta });

beforeEach(() => {
  falso.sesion = true; falso.vigente = null; falso.rpc = []; falso.tablasEscritas = [];
  falso.plan = { id: PLAN, plan_date: "2026-03-04", status: "draft" };
  falso.paradas = { [PLAN]: [parada("c1", 0, "P", "a"), parada("c1", 1, "D", "a", 520), parada("c2", 0, "P", "b"), parada("c2", 1, "D", "b", 530)] };
  falso.respuesta = { data: { written: 2, notifications: [{ driver_id: "c1", notification_id: "n1" }] }, error: null };
});

describe("/api/route-plan/publish", () => {
  it("sin sesión, 401; sin un plan_id válido, 400 — y en ninguno de los dos se llama a la base", async () => {
    falso.sesion = false;
    expect((await pide({ plan_id: PLAN })).status).toBe(401);
    falso.sesion = true;
    expect((await pide({ plan_id: "no-es-un-uuid" })).status).toBe(400);
    expect(falso.rpc).toEqual([]);
  });

  it("la primera vez: llama a `publish_route_plan` con UN aviso por chofer, y devuelve los ids para el push", async () => {
    const res = await pide({ plan_id: PLAN });
    expect(await res.json()).toEqual({ ok: true, plan_id: PLAN, written: 2, notifications: [{ driver_id: "c1", notification_id: "n1" }] });
    expect(falso.rpc).toHaveLength(1);
    expect(falso.rpc[0].fn).toBe("publish_route_plan");
    expect(falso.rpc[0].args).toEqual({ p_plan: PLAN, p_avisos: [
      { driver_id: "c1", message: "Your route for 2026-03-04 is ready: 2 stops, first stop 08:00" },
      { driver_id: "c2", message: "Your route for 2026-03-04 is ready: 2 stops, first stop 08:00" },
    ] });
  });

  it("al re-publicar: solo a quien le cambió algo, y a quien se quedó sin paradas", async () => {
    falso.vigente = { id: "viejo" };
    falso.paradas.viejo = [parada("c1", 0, "P", "a"), parada("c1", 1, "D", "a", 999), parada("c3", 0, "P", "z"), parada("c3", 1, "D", "z")];
    await pide({ plan_id: PLAN });
    const avisos = falso.rpc[0].args.p_avisos as { driver_id: string; message: string }[];
    expect(avisos.map((a) => a.driver_id)).toEqual(["c2", "c3"]);        // c1 igual (solo cambió la hora) → silencio
    expect(avisos[1].message).toBe("Your route for 2026-03-04 changed: you have no stops now");
    // El vigente es el publicado de ESA fecha, no cualquier publicado.
    expect(falso.filtrosDelVigente).toEqual({ plan_date: "2026-03-04", status: "published" });
  });

  it("esta ruta NO escribe por su cuenta: ni órdenes, ni avisos, ni el plan. Todo es la función", async () => {
    await pide({ plan_id: PLAN });
    expect(falso.tablasEscritas).toEqual([]);
    const codigo = sinComentarios(leer("src/app/api/route-plan/publish/route.ts"));
    expect(codigo).not.toMatch(/createAdminClient|\.insert\(|\.update\(|\.delete\(|from\("deliveries"\)|from\("notifications"\)/);
    expect(plano(codigo)).toContain('await supabase.rpc("publish_route_plan", { p_plan: planId, p_avisos })');
  });

  it("si la función se niega, se cuenta con su código: plan viejo, órdenes que no se ven, no es borrador", async () => {
    falso.respuesta = { data: null, error: { message: 'ROUTE_PLAN_STALE: [{"id": "a", "motivo": "cambio"}]' } };
    const viejo = await pide({ plan_id: PLAN });
    expect([viejo.status, await viejo.json()]).toEqual([409, { error: "STALE", detail: [{ id: "a", motivo: "cambio" }] }]);
    falso.respuesta = { data: null, error: { message: "ROUTE_PLAN_UNSEEN: 1 of 2 orders could not be written" } };
    expect((await pide({ plan_id: PLAN })).status).toBe(409);
    falso.respuesta = { data: null, error: { message: "ROUTE_PLAN_FORBIDDEN: only admin or logistics publish a route" } };
    expect((await pide({ plan_id: PLAN })).status).toBe(403);
  });

  it("una hoja importada NO se publica: 409 sin llamar a la función, sin leer paradas y sin avisar a nadie", async () => {
    falso.plan = { id: PLAN, plan_date: "2026-03-04", status: "draft", source: "manual_import" };
    const res = await pide({ plan_id: PLAN });
    expect([res.status, (await res.json()).error]).toEqual([409, "IMPORTED_PLAN"]);
    expect(falso.rpc).toEqual([]);
    expect(falso.tablasEscritas).toEqual([]);
  });

  it("un plan que no existe (o que quien llama no ve), 404 sin llamar a la función", async () => {
    falso.plan = null;
    expect((await pide({ plan_id: PLAN })).status).toBe(404);
    expect(falso.rpc).toEqual([]);
  });
});

describe("la ruta de planificar y la pantalla", () => {
  const ruta = sinComentarios(leer("src/app/api/route-plan/route.ts"));
  const panel = sinComentarios(leer("src/components/PlanDelDia.tsx"));

  it("lee y guarda con la SESIÓN de quien planifica; la llave de servicio, solo para la caché de tiempos", () => {
    expect(plano(ruta)).toContain('supabase.from("route_plans").insert(borrador.plan).select("id, version")');
    expect(plano(ruta)).toContain('supabase.from("route_plan_stops").insert(');
    expect([...ruta.matchAll(/admin\s*\.from\("(\w+)"\)/g)].map((m) => m[1])).toEqual(["travel_time_cache"]);
    // La llave de servicio se crea UNA vez, y cada lectura del día sale de la sesión.
    expect(ruta.split("createAdminClient(").length - 1).toBe(1);
    expect([...ruta.matchAll(/(\w+)\.from\("deliveries"\)/g)].map((m) => m[1])).toEqual(["supabase"]);
    expect(ruta).not.toMatch(/admin\s*\.from\("(deliveries|route_plans|route_plan_stops|notifications|profiles)"\)/);
  });

  it("leer el plan vigente (GET) es solo leer, con la sesión: el último borrador o publicado de ESA fecha", () => {
    const get = ruta.slice(ruta.indexOf("export async function GET("), ruta.indexOf("export async function PATCH("));
    expect(get.length).toBeGreaterThan(100);
    expect(get).not.toMatch(/\.(insert|update|delete|upsert|rpc)\(/);
    expect(get).not.toMatch(/admin|createAdminClient|fetch\(/);
    expect(plano(get)).toContain('.eq("plan_date", fecha).in("status", ["draft", "published"]).neq("source", "manual_import").order("version", { ascending: false }).limit(1).maybeSingle()');
    expect(plano(get)).toContain('if (!fila) return NextResponse.json({ ok: true, plan: null });');
    // No se baja la foto entera (lleva la matriz): solo la lista de órdenes, para saber cuál es de builder.
    expect(get).toContain("ordenes:input->entrada->ordenes");
    expect(get).not.toMatch(/[\s,"]input[\s,"]/);
  });

  it("planificar y leer contestan con la MISMA forma: el resumen y las rutas salen de las mismas dos funciones", () => {
    // Tres contestan: planificar (POST), leer (GET) y ajustar (PATCH).
    expect(ruta.split("resumenDelPlan(").length - 1).toBe(3);
    expect(ruta.split("vistaDelPlan(").length - 1).toBe(3);
    expect(ruta.split("choferes: choferesDelPlan(").length - 1).toBe(3);
    expect(ruta.split("porque: porQueDelPlan(").length - 1).toBe(3);
  });

  it("ajustar (PATCH): solo admin y logística, solo un BORRADOR, y el cliente manda el movimiento, no la ruta", () => {
    const patch = ruta.slice(ruta.indexOf("export async function PATCH("));
    expect(patch.length).toBeGreaterThan(100);
    expect(plano(patch)).toContain('if (!yo || !["admin", "logistics"].includes(String(yo.role)))');
    expect(plano(patch)).toContain('if (fila.status !== "draft" || fila.source === "manual_import") return NextResponse.json({ error: "NOT_DRAFT" }, { status: 409 });');
    // Parte de las paradas GUARDADAS y les aplica el movimiento; del cuerpo no se lee ninguna secuencia.
    expect(plano(patch)).toContain("aplicaMovimiento(estadoDeParadas((paradas.data ?? [])");
    expect(patch).not.toMatch(/cuerpo\.(secuencias|paradas|rutas|writes)/);
    expect(plano(patch)).toContain('if ("error" in estado) return NextResponse.json({ error: "BAD_MOVE", detail: estado.error }, { status: 400 });');
  });

  it("ajustar no llama a nadie ni toca órdenes: revalida con lo guardado, con la sesión, y sin la llave de servicio", () => {
    const patch = ruta.slice(ruta.indexOf("export async function PATCH("));
    expect(patch).not.toMatch(/admin\s*\.|createAdminClient|fetch\(|planificaElDia|proveedor/);
    expect(patch).not.toMatch(/from\("(deliveries|notifications)"\)/);
    expect(patch).not.toContain(".rpc(");
  });

  it("ajustar no pisa el plan: guarda uno NUEVO y descarta el anterior solo cuando el nuevo está entero", () => {
    const patch = plano(ruta.slice(ruta.indexOf("export async function PATCH(")));
    const guardaPlan = patch.indexOf('supabase.from("route_plans").insert(ajustado.plan)');
    const guardaParadas = patch.indexOf('supabase.from("route_plan_stops").insert(ajustado.paradas');
    const descartaElNuevo = patch.indexOf('.update({ status: "discarded" }).eq("id", nueva.id)');
    const descartaElViejo = patch.indexOf('.update({ status: "discarded" }).eq("id", planId)');
    expect([guardaPlan, guardaParadas, descartaElNuevo, descartaElViejo].every((i) => i > 0)).toBe(true);
    expect(guardaPlan < guardaParadas && guardaParadas < descartaElNuevo && descartaElNuevo < descartaElViejo).toBe(true);
    // Nunca se borra ni se edita una parada del plan anterior.
    expect(patch).not.toMatch(/from\("route_plan_stops"\)\.(update|delete)/);
  });

  it("planificar de nuevo lee lo FIJADO del borrador vigente de esa fecha y se lo pasa al motor", () => {
    const post = plano(ruta.slice(ruta.indexOf("export async function POST("), ruta.indexOf("export async function GET(")));
    expect(post).toContain('.eq("plan_date", fecha).eq("status", "draft").neq("source", "manual_import").order("version", { ascending: false }).limit(1).maybeSingle()');
    expect(post).toContain('.eq("plan_id", borradorVigente.id).eq("pinned", true)');
    expect(post).toContain("fijadas: estadoDeParadas((paradasFijadas ?? [])");
  });

  it("los controles de ajuste solo salen en un borrador, y mandan el movimiento tal cual", () => {
    const vista = plano(sinComentarios(leer("src/components/RutaDelPlan.tsx")));
    expect(vista).toContain('ajuste.mueve({ tipo: "sube", chofer: ruta.choferId, indice: k })');
    expect(vista).toContain('ajuste.mueve({ tipo: "baja", chofer: ruta.choferId, indice: k })');
    expect(vista).toContain('ajuste.mueve({ tipo: p.pinned ? "suelta" : "fija", orden: p.order_ref })');
    expect(vista).toContain('ajuste.mueve({ tipo: "a_chofer", orden: p.order_ref, chofer: e.target.value })');
    expect(vista).not.toMatch(/fetch\(|supabase|aplicaMovimiento|revalida/);
    expect(plano(panel)).toContain('if (!borrador || borrador.status !== "draft" || ocupado) return;');
    expect(plano(panel)).toContain('method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ plan_id: borrador.plan_id, movimiento })');
    // Los avisos se enseñan y se cuentan al confirmar; no deshabilitan «Publicar».
    expect(plano(panel)).toContain("disabled={!!ocupado || r!.ordenes === 0}");
    expect(panel).toContain("Este plan tiene ${avisos} aviso(s).");
    expect(plano(panel)).toContain('{(r.violaciones?.length ?? 0) > 0 && ( <div className="hint" style={{ margin: 0, color: "var(--red)" }}>');
    expect(plano(panel)).toContain("{(r.tramosSinTrafico ?? 0) > 0 && (");
    // Y el movimiento se comprueba en el servidor con la función probada, antes de tocar nada.
    expect(plano(ruta)).toContain("const movimiento = movimientoValido(cuerpo.movimiento);");
  });

  it("lo que quedó fuera sale orden por orden con su motivo y su siguiente paso; y cada entrega puede preguntar «¿por qué aquí?»", () => {
    expect(plano(panel)).toContain("{r.fueraConPorque!.map((x) => (");
    expect(plano(panel)).toContain('<b>{nombreDeOrden(x.id)}</b> — {motivo(x.motivo)}.');
    expect(plano(panel)).toContain('{REMEDIO[x.remedio] && <span className="hint" style={{ margin: 0 }}> {REMEDIO[x.remedio][lang === "es" ? 1 : 0]}</span>}');
    // Cada remedio que la librería puede devolver tiene su frase en el panel (menos «ninguno», que calla).
    const lib = leer("src/lib/route-plan/porque.ts");
    const tabla = lib.slice(lib.indexOf("const REMEDIOS"), lib.indexOf("};", lib.indexOf("const REMEDIOS")));
    const remedios = [...tabla.matchAll(/: "([a-z_]+)"/g)].map((m) => m[1]);
    expect(new Set(remedios).size).toBe(7);
    for (const x of new Set(remedios)) expect(panel).toContain(`  ${x}: [`);
    const vista = plano(sinComentarios(leer("src/components/RutaDelPlan.tsx")));
    expect(vista).toContain('{p.kind === "D" && porque?.[p.order_ref] && ( <button');
    expect(vista).toContain('if (q.quien === "persona") return t(');
    // Cada motivo por el que el motor dice «con ese no» tiene su frase.
    for (const x of ["capacidad", "ventana_estrecha", "retraso_sobre_el_tope", "fuera_de_turno", "sin_tiempo_de_viaje", "precedencia", "chofer_distinto_del_fijado", "no_permitido"]) expect(vista).toContain(`${x}: [`);
  });

  it("cada orden se nombra por su código Y su factura, leída en vivo; y la foto de los planes nuevos la lleva", () => {
    expect(plano(panel)).toContain('const nombreDeOrden = (id: string) => nombraLaOrden(deliveries, id, lang === "es");');
    expect(plano(ruta)).toContain("is_training, updated_at, invoice_num\";");
    // La función de publicar solo mira `id` y `updated_at` de cada foto: un campo más no la cambia.
    const publicar = leer("supabase/migrations/135_no_publicar_hoja_importada.sql");
    expect([...publicar.matchAll(/f->>'(\w+)'/g)].map((m) => m[1]).filter((x, i, a) => a.indexOf(x) === i).sort()).toEqual(["id", "updated_at"]);
  });

  it("planificar NO toca ninguna orden ni avisa a nadie", () => {
    expect(ruta).not.toMatch(/from\("deliveries"\)\s*\.(update|insert|delete|upsert)/);
    expect(ruta).not.toContain('from("notifications")');
    expect(ruta).not.toContain("/api/push");
  });

  it("solo admin y logística, solo etapas ruteables, y con Google únicamente si hay llave", () => {
    expect(plano(ruta)).toContain('if (!yo || !["admin", "logistics"].includes(String(yo.role)))');
    expect(ruta).toContain("if (!/^\\d{4}-\\d{2}-\\d{2}$/.test(fecha)) return NextResponse.json(");
    expect(plano(ruta)).toContain("warnTiendasMarcadas: Array.isArray(yo.visible_stores) && yo.visible_stores.length > 0,");
    expect(plano(ruta)).toContain('.eq("delivery_date", fecha).in("stage", [...ETAPAS_RUTEABLES])');
    expect(plano(ruta)).toContain("...(llave ? [proveedorGoogle(llave, fetch as unknown as FetchFn)] : []), proveedorOSRM(fetch as unknown as FetchFn), proveedorEstimado()");
  });

  it("si las paradas no se guardan, el plan se descarta: un plan sin paradas no sirve", () => {
    expect(plano(ruta)).toContain('await supabase.from("route_plans").update({ status: "discarded" }).eq("id", fila.id);');
  });

  it("el panel sale solo para admin y logística y con una fecha; no decide nada; y el push va con el id que devuelve publicar", () => {
    const gestor = plano(leer("src/app/(app)/routes/page.tsx"));
    expect(gestor).toContain('{!allDates && !soloPendientes && me && ["admin", "logistics"].includes(me.role) && <PlanDelDia date={date} />}');
    expect(panel).not.toMatch(/from\("|supabase|escriturasAlPublicar|avisosAlPublicar/);
    expect(plano(panel)).toContain('body: JSON.stringify({ notification_id: a.notification_id })');
    expect(plano(panel)).toContain("disabled={!!ocupado || r!.ordenes === 0}");
    // Publicar pregunta antes, y sin un sí no sigue.
    expect(plano(panel)).toMatch(/const ok = await confirmAction\(.*?\); if \(!ok\) return; setOcupado\("publicando"\)/);
  });

  it("dice con qué tiempos se hizo el plan, y que una orden partida en cargas es una sola en Órdenes", () => {
    expect(panel).toContain('r.proveedor === "estimado"');
    expect(panel).toContain("borrador!.warnTiendasMarcadas");
    // Un plan publicado se enseña, pero no se vuelve a publicar; y un plan viejo dice qué orden y por qué.
    expect(plano(panel)).toContain('{borrador?.status === "draft" && ( <button className="btn btn-primary btn-sm"');
    expect(panel).toContain('no_esta: ["you can\'t see this order, or it no longer exists", "no ve esta orden, o ya no existe"]');
    expect(plano(panel)).toContain('<RutaDelPlan rutas={borrador!.rutas} nombreDeOrden={nombreDeOrden} porque={borrador!.porque} ajuste={borrador!.status === "draft" ? {');
    expect(panel).toContain("se reparte en ${partes.length} cargas; en Órdenes figura una sola.");
  });
});

describe("135: una hoja importada no se publica, tampoco llamando a la función a mano", () => {
  const cuerpo = (f: string) => { const t = leer(f); const i = t.indexOf("create or replace function public.publish_route_plan("); const fin = "grant execute on function public.publish_route_plan(uuid, jsonb) to authenticated;\n"; return t.slice(i, t.indexOf(fin, i) + fin.length); };
  const de133 = cuerpo("supabase/migrations/133_route_plans.sql");
  const de135 = cuerpo("supabase/migrations/135_no_publicar_hoja_importada.sql");
  const sql = leer("supabase/migrations/135_no_publicar_hoja_importada.sql");

  it("`create or replace` reemplaza ENTERA: el cuerpo es el de la 133 letra por letra, y la ÚNICA diferencia es el bloque nuevo", () => {
    expect(de133.length).toBeGreaterThan(3000);
    const lineas133 = de133.split("\n"), lineas135 = de135.split("\n");
    const nuevas = lineas135.filter((l) => !lineas133.includes(l));
    expect(nuevas.map((l) => l.trim())).toEqual([
      "-- La hoja importada del despachador se guarda para COMPARAR. No se publica nunca, este en el estado que este:",
      "-- ni escribe ordenes, ni sustituye al plan publicado, ni avisa a nadie.",
      "if plan.source = 'manual_import' then",
      "raise exception 'ROUTE_PLAN_IMPORTED: an imported sheet is kept for comparing and is never published';",
    ]);
    // Quitando lo nuevo (y su `end if;`), queda exactamente la 133.
    const i = lineas135.findIndex((l) => l.includes("La hoja importada del despachador"));
    expect([...lineas135.slice(0, i), ...lineas135.slice(i + 5)].join("\n")).toBe(de133);
  });

  it("el rechazo va tras leer el plan y ANTES de mirar su estado, de validar avisos y de escribir nada", () => {
    const p = (s: string) => { const k = de135.indexOf(s); if (k < 0) throw new Error(s); return k; };
    const orden = ["where p.id = p_plan for update;", "ROUTE_PLAN_NOT_FOUND", "ROUTE_PLAN_IMPORTED", "ROUTE_PLAN_NOT_DRAFT", "ROUTE_PLAN_BAD_NOTICE", "ROUTE_PLAN_STALE", "update public.deliveries d", "insert into public.notifications"].map(p);
    expect(orden).toEqual([...orden].sort((a, b) => a - b));
  });

  it("sigue corriendo como quien llama; nada más cambia; sin transacción propia, sin el marcador, con ensayo y ledger", () => {
    const e = plano(sql.split("\n").map((l) => l.replace(/--.*$/, "")).join("\n"));
    expect(e.slice(e.indexOf("create or replace function public.publish_route_plan("), e.indexOf("declare"))).not.toContain("security definer");
    expect(e).not.toMatch(/create policy|drop policy|alter table|create table|create trigger|grant (select|insert|update|delete|all)/i);
    expect([...e.matchAll(/create or replace function public\.(\w+)/g)].map((m) => m[1])).toEqual(["publish_route_plan"]);
    expect(e).not.toMatch(/(^|[\s;])(begin|commit)\s*;/i);
    expect(sql).not.toContain("D-" + "NEXT");
    expect(sql).toContain("NO debe ser security definer");
    expect(sql).toContain("NADA escrito");
    expect(sql).toMatch(/-- @ledger-below\ninsert into public\.schema_migrations \(name, checksum\)\n {2}values \('135_no_publicar_hoja_importada\.sql', '[0-9a-f]{64}'\)/);
  });

  it("y el código lo cuenta con su código: IMPORTED es un 409", () => {
    expect(errorDePublicar("ROUTE_PLAN_IMPORTED: an imported sheet is kept for comparing and is never published")).toMatchObject({ codigo: "IMPORTED", status: 409 });
  });
});

describe("133: la base dice lo mismo", () => {
  const sql = leer("supabase/migrations/133_route_plans.sql");
  const e = plano(sql.split("\n").map((l) => l.replace(/--.*$/, "")).join("\n"));
  const funcion = e.slice(e.indexOf("create or replace function public.publish_route_plan("), e.indexOf("revoke execute on function public.publish_route_plan"));
  const politica = (n: string) => { const i = e.indexOf(`create policy "${n}"`); if (i < 0) throw new Error(n); return e.slice(i, e.indexOf(";", i)); };
  const roles = (txt: string) => [...txt.matchAll(/current_user_role\(\)\) in \(([^)]*)\)/g)].map((x) => x[1].split(",").map((r) => r.trim().replace(/'/g, "")).sort().join(","));

  it("publicar corre como quien llama: NO es security definer — y la autocomprobación lo exige", () => {
    expect(funcion.slice(0, funcion.indexOf(" as $$"))).not.toContain("security definer");
    expect(funcion).toContain("returns jsonb language plpgsql set search_path = public as $$");
    expect(e.slice(e.indexOf("do $comprueba$"))).toContain("if (select prosecdef from pg_proc where oid = 'public.publish_route_plan(uuid, jsonb)'::regprocedure) then");
    expect(e).toContain("revoke execute on function public.publish_route_plan(uuid, jsonb) from public, anon;");
  });

  it("solo admin y logística, y solo un borrador; el plan y el publicado vigente, bloqueados", () => {
    expect(funcion).toContain("rol not in ('admin', 'logistics') or not public.has_deliveries_access()");
    expect(funcion).toContain("select * into plan from public.route_plans p where p.id = p_plan for update;");
    expect(funcion).toContain("if plan.status <> 'draft' then raise exception 'ROUTE_PLAN_NOT_DRAFT");
    expect(funcion).toContain("where p.plan_date = plan.plan_date and p.status = 'published' for update;");
  });

  it("plan viejo: las MISMAS etapas ruteables y los mismos tres motivos que el código", () => {
    const etapas = /d\.stage not in \(([^)]*)\)/.exec(funcion)![1].split(",").map((s) => s.trim().replace(/'/g, "")).sort();
    expect(etapas).toEqual([...ETAPAS_RUTEABLES].sort());
    expect([...new Set([...funcion.matchAll(/then '(no_esta|fuera_de_etapa)'|else '(cambio)'/g)].map((m) => m[1] ?? m[2]))].sort()).toEqual(["cambio", "fuera_de_etapa", "no_esta"]);
    expect(funcion).toContain("or d.updated_at is distinct from (f->>'updated_at')::timestamptz;");
    expect(funcion).toContain("from jsonb_array_elements(coalesce(plan.input->'ordenes', '[]'::jsonb)) f");
  });

  it("la bandera que deja publicar es LOCAL a la transacción: no sobrevive en la conexión", () => {
    expect([...funcion.matchAll(/set_config\('app\.route_publishing', '(\w+)', (\w+)\)/g)].map((m) => [m[1], m[2]])).toEqual([["on", "true"], ["off", "true"]]);
  });

  it("escribe las cuatro columnas del Gestor y CUENTA: si no son todas, excepción — y todo se deshace", () => {
    const set = /update public\.deliveries d set (.*?) from jsonb_array_elements\(plan\.writes\)/.exec(funcion)![1];
    expect(set.split(",").map((x) => x.trim().split("=")[0].trim()).sort()).toEqual(["assigned_driver", "load_auto", "load_no", "route_seq"]);
    expect(funcion).toContain("get diagnostics escritas = row_count; if escritas <> esperadas then raise exception 'ROUTE_PLAN_UNSEEN");
  });

  it("los avisos se comprueban ANTES de escribir nada: chofer de este plan o del que sustituye, y texto acotado", () => {
    const valida = funcion.indexOf("and s.plan_id in (p_plan, anterior)");
    const escribe = funcion.indexOf("update public.deliveries d");
    expect(valida).toBeGreaterThan(0);
    expect(valida).toBeLessThan(escribe);
    expect(funcion).toContain("not between 1 and 300 then");
    expect(funcion).toContain(`values (nid, (aviso->>'driver_id')::uuid, '${ROUTE_PUBLISHED_KIND}', btrim(aviso->>'message'));`);
    expect(funcion).toContain("nid := gen_random_uuid();");
    expect(funcion).not.toContain("returning");
  });

  it("un plan solo pasa a `published` desde la función; un publicado es historia; y borrar un perfil no se atasca", () => {
    const guard = e.slice(e.indexOf("create or replace function public.guard_route_plan()"), e.indexOf("drop trigger if exists route_plans_guard"));
    expect(guard).toContain("if NEW.status = 'published' and publicando then return NEW; end if; raise exception 'A route plan is published only through publish_route_plan';");
    expect(guard).toContain("if OLD.status = 'published' and NEW.status = 'superseded' and publicando then");
    expect(guard).toContain("raise exception 'A route plan is never deleted: discard it instead';");
    expect(guard).toContain("if NEW.created_by is null then probe.created_by := OLD.created_by; end if; if NEW.published_by is null then probe.published_by := OLD.published_by; end if;");
    expect(e).toContain("check (status not in ('published', 'superseded') or published_at is not null)");
    expect(e).toContain("create unique index if not exists route_plans_one_published_idx on public.route_plans (plan_date) where status = 'published';");
  });

  it("un plan NACE borrador, con su versión y su autor puestos por la base", () => {
    const sello = e.slice(e.indexOf("create or replace function public.route_plan_stamp()"), e.indexOf("drop trigger if exists route_plans_stamp"));
    expect(sello).toContain("NEW.status := 'draft'; NEW.published_by := null; NEW.published_at := null;");
    expect(sello).toContain("if auth.uid() is not null then NEW.created_by := auth.uid(); end if;");
    expect(sello).toContain("where p.plan_date = NEW.plan_date), 0) + 1;");
  });

  it("quién lee y quién escribe: almacén solo lo publicado; escriben admin y logística; sin DELETE de planes", () => {
    const lee = politica("route_plans select");
    expect(roles(lee)).toEqual(["accounting,admin,logistics,manager"]);
    expect(lee).toContain("(select public.current_user_role()) = 'warehouse' and status = 'published'");
    for (const n of ["route_plans insert", "route_plan_stops insert", "route_plan_stops delete"]) expect(roles(politica(n)), n).toEqual(["admin,logistics"]);
    for (const n of ["route_plans update", "route_plan_stops update"]) expect(roles(politica(n)), n).toEqual(["admin,logistics", "admin,logistics"]);
    expect(politica("route_plan_stops select")).toContain("using (exists (select 1 from public.route_plans p where p.id = plan_id))");
    const politicas = [...e.matchAll(/create policy "[^"]+" on public\.(\w+) for (\w+)/g)].map((m) => `${m[1]} ${m[2]}`).sort();
    expect(politicas).toEqual(["route_plan_stops delete", "route_plan_stops insert", "route_plan_stops select", "route_plan_stops update", "route_plans insert", "route_plans select", "route_plans update"]);
    expect(e).toContain("grant select, insert, update on public.route_plans to authenticated;");
  });

  it("revoke antes del grant, sin transacción propia, con ensayo, ledger y sin el marcador", () => {
    for (const t of ["route_plans", "route_plan_stops"]) {
      const quita = e.indexOf(`revoke all on public.${t} from anon, authenticated;`);
      expect(quita, t).toBeGreaterThan(0);
      expect(e.indexOf(`on public.${t} to authenticated;`), t).toBeGreaterThan(quita);
    }
    expect(sql.split("\n").map((l) => l.replace(/--.*$/, "")).join("\n")).not.toMatch(/^\s*(begin|commit|rollback)\s*;/im);
    expect(sql).toContain("--   rollback;");
    expect(sql).toContain("-> 14 filas");
    expect(sql).toContain("-> 3, no 14");
    expect(sql.split("-- @ledger-below")[1]).toMatch(/'133_route_plans\.sql', '[0-9a-f]{64}'/);
    expect(sql).not.toContain("D-" + "NEXT");
  });

  it("las columnas que guarda el código existen en la tabla", () => {
    const tabla = (n: string) => { const i = e.indexOf(`create table if not exists public.${n} (`); return e.slice(i, e.indexOf(");", i)); };
    for (const c of ["plan_date", "source", "algorithm_version", "params", "input", "result", "writes", "provider", "traffic", "converged", "total_minutes", "total_miles", "late_minutes", "unassigned_count"]) {
      expect(tabla("route_plans"), c).toMatch(new RegExp(`\\b${c}\\b`));
    }
    for (const c of ["plan_id", "driver_id", "driver_name", "seq", "kind", "delivery_id", "order_ref", "label", "visit", "place", "lat", "lng", "window_start", "window_end", "is_hard", "eta", "etd", "wait_min", "service_min", "late_min", "load_after", "leg_minutes", "leg_miles", "pinned"]) {
      expect(tabla("route_plan_stops"), c).toMatch(new RegExp(`\\b${c}\\b`));
    }
  });
});
