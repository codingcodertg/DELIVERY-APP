import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { NextResponse } from "next/server";
import { cacheEnMemoria } from "@/lib/route-times/tiempos";
import type { ProveedorDeTiempos } from "@/lib/route-times/proveedores";
import type { OrdenEntrada } from "@/lib/route-engine";
import { planificaElDia, type Borrador } from "./borrador";
import { aplicaMovimiento, cambiaConLaVecina, estadoDeParadas, revalida, type EstadoDelPlan } from "./ajuste";
import { fisicaDeLaOrden, fotoDeLaCopia, type Foto, type OrdenAhora } from "./copia";
import type { DatosDelDia } from "./entrada";

/**
 * Cambiar una ruta YA PUBLICADA (D-NEXT). El dueño: «los botons para cmabiar la ruta cuando ya esta no funciona» —
 * «Ya publicada, no me deja». El primer ajuste crea un borrador nuevo, copia del publicado; el publicado no se toca.
 */

const P = (orden: string) => ({ orden, tipo: "P" as const });
const D = (orden: string) => ({ orden, tipo: "D" as const });

// ---------------------------------------------------------------------------------------------------------------
describe("la foto de la copia: qué órdenes siguen siendo las del plan publicado", () => {
  const orden = (id: string, o: Partial<OrdenEntrada> = {}): OrdenEntrada => ({
    id, origen: "tienda:norte", destino: `orden:${id}`, pallets: 2, ventana: [510, 600], estrecha: false, builder: false,
    servicioRecogidaMin: 8, servicioEntregaMin: 10, ...o,
  });
  const puntos = { "tienda:norte": { lat: 26.3, lng: -98.2 }, "orden:a": { lat: 26.35, lng: -98.25 }, "orden:b": { lat: 26.36, lng: -98.25 } };
  const fotos: Foto[] = [{ id: "a", updated_at: "T0a", factura: "F-1" }, { id: "b", updated_at: "T0b", factura: null }];
  const escritas = [{ id: "a", assigned_driver: "Chofer Uno", route_seq: 0, load_no: 1 }, { id: "b", assigned_driver: "Chofer Uno", route_seq: 1, load_no: 1 }];
  const ahora = (o: Partial<Record<string, Partial<OrdenAhora>>> = {}): OrdenAhora[] =>
    escritas.map((w) => ({ id: w.id, updated_at: `T1${w.id}`, assigned_driver: w.assigned_driver, route_seq: w.route_seq, load_no: w.load_no, ...o[w.id] }));
  const copia = (x: { frescas?: OrdenEntrada[]; puntosFrescos?: typeof puntos; ahora?: OrdenAhora[]; escritas?: typeof escritas } = {}) => fotoDeLaCopia({
    fotos, guardadas: [orden("a"), orden("b")], puntosGuardados: puntos,
    frescas: x.frescas ?? [orden("a"), orden("b")], puntosFrescos: x.puntosFrescos ?? puntos, ahora: x.ahora ?? ahora(), escritas: x.escritas ?? escritas,
  });

  it("una orden intacta desde que se publicó toma el `updated_at` de HOY: publicar la tocó, y sin esto la copia saldría vieja siempre", () => {
    expect(copia()).toEqual({ fotos: [{ id: "a", updated_at: "T1a", factura: "F-1" }, { id: "b", updated_at: "T1b", factura: null }], noSeReescriben: [], cambiaron: [] });
  });

  it("una orden que alguien movió en el Gestor después de publicar (otro chofer, otro puesto u otro viaje) CAMBIÓ: se queda con su foto vieja", () => {
    for (const cambio of [{ assigned_driver: "Chofer Dos" }, { route_seq: 5 }, { load_no: 2 }]) {
      const r = copia({ ahora: ahora({ b: cambio }) });
      expect(r.cambiaron).toEqual(["b"]);
      expect(r.fotos.find((f) => f.id === "b")!.updated_at).toBe("T0b");
      expect(r.fotos.find((f) => f.id === "a")!.updated_at).toBe("T1a");
    }
  });

  it("una orden a la que le cambió lo que usa el motor (pallets, ventana, servicio, el pin) CAMBIÓ", () => {
    expect(copia({ frescas: [orden("a"), orden("b", { pallets: 5 })] }).cambiaron).toEqual(["b"]);
    expect(copia({ frescas: [orden("a", { ventana: [600, 700] }), orden("b")] }).cambiaron).toEqual(["a"]);
    expect(copia({ frescas: [orden("a", { servicioEntregaMin: 40 }), orden("b")] }).cambiaron).toEqual(["a"]);
    expect(copia({ puntosFrescos: { ...puntos, "orden:b": { lat: 27, lng: -98 } } }).cambiaron).toEqual(["b"]);
    expect(copia({ frescas: [orden("a", { prioridad: "critical" }), orden("b")] }).cambiaron).toEqual(["a"]);
  });

  it("la zona y el chofer fijado no cuentan: salen de los choferes y de lo escrito, no de la orden", () => {
    expect(copia({ frescas: [orden("a", { zona: "mcallen", zonaRecogida: "edinburg" }), orden("b", { choferFijado: "c1" })] }).cambiaron).toEqual([]);
    expect(fisicaDeLaOrden(orden("a", { zona: "x", codigo: "Z", entrada: "2026" }), puntos)).toBe(fisicaDeLaOrden(orden("a"), puntos));
  });

  it("una orden que ya no está pendiente ese día (recogida, entregada, anulada, de otro día, o que no se ve) NO se reescribe", () => {
    const r = copia({ ahora: ahora().filter((o) => o.id !== "a") });
    expect(r.noSeReescriben).toEqual(["a"]);
    expect(r.fotos.map((f) => f.id)).toEqual(["b"]);
    expect(r.cambiaron).toEqual([]);
  });

  it("una orden que el publicado NO escribió (quedó sin asignar): publicar no la tocó, así que vale solo si su `updated_at` es el de la foto", () => {
    const sinB = escritas.filter((w) => w.id !== "b");
    expect(copia({ escritas: sinB, ahora: ahora({ b: { updated_at: "T0b", assigned_driver: null } }) }).cambiaron).toEqual([]);
    expect(copia({ escritas: sinB, ahora: ahora({ b: { updated_at: "T9b", assigned_driver: null } }) }).cambiaron).toEqual(["b"]);
  });
});

