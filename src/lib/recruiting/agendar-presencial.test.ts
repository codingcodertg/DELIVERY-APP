import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import type { Stage } from "./types";
import {
  ETAPA_PRESENCIAL, RESULTADO_AGENDADA, RESULTADO_CONFIRMACION,
  MARCADORES_DE_LA_CITA,
  contactoDeLaCita, contactoDeLaConfirmacion, etapaTrasAgendar, lugaresParaAgendar, plantillaDeAjustes,
  prepararConfirmacionPresencial, textoConfirmacionPresencial, tiendaDelLugar, validarFechaPresencial,
} from "./agendar-presencial";

const cand = { name: "María López", role: "Driver", phone: "(555) 010-2030" };
const stage = (key: string, type: Stage["type"] = "active"): Stage => ({ id: key, key, label: key, color: "#000", type, sort: 0, max_days: null });
const pipeline = [stage("registered"), stage("phone"), stage(ETAPA_PRESENCIAL), stage("hired", "won"), stage("discarded", "lost")];
const ahora = new Date("2026-10-18T12:00:00");
const cita = { iso: new Date("2026-10-20T10:30:00").toISOString(), lugar: "McAllen" };
// Como en Datos → Tiendas: nombre con prefijo y dirección (datos de prueba, no los del dueño).
const tiendas = [
  { name: "RDZ McAllen", address: "100 Main St, McAllen, TX" },
  { name: "RDZ Edinburg", address: "200 University Dr, Edinburg, TX" },
  { name: "Bodega Azul", address: "300 Expy, Brownsville, TX" },
];

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

  it("el texto de la cita lleva nombre de pila, puesto, fecha, hora, lugar y la DIRECCIÓN de la tienda, en el idioma de quien pulsa, sin marcadores", () => {
    const en = textoConfirmacionPresencial(cand, cita, "Andrés", "en", tiendas);
    expect(en).toContain("Hello María,");
    expect(en).toContain("Andrés");
    expect(en).toContain("Driver");
    expect(en).toContain("October 20");
    expect(en).toContain("10:30 AM");
    expect(en).toContain("our McAllen store, at this address: 100 Main St, McAllen, TX.");
    expect(en).not.toContain("{");
    const es = textoConfirmacionPresencial(cand, cita, "Andrés", "es", tiendas);
    expect(es).toContain("Hola María, le habla Andrés");
    expect(es).toContain("20 de octubre");
    expect(es).toContain("10:30");
    expect(es).toContain("en la tienda de McAllen, en esta dirección: 100 Main St, McAllen, TX.");
    expect(es).not.toContain("{");
  });

  it("la tienda se encuentra por nombre exacto o por palabra («Edinburg» ↔ «RDZ Edinburg»); una calle escrita a mano no es ninguna", () => {
    expect(tiendaDelLugar("Edinburg", tiendas)?.address).toBe("200 University Dr, Edinburg, TX");
    expect(tiendaDelLugar(" bodega azul ", tiendas)?.name).toBe("Bodega Azul");
    expect(tiendaDelLugar("Azul", tiendas)?.name).toBe("Bodega Azul");
    expect(tiendaDelLugar("Pharr", tiendas)).toBeNull();
    // Un trozo de palabra no es una tienda: «Ed» a mano no se vuelve Edinburg.
    expect(tiendaDelLugar("Ed", tiendas)).toBeNull();
    expect(tiendaDelLugar("Azu", tiendas)).toBeNull();
    expect(tiendaDelLugar("4201 W University Dr", tiendas)).toBeNull();
    expect(tiendaDelLugar("", tiendas)).toBeNull();
  });

  it("sin tienda conocida (un «Otro…» a mano) el texto dice el lugar tal cual y NO inventa una dirección; sin lugar, «nuestra oficina»", () => {
    const es = textoConfirmacionPresencial(cand, { ...cita, lugar: "4201 W University Dr" }, "A", "es", tiendas);
    expect(es).toContain("en 4201 W University Dr.");
    expect(es).not.toContain("dirección");
    const en = textoConfirmacionPresencial(cand, { ...cita, lugar: "4201 W University Dr" }, "A", "en", tiendas);
    expect(en).toContain("at 4201 W University Dr.");
    expect(en).not.toContain("address");
    expect(textoConfirmacionPresencial(cand, { ...cita, lugar: " " }, "A", "en")).toContain("at our office");
    expect(textoConfirmacionPresencial(cand, { ...cita, lugar: "" }, "A", "es")).toContain("en nuestra oficina");
  });

  it("una plantilla de Ajustes cuyo nombre lleve «presencial» o «in person» manda sobre la de código, con todos los marcadores", () => {
    const templates = [
      { label: "Invite to call", text: "Hi {name}" },
      { label: "Cita presencial", text: "{name}/{role}/{recruiter}/{date}/{time}/{place}/{address}" },
    ];
    expect(plantillaDeAjustes(templates)).toBe(templates[1].text);
    expect(plantillaDeAjustes([templates[0]])).toBeNull();
    expect(plantillaDeAjustes([{ label: "In-Person interview", text: "  " }])).toBeNull();
    const es = textoConfirmacionPresencial(cand, cita, "Andrés", "es", tiendas, plantillaDeAjustes(templates));
    expect(es).toMatch(/^María\/Driver\/Andrés\/.*20 de octubre.*\/.*10:30.*\/McAllen\/100 Main St, McAllen, TX$/);
    // Sin tienda, {address} vale el lugar (mejor eso que un hueco en un texto que escribió el reclutador).
    expect(textoConfirmacionPresencial(cand, { ...cita, lugar: "Pharr" }, "A", "es", tiendas, "{place}|{address}")).toBe("Pharr|Pharr");
    expect(MARCADORES_DE_LA_CITA.split(" ")).toEqual(["{date}", "{time}", "{place}", "{address}"]);
  });

  it("la confirmación va por el mismo camino que D-581: enlace rcsms con número limpio y el texto; sin teléfono, no abre nada", () => {
    const r = prepararConfirmacionPresencial(cand, "  Hola María, le espero.  ");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.texto).toBe("Hola María, le espero.");
    expect(r.enlace).toContain("/r/sms?type=new&number=5550102030");
    expect(r.enlace).toContain("&text=" + encodeURIComponent(r.texto));
    expect(prepararConfirmacionPresencial({ ...cand, phone: null }, "x")).toEqual({ ok: false, motivo: "sin-telefono" });
    // El texto lo edita quien manda: vacío del todo, no se abre nada.
    expect(prepararConfirmacionPresencial(cand, "   ")).toEqual({ ok: false, motivo: "sin-texto" });
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
    // D-597: el texto se arma con las tiendas de Datos (ruta propia) y la plantilla de Ajustes, y se guarda y manda de un golpe.
    expect(agendar).toContain('fetch("/api/recruiting/stores")');
    expect(agendar).toContain("plantillaDeAjustes(templates)");
    expect(agendar).toContain("guardarYMandar");
    expect(agendar).toContain("<textarea");
    // D-NEXT: RingCentral se abre en el clic, ANTES de esperar a la base (si no, el navegador no abre la app externa).
    const abre = agendar.indexOf("window.location.href = r.enlace;"); const guarda = agendar.indexOf("await agendar(iso);");
    expect(abre).toBeGreaterThan(0);
    expect(guarda).toBeGreaterThan(abre);
    const modal = readFileSync(new URL("../../components/recruiting/ModalHost.tsx", import.meta.url), "utf8");
    // El diálogo nuevo es el que se monta para «inperson», y la entrevista tiene la salida que guarda y abre el agendar.
    expect(modal).toContain("<InPersonScheduleModal id={inPersonId}");
    expect(modal).toMatch(/onClick=\{saveAndSchedule\}/);
    const vista = readFileSync(new URL("../../components/recruiting/InterviewView.tsx", import.meta.url), "utf8");
    expect(vista).toContain("schedule(c.id)");
    expect(modal).toContain("schedule={setInPersonId}");
  });
});
