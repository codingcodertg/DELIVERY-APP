import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/** Permisos es solo permisos: el horario semanal no se edita ahí (D-NEXT, 2026-10-29). */

const leer = (r: string) => readFileSync(join(process.cwd(), r), "utf8").split("\r\n").join("\n");
const sinComentarios = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("el bloque de Time Tracker dentro de Permisos", () => {
  const ficha = sinComentarios(leer("src/components/ClockinSettings.tsx"));
  it("ya no lleva el desplegable del horario ni la semana personalizada; dice cuál tiene y dónde se configura", () => {
    expect(ficha).not.toContain('t("Weekly schedule", "Horario semanal")');
    expect(ficha).not.toContain("CustomWeek");
    expect(ficha).not.toContain("setEmployeeSchedule(");
    expect(ficha).not.toContain("setCustomSchedule(");
    expect(ficha).toContain("data-horario-en-time-tracker");
    expect(ficha).toContain('t("It is set in Time Tracker › Schedule, not here.", "Se configura en Time Tracker › Horario, no aquí.")');
  });
  it("lo que sí es de aquí sigue: tipo de trabajador, puesto, sitio, visitas y la casilla de activo", () => {
    expect(ficha).toContain("{tipoDeTrabajador}");
    expect(ficha).toContain('t("Job position", "Puesto")');
    expect(ficha).toContain('t("Job site", "Sitio de trabajo")');
    expect(ficha).toContain('t("Field visits & errands (with photos)", "Visitas y mandados (con fotos)")');
    expect(ficha).toContain("setEmployeeActive(userId, e.target.checked)");
  });
  it("el horario sigue teniendo su sitio en Time Tracker (la pantalla de horario)", () => {
    expect(leer("src/components/timetracker/ScheduleWeek.tsx")).toContain("default_schedule");
  });
});
