import { describe, expect, it } from "vitest";
import type { Contact } from "./types";
import {
  RESULTADO_PUEDO_LLAMAR, contactoDelEnvio, envioPuedoLlamar, estadoDelBoton, prepararTextoPuedoLlamar, telefonoEnLaFila, textoPuedoLlamar, PLANTILLA } from "./texto-puedo-llamar";

const cand: { id: string; name: string; role: string; phone: string | null } = { id: "c1", name: "María López", role: "Driver", phone: "(555) 010-2030" };
const contacto = (over: Partial<Contact>): Contact => ({
  id: Math.random().toString(36), candidate_id: "c1", type: "SMS", result: "sent", note: "", created_by: null,
  created_at: "2026-10-18T15:00:00.000Z", ...over,
});

describe("texto «¿te puedo llamar?» (D-581)", () => {
  // D-595 (2026-10-19): el dueño pegó su texto; de usted, sin nombre ni puesto, firmado por quien pulsa.
  it("el texto es el del dueño, letra por letra, firmado por quien pulsa, en el idioma de quien pulsa", () => {
    const es = textoPuedoLlamar(cand, "Andrés", "es");
    expect(es).toBe("Hola, le habla Andrés, reclutador de Rodriguez Tile Group. Vi su aplicación y me gustaría conversar con usted. ¿Tiene 15 minutos ahora mismo para una breve entrevista telefónica? Si es así, respóndame y le llamo enseguida.");
    const en = textoPuedoLlamar(cand, "Andrés", "en");
    expect(en).toBe("Hello, this is Andrés, recruiter at Rodriguez Tile Group. I saw your application and would like to talk with you. Do you have 15 minutes right now for a brief phone interview? If so, reply and I'll call you right away.");
    expect(es).not.toContain("{");
    expect(en).not.toContain("{");
    // No nombra al candidato ni al puesto: así lo escribió.
    expect(es).not.toContain("María");
    expect(es).not.toContain("Driver");
    expect(PLANTILLA.es).toContain("{recruiter}");
  });

  it("prepara el enlace de RingCentral con el número limpio y el texto, igual que el diálogo", () => {
    const r = prepararTextoPuedoLlamar(cand, [], "Andrés", "en");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.enlace).toContain("/r/sms?type=new&number=5550102030");
    expect(r.enlace).toContain("&content=" + encodeURIComponent(r.texto));
    expect(r.enlace).not.toContain("&text=");
  });

  it("sin teléfono no abre nada y lo dice", () => {
    expect(prepararTextoPuedoLlamar({ ...cand, phone: null }, [], "A", "en")).toEqual({ ok: false, motivo: "sin-telefono" });
    expect(prepararTextoPuedoLlamar({ ...cand, phone: " - " }, [], "A", "en")).toEqual({ ok: false, motivo: "sin-telefono" });
  });

  it("se puede volver a mandar aunque ya haya un envío marcado (D-612); el historial sigue contando solo los marcados de ese candidato", () => {
    const marcado = contacto({ result: RESULTADO_PUEDO_LLAMAR });
    expect(prepararTextoPuedoLlamar(cand, [marcado], "A", "en").ok).toBe(true);
    expect(envioPuedoLlamar([marcado], "c1")).not.toBeNull();
    expect(envioPuedoLlamar([contacto({ result: "sent" })], "c1")).toBeNull();
    expect(prepararTextoPuedoLlamar(cand, [contacto({ result: "sent" })], "A", "en").ok).toBe(true);
    expect(prepararTextoPuedoLlamar(cand, [contacto({ result: RESULTADO_PUEDO_LLAMAR, candidate_id: "c2" })], "A", "en").ok).toBe(true);
    expect(prepararTextoPuedoLlamar(cand, [contacto({ result: RESULTADO_PUEDO_LLAMAR, type: "Note" })], "A", "en").ok).toBe(true);
  });

  it("el envío que se registra es un contacto SMS con la marca y el texto, y es lo que luego lo reconoce", () => {
    const k = contactoDelEnvio("x".repeat(100));
    expect(k).toMatchObject({ type: "SMS", result: RESULTADO_PUEDO_LLAMAR });
    expect(k.note).toHaveLength(80);
    expect(envioPuedoLlamar([contacto(k)], "c1")).toEqual({ cuando: "2026-10-18T15:00:00.000Z" });
    expect(envioPuedoLlamar([contacto(k)], "c2")).toBeNull();
  });

  it("el botón: antes ofrece el texto; después dice «SMS sent ✓» con la hora del ÚLTIMO envío (y sigue activo)", () => {
    expect(estadoDelBoton([], "c1", "en")).toEqual({ enviado: false, etiqueta: "📱 Text: can I call you?" });
    expect(estadoDelBoton([], "c1", "es").etiqueta).toBe("📱 Texto: ¿te puedo llamar?");
    const viejo = contacto({ result: RESULTADO_PUEDO_LLAMAR, created_at: "2026-10-17T09:05:00.000Z" });
    const nuevo = contacto({ result: RESULTADO_PUEDO_LLAMAR, created_at: "2026-10-18T15:30:00.000Z" });
    const en = estadoDelBoton([viejo, nuevo], "c1", "en");
    expect(en.enviado).toBe(true);
    // 15:30Z = 10:30 a.m. en Brownsville (D-632), en cualquier aparato; el viejo sería 04:05 AM.
    expect(en.etiqueta).toBe("SMS sent ✓ 10:30 AM");
    expect(estadoDelBoton([nuevo, viejo], "c1", "es").etiqueta).toBe("SMS enviado ✓ 10:30 a.m.");
  });

  it("la fila enseña el teléfono tal cual, enlazado a RingCentral; sin dígitos no enseña nada", () => {
    expect(telefonoEnLaFila(" (555) 010-2030 ")).toEqual({ texto: "(555) 010-2030", href: expect.stringContaining("/r/call?number=5550102030") });
    expect(telefonoEnLaFila("")).toBeNull();
    expect(telefonoEnLaFila(null)).toBeNull();
    expect(telefonoEnLaFila(" - ")).toBeNull();
  });
});