// ---------------------------------------------------------------------------------------------------------------
describe("lo que ya no está pendiente no se mueve", () => {
  const base: EstadoDelPlan = { secuencias: { c1: [P("a"), D("a"), P("b"), D("b")], c2: [P("z"), D("z")] }, fijadas: [] };
  const hecha = new Set(["a"]);

  it("ni subirla, ni bajarla, ni cambiar con ella a su vecina, ni pasarla a otro chofer", () => {
    expect(aplicaMovimiento(base, { tipo: "baja", chofer: "c1", indice: 0 }, ["c1", "c2"], hecha)).toEqual({ error: "ya_no_se_mueve" });
    expect(aplicaMovimiento(base, { tipo: "sube", chofer: "c1", indice: 2 }, ["c1", "c2"], hecha)).toEqual({ error: "ya_no_se_mueve" });   // P(b) sobre D(a)
    expect(aplicaMovimiento(base, { tipo: "a_chofer", orden: "a", chofer: "c2" }, ["c1", "c2"], hecha)).toEqual({ error: "ya_no_se_mueve" });
  });

  it("lo demás se mueve igual que siempre, y fijarla se puede", () => {
    expect(aplicaMovimiento(base, { tipo: "a_chofer", orden: "b", chofer: "c2" }, ["c1", "c2"], hecha)).toEqual({ secuencias: { c1: [P("a"), D("a")], c2: [P("z"), D("z"), P("b"), D("b")] }, fijadas: ["b"] });
    expect(aplicaMovimiento(base, { tipo: "fija", orden: "a" }, ["c1", "c2"], hecha)).toEqual({ ...base, fijadas: ["a"] });
    // Sin la lista (un borrador del motor), mover «a» vale como antes.
    expect(aplicaMovimiento(base, { tipo: "a_chofer", orden: "a", chofer: "c2" }, ["c1", "c2"])).not.toHaveProperty("error");
  });

  it("la flecha: una parada cambia con su vecina solo si ninguna de las dos es de una orden que no se mueve — y una parte cuenta como su orden", () => {
    const ordenes = ["a", "a", "b#1", "b#1"];
    expect(cambiaConLaVecina(ordenes, 2, -1, hecha)).toBe(false);
    expect(cambiaConLaVecina(ordenes, 2, 1, hecha)).toBe(true);
    expect(cambiaConLaVecina(ordenes, 3, 1, hecha)).toBe(false);                     // el borde
    expect(cambiaConLaVecina(ordenes, 2, 1, new Set(["b"]))).toBe(false);             // «b#1» es la orden «b»
  });
});

