import { describe, it, expect, vi } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { accionesDePractica, CLASE_DE_ACCION, type AccionesDeFichar, type Libreta } from "./capacitacion-fichar";
import { practicaVacia, type Practica } from "./capacitacion";

/**
 * Las acciones de fichar en práctica (D-490): lo que escribe no llama a la acción real; lo que lee la
 * llama y le pinta encima lo practicado. Y las pantallas del empleado las piden al hook, no a las
 * acciones de servidor.
 */

const leer = (r: string) => readFileSync(join(process.cwd(), r), "utf8").split("\r\n").join("\n");
const sinComentarios = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .split("\n").map((l) => (/^\s*\/\//.test(l) ? "" : l.replace(/\s\/\/.*$/, ""))).join("\n");

const H = (h: number, m = 0) => new Date(Date.UTC(2026, 9, 7, h, m, 0)).toISOString();

/** Un juego real donde TODO lo que escribe revienta: si la práctica lo llama, la prueba lo ve. */
function reales() {
  const escribe = (nombre: string) => vi.fn(async () => { throw new Error(`la práctica llamó a ${nombre} de verdad`); });
  const r = {
    getMyDay: vi.fn(async () => ({
      ok: true as const, companyId: "c", userId: "u", open: null, leave: null, shift: null, scheduledMinutes: 0,
      scheduledDays: 0, periodStart: "2026-10-02", periodEnd: "2026-10-08", today: [], breaks: [],
      lunchMinutes: 0, outMinutes: 0, todayMinutes: 0, weekMinutes: 600,
    })),
    getMyTrip: vi.fn(async () => ({
      ok: true as const, mode: "sales" as const, vehicles: [{ id: "v1", name: "Van" }], trip: null, stops: [],
      currentVehicleId: null, clockedIn: false,
    })),
    getMyNotes: vi.fn(async () => ({ ok: true as const, notes: [{ id: "n-real", note: "real", created_at: H(7) }] })),
    getMyTimeOff: vi.fn(async () => ({ ok: true as const, rows: [] })),
    getMyNotifications: vi.fn(async () => ({ ok: true as const, items: [{ id: "a", type: "x", message: "hola", read: false, created_at: H(7) }] })),
    countUnread: vi.fn(async () => 3),
    clockIn: escribe("clockIn"),
    clockOut: escribe("clockOut"),
    startLeave: escribe("startLeave"),
    endLeave: escribe("endLeave"),
    startTrip: escribe("startTrip"),
    endTrip: escribe("endTrip"),
    logStop: escribe("logStop"),
    finishStop: escribe("finishStop"),
    subirFoto: escribe("subirFoto"),
    addNote: escribe("addNote"),
    submitTimeOff: escribe("submitTimeOff"),
    markAllRead: escribe("markAllRead"),
  };
  return r as unknown as AccionesDeFichar & typeof r;
}

function libreta(): Libreta & { practica: () => Practica } {
  let p = practicaVacia();
  let n = 0;
  let t = Date.parse(H(9));
  return {
    leer: () => p,
    cambia: (f) => { p = f(p); },
    ahora: () => (t += 60 * 60 * 1000),
    nuevoId: () => `practica-${++n}`,
    practica: () => p,
  };
}

describe("en práctica, lo que escribe no llega a la acción real", () => {
  // Cada acción que escribe, llamada con argumentos de verdad. Si se añade una al juego, `CLASE_DE_ACCION`
  // obliga a clasificarla, y esta lista a probarla.
  const llamadas: Record<string, (a: AccionesDeFichar) => Promise<unknown>> = {
    clockIn: (a) => a.clockIn({ lat: 26.2, lng: -98.2 }),
    clockOut: (a) => a.clockOut("e1", { lat: 26.2, lng: -98.2 }),
    startLeave: (a) => a.startLeave({ reason: "lunch" }),
    endLeave: (a) => a.endLeave("l1"),
    startTrip: (a) => a.startTrip({ kind: "sales", vehicleId: "v1", odometer: 1000 }),
    endTrip: (a) => a.endTrip({}),
    logStop: (a) => a.logStop({ label: "Cliente", photoPath: "x.jpg" }),
    finishStop: (a) => a.finishStop({}),
    subirFoto: (a) => a.subirFoto(new File(["x"], "f.jpg"), { companyId: "c", userId: "u" }),
    addNote: (a) => a.addNote("hola"),
    submitTimeOff: (a) => a.submitTimeOff({ type: "vacation", startDate: "2026-10-20", endDate: "2026-10-21" }),
    markAllRead: (a) => a.markAllRead(),
  };

  it("la lista de arriba es exactamente la de las que escriben", () => {
    const escriben = Object.entries(CLASE_DE_ACCION).filter(([, c]) => c === "escribe").map(([k]) => k).sort();
    expect(Object.keys(llamadas).sort()).toEqual(escriben);
  });

  for (const [nombre, llama] of Object.entries(llamadas)) {
    it(`${nombre}: contesta ok sin llamar a la real`, async () => {
      const r = reales();
      const res = (await llama(accionesDePractica(r, libreta()))) as { ok: boolean };
      expect(res.ok).toBe(true);
      expect((r as unknown as Record<string, ReturnType<typeof vi.fn>>)[nombre]).not.toHaveBeenCalled();
    });
  }
});

describe("lo que lee pregunta lo real y le pinta la práctica encima", () => {
  it("fichar entrada y empezar la comida se ven en el día siguiente que se lee", async () => {
    const r = reales();
    const l = libreta();
    const a = accionesDePractica(r, l);
    await a.clockIn({ lat: 1, lng: 1 });
    await a.startLeave({ reason: "lunch" });
    const d = await a.getMyDay();
    expect(r.getMyDay).toHaveBeenCalledTimes(1);
    if (!d.ok) throw new Error("no ok");
    expect(d.open?.id).toBe("practica-1");
    expect(d.leave).toMatchObject({ id: "practica-2", reason: "lunch" });
    expect(l.practica().fichar.map((e) => e.k)).toEqual(["entrada", "descanso"]);
  });

  it("un viaje con el vehículo de la empresa, o personal sin vehículo", async () => {
    const r = reales();
    const a = accionesDePractica(r, libreta());
    await a.clockIn({ lat: 1, lng: 1 });
    await a.startTrip({ kind: "sales", vehicleId: "v1", odometer: 1 });
    let v = await a.getMyTrip();
    if (!v.ok) throw new Error("no ok");
    expect(v.trip?.vehicleId).toBe("v1");
    const b = accionesDePractica(reales(), libreta());
    await b.clockIn({ lat: 1, lng: 1 });
    await b.startTrip({ kind: "sales", vehicleId: "v1", personal: true });
    v = await b.getMyTrip();
    if (!v.ok) throw new Error("no ok");
    expect(v.trip?.vehicleId).toBeNull();
  });

  it("la nota practicada sale encima de las reales", async () => {
    const a = accionesDePractica(reales(), libreta());
    await a.addNote("practicando");
    const n = await a.getMyNotes();
    if (!n.ok) throw new Error("no ok");
    expect(n.notes.map((x) => x.note)).toEqual(["practicando", "real"]);
  });

  it("el tiempo libre practicado sale pendiente", async () => {
    const a = accionesDePractica(reales(), libreta());
    await a.submitTimeOff({ type: "sick", startDate: "2026-10-09", endDate: "2026-10-09", note: "gripe" });
    const t = await a.getMyTimeOff();
    if (!t.ok) throw new Error("no ok");
    expect(t.rows).toEqual([{ id: "practica-1", type: "sick", start_date: "2026-10-09", end_date: "2026-10-09", note: "gripe", status: "pending", manager_comment: null }]);
  });

  it("marcar los avisos como leídos se ve, y la base no se entera", async () => {
    const r = reales();
    const a = accionesDePractica(r, libreta());
    expect(await a.countUnread()).toBe(3);
    await a.markAllRead();
    expect(await a.countUnread()).toBe(0);
    const n = await a.getMyNotifications();
    if (!n.ok) throw new Error("no ok");
    expect(n.items.every((i) => i.read)).toBe(true);
    expect(r.markAllRead).not.toHaveBeenCalled();
  });

  it("la foto devuelve una ruta de práctica, que nunca es la del cubo real", async () => {
    const f = await accionesDePractica(reales(), libreta()).subirFoto(new File(["x"], "f.jpg"), { companyId: "c", userId: "u" });
    expect(f).toEqual({ ok: true, path: "practica/practica-1.jpg" });
  });
});

describe("quién usa qué", () => {
  const cap = sinComentarios(leer("src/components/timetracker/Capacitacion.tsx"));

  it("el hook da el juego de práctica con la práctica encendida, y el real si no", () => {
    expect(cap).toContain("return useMemo(() => (activa ? accionesDePractica(REALES, libreta) : REALES), [activa, libreta]);");
  });

  it("el juego real son las acciones de servidor de verdad, una por una", () => {
    const reales = cap.slice(cap.indexOf("const REALES: AccionesDeFichar = {"), cap.indexOf("};", cap.indexOf("const REALES")));
    for (const k of Object.keys(CLASE_DE_ACCION)) {
      if (k === "subirFoto") expect(reales).toContain("subirFoto: subirFotoDeFichaje,");
      else expect(reales, k).toMatch(new RegExp(`\\b${k}\\b`));
    }
  });

  it("las pantallas del empleado piden las acciones al hook", () => {
    for (const f of [
      "src/components/timetracker/PunchPanel.tsx",
      "src/components/timetracker/TripPanel.tsx",
      "src/components/timetracker/MySections.tsx",
      "src/components/timetracker/TimeOffRequests.tsx",
      "src/components/timetracker/NotificationBell.tsx",
      "src/components/timetracker/FichajesDeHoy.tsx",
    ]) {
      expect(sinComentarios(leer(f)), f).toMatch(/= useAccionesDeFichar\(\);/);
    }
  });

  it("ninguna pantalla importa directamente una acción de fichar que escribe, ni la subida de fotos", () => {
    const escriben = Object.entries(CLASE_DE_ACCION).filter(([k, c]) => c === "escribe" && k !== "subirFoto").map(([k]) => k);
    const tsx: string[] = [];
    const recorre = (d: string) => {
      for (const f of readdirSync(d)) {
        const p = join(d, f);
        if (statSync(p).isDirectory()) recorre(p);
        else if (f.endsWith(".tsx")) tsx.push(p.split("\\").join("/"));
      }
    };
    recorre("src");
    const culpables: string[] = [];
    for (const f of tsx) {
      if (f === "src/components/timetracker/Capacitacion.tsx") continue;
      const src = sinComentarios(readFileSync(f, "utf8"));
      for (const m of src.matchAll(/import\s*\{([^}]*)\}\s*from\s*["']([^"']+)["']/g)) {
        const nombres = m[1].split(",").map((x) => x.trim().replace(/^type\s+/, "").split(/\s+as\s+/)[0]);
        const deFichar = m[2].startsWith("@/app/timetracker/clock-in/actions/");
        for (const n of nombres) {
          if (deFichar && escriben.includes(n)) culpables.push(`${f}: ${n}`);
          if (m[2] === "@/lib/clockin/sube-foto" && n === "subirFotoDeFichaje") culpables.push(`${f}: ${n}`);
        }
      }
    }
    expect(culpables).toEqual([]);
  });
});
