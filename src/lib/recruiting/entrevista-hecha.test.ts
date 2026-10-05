import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { cuentaDeContestadas, filasDeLaEntrevista, hayEntrevistaHecha, notasDeLaPresencial } from "./entrevista-hecha";
import type { Contact, Interview } from "./types";

const entrevista = (questions: Interview["questions"]): Interview => ({
  answers: {}, generalNotes: "", average: null, date: "2026-10-01T15:00:00.000Z", questions,
});
const contacto = (type: string, created_at: string, note = ""): Contact => ({
  id: type + created_at, candidate_id: "c1", type, result: null, note, created_by: null, created_at,
});

describe("ver la entrevista hecha (D-472)", () => {
  it("enseña todas las preguntas, también las que quedaron sin contestar, en su orden", () => {
    const filas = filasDeLaEntrevista(entrevista([
      { text: "Uno", weight: 2, grade: 3, note: " bien ", category: "Wage" },
      { text: "Dos", weight: 0, grade: null, note: "   " },
      { text: "Tres", weight: 1, grade: null, note: "solo nota" },
    ]));
    expect(filas.map((f) => f.text)).toEqual(["Uno", "Dos", "Tres"]);
    expect(filas[0]).toMatchObject({ grade: 3, note: "bien", category: "Wage", weight: 2, sinContestar: false });
    expect(filas[1]).toMatchObject({ grade: null, note: "", category: null, weight: 1, sinContestar: true });
    expect(filas[2].sinContestar).toBe(false);
    expect(cuentaDeContestadas(filas)).toEqual({ contestadas: 2, total: 3 });
  });

  it("sin entrevista no hay filas", () => {
    expect(filasDeLaEntrevista(null)).toEqual([]);
    expect(filasDeLaEntrevista(undefined)).toEqual([]);
  });

  it("de la presencial salen solo los renglones «In person», del más viejo al más nuevo", () => {
    const notas = notasDeLaPresencial([
      contacto("In person", "2026-10-03T10:00:00Z", "segunda"),
      contacto("Call", "2026-10-02T10:00:00Z"),
      contacto("in person ", "2026-10-01T10:00:00Z", "primera"),
    ]);
    expect(notas.map((n) => n.note)).toEqual(["primera", "segunda"]);
  });

  it("hay algo que ver con entrevista por teléfono o con nota de la presencial; si no, no", () => {
    expect(hayEntrevistaHecha(entrevista([]), [])).toBe(true);
    expect(hayEntrevistaHecha(null, [contacto("In person", "2026-10-01T10:00:00Z")])).toBe(true);
    expect(hayEntrevistaHecha(null, [contacto("Call", "2026-10-01T10:00:00Z")])).toBe(false);
  });

  it("el botón está en cada pantalla donde se lista una entrevista, y la vista no guarda nada", () => {
    const lee = (p: string) => readFileSync(p, "utf8");
    for (const p of [
      "src/components/recruiting/CandidateRow.tsx",
      "src/components/recruiting/ModalHost.tsx",
      "src/app/recruiting/(recruiting)/calendar/page.tsx",
      "src/app/recruiting/(recruiting)/today/page.tsx",
      "src/app/recruiting/(recruiting)/outcomes/page.tsx",
    ]) expect(lee(p), p).toContain("openInterviewView(");
    const vista = lee("src/components/recruiting/InterviewView.tsx");
    expect(vista).not.toContain("updateCandidate");
    expect(vista).not.toContain("addContact");
    expect(vista).not.toContain("<input");
    expect(vista).not.toContain("<textarea");
  });
});