// ---------------------------------------------------------------------------------------------------------------
const AHORA = "2026-03-02T12:00:00.000Z";
const proveedor: ProveedorDeTiempos = {
  nombre: "google", conTrafico: false,
  async matriz(origenes, destinos) { return origenes.map(() => destinos.map(() => ({ minutos: 10, millas: 5 }))); },
  async tramo() { return { minutos: 14, millas: 5 }; },
};
const datos = (): DatosDelDia => ({
  ordenes: ["a", "b"].map((id, k) => ({
    id, stage: "approved", order_code: id.toUpperCase(), order_type: "ACliente", store: "Tienda Norte", pickup_name: null, delivery_name: null,
    delivery_lat: 26.35 + k / 100, delivery_lng: -98.25, delivery_windows: "0830-1730", est_pallets: 2, actual_pallets: null, pickup_duration: "8 min",
    delivery_duration: "10 min", assigned_driver: null, input_date: "2026-03-03", input_time: `090${k}`, account: null, customer_type: "counter_sale",
    is_training: false, updated_at: `2026-03-03T15:00:0${k}.000000+00:00`,
  })),
  choferes: [{ id: "c1", full_name: "Chofer Uno", role: "driver" as const }, { id: "c2", full_name: "Chofer Dos", role: "driver" as const }],
  ajustesDeChofer: ["c1", "c2"].map((profile_id) => ({ profile_id, base_store: "Tienda Norte", capacity_pallets: 10, shift_start: "08:00", shift_end: "17:30", returns_to_base: true, routable: true })),
  settings: { stores: [{ name: "Tienda Norte", address: "1 Calle", lat: 26.3, lng: -98.2 }], order_type_rules: { ACliente: { storeToStore: false } } },
});
const planDelMotor = () => planificaElDia(datos(), "2026-03-04", "America/Chicago", { cache: cacheEnMemoria(), proveedores: [proveedor], ahoraISO: AHORA });

