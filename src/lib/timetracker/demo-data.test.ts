import { describe, expect, it } from "vitest";
import { dateISO, weekStartISO } from "@/lib/timetracker/helpers";
import { ADMIN_DEMO, DEMO_EMPLOYEES, DEMO_PROJECTS, semillaDemo } from "@/lib/timetracker/demo-data";

// La semilla del modo demo de Time Tracker. `now` fijo: una prueba con la fecha real pasa en local y cae en el
// CI tras la medianoche UTC. Miércoles a mediodía, lejos de cualquier frontera de día.
const NOW = Date.UTC(2026, 10, 4, 18, 0, 0);
const DIA = 86_400_000;
const semilla = semillaDemo(NOW);
const empleados = new Set(semilla.employees.map((e) => e.id));
const proyectos = new Set(semilla.projects.map((p) => p.id));
const asignaciones = new Set(semilla.assignments.map((a) => a.id));

describe("la semilla del demo de Time Tracker", () => {
  it("tiene 5 empleados: el admin remoto, 3 presenciales inout y 1 remota activity", () => {
    expect(semilla.employees).toHaveLength(5);
    expect(semilla.employees.find((e) => e.id === "u-admin")).toEqual(ADMIN_DEMO);
    expect(ADMIN_DEMO.role).toBe("admin");
    expect(ADMIN_DEMO.tienda).toBe("McAllen");
    const presenciales = semilla.employees.filter((e) => e.workerType === "inhouse");
    expect(presenciales).toHaveLength(3);
    expect(presenciales.every((e) => e.trackMode === "inout")).toBe(true);
    const remotas = semilla.employees.filter((e) => e.role === "employee" && e.workerType === "remote");
    expect(remotas).toHaveLength(1);
    expect(remotas[0].trackMode).toBe("activity");
    expect(DEMO_EMPLOYEES).toBe(semilla.employees);
  });

  it("tiene 3 proyectos sin archivar y toda asignación apunta a empleado y proyecto existentes, con tarifa", () => {
    expect(DEMO_PROJECTS).toHaveLength(3);
    expect(semilla.projects.every((p) => !p.archived)).toBe(true);
    expect(semilla.assignments.length).toBeGreaterThan(0);
    for (const a of semilla.assignments) {
      expect(empleados.has(a.employeeUid), `asignación ${a.id} → empleado ${a.employeeUid}`).toBe(true);
      expect(proyectos.has(a.projectId), `asignación ${a.id} → proyecto ${a.projectId}`).toBe(true);
      expect(a.hourlyRate).toBeGreaterThan(0);
    }
    // Cada empleado tiene al menos una asignación: sin ella el cronómetro no deja arrancar.
    for (const id of empleados) expect(semilla.assignments.some((a) => a.employeeUid === id), `empleado ${id} sin asignación`).toBe(true);
  });

  it("todas las sesiones están CERRADAS, cuadran con su gente y caen en los 14 días anteriores a now", () => {
    expect(semilla.sessions.length).toBeGreaterThan(0);
    const desde = dateISO(NOW - 14 * DIA);
    const hoy = dateISO(NOW);
    for (const s of semilla.sessions) {
      expect(s.isLive, s.id).toBe(false);
      expect(s.startMs).not.toBeNull();
      expect(s.endMs!).toBeGreaterThan(s.startMs!);
      expect(s.durationSeconds).toBeGreaterThan(0);
      expect(s.durationSeconds).toBe(Math.round((s.endMs! - s.startMs!) / 1000));
      expect(empleados.has(s.employeeUid), s.id).toBe(true);
      expect(proyectos.has(s.projectId!), s.id).toBe(true);
      expect(asignaciones.has(s.assignmentId!), s.id).toBe(true);
      expect(s.date! >= desde && s.date! < hoy, `${s.id} fecha ${s.date} fuera de [${desde}, ${hoy})`).toBe(true);
      expect(s.weekOf).toBe(weekStartISO(s.startMs!));
      expect(s.payrollId).toBeNull();
    }
    for (const id of empleados) expect(semilla.sessions.some((s) => s.employeeUid === id), `empleado ${id} sin sesiones`).toBe(true);
    // Horas verosímiles: entre 4 y 9 por sesión.
    for (const s of semilla.sessions) expect(s.durationSeconds / 3600).toBeGreaterThanOrEqual(4);
    for (const s of semilla.sessions) expect(s.durationSeconds / 3600).toBeLessThanOrEqual(9);
  });

  it("hay 2 solicitudes pendientes y 1 aprobada, de gente que existe, dentro de los 14 días", () => {
    expect(semilla.requests.filter((r) => r.status === "pending")).toHaveLength(2);
    expect(semilla.requests.filter((r) => r.status === "approved")).toHaveLength(1);
    expect(semilla.requests).toHaveLength(3);
    const desde = new Date(NOW - 14 * DIA).toISOString();
    for (const r of semilla.requests) {
      expect(empleados.has(r.employeeUid), r.id).toBe(true);
      expect(r.createdAt >= desde && r.createdAt <= new Date(NOW).toISOString(), r.id).toBe(true);
      if (r.status === "pending") { expect(r.resolvedAt).toBeNull(); expect(r.resolvedBy).toBeNull(); }
      else expect(r.resolvedBy).toBe("u-admin");
    }
  });

  it("hay 1 nómina de la semana pasada, pagada, de una persona que existe; varias entradas de auditoría; 0-2 capturas en blanco", () => {
    expect(semilla.payrolls).toHaveLength(1);
    const [py] = semilla.payrolls;
    expect(py.weekOf).toBe(weekStartISO(NOW - 7 * DIA));
    expect(py.paid).toBe(true);
    expect(empleados.has(py.employeeUid)).toBe(true);
    expect(py.total).toBeGreaterThan(0);

    expect(semilla.audit.length).toBeGreaterThanOrEqual(3);
    for (const a of semilla.audit) expect(a.at <= new Date(NOW).toISOString(), a.id).toBe(true);

    expect(semilla.screenshots.length).toBeLessThanOrEqual(2);
    for (const sh of semilla.screenshots) {
      expect(sh.noActivity).toBe(true);
      expect(sh.path).toBeNull();
      expect(empleados.has(sh.employeeUid)).toBe(true);
      expect(semilla.sessions.some((s) => s.id === sh.sessionId), `captura ${sh.id} → sesión ${sh.sessionId}`).toBe(true);
    }
  });

  it("es determinista: el mismo now da la misma semilla, y otro now mueve las fechas", () => {
    expect(semillaDemo(NOW)).toEqual(semilla);
    const otra = semillaDemo(NOW + 7 * DIA);
    expect(otra.sessions[0].date).not.toBe(semilla.sessions[0].date);
  });
});
