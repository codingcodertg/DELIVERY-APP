import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { semillaRrhh, ADMIN_DEMO } from "./demo-data";
import { nombreEstandar, telefonoEstandar } from "./formato";

// La semilla del demo de RR. HH. (D-NEXT). `now` fijo: lo que se mide no depende del reloj de la máquina ni de la
// medianoche UTC del CI (regla «prueba con la fecha real»).
const AHORA = new Date("2026-11-08T12:00:00");
const s = semillaRrhh(AHORA);
const claves = new Set(s.stages.map((x) => x.key));
const idsCandidatos = new Set(s.candidates.map((c) => c.id));
const noFutura = (iso: string) => expect(new Date(iso).getTime(), iso).toBeLessThanOrEqual(AHORA.getTime());

describe("la semilla del demo de RR. HH.", () => {
  it("tiene lo que el pedido dice: 9 candidatos, 2 vacantes, 6 preguntas en 1 grupo, 2 plantillas, 1 campo, 3 reclutadores", () => {
    expect(s.candidates).toHaveLength(9);
    expect(s.jobs).toHaveLength(2);
    expect(s.questionSets).toHaveLength(1);
    expect(s.questions).toHaveLength(6);
    expect(s.templates).toHaveLength(2);
    expect(s.customFields).toHaveLength(1);
    expect(s.recruiters).toHaveLength(3);
    expect(s.recruiters.find((r) => r.id === "u-admin")).toEqual(ADMIN_DEMO);
    expect(ADMIN_DEMO).toMatchObject({ id: "u-admin", full_name: "You (Admin)", role: "admin" });
  });

  it("todo candidato está en una etapa existente y su vacante existe o es null", () => {
    for (const c of s.candidates) {
      expect(claves.has(c.status), `${c.name}: ${c.status}`).toBe(true);
      if (c.job_id !== null) expect(s.jobs.map((j) => j.id), `${c.name}: ${c.job_id}`).toContain(c.job_id);
    }
    // Y hay candidatos en más de una etapa: un tablero con una sola columna llena no enseña nada.
    expect(new Set(s.candidates.map((c) => c.status)).size).toBeGreaterThanOrEqual(5);
  });

  it("los teléfonos van en la forma estándar del hub, (956) 555-01NN, y son inventados", () => {
    for (const c of s.candidates) {
      expect(c.phone).toMatch(/^\(956\) 555-01\d\d$/);
      expect(telefonoEstandar(c.phone)).toBe(c.phone);
    }
    expect(new Set(s.candidates.map((c) => c.phone)).size).toBe(s.candidates.length);
  });

  it("los correos están en minúsculas y los nombres con mayúscula inicial", () => {
    for (const c of s.candidates) {
      if (c.email !== null) {
        expect(c.email).toBe(c.email.toLowerCase());
        expect(c.email).toMatch(/@example\.com$/);
      }
      expect(nombreEstandar(c.name)).toBe(c.name);
    }
  });

  it("nada de lo ya ocurrido es posterior a `now`", () => {
    for (const c of s.candidates) {
      noFutura(c.created_at); noFutura(c.updated_at); noFutura(c.stage_changed_at);
      expect(c.reg_date <= "2026-11-08", `${c.name}: ${c.reg_date}`).toBe(true);
      if (c.interview) noFutura(c.interview.date);
    }
    for (const k of s.contacts) noFutura(k.created_at);
    for (const h of s.stageHistory) noFutura(h.entered_at);
    for (const j of s.jobs) noFutura(j.created_at);
    // Lo agendado sí puede ser futuro: así Hoy y Calendario tienen algo que enseñar.
    expect(s.candidates.some((c) => c.inperson_date && new Date(c.inperson_date).getTime() > AHORA.getTime())).toBe(true);
  });

  it("contactos e historial apuntan a candidatos y etapas que existen; hay 3 candidatos con historial", () => {
    for (const k of s.contacts) expect(idsCandidatos.has(k.candidate_id), k.id).toBe(true);
    for (const h of s.stageHistory) {
      expect(idsCandidatos.has(h.candidate_id), h.id).toBe(true);
      expect(claves.has(h.stage_key), h.id).toBe(true);
    }
    expect(new Set(s.stageHistory.map((h) => h.candidate_id)).size).toBe(3);
    expect(new Set(s.contacts.map((h) => h.candidate_id)).size).toBe(3);
  });

  it("las preguntas cuelgan del grupo, la vacante del grupo que existe, y hay una entrevista con sus 6 respuestas", () => {
    const grupos = new Set(s.questionSets.map((q) => q.id));
    for (const q of s.questions) expect(grupos.has(q.set_id ?? ""), q.id).toBe(true);
    for (const j of s.jobs) if (j.question_set_id) expect(grupos.has(j.question_set_id), j.id).toBe(true);
    const conEntrevista = s.candidates.filter((c) => c.interview);
    expect(conEntrevista).toHaveLength(1);
    expect(Object.keys(conEntrevista[0].interview!.answers).sort()).toEqual(s.questions.map((q) => q.id).sort());
    expect(conEntrevista[0].interview!.average).toBeGreaterThan(1);
  });

  it("es determinista: el mismo `now` da la misma semilla, y el fichero no mira el reloj", () => {
    expect(JSON.stringify(semillaRrhh(AHORA))).toBe(JSON.stringify(s));
    const fuente = readFileSync("src/lib/recruiting/demo-data.ts", "utf8");
    expect(fuente).not.toMatch(/new Date\(\)/);
    expect(fuente).not.toMatch(/Date\.now\(/);
  });
});