describe("revalidar solo escribe lo que está en la foto", () => {
  it("en la copia, una orden fuera de la foto sigue en la ruta pero NO se escribe; en un plan del motor no se quita nada", async () => {
    const b = await planDelMotor();
    const tiendas = datos().settings.stores!;
    expect(revalida(b.plan, estadoDeParadas(b.paradas), "p", tiendas).plan.writes.map((w) => w.id)).toEqual(["a", "b"]);
    const sinA = { ...b.plan, input: { ...b.plan.input, ordenes: b.plan.input.ordenes.filter((f) => f.id !== "a") } };
    const r = revalida(sinA, estadoDeParadas(b.paradas), "p", tiendas);
    expect(r.plan.writes.map((w) => w.id)).toEqual(["b"]);
    expect(r.paradas.filter((p) => p.order_ref === "a")).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// La ruta, con un Supabase falso: ajustar un PUBLICADO.
const falso = vi.hoisted(() => ({
  planes: {} as Record<string, Record<string, unknown>>,
  paradas: {} as Record<string, unknown[]>,
  dia: [] as Record<string, unknown>[],
  encima: null as { id: string } | null,
  publicadoWrites: [] as unknown[],
  escrito: [] as { tabla: string; op: "insert" | "update"; valor: unknown; filtros: Record<string, unknown> }[],
  ajustes: {} as Record<string, unknown>,
  choferes: [] as unknown[],
  deChofer: [] as unknown[],
}));

vi.mock("@/lib/api-auth", () => ({
  requireUser: async () => ({
    ok: true, user: { id: "u1" },
    supabase: {
      from: (tabla: string) => {
        const filtros: Record<string, unknown> = {};
        let op: "select" | "insert" | "update" = "select", valor: unknown = null;
        const resultado = (uno: boolean): { data: unknown; error: null } => {
          if (op !== "select") {
            falso.escrito.push({ tabla, op, valor, filtros: { ...filtros } });
            return { data: tabla === "route_plans" && op === "insert" ? { id: "22222222-2222-2222-2222-222222222222", version: 9 } : null, error: null };
          }
          if (tabla === "profiles") return { data: filtros.id ? { role: "logistics", visible_stores: [] } : falso.choferes, error: null };
          if (tabla === "route_plans") {
            if (filtros.id) return { data: falso.planes[String(filtros.id)] ?? null, error: null };
            if (filtros.status === "draft") return { data: falso.encima, error: null };
            return { data: { writes: falso.publicadoWrites }, error: null };
          }
          if (tabla === "route_plan_stops") return { data: falso.paradas[String(filtros.plan_id)] ?? [], error: null };
          if (tabla === "settings") return { data: falso.ajustes, error: null };
          if (tabla === "deliveries") return { data: falso.dia, error: null };
          if (tabla === "driver_settings") return { data: falso.deChofer, error: null };
          return { data: uno ? null : [], error: null };                     // driver_availability, route_locks
        };
        const q = {
          select: () => q, order: () => q, limit: () => q,
          eq: (c: string, v: unknown) => { filtros[c] = v; return q; }, neq: () => q, in: () => q,
          gt: (c: string, v: unknown) => { filtros[`gt_${c}`] = v; return q; },
          insert: (v: unknown) => { op = "insert"; valor = v; return q; }, update: (v: unknown) => { op = "update"; valor = v; return q; },
          maybeSingle: async () => resultado(true),
          then: (ok: (v: unknown) => unknown) => ok(resultado(false)),
        };
        return q;
      },
    },
  }),
}));
void NextResponse;

import { PATCH as ajusta } from "@/app/api/route-plan/route";

const PUB = "11111111-1111-1111-1111-111111111111";
const pide = (movimiento: unknown, plan_id = PUB) => ajusta(new Request("http://localhost/api/route-plan", { method: "PATCH", body: JSON.stringify({ plan_id, movimiento }) }));

/** El día DESPUÉS de publicar: cada orden con el chofer, viaje y puesto que escribió el plan, y un `updated_at` nuevo. */
const diaTrasPublicar = (b: Borrador) => datos().ordenes.map((o) => {
  const w = b.plan.writes.find((x) => x.id === o.id)!;
  return { ...o, updated_at: `2026-03-04T08:00:00.123456+00:00`, assigned_driver: w.assigned_driver, route_seq: w.route_seq, load_no: w.load_no };
});

let b: Borrador;
beforeEach(async () => {
  b = await planDelMotor();
  falso.planes = { [PUB]: { ...b.plan, id: PUB, status: "published", version: 3 } };
  falso.paradas = { [PUB]: b.paradas.map((p) => ({ driver_id: p.driver_id, seq: p.seq, kind: p.kind, order_ref: p.order_ref, pinned: p.pinned })) };
  falso.dia = diaTrasPublicar(b);
  falso.encima = null; falso.publicadoWrites = b.plan.writes; falso.escrito = [];
  const d = datos();
  falso.ajustes = d.settings as Record<string, unknown>; falso.choferes = [...d.choferes]; falso.deChofer = [...d.ajustesDeChofer];
});

/** Qué chofer lleva «b», y el otro. */
const choferDe = (id: string) => b.paradas.find((p) => p.order_ref === id)!.driver_id;
const otro = (c: string) => (c === "c1" ? "c2" : "c1");

describe("PATCH sobre un plan PUBLICADO: una copia en borrador, y el publicado intacto", () => {
  it("el primer ajuste guarda un BORRADOR nuevo, hijo del publicado, con el movimiento aplicado — y no escribe NADA en el publicado", async () => {
    const res = await pide({ tipo: "a_chofer", orden: "b", chofer: otro(choferDe("b")) });
    const cuerpo = await res.json();
    expect([res.status, cuerpo.ok, cuerpo.status]).toEqual([200, true, "draft"]);
    expect(cuerpo.copia).toEqual({ version: 3, noSeReescriben: [], cambiaron: [] });
    const plan = falso.escrito.find((e) => e.tabla === "route_plans" && e.op === "insert")!.valor as { parent_plan_id: string; source: string; writes: { id: string; assigned_driver: string }[] };
    expect([plan.parent_plan_id, plan.source]).toEqual([PUB, "manual_edit"]);
    expect(plan.writes.find((w) => w.id === "b")!.assigned_driver).toBe(otro(choferDe("b")) === "c1" ? "Chofer Uno" : "Chofer Dos");
    // Ni se descarta ni se edita el publicado: sigue siendo lo que tiene cada chofer hasta que se publique la copia.
    expect(falso.escrito.filter((e) => e.op === "update")).toEqual([]);
  });

  it("la copia lleva la foto con el `updated_at` de HOY de lo que no cambió: así publicarla no sale «plan viejo» por lo que escribió el propio publicado", async () => {
    await pide({ tipo: "fija", orden: "a" });
    const plan = falso.escrito.find((e) => e.tabla === "route_plans" && e.op === "insert")!.valor as { input: { ordenes: Foto[] } };
    expect(plan.input.ordenes.map((f) => [f.id, f.updated_at])).toEqual([["a", "2026-03-04T08:00:00.123456+00:00"], ["b", "2026-03-04T08:00:00.123456+00:00"]]);
  });

  it("lo que ya no está pendiente (aquí «a», ya salió del día) ni se mueve ni se reescribe; lo demás, sí", async () => {
    falso.dia = diaTrasPublicar(b).filter((o) => o.id !== "a");
    const quieto = await pide({ tipo: "a_chofer", orden: "a", chofer: otro(choferDe("a")) });
    expect([quieto.status, await quieto.json()]).toEqual([400, { error: "BAD_MOVE", detail: "ya_no_se_mueve" }]);
    expect(falso.escrito).toEqual([]);
    const res = await pide({ tipo: "a_chofer", orden: "b", chofer: otro(choferDe("b")) });
    expect((await res.json()).copia).toEqual({ version: 3, noSeReescriben: ["a"], cambiaron: [] });
    const plan = falso.escrito.find((e) => e.tabla === "route_plans" && e.op === "insert")!.valor as { input: { ordenes: Foto[] }; writes: { id: string }[] };
    expect(plan.input.ordenes.map((f) => f.id)).toEqual(["b"]);
    expect(plan.writes.map((w) => w.id)).toEqual(["b"]);
  });

  it("una orden editada después de publicar se dice (`cambiaron`) y se queda con su foto vieja: publicar la copia dirá «plan viejo», como hoy", async () => {
    falso.dia = diaTrasPublicar(b).map((o) => (o.id === "b" ? { ...o, est_pallets: 7 } : o));
    const cuerpo = await (await pide({ tipo: "fija", orden: "a" })).json();
    expect(cuerpo.copia.cambiaron).toEqual(["b"]);
    const plan = falso.escrito.find((e) => e.tabla === "route_plans" && e.op === "insert")!.valor as { input: { ordenes: Foto[] } };
    expect(plan.input.ordenes.find((f) => f.id === "b")!.updated_at).toBe(b.plan.input.ordenes.find((f) => f.id === "b")!.updated_at);
  });

  it("si ya hay un borrador más nuevo de esa fecha, no se hace otra copia: 409 y nada escrito", async () => {
    falso.encima = { id: "otro" };
    const res = await pide({ tipo: "fija", orden: "a" });
    expect([res.status, (await res.json()).error]).toEqual([409, "DRAFT_EXISTS"]);
    expect(falso.escrito).toEqual([]);
  });

  it("un BORRADOR se ajusta como siempre: plan nuevo y el anterior descartado; ni lee el día ni lleva copia", async () => {
    falso.planes[PUB] = { ...falso.planes[PUB], status: "draft" };
    falso.dia = [];                                    // si lo leyera, «a» y «b» saldrían «ya no pendientes»
    const cuerpo = await (await pide({ tipo: "a_chofer", orden: "b", chofer: otro(choferDe("b")) })).json();
    expect(cuerpo.copia).toBeNull();
    expect(falso.escrito.filter((e) => e.op === "update").map((e) => [e.valor, e.filtros.id])).toEqual([[{ status: "discarded" }, PUB]]);
  });

  it("un plan sustituido o descartado sigue sin ajustarse: 409 NOT_DRAFT", async () => {
    for (const status of ["superseded", "discarded"]) {
      falso.planes[PUB] = { ...falso.planes[PUB], status };
      expect((await pide({ tipo: "fija", orden: "a" })).status).toBe(409);
    }
    expect(falso.escrito).toEqual([]);
  });

  // Mutante del orquestador: quitar `|| fila.source === "manual_import"` sobrevivía. La hoja importada a mano (D-326) es
  // para comparar, no una ruta: ni en borrador ni publicada se ajusta.
  it("una hoja importada a mano (`manual_import`) no se ajusta, ni en borrador ni publicada: 409 NOT_DRAFT", async () => {
    for (const status of ["draft", "published"]) {
      falso.planes[PUB] = { ...falso.planes[PUB], status, source: "manual_import" };
      const res = await pide({ tipo: "fija", orden: "a" });
      expect([res.status, (await res.json()).error]).toEqual([409, "NOT_DRAFT"]);
    }
    expect(falso.escrito).toEqual([]);
  });
});

describe("el servidor: la copia LEE el día y no escribe en él", () => {
  const ruta = readFileSync(join(process.cwd(), "src/app/api/route-plan/route.ts"), "utf8").split("\r\n").join("\n");
  it("`leeElDia` —la lectura de planificar, compartida— solo lee; y el PATCH la llama únicamente con un publicado", () => {
    const lee = ruta.slice(ruta.indexOf("async function leeElDia("), ruta.indexOf("export async function POST("));
    expect(lee.length).toBeGreaterThan(200);
    expect(lee).not.toMatch(/\.(insert|update|delete|upsert|rpc)\(/);
    const patch = ruta.slice(ruta.indexOf("export async function PATCH("));
    expect(patch.replace(/\s+/g, " ")).toContain('if (esPublicado) { // La copia');
    expect(patch).not.toMatch(/from\("(deliveries|notifications)"\)/);
  });
});

describe("la pantalla: el publicado lleva los mismos controles y dice que se edita una copia", () => {
  const leer = (f: string) => readFileSync(join(process.cwd(), f), "utf8");
  const panel = leer("src/components/PlanDelDia.tsx");
  const vista = leer("src/components/RutaDelPlan.tsx");

  it("los controles de ajuste salen en borrador Y en publicado, y el ajuste manda el plan que se ve", () => {
    expect(panel).toContain('ajuste={borrador!.status === "draft" || borrador!.status === "published" ?');
    expect(panel).toContain('if (!borrador || !["draft", "published"].includes(borrador.status) || ocupado) return;');
  });

  it("con una copia, la pantalla lo dice, y dice qué no se reescribe y qué cambió", () => {
    expect(panel).toContain("Estás editando una copia");
    expect(panel).toContain("data-copia-del-publicado");
    expect(panel).toContain("borrador!.copia.cambiaron.length > 0");
  });

  it("la flecha se apaga con la MISMA regla que usa el servidor, y lo que no se mueve lleva su candado", () => {
    expect(vista).toContain("cambiaConLaVecina(ordenesDeLaRuta, k, -1, ajuste.noSeMueven)");
    expect(vista).toContain("cambiaConLaVecina(ordenesDeLaRuta, k, 1, ajuste.noSeMueven)");
    expect(vista).toContain("data-no-se-mueve");
  });
});
