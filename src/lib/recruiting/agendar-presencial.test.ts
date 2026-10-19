import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import type { Stage } from "./types";
import {
  ETAPA_PRESENCIAL, RESULTADO_AGENDADA, RESULTADO_CONFIRMACION,
  contactoDeLaCita, contactoDeLaConfirmacion, etapaTrasAgendar, lugaresParaAgendar,
  prepararConfirmacionPresencial, textoConfirmacionPresencial, validarFechaPresencial,
} from "./agendar-presencial";

const cand = { name: "María López", role: "Driver", phone: "(555) 010-2030" };
const stage = (key: string, type: Stage["type"] = "active"): Stage => ({ id: key, key, label: key, color: "#000", type, sort: 0, max_days: null });
const pipeline = [stage("registered"), stage("phone"), stage(ETAPA_PRESENCIAL), stage("hired", "won"), stage("discarded", "lost")];
const ahora = new Date("2026-10-18T12:00:00");
const cita = { iso: new Date("2026-10-20T10:30:00").toISOString(), lugar: "McAllen" };

describe("agendar entrevista presencial al terminar la entrevista (D-585)", () => {
  it("la fecha tiene que existir, ser válida y estar en el futuro", () => {
    expect(validarFechaPresencial("", ahora)).toEqual({ ok: false, motivo: "sin-fecha" });
    expect(validarFechaPresencial("ayer", ahora)).toEqual({ ok: false, motivo: "invalida" });
    expect(validarFechaPresencial("2026-10-18T11:59", ahora)).toEqual({ ok: false, motivo: "en-el-pasado" });
    expect(validarFechaPresencial("2026-10-18T12:00", ahora)).toEqual({ ok: false, motivo: "en-el-pasado" });
    const r = validarFechaPresencial("2026-10-20T10:30", ahora);
    expect(r).toEqual({ ok: true, iso: new Date("2026-10-20T10:30").toISOString() });
  });

  it("la etapa resultante es «inperson» para un candidato activo; sin esa etapa en el pipeline se queda donde está", () => {
    expect(etapaTrasAgendar(pipeline, "phone")).toBe(ETAPA_PRESENCIAL);
    expect(etapaTrasAgendar(pipeline, "registered")).toBe(ETAPA_PRESENCIAL);
    expect(etapaTrasAgendar(pipeline, ETAPA_PRESENCIAL)).toBe(ETAPA_PRESENCIAL);
    expect(etapaTrasAgendar(pipeline.filter((s) => s.key !== ETAPA_PRESENCIAL), "phone")).toBe("phone");
  });

  it("un contratado o un descartado no vuelve atrás por agendar", () => {
    expect(etapaTrasAgendar(pipeline, "hired")).toBe("hired");
    expect(etapaTrasAgendar(pipeline, "discarded")).toBe("discarded");
  });

  it("el contacto de la cita es el renglón «In person / Scheduled» con fecha, lugar y nota; sin lugar ni nota, solo la fecha", () => {
    const k = contactoDeLaCita(cita.iso, " McAllen ", "traer identificación");
    expect(k.type).toBe("In person");
    expect(k.result).toBe(RESULTADO_AGENDADA);
    expect((k.note ?? "").split(" · ")).toEqual([expect.stringMatching(/Oct/), "McAllen", "traer identificación"]);
    expect(contactoDeLaCita(cita.iso, "", "  ").note).not.toContain("·");
  });

  it("los lugares son las sedes sin «TBD», más el que ya tenga el candidato si no está en la lista", () => {
    const base = lugaresParaAgendar();
    expect(base).toContain("McAllen");
    expect(base).not.toContain("TBD");
    expect(lugaresParaAgendar("McAllen")).toEqual(base);
    expect(lugaresParaAgendar("Bodega Hidalgo")).toEqual([...base, "Bodega Hidalgo"]);
  });

  it("el texto de confirmación lleva nombre de pila, puesto, fecha, hora y lugar, en el idioma de quien pulsa, sin marcadores", () => {
    const en = textoConfirmacionPresencial(cand, cita, "Andrés", "en");
    expect(en).toContain("Hi María,");
    expect(en).toContain("Andrés");
    expect(en).toContain("Driver");
    expect(en).toContain("October 20");
    expect(en).toContain("10:30 AM");
    expect(en).toContain("at McAllen");
    expect(en).not.toContain("{");
    const es = textoConfirmacionPresencial(cand, cita, "Andrés", "es");
    expect(es).toContain("Hola María,");
    expect(es).toContain("20 de octubre");
    expect(es).toContain("10:30");
    expect(es).toContain("en McAllen");
    expect(es).not.toContain("{");
  });

  it("sin lugar, el texto dice «nuestra oficina» / «our office» en vez de dejar un hueco", () => {
    expect(textoConfirmacionPresencial(cand, { ...cita, lugar: " " }, "A", "en")).toContain("at our office");
    expect(textoConfirmacionPresencial(cand, { ...cita, lugar: "" }, "A", "es")).toContain("en nuestra oficina");
  });

  it("la confirmación va por el mismo camino que D-581: enlace rcsms con número limpio y el texto; sin teléfono, no abre nada", () => {
    const r = prepararConfirmacionPresencial(cand, cita, "Andrés", "en");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.enlace).toContain("/r/sms?type=new&number=5550102030");
    expect(r.enlace).toContain("&text=" + encodeURIComponent(r.texto));
    expect(prepararConfirmacionPresencial({ ...cand, phone: null }, cita, "A", "en")).toEqual({ ok: false, motivo: "sin-telefono" });
  });

  it("el contacto de la confirmación es un SMS marcado, distinto del «¿te puedo llamar?» y del SMS suelto", () => {
    const k = contactoDeLaConfirmacion("x".repeat(100));
    expect(k.type).toBe("SMS");
    expect(k.result).toBe(RESULTADO_CONFIRMACION);
    expect(k.result).not.toBe("sent");
    expect(k.result).not.toBe("sent · can I call?");
    expect(k.note).toHaveLength(80);
  });

  it("puerta: el diálogo de agendar y la entrevista pasan por la librería, y la entrevista ofrece el botón", () => {
    const agendar = readFileSync(new URL("../../components/recruiting/InPersonScheduleModal.tsx", import.meta.url), "utf8");
    expect(agendar).toContain('from "@/lib/recruiting/agendar-presencial"');
    expect(agendar).toContain("validarFechaPresencial(");
    expect(agendar).toContain("etapaTrasAgendar(");
    expect(agendar).toContain("prepararConfirmacionPresencial(");
    const modal = readFileSync(new URL("../../components/recruiting/ModalHost.tsx", import.meta.url), "utf8");
    // El diálogo nuevo es el que se monta para «inperson», y la entrevista tiene la salida que guarda y abre el agendar.
    expect(modal).toContain("<InPersonScheduleModal id={inPersonId}");
    expect(modal).toMatch(/onClick=\{saveAndSchedule\}/);
    const vista = readFileSync(new URL("../../components/recruiting/InterviewView.tsx", import.meta.url), "utf8");
    expect(vista).toContain("schedule(c.id)");
    expect(modal).toContain("schedule={setInPersonId}");
  });
});
