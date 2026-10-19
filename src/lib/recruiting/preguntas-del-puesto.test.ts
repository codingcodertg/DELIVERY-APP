import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  conjuntoDeEntrevista,
  preguntasDeEntrevista,
  puedeAsignarPreguntasAlPuesto,
  preguntasActivasPorConjunto,
} from "./preguntas-del-puesto";

const SETS = [
  { id: "def", is_default: true, role: null },
  { id: "acc", is_default: false, role: "Accounting Associate" },
  { id: "sinpuesto", is_default: false, role: null },
];
const Q = [
  { id: "g1", role: "all", active: true, set_id: "def", category: "Trust Level" },
  { id: "g2", role: "all", active: true, set_id: "def", category: "Tenure" },
  { id: "a1", role: "Accounting Associate", active: true, set_id: "acc", category: "Skills" },
  { id: "a2", role: "all", active: true, set_id: "acc", category: "Education / Certifications" },
  { id: "a3", role: "Accounting Associate", active: false, set_id: "acc", category: null },
  { id: "d1", role: "Driver", active: true, set_id: "sinpuesto", category: null },
  { id: "o1", role: "Otro puesto", active: true, set_id: "acc", category: null },
];

describe("conjuntoDeEntrevista (D-582): de qué conjunto se entrevista", () => {
  it("la vacante que sujeta un conjunto manda sobre el puesto y el predeterminado", () => {
    const r = conjuntoDeEntrevista({
      vacante: { id: "j", role: "Driver", question_set_id: "acc" },
      rolDelCandidato: "Driver",
      conjuntos: SETS,
      preguntas: Q,
    });
    expect(r).toEqual({ setId: "acc", origen: "vacante" });
  });
  it("sin conjunto en la vacante, gana el conjunto cuyo puesto es el del candidato", () => {
    const r = conjuntoDeEntrevista({
      vacante: { id: "j", role: null, question_set_id: null },
      rolDelCandidato: "Accounting Associate",
      conjuntos: SETS,
      preguntas: Q,
    });
    expect(r).toEqual({ setId: "acc", origen: "puesto" });
  });
  it("si ningún conjunto lleva el puesto, vale el que tenga preguntas activas con ese rol (implícito)", () => {
    const r = conjuntoDeEntrevista({ vacante: null, rolDelCandidato: "Driver", conjuntos: SETS, preguntas: Q });
    expect(r).toEqual({ setId: "sinpuesto", origen: "implicito" });
  });
  it("una pregunta inactiva no crea el enlace implícito", () => {
    const sets = SETS.filter((s) => s.id !== "acc").concat({ id: "acc", is_default: false, role: null });
    const preguntas = Q.filter((q) => q.id !== "a1");
    const r = conjuntoDeEntrevista({ vacante: null, rolDelCandidato: "Accounting Associate", conjuntos: sets, preguntas });
    expect(r).toEqual({ setId: "def", origen: "predeterminado" });
  });
  it("sin nada propio, el predeterminado; sin predeterminado, ninguno", () => {
    expect(conjuntoDeEntrevista({ vacante: null, rolDelCandidato: "Nadie", conjuntos: SETS, preguntas: Q }))
      .toEqual({ setId: "def", origen: "predeterminado" });
    expect(conjuntoDeEntrevista({ vacante: null, rolDelCandidato: null, conjuntos: [], preguntas: [] }))
      .toEqual({ setId: null, origen: "ninguno" });
  });
});

