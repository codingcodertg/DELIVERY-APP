import { describe, it, expect, vi, beforeEach } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { COOKIE_CAPACITACION, mensajeDeCapacitacion } from "./capacitacion";
import { rechazoDeCapacitacion } from "./capacitacion-servidor";

/**
 * La tercera capa del modo capacitación (D-NEXT): el servidor.
 *
 * Dos clases de prueba:
 *   1. **El barrido**: cada acción de servidor de fichaje que no esté en la lista de lecturas empieza
 *      con la guarda, antes que nada. Una acción nueva que escriba y no la lleve, no pasa. Y lo que está
 *      en la lista de lecturas no escribe (ni `insert`, ni `update`, ni avisos).
 *   2. **De verdad**: se llaman acciones con la cookie puesta y con Supabase y los avisos falsos, y se
 *      comprueba que contestan «no se guardó» SIN crear siquiera el cliente de Supabase; sin la cookie,
 *      siguen su camino de siempre. Y el latido del cronómetro, igual.
 */

const falso = vi.hoisted(() => ({
  cookie: null as string | null,
  crearCliente: vi.fn(),
  avisos: vi.fn(),
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (k: string) => (k === "rtg_capacitacion_tt" && falso.cookie !== null ? { name: k, value: falso.cookie } : undefined),
    getAll: () => [],
    set: () => {},
  }),
}));

/** Un Supabase sin sesión: sin la cookie, la acción sigue y se para en «Not signed in». */
const sinSesion = () => {
  falso.crearCliente();
  return {
    auth: { getUser: async () => ({ data: { user: null }, error: null }) },
    from: () => { throw new Error("no debía llegar a la base"); },
    schema: () => { throw new Error("no debía llegar a la base"); },
  };
};
vi.mock("@/lib/clockin/supabase/server", () => ({ createClient: async () => sinSesion(), isSupabaseConfigured: true }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => sinSesion() }));
vi.mock("@/lib/clockin/notify", () => ({
  pushToManagers: falso.avisos, pushToUser: falso.avisos, maybeNotifyStoreReady: falso.avisos,
}));
vi.mock("@/lib/clockin/push", () => ({ sendPush: falso.avisos }));

import { clockIn, clockOut, adminClock } from "@/app/timetracker/clock-in/actions/clock";
import { startLeave, endLeave } from "@/app/timetracker/clock-in/actions/leave";
import { startTrip, logStop, finishStop, endTrip } from "@/app/timetracker/clock-in/actions/runner";
import { addNote } from "@/app/timetracker/clock-in/actions/notes";
import { markAllRead } from "@/app/timetracker/clock-in/actions/notifications";
import { submitTimeOff, reviewTimeOff } from "@/app/timetracker/clock-in/actions/timeoff";
import { approveTimesheet } from "@/app/timetracker/clock-in/actions/reports";
import { setEmployeeActive } from "@/app/timetracker/clock-in/actions/team";
import { sendTestPush } from "@/app/timetracker/clock-in/actions/push";
import { POST as latido } from "@/app/timetracker/api/heartbeat/route";

beforeEach(() => {
  falso.cookie = null;
  falso.crearCliente.mockClear();
  falso.avisos.mockClear();
});

const DIR = "src/app/timetracker/clock-in/actions";

/** Lo que solo lee. Si alguna empieza a escribir, el barrido de abajo lo ve y hay que quitarla de aquí. */
const LECTURAS = new Set([
  "getCrewNow", "getMyDay", "getExceptionHistory", "getMySchedule", "getMyNotes", "getMyScorecard", "getMyNotifications",
  "countUnread", "getDayPhotos", "getPayrollPeriod", "getEmployeeWeek", "getMyTrip", "getScheduleWeek", "getGeofences",
  "geocodeForMap", "getClockinEmployeeSettings", "getPendingForInbox", "getMyTimeOff", "listVehicles",
]);
/**
 * Reciben el cliente de Supabase como primer argumento: no se pueden llamar desde el navegador (un
 * cliente no viaja), y solo las llaman acciones que ya pasaron su guarda.
 */
