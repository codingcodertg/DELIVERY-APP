import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { citaPresencial, mensajeParaElGerente, notaDeLaEntrevista, SEGUNDOS_DEL_ENLACE_DEL_CV } from "./mensaje-para-el-gerente";
import type { Candidate, Contact } from "./types";

// D-NEXT · «en el hr app haya una opcion que sea como copiar mensaje para el manager, que es copiar, nombre, telefono,
// curriculum la nota que deje en la entrevista y la hora a la que lo cite de cita personal» (el dueño, 2026-10-19).

const leer = (p: string) => readFileSync(p, "utf8").split("\r\n").join("\n");
const contacto = (type: string, result: string | null, note: string | null, created_at: string): Contact =>
  ({ id: created_at, candidate_id: "c1", type, result, note, created_by: null, created_at });
const cand = (extra: Partial<Candidate> = {}): Candidate => ({
  name: " Ana Pérez ", phone: "(956) 555-0101", role: "Sales", inperson_date: null, resume_name: null, resume_path: null,
  interview: null, ...extra,
} as unknown as Candidate);
const cita = contacto("In person", "Scheduled", "Oct 21 10:00 AM · McAllen · traer ID", "2026-10-19T15:00:00Z");

describe("la cita presencial que se cuenta", () => {
  it("el último contacto «In person / Scheduled», con su lugar y nota tal como lo dejó D-585", () => {
    const vieja = contacto("In person", "Scheduled", "Oct 15 09:00 AM · Pharr", "2026-10-10T15:00:00Z");
    expect(citaPresencial(cand(), [vieja, cita])).toBe("Oct 21 10:00 AM · McAllen · traer ID");
    expect(citaPresencial(cand(), [cita, vieja])).toBe("Oct 21 10:00 AM · McAllen · traer ID");
  });
  it("otros contactos no son la cita; sin contacto, la fecha de `inperson_date`; sin nada, null", () => {
    const sms = contacto("SMS", "sent · in-person confirmation", "Hi Ana…", "2026-10-19T16:00:00Z");
    const hecha = contacto("In person", "Done", "fue bien", "2026-10-22T16:00:00Z");
    expect(citaPresencial(cand({ inperson_date: "2026-10-21T15:00:00.000Z" }), [sms, hecha, cita])).toBe("Oct 21 10:00 AM · McAllen · traer ID");
    expect(citaPresencial(cand({ inperson_date: "2026-10-21T15:00:00.000Z" }), [sms, hecha])).toMatch(/^Oct 21 /);
    expect(citaPresencial(cand(), [sms])).toBeNull();
    expect(citaPresencial(cand(), [contacto("In person", "Scheduled", "  ", "2026-10-19T15:00:00Z")])).toBeNull();
  });
});

describe("la nota de la entrevista", () => {
  it("las notas generales del reclutador, limpias; sin entrevista o vacías, null", () => {
    expect(notaDeLaEntrevista(cand({ interview: { generalNotes: "  Buena actitud,\n llega  tarde " } as Candidate["interview"] }))).toBe("Buena actitud, llega tarde");
    expect(notaDeLaEntrevista(cand({ interview: { generalNotes: "   " } as Candidate["interview"] }))).toBeNull();
    expect(notaDeLaEntrevista(cand())).toBeNull();
  });
});

describe("el mensaje", () => {
  const completo = cand({ interview: { generalNotes: "Buena actitud" } as Candidate["interview"], resume_path: "c1/cv.pdf", resume_name: "cv.pdf" });
  it("en español: las cinco líneas, con el puesto junto al nombre y el enlace del CV", () => {
    expect(mensajeParaElGerente(completo, { cvEnlace: "https://x/cv.pdf?token=1", contactos: [cita] }, "es")).toBe(
      "Candidato: Ana Pérez (Sales)\nTeléfono: (956) 555-0101\nCV: https://x/cv.pdf?token=1\nNota de la entrevista: Buena actitud\nEntrevista presencial: Oct 21 10:00 AM · McAllen · traer ID",
    );
  });
  it("en inglés", () => {
    expect(mensajeParaElGerente(completo, { cvEnlace: "https://x/cv.pdf?token=1", contactos: [cita] }, "en")).toBe(
      "Candidate: Ana Pérez (Sales)\nPhone: (956) 555-0101\nCV: https://x/cv.pdf?token=1\nInterview note: Buena actitud\nIn-person interview: Oct 21 10:00 AM · McAllen · traer ID",
    );
  });
  it("lo que falta se dice, no se omite: sin CV, sin entrevista, sin cita, sin puesto, sin teléfono", () => {
    const m = mensajeParaElGerente(cand({ role: null, phone: " " }), { cvEnlace: null, contactos: [] }, "es");
    expect(m).toBe("Candidato: Ana Pérez\nTeléfono: —\nCV: sin CV adjunto\nNota de la entrevista: sin entrevista aún\nEntrevista presencial: sin cita aún");
    expect(mensajeParaElGerente(cand(), { cvEnlace: null, contactos: [] }, "en")).toContain("CV: no CV attached\nInterview note: no interview yet\nIn-person interview: not scheduled yet");
  });
  it("el enlace del CV vale 7 días: el gerente lo abre cuando lea el mensaje", () => {
    expect(SEGUNDOS_DEL_ENLACE_DEL_CV).toBe(604800);
  });
});

describe("el botón y dónde está", () => {
  const boton = leer("src/components/recruiting/BotonCopiarParaElGerente.tsx");
  it("pide el enlace solo si hay CV, arma el texto con los contactos del candidato y copia al portapapeles; si no puede, lo enseña para copiarlo a mano", () => {
    expect(boton).toContain("const cvEnlace = c.resume_path ? await resumeLink(c.id, SEGUNDOS_DEL_ENLACE_DEL_CV) : null;");
    expect(boton).toContain("const texto = mensajeParaElGerente(c, { cvEnlace, contactos: contactsFor(c.id) }, lang);");
    expect(boton).toContain("await navigator.clipboard.writeText(texto);");
    expect(boton).toMatch(/catch \{\s*setEstado\("quieto"\);\s*setAMano\(texto\);/);
    expect(boton).toContain("data-copiar-a-mano");
  });
  it("está en la fila del candidato y en su ficha, junto al «📱 Texto: ¿te puedo llamar?» de D-581", () => {
    const fila = leer("src/components/recruiting/CandidateRow.tsx");
    const ficha = leer("src/components/recruiting/ModalHost.tsx");
    expect(fila).toContain("<BotonTextoPuedoLlamar c={c} />\n        <BotonCopiarParaElGerente c={c} />");
    expect(ficha).toContain("<BotonTextoPuedoLlamar c={c} />\n              <BotonCopiarParaElGerente c={c} />");
  });
  it("el proveedor firma el enlace del CV del bucket `resumes` por los segundos que se le piden", () => {
    const prov = leer("src/lib/recruiting-data-provider.tsx");
    expect(prov).toContain('const { data, error } = await supabase.storage.from("resumes").createSignedUrl(c.resume_path, seconds);');
    expect(prov).toContain("resumeLink: (candidateId: string, seconds: number) => Promise<string | null>;");
  });
});
