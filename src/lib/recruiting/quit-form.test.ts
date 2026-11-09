import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  MOTIVOS_RENUNCIA, esMotivoRenuncia, etiquetaMotivoRenuncia, normalizaMotivoRenuncia, revisaQuitForm,
} from "./quit-form";

// D-935 (2026-11-09) · Roberto: el formato que firma quien renuncia con el motivo (otro trabajo, asuntos personales, …).
describe("formulario de renuncia (quit form)", () => {
  it("los motivos incluyen los que nombró Roberto, bilingües", () => {
    const keys = MOTIVOS_RENUNCIA.map((m) => m.key);
    expect(keys).toContain("another_job");
    expect(keys).toContain("personal");
    expect(keys).toContain("other");
    expect(etiquetaMotivoRenuncia("another_job", "es")).toBe("Otro trabajo");
    expect(etiquetaMotivoRenuncia("personal", "en")).toBe("Personal matters");
    expect(etiquetaMotivoRenuncia("inventado", "es")).toBe("");
  });

  it("normaliza: vacío → null, de la lista → la clave, fuera de la lista → undefined", () => {
    expect(normalizaMotivoRenuncia("")).toBeNull();
    expect(normalizaMotivoRenuncia("  ")).toBeNull();
    expect(normalizaMotivoRenuncia("another_job")).toBe("another_job");
    expect(normalizaMotivoRenuncia("quit")).toBeUndefined();
    expect(esMotivoRenuncia("health")).toBe(true);
    expect(esMotivoRenuncia(42)).toBe(false);
  });

  it("revisa el formulario: pide motivo de la lista y nombre de quien firma", () => {
    expect(revisaQuitForm({ motivo: "", firmaNombre: "Ana" })).toEqual({ ok: false, motivo: "sin_motivo" });
    expect(revisaQuitForm({ motivo: "quit", firmaNombre: "Ana" })).toEqual({ ok: false, motivo: "motivo_desconocido" });
    expect(revisaQuitForm({ motivo: "personal", firmaNombre: " " })).toEqual({ ok: false, motivo: "sin_firma" });
    // «other» exige nota
    expect(revisaQuitForm({ motivo: "other", firmaNombre: "Ana", nota: "" })).toEqual({ ok: false, motivo: "sin_motivo" });
  });

  it("un formulario válido se sanea (nombre recortado, opcionales a null)", () => {
    const r = revisaQuitForm({ motivo: "another_job", firmaNombre: "  José Pérez ", nota: "  ", firmaFecha: "2026-11-09" });
    expect(r).toEqual({ ok: true, motivo: "another_job", nota: null, firmaNombre: "José Pérez", firmaFecha: "2026-11-09", fotoPath: null });
    const con = revisaQuitForm({ motivo: "other", firmaNombre: "Ana", nota: "me mudo", fotoPath: "x/quit_form/a.jpg" });
    expect(con.ok && con.fotoPath).toBe("x/quit_form/a.jpg");
  });

  it("la 276 crea la tabla, con los motivos y las políticas, y el expediente la pinta", () => {
    const sql = readFileSync(new URL("../../../supabase/migrations/276_formulario_de_renuncia.sql", import.meta.url), "utf8");
    expect(sql).toContain("create table if not exists recruiting.quit_forms (");
    for (const m of MOTIVOS_RENUNCIA) expect(sql).toContain(`'${m.key}'`);
    expect(sql).toContain("for select using ((select public.current_recruiting_role()) in ('admin', 'manager'))");
    expect(sql).not.toMatch(/^\s*(begin|commit);/m);
    const pagina = readFileSync(new URL("../../app/recruiting/(recruiting)/employees/page.tsx", import.meta.url), "utf8");
    expect(pagina).toContain("<QuitFormDelEmpleado");
    // La baja puede registrar el motivo del quit form (deactivateEmployee).
    const hr = readFileSync(new URL("../../app/recruiting/actions/hr.ts", import.meta.url), "utf8");
    expect(hr).toContain("quitForm");
    expect(hr).toContain('from("quit_forms")');
  });
});