const AYUDANTES = new Set(["materializeForEmployee", "clearFutureShifts"]);

/** Las funciones exportadas de un fichero, con su cuerpo. Sigue paréntesis, llaves y `<…>` del tipo de vuelta. */
function funciones(src: string): { nombre: string; firma: string; cuerpo: string }[] {
  const out: { nombre: string; firma: string; cuerpo: string }[] = [];
  for (const m of src.matchAll(/^export async function (\w+)\s*\(/gm)) {
    let i = (m.index ?? 0) + m[0].length - 1;
    let d = 0;
    for (; ; i++) {
      if (src[i] === "(") d++;
      else if (src[i] === ")" && --d === 0) break;
    }
    const finParams = i;
    let ang = 0, br = 0, par = 0;
    for (i = i + 1; ; i++) {
      if (src.startsWith("=>", i)) { i++; continue; }
      const c = src[i];
      if (c === "<") ang++;
      else if (c === ">") ang--;
      else if (c === "(") par++;
      else if (c === ")") par--;
      else if (c === "{") { if (ang === 0 && br === 0 && par === 0) break; br++; }
      else if (c === "}") br--;
    }
    const ini = i;
    d = 0;
    for (; ; i++) {
      if (src[i] === "{") d++;
      else if (src[i] === "}" && --d === 0) break;
    }
    out.push({ nombre: m[1], firma: src.slice(m.index, finParams + 1), cuerpo: src.slice(ini + 1, i) });
  }
  return out;
}

const ficheros = readdirSync(DIR).filter((f) => f.endsWith(".ts")).map((f) => ({
  f, src: readFileSync(join(DIR, f), "utf8").split("\r\n").join("\n"),
}));
const todas = ficheros.flatMap(({ f, src }) => funciones(src).map((x) => ({ ...x, f })));

describe("el barrido de las acciones de fichaje", () => {
  it("las encuentra todas (control: si el lector se rompe, no hay nada que barrer)", () => {
    expect(todas.length).toBeGreaterThanOrEqual(60);
    for (const n of ["clockIn", "startLeave", "startTrip", "addNote", "submitTimeOff", "approveTimesheet", "getMyDay"]) {
      expect(todas.map((x) => x.nombre), n).toContain(n);
    }
  });

  it("toda acción que no es lectura empieza con la guarda, antes que nada", () => {
    const sinGuarda: string[] = [];
    for (const { f, nombre, cuerpo } of todas) {
      if (LECTURAS.has(nombre) || AYUDANTES.has(nombre)) continue;
      if (!/^\s*const corte = await corteDeCapacitacion\(\);\n\s*if \(corte\) return /.test(cuerpo)) sinGuarda.push(`${f}: ${nombre}`);
    }
    expect(sinGuarda).toEqual([]);
  });

  it("cada fichero con guardas importa la guarda de verdad", () => {
    for (const { f, src } of ficheros) {
      if (!src.includes("await corteDeCapacitacion()")) continue;
      expect(src, f).toContain('import { corteDeCapacitacion } from "@/lib/timetracker/capacitacion-servidor";');
    }
  });

  it("las lecturas no escriben, no avisan y no llaman a quien escribe", () => {
    const escribe = /\.(insert|update|upsert|delete|rpc|upload|remove)\(|pushTo|sendPush|maybeNotify|materializeForEmployee|clearFutureShifts|method:\s*"(POST|PUT|PATCH|DELETE)"/;
    for (const { f, nombre, cuerpo } of todas) {
      if (!LECTURAS.has(nombre)) continue;
      expect(cuerpo, `${f}: ${nombre}`).not.toMatch(escribe);
    }
  });

  it("las ayudantes reciben el cliente de Supabase, que no puede venir del navegador", () => {
    for (const { nombre, firma } of todas) {
      if (!AYUDANTES.has(nombre)) continue;
      expect(firma, nombre).toMatch(/\(\s*supabase: AnySupabase/);
    }
  });

  it("las dos listas solo nombran acciones que existen", () => {
    const nombres = new Set(todas.map((x) => x.nombre));
    for (const n of [...LECTURAS, ...AYUDANTES]) expect(nombres.has(n), n).toBe(true);
  });
});

describe("la respuesta", () => {
  it("apagada no hay rechazo; encendida, «no se guardó» en el idioma de la cookie", () => {
    expect(rechazoDeCapacitacion(null)).toBeNull();
    expect(rechazoDeCapacitacion("es")).toEqual({ ok: false, code: "error", message: mensajeDeCapacitacion("es"), capacitacion: true });
    expect(rechazoDeCapacitacion("en")?.message).toBe(mensajeDeCapacitacion("en"));
  });
});

describe("de verdad: con la cookie, la acción contesta sin crear el cliente ni avisar a nadie", () => {
  const casos: [string, () => Promise<unknown>][] = [
    ["clockIn", () => clockIn({ lat: 26.2, lng: -98.2 })],
    ["clockOut", () => clockOut("e1", { lat: 26.2, lng: -98.2 })],
    ["startLeave", () => startLeave({ reason: "lunch" })],
    ["endLeave", () => endLeave("l1")],
    ["startTrip", () => startTrip({ kind: "sales", personal: true })],
    ["logStop", () => logStop({ label: "Cliente", photoPath: "x.jpg" })],
    ["finishStop", () => finishStop({})],
    ["endTrip", () => endTrip({})],
    ["addNote", () => addNote("hola")],
    ["markAllRead", () => markAllRead()],
    ["submitTimeOff", () => submitTimeOff({ type: "vacation", startDate: "2026-10-20", endDate: "2026-10-21" })],
    ["reviewTimeOff", () => reviewTimeOff({ id: "t1", decision: "approved" })],
    ["approveTimesheet", () => approveTimesheet({ employeeId: "e", periodStart: "2026-10-02" } as Parameters<typeof approveTimesheet>[0])],
    ["setEmployeeActive", () => setEmployeeActive("e", false)],
    ["adminClock", () => adminClock({ employeeId: "e" } as Parameters<typeof adminClock>[0])],
  ];

  for (const [nombre, llama] of casos) {
    it(`${nombre}`, async () => {
      falso.cookie = "es";
      const r = (await llama()) as { ok: boolean; message?: string };
      expect(r.ok).toBe(false);
      expect(r.message).toBe(mensajeDeCapacitacion("es"));
      expect(falso.crearCliente).not.toHaveBeenCalled();
      expect(falso.avisos).not.toHaveBeenCalled();
    });
  }

  it("la prueba de push tampoco manda nada", async () => {
    falso.cookie = "en";
    expect(await sendTestPush()).toEqual({ ok: false, sent: 0 });
    expect(falso.crearCliente).not.toHaveBeenCalled();
    expect(falso.avisos).not.toHaveBeenCalled();
  });

  it("sin la cookie, la misma acción sigue su camino (control: la guarda no lo corta todo)", async () => {
    const r = await addNote("hola");
    expect(falso.crearCliente).toHaveBeenCalled();
    expect(r).toEqual({ ok: false, message: "Not signed in." });
  });

  it("el latido del cronómetro con la cookie contesta sin tocar la base", async () => {
    falso.cookie = "es";
    const r = await latido(new Request("http://x/timetracker/api/heartbeat", { method: "POST", body: JSON.stringify({ id: "practica-1", endMs: 5 }) }));
    expect(await r.json()).toEqual({ ok: true, capacitacion: true });
    expect(falso.crearCliente).not.toHaveBeenCalled();
  });

  it("sin la cookie, el latido sí pregunta por la sesión", async () => {
    const r = await latido(new Request("http://x/timetracker/api/heartbeat", { method: "POST", body: JSON.stringify({ id: "s1", endMs: 5 }) }));
    expect(r.status).toBe(401);
    expect(falso.crearCliente).toHaveBeenCalled();
  });

  it("la cookie que se lee es la del modo capacitación", () => {
    expect(COOKIE_CAPACITACION).toBe("rtg_capacitacion_tt");
  });
});
