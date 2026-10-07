import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { CLASE_DE_DATO, datosDePractica, funcionesDePractica } from "./capacitacion-datos";
import { mensajeDeCapacitacion, practicaVacia, type Practica } from "./capacitacion";
import type { Libreta } from "./capacitacion-fichar";
import type { DataState } from "@/lib/timetracker-data-provider";
import type { Session } from "./types";

/**
 * El proveedor de datos de Time Tracker en práctica (D-NEXT). Cada función está clasificada —pasa, se
 * practica, se bloquea— y aquí se comprueba con un proveedor «real» de mentira cuyas funciones avisan si
 * alguien las llama.
 */

const leer = (r: string) => readFileSync(r, "utf8").split("\r\n").join("\n");

function sesion(id: string, extra: Partial<Session> = {}): Session {
  return {
    id, employeeUid: "yo", employeeName: null, projectId: null, assignmentId: null, payrollId: null, memo: "", weekOf: null,
    date: "2026-10-07", startMs: 1, endMs: 2, durationSeconds: 1, activeSeconds: 0, idleSeconds: 0, screenSeconds: 0,
    keystrokes: 0, clicks: 0, lunchSeconds: 0, breakSeconds: 0, breakEvents: [], manual: false, source: "tracked",
    isLive: false, liveNote: null, createdAt: "2026-10-07T00:00:00Z", ...extra,
  };
}

/** Un proveedor real cuyas funciones son espías. Las de datos llevan una sesión y una solicitud reales. */
function proveedorReal() {
  const espias: Record<string, ReturnType<typeof vi.fn>> = {};
  for (const k of Object.keys(CLASE_DE_DATO)) espias[k] = vi.fn(async () => `real:${k}`);
  const real = {
    ...espias,
    ready: true,
    me: { id: "yo", fullName: "Everto Prado", role: "employee" },
    mySessions: [sesion("real-s")],
    myRequests: [{ id: "real-r", employeeUid: "yo", type: "add", payload: {}, status: "pending", resolvedAt: null, resolvedBy: null, createdAt: "x" }],
  } as unknown as DataState;
  return { real, espias };
}

function libreta(): Libreta {
  let p: Practica = practicaVacia();
  let n = 0;
  return { leer: () => p, cambia: (f) => { p = f(p); }, ahora: () => Date.parse("2026-10-07T15:00:00Z"), nuevoId: () => `practica-${++n}` };
}

/** Argumentos de ejemplo para llamar a cada función. */
const ARGS: Record<keyof typeof CLASE_DE_DATO, unknown[]> = {
  ensureSessionsSince: ["2026-09-01"], addRequest: ["add", { horas: 1 }], notify: ["hola"], listLiveSessions: [],
  getSession: ["practica-x"], startSession: [{ isLive: true }], updateSession: ["real-s", { memo: "x" }],
  updateLiveSession: ["real-s", { memo: "x" }], screenshotSignedUrl: ["a.jpg"], deleteScreenshot: ["sh", "a.jpg"],
  uploadScreenshot: [{ employeeUid: "yo", sessionId: null, blob: new Blob(["x"]), date: null, activityPercent: 5 }],
  insertBlankScreenshot: [{ employeeUid: "yo", sessionId: null, date: null }],
  updateMyAccount: [{ fullName: "x", city: "", payMethod: "", payDetails: "" }], signOutEverywhere: [], logAudit: ["a", "b"],
  sessionsSince: ["2026-10-01"], sessionsByProject: ["p"], insertSession: [{}], removeSession: ["s"], payrollsForWeek: ["w"],
  insertPayroll: [{}], updatePayroll: ["p", {}], removePayroll: ["p"], insertProject: [{}], updateProject: ["p", {}],
  insertAssignment: [{}], updateAssignment: ["a", {}], removeAssignment: ["a"],
  claimRequest: ["r", { status: "approved", resolvedBy: "yo" }], resetRequestToPending: ["r"],
  updateEmployeeSettings: ["e", { active: true }], updateSettings: [{}],
};

describe("cada función del proveedor, en práctica", () => {
  for (const [nombre, clase] of Object.entries(CLASE_DE_DATO)) {
    it(`${nombre} (${clase})`, async () => {
      const { real, espias } = proveedorReal();
      const p = datosDePractica(real, libreta(), "es");
      const f = (p as unknown as Record<string, (...a: unknown[]) => unknown>)[nombre];
      if (clase === "pasa") {
        // La del proveedor real, con los mismos argumentos y su misma respuesta: leer es leer.
        const args = ARGS[nombre as keyof typeof ARGS];
        expect(await f(...args)).toBe(`real:${nombre}`);
        expect(espias[nombre]).toHaveBeenCalledWith(...args);
        return;
      }
      if (clase === "bloqueada") {
        await expect(f(...ARGS[nombre as keyof typeof ARGS])).rejects.toThrow(mensajeDeCapacitacion("es"));
      } else {
        await f(...ARGS[nombre as keyof typeof ARGS]);
      }
      expect(espias[nombre], `${nombre} llegó a la real`).not.toHaveBeenCalled();
    });
  }

  it("ninguna que escriba pasa: lo que pasa solo lee o no toca datos", () => {
    const pasan = Object.entries(CLASE_DE_DATO).filter(([, c]) => c === "pasa").map(([k]) => k).sort();
    expect(pasan).toEqual([
      "ensureSessionsSince", "notify", "payrollsForWeek", "screenshotSignedUrl", "sessionsByProject", "sessionsSince", "signOutEverywhere",
    ]);
  });
});

