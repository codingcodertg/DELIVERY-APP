import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import type { Stage } from "./types";
import {
  ETAPA_PRESENCIAL, RESULTADO_AGENDADA, RESULTADO_CONFIRMACION,
  MARCADORES_DE_LA_CITA, enlacesDeMapa,
  contactoDeLaCita, contactoDeLaConfirmacion, etapaTrasAgendar, fechaYHora, lugaresParaAgendar, plantillaDeAjustes,
  prepararConfirmacionPresencial, textoConfirmacionPresencial, tiendaDelLugar, validarFechaPresencial,
} from "./agendar-presencial";

const cand = { name: "María López", role: "Driver", phone: "(555) 010-2030" };
const stage = (key: string, type: Stage["type"] = "active"): Stage => ({ id: key, key, label: key, color: "#000", type, sort: 0, max_days: null });
const pipeline = [stage("registered"), stage("phone"), stage(ETAPA_PRESENCIAL), stage("hired", "won"), stage("discarded", "lost")];
// Todas las horas, de Brownsville (D-632): octubre es horario de verano, UTC−5. Escritas con su desfase para que la
// prueba diga lo mismo en cualquier aparato (antes eran horas «locales» y medían la zona de quien corría la prueba).
const ahora = new Date("2026-10-18T12:00:00-05:00");
const cita = { iso: "2026-10-20T15:30:00.000Z", lugar: "McAllen" }; // 10:30 a.m. en Brownsville
// «Ahora» para medir «mañana» / «hoy» / «el martes»: la cita es el 20 a las 10:30.
const hoyEs19 = new Date("2026-10-19T15:00:00-05:00");
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
    expect(r).toEqual({ ok: true, iso: "2026-10-20T15:30:00.000Z" }); // 10:30 de Brownsville, no del aparato
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

  it("el texto de la cita es la plantilla del dueño: de usted, sin nombre, «para mañana a las 10:30 a.m.», el bloque con la dirección de la tienda y la despedida firmada", () => {
    const es = textoConfirmacionPresencial(cand, cita, "Andrés", "es", tiendas, null, hoyEs19);
    expect(es).toBe(
      "Hola, le habla Andrés, reclutador de Rodriguez Tile Group. Gracias por su tiempo. Le confirmo su entrevista presencial para mañana a las 10:30 a.m. en nuestra oficina:\n\n"
      + "Rodriguez Tile Group\n100 Main St, McAllen, TX\n\n"
      + "Por favor llegue unos minutos antes y traiga una identificación. Cualquier duda o si necesita cambiar la hora, respóndame a este número.\n\n"
      + "Nos vemos mañana,\nAndrés\nRodriguez Tile Group",
    );
    const en = textoConfirmacionPresencial(cand, cita, "Andrés", "en", tiendas, null, hoyEs19);
    expect(en).toContain("Hello, this is Andrés, recruiter at Rodriguez Tile Group.");
    expect(en).toContain("for tomorrow at 10:30 AM at our office:\n\nRodriguez Tile Group\n100 Main St, McAllen, TX\n\n");
    expect(en).toContain("See you tomorrow,\nAndrés\nRodriguez Tile Group");
    expect(en).not.toContain("{");
    expect(es).not.toContain("{");
    expect(es).not.toContain("María");
  });

  it("«{when}» y «{day}»: hoy, mañana, o el día de la semana con la fecha", () => {
    const f = (pared: string, lang: "en" | "es") => fechaYHora(new Date(pared + "-05:00").toISOString(), lang, hoyEs19);
    expect(f("2026-10-19T16:00:00", "es")).toMatchObject({ when: "hoy a las 4:00 p.m.", day: "hoy" });
    expect(f("2026-10-20T10:30:00", "es")).toMatchObject({ when: "mañana a las 10:30 a.m.", day: "mañana" });
    expect(f("2026-10-22T09:00:00", "es")).toMatchObject({ when: "el jueves, 22 de octubre a las 9:00 a.m.", day: "el jueves" });
    expect(f("2026-10-22T09:00:00", "en")).toMatchObject({ when: "Thursday, October 22 at 9:00 AM", day: "on Thursday" });
    expect(f("2026-10-19T16:00:00", "en")).toMatchObject({ when: "today at 4:00 PM", day: "today" });
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
    const es = textoConfirmacionPresencial(cand, { ...cita, lugar: "4201 W University Dr" }, "A", "es", tiendas, null, hoyEs19);
    expect(es).toContain("para mañana a las 10:30 a.m. en 4201 W University Dr.");
    expect(es).not.toContain("nuestra oficina");
    const en = textoConfirmacionPresencial(cand, { ...cita, lugar: "4201 W University Dr" }, "A", "en", tiendas, null, hoyEs19);
    expect(en).toContain("for tomorrow at 10:30 AM at 4201 W University Dr.");
    expect(en).not.toContain("our office:");
    expect(textoConfirmacionPresencial(cand, { ...cita, lugar: " " }, "A", "en")).toContain("at our office");
    expect(textoConfirmacionPresencial(cand, { ...cita, lugar: "" }, "A", "es")).toContain("en nuestra oficina");
  });

  it("una plantilla de Ajustes cuyo nombre lleve «presencial» o «in person» manda sobre la de código, con todos los marcadores", () => {
    const templates = [
      { label: "Invite to call", text: "Hi {name}" },
      { label: "Cita presencial", text: "{name}/{role}/{recruiter}/{date}/{time}/{place}/{address}/{when}/{day}" },
    ];
    expect(plantillaDeAjustes(templates)).toBe(templates[1].text);
    expect(plantillaDeAjustes([templates[0]])).toBeNull();
    expect(plantillaDeAjustes([{ label: "In-Person interview", text: "  " }])).toBeNull();
    const es = textoConfirmacionPresencial(cand, cita, "Andrés", "es", tiendas, plantillaDeAjustes(templates), hoyEs19);
    expect(es).toMatch(/^María\/Driver\/Andrés\/.*20 de octubre.*\/10:30 a\.m\.\/McAllen\/100 Main St, McAllen, TX\/mañana a las 10:30 a\.m\.\/mañana$/);
    // Sin tienda, {address} vale el lugar (mejor eso que un hueco en un texto que escribió el reclutador).
    expect(textoConfirmacionPresencial(cand, { ...cita, lugar: "Pharr" }, "A", "es", tiendas, "{place}|{address}")).toBe("Pharr|Pharr");
    expect(MARCADORES_DE_LA_CITA.split(" ")).toEqual(["{when}", "{day}", "{date}", "{time}", "{place}", "{address}", "{maps}"]);
  });

  it("la confirmación va por el mismo camino que D-581: enlace rcsms con número limpio y el texto; sin teléfono, no abre nada", () => {
    const r = prepararConfirmacionPresencial(cand, "  Hola María, le espero.  ");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.texto).toBe("Hola María, le espero.");
    expect(r.enlace).toContain("/r/sms?type=new&number=5550102030");
    expect(r.enlace).toContain("&content=" + encodeURIComponent(r.texto));
    expect(r.enlace).not.toContain("&text=");
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
    // D-599: RingCentral se abre en el clic, ANTES de esperar a la base (si no, el navegador no abre la app externa).
    const abre = agendar.indexOf("abrirSmsEnRingCentral(r.enlace, r.texto, navegadorReal());"); const guarda = agendar.indexOf("await agendar(iso);");
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
