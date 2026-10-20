import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  RESULTADO_SEGUIMIENTO, RESULTADOS_CON_SEGUIMIENTO,
  contactoDelSeguimiento, ofreceSeguimiento, plantillaDeSeguimiento, prepararTextoDeSeguimiento, textoDeSeguimiento,
} from "./texto-de-seguimiento";

const cand = { name: "María López", role: "Driver", phone: "(555) 010-2030" };

describe("texto de seguimiento tras buzón de voz o volver a llamar (D-598)", () => {
  it("lo ofrecen «Voicemail», «Call back later» y «No answer» (D-NEXT); ni «Wrong number» ni la etiqueta traducida", () => {
    expect([...RESULTADOS_CON_SEGUIMIENTO].sort()).toEqual(["Call back later", "No answer", "Voicemail"]);
    expect(ofreceSeguimiento("Voicemail")).toBe(true);
    expect(ofreceSeguimiento("Call back later")).toBe(true);
    expect(ofreceSeguimiento("No answer")).toBe(true);
    expect(ofreceSeguimiento("Wrong number")).toBe(false);
    expect(ofreceSeguimiento("Buzón de voz")).toBe(false);
  });

  it("el texto trata de usted, nombra el puesto, firma quien pulsa y pregunta cuándo está disponible; en los dos idiomas, sin marcadores", () => {
    // Firma con un nombre que NO sea el del dueño: una firma fija en el código tiene que caer.
    const es = textoDeSeguimiento(cand, "Paola", "es");
    expect(es).toBe("Hola, le habla Paola de Rodriguez Tile Group. Le estoy llamando por el puesto de Driver al que aplicó. ¿Cuándo está disponible para una breve entrevista telefónica? Respóndame con un horario y le llamo a esa hora. ¡Gracias!");
    const en = textoDeSeguimiento(cand, "Andrés", "en");
    expect(en).toContain("this is Andrés from Rodriguez Tile Group");
    expect(en).toContain("the Driver position");
    expect(en).toContain("When would you be available");
    expect(en).not.toContain("{");
    expect(es).not.toContain("{");
  });

  it("una plantilla de Ajustes cuyo nombre lleve «seguimiento» o «follow up» manda sobre la de código", () => {
    const templates = [
      { label: "Invite to call", text: "Hi {name}" },
      { label: "Follow-up", text: "{name}/{role}/{recruiter}" },
    ];
    expect(plantillaDeSeguimiento(templates)).toBe("{name}/{role}/{recruiter}");
    expect(plantillaDeSeguimiento([templates[0]])).toBeNull();
    expect(plantillaDeSeguimiento([{ label: "Seguimiento", text: " " }])).toBeNull();
    expect(textoDeSeguimiento(cand, "Andrés", "es", plantillaDeSeguimiento(templates))).toBe("María/Driver/Andrés");
  });

  it("va por el mismo camino que D-581: enlace rcsms con número limpio y el texto editado; sin teléfono o sin texto, no abre nada", () => {
    const r = prepararTextoDeSeguimiento(cand, "  Hola María.  ");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.texto).toBe("Hola María.");
    expect(r.enlace).toContain("/r/sms?type=new&number=5550102030");
    expect(r.enlace).toContain("&content=" + encodeURIComponent("Hola María."));
    expect(r.enlace).not.toContain("&text=");
    expect(prepararTextoDeSeguimiento({ ...cand, phone: null }, "x")).toEqual({ ok: false, motivo: "sin-telefono" });
    expect(prepararTextoDeSeguimiento(cand, "  ")).toEqual({ ok: false, motivo: "sin-texto" });
  });

  it("el contacto es un SMS marcado, distinto del «¿te puedo llamar?», del de la cita y del SMS suelto", () => {
    const k = contactoDelSeguimiento("x".repeat(100));
    expect(k.type).toBe("SMS");
    expect(k.result).toBe(RESULTADO_SEGUIMIENTO);
    expect(["sent", "sent · can I call?", "sent · in-person confirmation"]).not.toContain(k.result);
    expect(k.note).toHaveLength(80);
  });

  it("puerta: el diálogo de entrevista decide con la librería si ofrece el seguimiento, y ya no cierra a ciegas tras registrar", () => {
    const modal = readFileSync(new URL("../../components/recruiting/ModalHost.tsx", import.meta.url), "utf8");
    expect(modal).toContain('from "@/lib/recruiting/texto-de-seguimiento"');
    expect(modal).toContain("ofreceSeguimiento(");
    // El discriminador tal cual: que la decisión sea la de la librería y no un `false &&` delante.
    expect(modal).toMatch(/if \(ofreceSeguimiento\(clave\)\) \{\s+setTextoSeg\(/);
    expect(modal).toContain("prepararTextoDeSeguimiento(");
    expect(modal).toContain("contactoDelSeguimiento(");
    expect(modal).toContain("plantillaDeSeguimiento(templates)");
    // Los botones pasan la clave en inglés (la que decide), no solo la etiqueta traducida.
    expect(modal).toMatch(/logOutcome\("Voicemail"/);
    expect(modal).toMatch(/logOutcome\("Call back later"/);
  });
});
