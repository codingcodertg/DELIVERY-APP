import { describe, expect, it } from "vitest";
import type { Contact } from "./types";
import {
  RESULTADO_PUEDO_LLAMAR, contactoDelEnvio, envioPuedoLlamar, estadoDelBoton, prepararTextoPuedoLlamar, telefonoEnLaFila, textoPuedoLlamar,
} from "./texto-puedo-llamar";

const cand: { id: string; name: string; role: string; phone: string | null } = { id: "c1", name: "María López", role: "Driver", phone: "(555) 010-2030" };
const contacto = (over: Partial<Contact>): Contact => ({
  id: Math.random().toString(36), candidate_id: "c1", type: "SMS", result: "sent", note: "", created_by: null,
  created_at: "2026-10-18T15:00:00.000Z", ...over,
});
const hora = (iso: string, locale: string) => new Date(iso).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });

describe("texto «¿te puedo llamar?» (D-581)", () => {
  it("el texto lleva el nombre de pila, el puesto y quien escribe, en el idioma de quien pulsa", () => {
    const en = textoPuedoLlamar(cand, "Andrés", "en");
    expect(en).toContain("Hi María,");
    expect(en).toContain("Andrés");
    expect(en).toContain("Driver");
    expect(en).toContain("Can I call you?");
    const es = textoPuedoLlamar(cand, "Andrés", "es");
    expect(es).toContain("Hola María,");
    expect(es).toContain("¿Te puedo llamar?");
    expect(es).not.toContain("{");
  });

  it("prepara el enlace de RingCentral con el número limpio y el texto, igual que el diálogo", () => {
    const r = prepararTextoPuedoLlamar(cand, [], "Andrés", "en");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.enlace).toContain("/r/sms?type=new&number=5550102030");
    expect(r.enlace).toContain("&text=" + encodeURIComponent(r.texto));
  });

  it("sin teléfono no abre nada y lo dice", () => {
    expect(prepararTextoPuedoLlamar({ ...cand, phone: null }, [], "A", "en")).toEqual({ ok: false, motivo: "sin-telefono" });
    expect(prepararTextoPuedoLlamar({ ...cand, phone: " - " }, [], "A", "en")).toEqual({ ok: false, motivo: "sin-telefono" });
  });

  it("idempotente por candidato: con un envío marcado no se vuelve a mandar; otro SMS suelto, otro tipo u otro candidato no cuentan", () => {
    const marcado = contacto({ result: RESULTADO_PUEDO_LLAMAR });
    expect(prepararTextoPuedoLlamar(cand, [marcado], "A", "en")).toEqual({ ok: false, motivo: "ya-enviado" });
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

  it("el botón: antes ofrece el texto; después dice «SMS sent ✓» con la hora del ÚLTIMO envío y queda deshabilitado", () => {
    expect(estadoDelBoton([], "c1", "en")).toEqual({ enviado: false, etiqueta: "📱 Text: can I call you?" });
    expect(estadoDelBoton([], "c1", "es").etiqueta).toBe("📱 Texto: ¿te puedo llamar?");
    const viejo = contacto({ result: RESULTADO_PUEDO_LLAMAR, created_at: "2026-10-17T09:05:00.000Z" });
    const nuevo = contacto({ result: RESULTADO_PUEDO_LLAMAR, created_at: "2026-10-18T15:30:00.000Z" });
    expect(hora(nuevo.created_at, "en-US")).not.toBe(hora(viejo.created_at, "en-US"));
    const en = estadoDelBoton([viejo, nuevo], "c1", "en");
    expect(en.enviado).toBe(true);
    expect(en.etiqueta).toBe("SMS sent ✓ " + hora(nuevo.created_at, "en-US"));
    expect(estadoDelBoton([nuevo, viejo], "c1", "es").etiqueta).toBe("SMS enviado ✓ " + hora(nuevo.created_at, "es-MX"));
  });

  it("la fila enseña el teléfono tal cual, enlazado a RingCentral; sin dígitos no enseña nada", () => {
    expect(telefonoEnLaFila(" (555) 010-2030 ")).toEqual({ texto: "(555) 010-2030", href: expect.stringContaining("/r/call?number=5550102030") });
    expect(telefonoEnLaFila("")).toBeNull();
    expect(telefonoEnLaFila(null)).toBeNull();
    expect(telefonoEnLaFila(" - ")).toBeNull();
  });
});
