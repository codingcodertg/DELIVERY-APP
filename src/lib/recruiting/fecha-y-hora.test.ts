import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { diaEntreLasFichas, fechaLocal, fichasDeDia, fichasDeHora, horaEntreLasFichas, juntaFechaYHora, parteDeFechaYHora } from "./fecha-y-hora";

// D-NEXT (2026-10-20) · El dueño: «esa forma de meter el calendario para entrevista presencial … se mira medio feo … que sea más
// user friendly». Fichas de día y de hora; el valor guardado no cambia.

const hoy = new Date("2026-10-20T15:00:00");

describe("selector de fecha y hora amable", () => {
  it("días: Hoy, Mañana y cinco más con su nombre, en el idioma de quien mira; la fecha es local (sin UTC)", () => {
    const es = fichasDeDia("es", hoy);
    expect(es).toHaveLength(7);
    expect(es[0]).toMatchObject({ fecha: "2026-10-20", etiqueta: "Hoy" });
    expect(es[1]).toMatchObject({ fecha: "2026-10-21", etiqueta: "Mañana" });
    expect(es[2].fecha).toBe("2026-10-22");
    expect(es[2].etiqueta.toLowerCase()).toContain("jue");
    expect(es[6].fecha).toBe("2026-10-26");
    const en = fichasDeDia("en", hoy);
    expect(en[0].etiqueta).toBe("Today");
    expect(en[1].etiqueta).toBe("Tomorrow");
    expect(en[2].etiqueta).toBe("Thu");
    // Fin de mes: no se rompe la cuenta.
    expect(fichasDeDia("es", new Date("2026-10-30T09:00:00"))[2].fecha).toBe("2026-11-01");
    expect(fechaLocal(new Date("2026-01-05T23:30:00"))).toBe("2026-01-05");
  });

  it("horas: de 8:00 a 6:00 p.m. cada media hora, con su etiqueta de 12 horas", () => {
    const es = fichasDeHora("es");
    expect(es).toHaveLength(21);
    expect(es[0]).toEqual({ hora: "08:00", etiqueta: "8:00 a.m." });
    expect(es[1]).toEqual({ hora: "08:30", etiqueta: "8:30 a.m." });
    expect(es[8]).toEqual({ hora: "12:00", etiqueta: "12:00 p.m." });
    expect(es[20]).toEqual({ hora: "18:00", etiqueta: "6:00 p.m." });
    expect(fichasDeHora("en")[9].etiqueta).toBe("12:30 PM");
    expect(horaEntreLasFichas("08:30", es)).toBe(true);
    expect(horaEntreLasFichas("07:45", es)).toBe(false);
    expect(diaEntreLasFichas("2026-10-26", fichasDeDia("es", hoy))).toBe(true);
    expect(diaEntreLasFichas("2026-11-26", fichasDeDia("es", hoy))).toBe(false);
  });

  it("el valor de siempre: se parte y se junta sin perder nada; a medias, vacío", () => {
    expect(parteDeFechaYHora("2026-10-21T10:30")).toEqual({ fecha: "2026-10-21", hora: "10:30" });
    expect(parteDeFechaYHora("2026-10-21T10:30:00.000Z")).toEqual({ fecha: "2026-10-21", hora: "10:30" });
    expect(parteDeFechaYHora("")).toEqual({ fecha: "", hora: "" });
    expect(parteDeFechaYHora(null)).toEqual({ fecha: "", hora: "" });
    expect(juntaFechaYHora("2026-10-21", "10:30")).toBe("2026-10-21T10:30");
    expect(juntaFechaYHora("2026-10-21", "")).toBe("");
    expect(juntaFechaYHora("", "10:30")).toBe("");
    expect(juntaFechaYHora("21/10/2026", "10:30")).toBe("");
  });

  it("puerta: los tres diálogos con fecha y hora usan el selector (presencial, llamada, y el registro); ningún datetime-local pelado queda", () => {
    const raiz = new URL("../../components/recruiting/", import.meta.url);
    for (const f of ["InPersonScheduleModal.tsx", "ModalHost.tsx"]) {
      const s = readFileSync(new URL(f, raiz), "utf8");
      expect(s, f).toContain("<SelectorDeFechaYHora");
      expect(s, f).not.toContain('type="datetime-local"');
    }
    const sel = readFileSync(new URL("SelectorDeFechaYHora.tsx", raiz), "utf8");
    expect(sel).toContain("fichasDeDia(lang");
    expect(sel).toContain("fichasDeHora(lang");
    expect(sel).toContain("juntaFechaYHora(");
  });
});
