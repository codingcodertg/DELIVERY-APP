import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Un fallo de lectura no acusa a nadie — las acciones de fichar, corridas de verdad (D-NEXT).
 *
 * Esto no se prueba con una copia de la regla: lo que decidía el bug acababa en la base (una fila
 * de `exceptions` tipo `out_of_radius` contra una persona, y un aviso a los gerentes), así que se
 * llama a `clockIn` y a `clockOut` con una base falsa y se mira **qué se escribió**. La base falsa
 * no sale de esta máquina: no hay Supabase, no hay push y no hay nada que avisar a nadie.
 *
 * El caso: `job_sites` contesta un error. Antes, `sites` quedaba en `null`, `firstMatch` no casaba
 * con nada, `onSite` salía `false` y con ese `false` se escribía la excepción y salía el aviso —
 * una fila idéntica, byte a byte, a la de un fraude real (hallazgo C-3, `docs/AUDIT-2026-10-09.md`).
 */

const EMPRESA = "99999999-9999-9999-9999-999999999999";
const SITIO = "11111111-1111-1111-1111-111111111111";
const YO = "caf1a337-0000-4000-8000-000000000000";

/** Un sitio circular de 50 m; dentro es el centro y lejos está a ~30 km. */
const CIRCULO = { id: SITIO, latitude: 25.9593, longitude: -97.5091, radius_meters: 50, boundary: null, padding_meters: null };
const DENTRO = { lat: 25.9593, lng: -97.5091 };
const LEJOS = { lat: 26.2045, lng: -98.1673 };

type Respuesta = { data?: unknown; error?: unknown; count?: number };

const falso = vi.hoisted(() => ({
  plan: {} as Record<string, { data?: unknown; error?: unknown; count?: number }>,
  escrituras: [] as { tabla: string; op: string; fila: unknown }[],
  pushToManagers: vi.fn(async (..._a: unknown[]) => undefined),
  pushToUser: vi.fn(async (..._a: unknown[]) => undefined),
}));

/**
 * Una base falsa que contesta por `tabla:operación` y apunta toda escritura. Devuelve un eslabón
 * que es a la vez cadena (`.eq().limit()…`) y promesa, porque el fichero usa las dos formas: unas
 * consultas terminan en `.maybeSingle()` y otras se esperan tal cual.
 */
function consulta(tabla: string, op: string, fila?: unknown) {
  if (op !== "select") falso.escrituras.push({ tabla, op, fila });
  const r = (): Respuesta => falso.plan[`${tabla}:${op}`] ?? { data: null, error: null };
  const eslabon: Record<string, unknown> = {};
  for (const m of ["select", "eq", "neq", "is", "in", "gte", "lte", "order", "limit"]) eslabon[m] = () => eslabon;
  eslabon.maybeSingle = async () => r();
  eslabon.single = async () => r();
  eslabon.then = (ok: (v: Respuesta) => unknown, fail?: (e: unknown) => unknown) => Promise.resolve(r()).then(ok, fail);
  return eslabon;
}

vi.mock("@/lib/timetracker/capacitacion-servidor", () => ({ corteDeCapacitacion: async () => null }));
vi.mock("@/lib/clockin/notify", () => ({ pushToManagers: falso.pushToManagers, pushToUser: falso.pushToUser }));
vi.mock("@/lib/clockin/supabase/server", () => ({
  isSupabaseConfigured: true,
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: YO } } }) },
    from: (tabla: string) => ({
      select: () => consulta(tabla, "select"),
      insert: (fila: unknown) => consulta(tabla, "insert", fila),
      update: (fila: unknown) => consulta(tabla, "update", fila),
    }),
  }),
}));

import { clockIn, clockOut } from "@/app/timetracker/clock-in/actions/clock";

/** Lo que contesta la base cuando nada se tuerce: sin fichaje abierto, sin turno de hoy. */
function planBase(sitios: { data?: unknown; error?: unknown }) {
  falso.plan = {
    "profiles:select": { data: { company_id: EMPRESA, full_name: "Empleado de prueba", store_id: SITIO, role: "employee" }, error: null },
    "time_entries:select": { data: null, error: null },
    "job_sites:select": sitios,
    "scheduled_shifts:select": { data: null, error: null },
    "time_entries:insert": { data: { id: "entrada-1", clock_in_at: "2026-10-10T13:00:00Z" }, error: null },
    "time_entries:update": { data: { id: "entrada-1" }, error: null },
    "exceptions:select": { data: null, error: null, count: 0 },
    "vehicle_trips:select": { data: null, error: null },
    "exceptions:insert": { data: null, error: null },
  };
}

const escritasA = (tabla: string, op: string) => falso.escrituras.filter((e) => e.tabla === tabla && e.op === op);
const fila = (tabla: string, op: string) => escritasA(tabla, op)[0]?.fila as Record<string, unknown> | undefined;

beforeEach(() => {
  falso.escrituras = [];
  falso.pushToManagers.mockClear();
  falso.pushToUser.mockClear();
});