// D-NEXT (2026-11-07) · El dueño: «cuando estoy registrando un nuevo candidato … le vas a poner ahí también Guardar y enviar
// mensaje de "¿te puedo llamar?"». Plantillas editables en Ajustes, idioma del candidato, y el cuarto botón del alta.
import { idiomaDelTexto, notaDelAlta, plantillaVigente, puedeGuardarYEnviar } from "./texto-puedo-llamar";
import { readFileSync } from "node:fs";

describe("«Guardar y enviar ¿te puedo llamar?» y las plantillas de Ajustes (D-NEXT)", () => {
  it("la plantilla de Ajustes manda si tiene texto; vacía, null o ausente, vale la de fábrica", () => {
    expect(plantillaVigente("es", null)).toBe(PLANTILLA.es);
    expect(plantillaVigente("en", undefined)).toBe(PLANTILLA.en);
    expect(plantillaVigente("es", { es: "   " })).toBe(PLANTILLA.es);
    expect(plantillaVigente("es", { en: "Hi" })).toBe(PLANTILLA.es);
    expect(plantillaVigente("en", { en: "Hi {first_name}" })).toBe("Hi {first_name}");
  });

  it("rellena los marcadores nuevos ({first_name}, {position}) y los viejos ({name}, {role}, {recruiter}, {phone})", () => {
    const ajustes = { en: "Hi {first_name}, this is {recruiter} from RDZ Tile Group. Thank you for applying for {position}. Can I call you? ({phone})" };
    expect(textoPuedoLlamar(cand, "Andrés", "en", ajustes)).toBe("Hi María, this is Andrés from RDZ Tile Group. Thank you for applying for Driver. Can I call you? ((555) 010-2030)");
    expect(textoPuedoLlamar(cand, "Andrés", "es", { es: "Hola {name}, {role} · {reclutador}" })).toBe("Hola María, Driver · Andrés");
    // Sin ajustes, exactamente lo de siempre (D-595).
    expect(textoPuedoLlamar(cand, "Andrés", "es")).toBe(textoPuedoLlamar(cand, "Andrés", "es", null));
    // El enlace lleva el texto de la plantilla de Ajustes.
    const r = prepararTextoPuedoLlamar(cand, [], "Andrés", "en", ajustes);
    expect(r.ok && r.enlace).toContain(encodeURIComponent("Hi María, this is Andrés"));
  });

  it("el idioma: el del candidato si lo dijo en el prescreen, si no el de quien pulsa", () => {
    expect(idiomaDelTexto("Español", "en")).toBe("es");
    expect(idiomaDelTexto("spanish only", "en")).toBe("es");
    expect(idiomaDelTexto("English", "es")).toBe("en");
    expect(idiomaDelTexto("Inglés básico", "es")).toBe("en");
    expect(idiomaDelTexto("bilingüe inglés y español", "es")).toBe("es");
    expect(idiomaDelTexto("bilingual english/spanish", "en")).toBe("en");
    expect(idiomaDelTexto("", "es")).toBe("es");
    expect(idiomaDelTexto(null, "en")).toBe("en");
    expect(idiomaDelTexto("K'iche'", "en")).toBe("en");
  });

  it("el cuarto botón solo se enciende con nombre y teléfono con dígitos, sin duplicado, sin aviso pendiente y sin guardado en curso", () => {
    const ok = { name: "María", phone: "(555) 010-2030", saving: false, bloqueado: false, avisoPendiente: false };
    expect(puedeGuardarYEnviar(ok)).toBe(true);
    expect(puedeGuardarYEnviar({ ...ok, name: "  " })).toBe(false);
    expect(puedeGuardarYEnviar({ ...ok, phone: "" })).toBe(false);
    expect(puedeGuardarYEnviar({ ...ok, phone: " - +" })).toBe(false);
    expect(puedeGuardarYEnviar({ ...ok, saving: true })).toBe(false);
    expect(puedeGuardarYEnviar({ ...ok, bloqueado: true })).toBe(false);
    expect(puedeGuardarYEnviar({ ...ok, avisoPendiente: true })).toBe(false);
  });

  it("la línea del historial del alta: mismo contacto «SMS / sent · can I call?» que el botón de la ficha, con la marca de que fue al dar de alta", () => {
    const k = contactoDelEnvio("Hola, le habla Andrés…", notaDelAlta("es"));
    expect(k).toMatchObject({ type: "SMS", result: RESULTADO_PUEDO_LLAMAR });
    expect(k.note).toBe("Mensaje preparado al dar de alta: ¿te puedo llamar? · Hola, le habla Andrés…");
    expect(notaDelAlta("en")).toBe("Message prepared on registration: can I call you?");
    // Y la ficha lo reconoce como envío (la etiqueta «SMS enviado ✓ hh:mm»).
    expect(envioPuedoLlamar([contacto(k)], "c1")).not.toBeNull();
  });

  it("puerta: el alta tiene el cuarto botón, copia el texto DENTRO del clic (antes de guardar), abre RingCentral tras guardar, registra el contacto y abre la ficha; Ajustes edita las plantillas", () => {
    const modal = readFileSync(new URL("../../components/recruiting/ModalHost.tsx", import.meta.url), "utf8");
    expect(modal).toContain('save("text")');
    expect(modal).toContain("Guardar y enviar «¿Te puedo llamar?»");
    expect(modal).toContain("puedeGuardarYEnviar({ name, phone, saving");
    const copia = modal.indexOf("copiarAlPortapapeles(texto, navegadorReal())");
    const alta = modal.indexOf("const created = await addCandidate(");
    expect(copia).toBeGreaterThan(0);
    expect(copia).toBeLessThan(alta);
    expect(modal).toContain("contactoDelEnvio(sms.texto, notaDelAlta(lang))");
    expect(modal).toContain("navegadorReal().abrir(rcSms(created.phone, sms.texto))");
    expect(modal).toContain('if (created && despues === "text") ui.openProfile(created.id);');
    const ajustes = readFileSync(new URL("../../app/recruiting/(recruiting)/settings/page.tsx", import.meta.url), "utf8");
    expect(ajustes).toContain("sms_puedo_llamar");
    expect(ajustes).toContain("plantillaVigente(");
    // El botón de la ficha usa las mismas plantillas y el idioma del candidato.
    const boton = readFileSync(new URL("../../components/recruiting/BotonTextoPuedoLlamar.tsx", import.meta.url), "utf8");
    expect(boton).toContain("idiomaDelTexto(c.prescreen?.language, lang), settings.sms_puedo_llamar");
    // La migración existe y es solo una columna nueva, sin tocar nada más.
    const sql = readFileSync(new URL("../../../supabase/migrations/271_sms_puedo_llamar_editable.sql", import.meta.url), "utf8");
    expect(sql).toContain("add column if not exists sms_puedo_llamar jsonb");
    expect(sql).not.toMatch(/D-NEXT/);
  });
});
