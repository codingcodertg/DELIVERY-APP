import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { COLUMNAS, eleccionesDe, type RespuestaEncuesta } from "./resumen";

// D-NEXT (2026-10-20) · El dueño, con la captura del paso 2 del sitio: «This step needs an optional box below each for if they
// want to explain further». La columna `rating_notes` (186) y su lectura en el panel.

const base: RespuestaEncuesta = {
  id: "r1", created_at: "2026-10-20T15:00:00Z", nothing_to_improve: false, selected_areas: ["pricing", "staff_service"], other_text: null,
  ratings: { pricing: 2, staff_service: 4 }, wants_contact: false, contact_name: null, contact_phone: null, contact_email: null,
  contacted: false, contacted_at: null, note: null,
} as RespuestaEncuesta;

describe("comentarios por área en el panel de Encuestas", () => {
  it("el panel pide la columna y la enseña entre comillas detrás de la calificación; sin comentario, como antes", () => {
    expect(COLUMNAS).toContain("rating_notes");
    const con = eleccionesDe({ ...base, rating_notes: { pricing: "  muy caro  " } }, "es");
    expect(con).toContain("Precio 2 («muy caro»)");
    expect(con).toContain("Atención del personal 4");
    expect(con).not.toContain("Atención del personal 4 («");
    expect(eleccionesDe({ ...base, rating_notes: null }, "es")).toBe(eleccionesDe(base, "es"));
    expect(eleccionesDe({ ...base, rating_notes: { pricing: "" } }, "en")).not.toContain("(«");
  });
  it("la 186: columna con su CHECK, la función admite y valida `rating_notes`, y el checksum está puesto", () => {
    const sql = readFileSync(new URL("../../../supabase/migrations/186_encuesta_comentarios_por_area.sql", import.meta.url), "utf8");
    expect(sql).toContain("add column if not exists rating_notes jsonb not null default '{}'::jsonb");
    expect(sql).toContain("create or replace function public.survey_rating_notes_valid(notes jsonb, areas text[])");
    expect(sql).toContain("check (public.survey_rating_notes_valid(rating_notes, selected_areas))");
    expect(sql).toContain("'contact_name', 'contact_phone', 'contact_email', 'note', 'rating_notes') then");
    expect(sql).toContain("raise exception 'survey: comment for \"%\", which was not selected', v_key");
    expect(sql).toContain("elsif length(v_txt) > 300 then");
    expect(sql).toContain("(v_nothing, v_areas, v_other, v_ratings, v_wants, v_name, v_phone, v_email, v_note, v_notes)");
    expect(sql).not.toContain("'PENDIENTE'");
  });
});