describe("clockIn: la geocerca que no se pudo leer", () => {
  it("el fichaje se guarda, pero «en radio» queda SIN MEDIR — no en `false`", async () => {
    planBase({ data: null, error: { message: "canceling statement due to statement timeout" } });
    const r = await clockIn(DENTRO);
    expect(r.ok).toBe(true);
    expect(r.ok && r.onSite).toBe(null);
    expect(fila("time_entries", "insert")).toMatchObject({ clock_in_in_radius: null, clock_in_site_id: null });
  });

  it("no se le inserta ninguna excepción ni sale aviso a los gerentes", async () => {
    planBase({ data: null, error: { message: "permission denied for table job_sites" } });
    await clockIn(DENTRO);
    expect(escritasA("exceptions", "insert")).toEqual([]);
    expect(falso.pushToManagers).not.toHaveBeenCalled();
  });

  it("y no se le pide un motivo que no puede dar", async () => {
    // Sin medir no hay nada que explicar: la persona no sabe que el SELECT falló.
    planBase({ data: null, error: { message: "timeout" } });
    const r = await clockIn(DENTRO);
    expect(r.ok).toBe(true);
  });

  it("ni se le pregunta por el turno: «en el sitio y sin turno» tampoco se puede afirmar", async () => {
    planBase({ data: null, error: { message: "timeout" } });
    falso.plan["scheduled_shifts:select"] = { data: null, error: null, count: 3 }; // la empresa sí usa horarios hoy
    const r = await clockIn(DENTRO);
    expect(r.ok).toBe(true);
    expect(escritasA("exceptions", "insert")).toEqual([]);
  });
});

describe("clockIn: lo que ya funcionaba sigue igual", () => {
  it("fuera de radio DE VERDAD: se apunta `out_of_radius` y se avisa", async () => {
    planBase({ data: [CIRCULO], error: null });
    const r = await clockIn({ ...LEJOS, reasons: ["traffic"] });
    expect(r.ok && r.onSite).toBe(false);
    expect(fila("time_entries", "insert")).toMatchObject({ clock_in_in_radius: false });
    expect(fila("exceptions", "insert")).toMatchObject({ type: "out_of_radius", employee_id: YO, reason: "traffic" });
    expect(falso.pushToManagers.mock.calls[0]?.[1]).toBe("mgr_offsite");
  });

  it("fuera de radio y sin motivo: sigue pidiéndolo, y no escribe nada", async () => {
    planBase({ data: [CIRCULO], error: null });
    const r = await clockIn(LEJOS);
    expect(r).toEqual({ ok: false, code: "needs_reason", context: "offsite" });
    expect(falso.escrituras).toEqual([]);
  });

  it("dentro del sitio, sin turno y con horarios en uso: sigue pidiendo motivo", async () => {
    planBase({ data: [CIRCULO], error: null });
    falso.plan["scheduled_shifts:select"] = { data: null, error: null, count: 3 };
    expect(await clockIn(DENTRO)).toEqual({ ok: false, code: "needs_reason", context: "unscheduled" });
  });

  it("dentro del sitio: se guarda `true`, sin excepción y sin aviso", async () => {
    planBase({ data: [CIRCULO], error: null });
    const r = await clockIn(DENTRO);
    expect(r.ok && r.onSite).toBe(true);
    expect(fila("time_entries", "insert")).toMatchObject({ clock_in_in_radius: true, clock_in_site_id: SITIO });
    expect(escritasA("exceptions", "insert")).toEqual([]);
    expect(falso.pushToManagers).not.toHaveBeenCalled();
  });
});

describe("clockOut: el mismo bloque, que estaba copiado", () => {
  it("con la geocerca ilegible, la salida se cierra SIN la «classic fraud signal»", async () => {
    planBase({ data: null, error: { message: "timeout" } });
    const r = await clockOut("entrada-1", DENTRO);
    expect(r.ok).toBe(true);
    expect(r.ok && r.onSite).toBe(null);
    expect(fila("time_entries", "update")).toMatchObject({ clock_out_in_radius: null, clock_out_site_id: null });
    expect(escritasA("exceptions", "insert")).toEqual([]);
    expect(falso.pushToManagers).not.toHaveBeenCalled();
  });

  it("fuera de un sitio DE VERDAD: se apunta y se avisa, como siempre", async () => {
    planBase({ data: [CIRCULO], error: null });
    const r = await clockOut("entrada-1", LEJOS);
    expect(r.ok && r.onSite).toBe(false);
    expect(fila("time_entries", "update")).toMatchObject({ clock_out_in_radius: false });
    expect(fila("exceptions", "insert")).toMatchObject({ type: "out_of_radius", time_entry_id: "entrada-1" });
    expect(falso.pushToManagers.mock.calls[0]?.[1]).toBe("mgr_offsite_out");
  });

  it("dentro del sitio: `true`, sin excepción y sin aviso", async () => {
    planBase({ data: [CIRCULO], error: null });
    const r = await clockOut("entrada-1", DENTRO);
    expect(r.ok && r.onSite).toBe(true);
    expect(fila("time_entries", "update")).toMatchObject({ clock_out_in_radius: true, clock_out_site_id: SITIO });
    expect(escritasA("exceptions", "insert")).toEqual([]);
    expect(falso.pushToManagers).not.toHaveBeenCalled();
  });
});