describe("preguntasDeEntrevista (D-582): la lista que ve quien entrevista", () => {
  const ids = (xs: { id: string }[]) => xs.map((x) => x.id);

  it("candidato a la vacante Accounting Associate con su conjunto: sus preguntas, las inactivas fuera, preselección delante", () => {
    const r = preguntasDeEntrevista({
      vacante: { id: "j", role: "Accounting Associate", question_set_id: "acc" },
      rolDelCandidato: "Accounting Associate",
      conjuntos: SETS,
      preguntas: Q,
    });
    expect(ids(r)).toEqual(["a2", "a1"]);
  });
  it("en un conjunto sujetado por la vacante entra también la pregunta etiquetada con el puesto de la VACANTE, aunque el candidato lleve otro", () => {
    const r = preguntasDeEntrevista({
      vacante: { id: "j", role: "Accounting Associate", question_set_id: "acc" },
      rolDelCandidato: "Accountant",
      conjuntos: SETS,
      preguntas: Q,
    });
    expect(ids(r)).toEqual(["a2", "a1"]);
    expect(ids(r)).not.toContain("o1");
  });
  it("medido en producción 2026-10-18: candidato «Accounting Associate», conjunto atado a ese puesto, 27 preguntas con role «Accounting» → las 27", () => {
    const conjuntos = [{ id: "def", is_default: true, role: null }, { id: "acc27", is_default: false, role: "Accounting Associate" }];
    const preguntas = Array.from({ length: 27 }, (_, i) => ({ id: "q" + i, role: "Accounting", active: true, set_id: "acc27", category: null }))
      .concat({ id: "apagada", role: "Accounting", active: false, set_id: "acc27", category: null })
      .concat({ id: "g1", role: "all", active: true, set_id: "def", category: null });
    const r = preguntasDeEntrevista({ vacante: null, rolDelCandidato: "Accounting Associate", conjuntos, preguntas });
    expect(r).toHaveLength(27);
    expect(ids(r)).not.toContain("apagada");
    expect(ids(r)).not.toContain("g1");
  });
  it("por el enlace implícito o el predeterminado, la etiqueta de rol sigue filtrando", () => {
    const conjuntos = [{ id: "def", is_default: true, role: null }];
    const preguntas = [
      { id: "g1", role: "all", active: true, set_id: "def", category: null },
      { id: "otra", role: "Sales Representative", active: true, set_id: "def", category: null },
    ];
    const r = preguntasDeEntrevista({ vacante: null, rolDelCandidato: "Accounting Associate", conjuntos, preguntas });
    expect(ids(r)).toEqual(["g1"]);
  });
  it("el puesto de la vacante NO abre la puerta cuando el conjunto no vino de la vacante", () => {
    const r = preguntasDeEntrevista({
      vacante: { id: "j", role: "Accounting Associate", question_set_id: null },
      rolDelCandidato: "Accountant",
      conjuntos: SETS,
      // Una pregunta del predeterminado etiquetada con el puesto de la vacante: si entrara, la puerta estaría abierta de más.
      preguntas: Q.concat({ id: "t1", role: "Accounting Associate", active: true, set_id: "def", category: null }),
    });
    // Sin conjunto propio para «Accountant» cae al predeterminado: solo las generales; t1 queda fuera.
    expect(ids(r)).toEqual(["g2", "g1"]);
  });
  it("sin ningún conjunto (ni preguntas con conjunto), entran todas las activas de rol «all» o del candidato", () => {
    const sueltas = Q.map((q) => ({ ...q, set_id: null }));
    const r = preguntasDeEntrevista({ vacante: null, rolDelCandidato: "Driver", conjuntos: [], preguntas: sueltas });
    expect(ids(r)).toEqual(["g2", "a2", "g1", "d1"]);
  });
  it("la preselección va en SU orden: Tenure, Language Skill, Education; el resto conserva el orden de llegada", () => {
    const preguntas = [
      { id: "x1", role: "all", active: true, set_id: "def", category: "Education / Certifications" },
      { id: "x2", role: "all", active: true, set_id: "def", category: null },
      { id: "x3", role: "all", active: true, set_id: "def", category: "Language Skill" },
      { id: "x4", role: "all", active: true, set_id: "def", category: "Other" },
      { id: "x5", role: "all", active: true, set_id: "def", category: "Tenure" },
    ];
    const r = preguntasDeEntrevista({ vacante: null, rolDelCandidato: null, conjuntos: SETS, preguntas });
    expect(ids(r)).toEqual(["x5", "x3", "x1", "x2", "x4"]);
  });
});

describe("puedeAsignarPreguntasAlPuesto (D-582): quién cambia el conjunto de una vacante", () => {
  it("admin y gerente sí; reclutador, sin rol o rol desconocido, no", () => {
    expect(puedeAsignarPreguntasAlPuesto("admin")).toBe(true);
    expect(puedeAsignarPreguntasAlPuesto("manager")).toBe(true);
    expect(puedeAsignarPreguntasAlPuesto("recruiter")).toBe(false);
    expect(puedeAsignarPreguntasAlPuesto(null)).toBe(false);
    expect(puedeAsignarPreguntasAlPuesto(undefined)).toBe(false);
    expect(puedeAsignarPreguntasAlPuesto("owner")).toBe(false);
  });
});

describe("preguntasActivasPorConjunto (D-582)", () => {
  it("cuenta solo activas y con conjunto; un conjunto sin preguntas no aparece", () => {
    const m = preguntasActivasPorConjunto(Q);
    expect(m.get("def")).toBe(2);
    expect(m.get("acc")).toBe(3);
    expect(m.get("sinpuesto")).toBe(1);
    expect(m.has("vacio")).toBe(false);
    expect(preguntasActivasPorConjunto([{ id: "s", role: "all", active: true, set_id: null }]).size).toBe(0);
  });
});

describe("las pantallas usan la librería (D-582)", () => {
  const ajustes = readFileSync("src/app/recruiting/(recruiting)/settings/page.tsx", "utf8");
  const modal = readFileSync("src/components/recruiting/ModalHost.tsx", "utf8");

  it("Ajustes → Vacantes ofrece un selector de conjunto por vacante existente, que guarda question_set_id", () => {
    expect(ajustes).toMatch(/data-job-set=\{j\.id\}/);
    expect(ajustes).toMatch(/updateJob\(j\.id,\s*\{\s*question_set_id:\s*e\.target\.value\s*\|\|\s*null\s*\}\)/);
  });
  it("el selector por vacante pasa por la puerta de rol", () => {
    expect(ajustes).toMatch(/const puedeAsignar = puedeAsignarPreguntasAlPuesto\(me\?\.role\)/);
    // El <select> con data-job-set lleva disabled={!puedeAsignar} antes del cierre de la etiqueta.
    const sel = /<select[^>]*data-job-set=\{j\.id\}[^>]*disabled=\{!puedeAsignar\}/s;
    expect(ajustes).toMatch(sel);
  });
  it("la entrevista toma su lista de preguntasDeEntrevista, no de un filtro propio", () => {
    expect(modal).toMatch(/import \{[^}]*preguntasDeEntrevista[^}]*\} from "@\/lib\/recruiting\/preguntas-del-puesto"/);
    expect(modal).toMatch(/return preguntasDeEntrevista\(\{/);
    expect(modal).not.toMatch(/q\.role === "all" \|\| q\.role === c\?\.role/);
  });
});