describe("las funciones leen el proveedor al llamarlas, no al crearlas", () => {
  it("con el proveedor ya cambiado, leer una sesión real pregunta al de ahora", async () => {
    const a = proveedorReal();
    const b = proveedorReal();
    let actual = a.real;
    const f = funcionesDePractica(() => actual, libreta(), "es");
    actual = b.real;
    await f.getSession("real-s");
    expect(a.espias.getSession).not.toHaveBeenCalled();
    expect(b.espias.getSession).toHaveBeenCalledWith("real-s");
  });
});

describe("el cronómetro de práctica", () => {
  it("empieza una sesión que solo existe en la práctica, y se ve en «mis sesiones» delante de las reales", async () => {
    const { real } = proveedorReal();
    const l = libreta();
    const s = await datosDePractica(real, l, "es").startSession({ isLive: true, memo: "practicando", employeeUid: "otro" });
    expect(s.id).toBe("practica-1");
    // Siempre a nombre de quien practica, diga lo que diga el cuerpo.
    expect(s.employeeUid).toBe("yo");
    const de = datosDePractica(real, l, "es");
    expect(de.mySessions.map((x) => x.id)).toEqual(["practica-1", "real-s"]);
    expect((await de.listLiveSessions()).map((x) => x.id)).toEqual(["practica-1"]);
  });

  it("no ve —ni puede cerrar— una sesión real viva", async () => {
    const { real, espias } = proveedorReal();
    const p = datosDePractica(real, libreta(), "es");
    expect(await p.listLiveSessions()).toEqual([]);
    expect(espias.listLiveSessions).not.toHaveBeenCalled();
    expect(await p.updateLiveSession("real-s", { isLive: false })).toBe(false);
    await p.updateSession("real-s", { isLive: false });
    expect(espias.updateSession).not.toHaveBeenCalled();
  });

  it("el latido cae en la sesión de práctica viva; cerrada, ya no", async () => {
    const { real } = proveedorReal();
    const l = libreta();
    const s = await datosDePractica(real, l, "es").startSession({ isLive: true });
    expect(await datosDePractica(real, l, "es").updateLiveSession(s.id, { durationSeconds: 30 })).toBe(true);
    await datosDePractica(real, l, "es").updateSession(s.id, { isLive: false });
    expect(await datosDePractica(real, l, "es").updateLiveSession(s.id, { durationSeconds: 60 })).toBe(false);
    const fila = await datosDePractica(real, l, "es").getSession(s.id);
    expect(fila).toMatchObject({ id: s.id, durationSeconds: 30, isLive: false });
  });

  it("leer una sesión real por id sí pregunta a la real", async () => {
    const { real, espias } = proveedorReal();
    await datosDePractica(real, libreta(), "es").getSession("real-s");
    expect(espias.getSession).toHaveBeenCalledWith("real-s");
  });
});

describe("«Mis solicitudes» en práctica", () => {
  it("la solicitud practicada sale pendiente, delante de las reales", async () => {
    const { real } = proveedorReal();
    const l = libreta();
    await datosDePractica(real, l, "es").addRequest("add", { horas: 2 });
    const r = datosDePractica(real, l, "es").myRequests;
    expect(r.map((x) => x.id)).toEqual(["practica-1", "real-r"]);
    expect(r[0]).toMatchObject({ employeeUid: "yo", type: "add", status: "pending", payload: { horas: 2 } });
  });
});

describe("el proveedor de verdad lo usa", () => {
  const prov = leer("src/lib/timetracker-data-provider.tsx");

  it("con la práctica encendida da el proveedor de práctica; apagada, el real", () => {
    expect(prov).toContain("const value: DataState = funcionesDeLaPractica ? conPractica(real, funcionesDeLaPractica, capacitacion.practica) : real;");
  });

  it("las funciones de práctica se crean UNA vez por práctica y leen el proveedor de cada momento", () => {
    // Con identidades nuevas en cada pintado, los efectos del cronómetro que dependen de ellas se volverían a montar.
    expect(prov).toContain("realRef.current = real;");
    expect(prov).toMatch(/const funcionesDeLaPractica = useMemo\(\n\s*\(\) => \(capacitacion\.activa \? funcionesDePractica\(\(\) => realRef\.current, capacitacion\.libreta, capacitacion\.activa\) : null\),\n\s*\[capacitacion\.activa, capacitacion\.libreta\],\n\s*\);/);
    expect(prov).toContain("<Ctx.Provider value={value}>");
  });

  it("en práctica la cola de sin conexión NO arranca: lo que tenga es trabajo real de antes", () => {
    const efecto = prov.slice(prov.indexOf("const capacitacion = useCapacitacion();"), prov.indexOf("const real: DataState = {"));
    expect(efecto).toContain("if (capacitacion.activa) return;");
    expect(efecto.indexOf("if (capacitacion.activa) return;")).toBeLessThan(efecto.indexOf("initOfflineQueue("));
  });
});
