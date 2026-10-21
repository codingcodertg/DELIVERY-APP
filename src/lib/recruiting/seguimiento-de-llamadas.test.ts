import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import type { Candidate, Contact, Stage } from "./types";
import {
  MARGEN_DE_LA_CITA_MS, RESULTADO_DESCARTADO, RESULTADO_SEGUIR, RESULTADO_YA_LLAMADO,
  contactoDeLaAccion, etiquetasTrasLaAccion, listaDeSeguimiento, notaDeLaCita, seguimientoDelCandidato,
  type AccionDeSeguimiento, type ItemDeSeguimiento,
} from "./seguimiento-de-llamadas";

const stage = (key: string, type: Stage["type"] = "active"): Stage => ({ id: key, key, label: key, color: "#000", type, sort: 0, max_days: null });
const pipeline = [stage("registered"), stage("phone"), stage("inperson"), stage("hired", "won"), stage("discarded", "lost")];
const terminales = new Set(["hired", "discarded"]);
const ahora = new Date("2026-10-21T18:00:00Z");

const cand = (p: Partial<Candidate>): Candidate => ({
  id: p.id ?? "c", name: "X", phone: "9565550000", email: null, role: "Driver", location: "Edinburg", home_location: null, source: null, alt_sources: [],
  reg_date: "2026-10-01", notes: null, status: "phone", phone_date: null, inperson_date: null, resume_passed: false, favorite: false, photo: null,
  custom: {}, prescreen: {}, interview: null, follow_up: null, summary_sent: false, discard_reason: null, discard_source: null, resume_path: null,
  resume_name: null, offer_salary: null, offer_start_date: null, offer_status: "none", offer_notes: null, tags: [], extra_phones: [], extra_emails: [],
  pinned: false, archived: false, stage_changed_at: "2026-10-10T00:00:00Z", job_id: null, assigned_recruiter: null, created_by: null,
  created_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-01T00:00:00Z", ...p,
});
let n = 0;
const k = (created_at: string, type: string, result: string | null, extra: Partial<Contact> = {}): Contact =>
  ({ id: "k" + ++n, candidate_id: "c", type, result, note: null, created_by: null, created_at, ...extra });
const entrevista = (date: string): Candidate["interview"] =>
  ({ answers: {}, generalNotes: "", average: null, date, questions: [] });
const item = (c: Candidate, ks: Contact[]) => seguimientoDelCandidato(c, ks, terminales, ahora);

describe("Llamadas pendientes: buzones de voz (D-629, 2026-10-21)", () => {
  it("un buzón de voz deja al candidato en la lista, en las dos lenguas en que se guarda", () => {
    const es = item(cand({}), [k("2026-10-20T15:00:00Z", "Call", "Buzón de voz")]);
    expect(es).toMatchObject({ tipo: "fallida", motivo: "buzon", ultima: "2026-10-20T15:00:00.000Z", intentos: 1 });
    expect(item(cand({}), [k("2026-10-20T15:00:00Z", "Call", "Voicemail")])).toMatchObject({ tipo: "fallida", motivo: "buzon" });
  });

  it("«Sin respuesta» y «Volver a llamar» también entran, con su motivo", () => {
    expect(item(cand({}), [k("2026-10-20T15:00:00Z", "Call", "Sin respuesta")])).toMatchObject({ motivo: "sin-respuesta" });
    expect(item(cand({}), [k("2026-10-20T15:00:00Z", "Call", "No answer")])).toMatchObject({ motivo: "sin-respuesta" });
    expect(item(cand({}), [k("2026-10-20T15:00:00Z", "Call", "Volver a llamar")])).toMatchObject({ motivo: "volver-a-llamar" });
    expect(item(cand({}), [k("2026-10-20T15:00:00Z", "Call", "Call back later")])).toMatchObject({ motivo: "volver-a-llamar" });
  });

  it("sin llamadas con resultado, o con un SMS de seguimiento, no hay nada pendiente", () => {
    expect(item(cand({}), [])).toBeNull();
    expect(item(cand({}), [k("2026-10-20T15:00:00Z", "Call", ""), k("2026-10-20T15:01:00Z", "SMS", "sent · follow-up")])).toBeNull();
    // Un buzón registrado como SMS no es una llamada
    expect(item(cand({}), [k("2026-10-20T15:00:00Z", "SMS", "Voicemail")])).toBeNull();
  });

  it("un «📞 Llamar» suelto (resultado vacío) después del buzón NO lo saca: es un intento, no un desenlace", () => {
    const ks = [k("2026-10-20T15:00:00Z", "Call", "Buzón de voz"), k("2026-10-21T15:00:00Z", "Call", ""), k("2026-10-21T15:00:01Z", "Call", null)];
    expect(item(cand({}), ks)).toMatchObject({ tipo: "fallida", ultima: "2026-10-20T15:00:00.000Z" });
  });

  it("lo saca un resultado que no es fallido: Contestó, Número equivocado, «Ya le llamé»", () => {
    for (const r of ["Answered", "Número equivocado", RESULTADO_YA_LLAMADO]) {
      expect(item(cand({}), [k("2026-10-20T15:00:00Z", "Call", "Buzón de voz"), k("2026-10-20T16:00:00Z", "Call", r)])).toBeNull();
    }
  });

  it("lo saca «Descartar», y el candidato no se toca; «Seguir llamando» lo deja y apunta desde cuándo", () => {
    const vm = k("2026-10-20T15:00:00Z", "Call", "Buzón de voz");
    expect(item(cand({}), [vm, k("2026-10-20T16:00:00Z", "Follow-up", RESULTADO_DESCARTADO)])).toBeNull();
    expect(item(cand({}), [vm, k("2026-10-20T16:00:00Z", "Follow-up", RESULTADO_SEGUIR)]))
      .toMatchObject({ tipo: "fallida", siguiendoDesde: "2026-10-20T16:00:00.000Z" });
    // Un «Seguir» de ANTES del último cierre no cuenta
    expect(item(cand({}), [
      k("2026-10-18T15:00:00Z", "Follow-up", RESULTADO_SEGUIR), k("2026-10-19T15:00:00Z", "Call", "Answered"), vm,
    ])).toMatchObject({ siguiendoDesde: null });
  });

  it("el orden lo da la fecha, no el orden del arreglo: un buzón DESPUÉS del cierre vuelve a meterlo", () => {
    // El arreglo viene al revés (como lo carga la app: más nuevo primero)
    const ks = [k("2026-10-21T10:00:00Z", "Call", "Buzón de voz"), k("2026-10-20T16:00:00Z", "Follow-up", RESULTADO_DESCARTADO), k("2026-10-20T15:00:00Z", "Call", "Buzón de voz")];
    expect(item(cand({}), ks)).toMatchObject({ tipo: "fallida", ultima: "2026-10-21T10:00:00.000Z", intentos: 1 });
    const alReves = [k("2026-10-20T16:00:00Z", "Follow-up", RESULTADO_DESCARTADO), k("2026-10-20T15:00:00Z", "Call", "Buzón de voz")];
    expect(item(cand({}), alReves)).toBeNull();
  });

  it("cuenta los intentos fallidos desde el último cierre", () => {
    const ks = [
      k("2026-10-10T15:00:00Z", "Call", "Buzón de voz"), k("2026-10-11T15:00:00Z", "Call", "Answered"),
      k("2026-10-19T15:00:00Z", "Call", "Sin respuesta"), k("2026-10-20T15:00:00Z", "Call", "Buzón de voz"),
    ];
    expect(item(cand({}), ks)).toMatchObject({ motivo: "buzon", intentos: 2 });
  });

  it("una entrevista guardada DESPUÉS del buzón lo saca; una de ANTES no", () => {
    const vm = k("2026-10-20T15:00:00Z", "Call", "Buzón de voz");
    expect(item(cand({ interview: entrevista("2026-10-20T17:00:00Z") }), [vm])).toBeNull();
    expect(item(cand({ interview: entrevista("2026-10-01T17:00:00Z") }), [vm])).toMatchObject({ tipo: "fallida" });
  });

  it("un contacto «In person» (ya va a presencial) lo saca", () => {
    expect(item(cand({}), [k("2026-10-20T15:00:00Z", "Call", "Buzón de voz"), k("2026-10-20T16:00:00Z", "In person", "Scheduled")])).toBeNull();
  });

  it("archivado o en etapa final (contratado / descartado): fuera", () => {
    const vm = [k("2026-10-20T15:00:00Z", "Call", "Buzón de voz")];
    expect(item(cand({ archived: true }), vm)).toBeNull();
    expect(item(cand({ status: "discarded" }), vm)).toBeNull();
    expect(item(cand({ status: "hired" }), vm)).toBeNull();
    expect(item(cand({ status: "registered" }), vm)).not.toBeNull();
  });

  it("solo cuenta los contactos de ESTE candidato", () => {
    expect(item(cand({ id: "c" }), [k("2026-10-20T15:00:00Z", "Call", "Buzón de voz", { candidate_id: "otro" })])).toBeNull();
  });
});

describe("Llamadas pendientes: llamadas agendadas", () => {
  const cita = "2026-10-22T20:00:00.000Z";

  it("una cita sin desenlace aparece; futura no está atrasada, pasada sí", () => {
    expect(item(cand({ phone_date: cita }), [])).toMatchObject({ tipo: "agendada", cuando: cita, atrasada: false, intentos: 0 });
    expect(item(cand({ phone_date: "2026-10-21T17:59:00Z" }), [])).toMatchObject({ tipo: "agendada", atrasada: true });
  });

  it("con la entrevista ya guardada, la cita no está pendiente (aunque la entrevista sea de antes de la cita, como en Tablero)", () => {
    expect(item(cand({ phone_date: cita, interview: entrevista("2026-10-23T10:00:00Z") }), [])).toBeNull();
    expect(item(cand({ phone_date: cita, interview: entrevista("2026-10-15T10:00:00Z") }), [])).toBeNull();
  });

  it("un buzón de ANTES de la cita (con más de una hora) no la resuelve: sigue agendada y cuenta el intento", () => {
    const ks = [k("2026-10-22T10:00:00Z", "Call", "Buzón de voz")];
    expect(item(cand({ phone_date: cita }), ks)).toMatchObject({ tipo: "agendada", intentos: 1 });
  });

  it("un buzón dentro de la hora previa o después de la cita la resuelve, y pasa a «buzón»", () => {
    const justo = new Date(Date.parse(cita) - MARGEN_DE_LA_CITA_MS).toISOString();
    expect(item(cand({ phone_date: cita }), [k(justo, "Call", "Buzón de voz")])).toMatchObject({ tipo: "fallida", motivo: "buzon" });
    const unoAntes = new Date(Date.parse(cita) - MARGEN_DE_LA_CITA_MS - 1000).toISOString();
    expect(item(cand({ phone_date: cita }), [k(unoAntes, "Call", "Buzón de voz")])).toMatchObject({ tipo: "agendada" });
    expect(item(cand({ phone_date: cita }), [k("2026-10-22T20:05:00Z", "Call", "Volver a llamar")])).toMatchObject({ tipo: "fallida", motivo: "volver-a-llamar" });
  });

  it("un resultado que cierra después de la cita la quita del todo", () => {
    expect(item(cand({ phone_date: cita }), [k("2026-10-22T20:05:00Z", "Call", "Answered")])).toBeNull();
  });

  it("«Descartar» o «Ya le llamé» pulsados ANTES de la hora valen para ESA cita (van atados en la nota), no para otra", () => {
    const antes = "2026-10-21T12:00:00Z";
    for (const r of [RESULTADO_DESCARTADO, RESULTADO_YA_LLAMADO]) {
      const tipo = r === RESULTADO_DESCARTADO ? "Follow-up" : "Call";
      expect(item(cand({ phone_date: cita }), [k(antes, tipo, r, { note: notaDeLaCita(cita) })])).toBeNull();
      // Sin la nota (p. ej. el descarte de un buzón viejo) no resuelve una cita posterior
      expect(item(cand({ phone_date: cita }), [k(antes, tipo, r)])).toMatchObject({ tipo: "agendada" });
      // Atado a otra cita, tampoco: reagendar la vuelve a meter
      expect(item(cand({ phone_date: cita }), [k(antes, tipo, r, { note: notaDeLaCita("2026-10-21T20:00:00.000Z") })])).toMatchObject({ tipo: "agendada" });
    }
  });
});

describe("Llamadas pendientes: la lista entera", () => {
  it("separa agendadas y buzones; agendadas por la hora de la cita (antigua arriba), buzones por el último intento (reciente arriba)", () => {
    const cs = [
      cand({ id: "a2", phone_date: "2026-10-25T15:00:00Z" }),
      cand({ id: "f1", phone_date: null }),
      cand({ id: "a1", phone_date: "2026-10-01T15:00:00Z" }),
      cand({ id: "f2", phone_date: null }),
      cand({ id: "fin", status: "hired" }),
    ];
    const ks = [
      k("2026-10-01T15:00:00Z", "Call", "Buzón de voz", { candidate_id: "f1" }),
      k("2026-10-20T15:00:00Z", "Call", "Voicemail", { candidate_id: "f2" }),
      k("2026-10-20T15:00:00Z", "Call", "Voicemail", { candidate_id: "fin" }),
    ];
    const l = listaDeSeguimiento(cs, ks, pipeline, ahora);
    expect(l.agendadas.map((i) => i.c.id)).toEqual(["a1", "a2"]);
    expect(l.fallidas.map((i) => i.c.id)).toEqual(["f2", "f1"]);
  });

  it("las etapas finales salen de los `stages` (type ≠ active), no de nombres fijos", () => {
    const cs = [cand({ id: "x", status: "rechazado" })];
    const ks = [k("2026-10-20T15:00:00Z", "Call", "Voicemail", { candidate_id: "x" })];
    expect(listaDeSeguimiento(cs, ks, [...pipeline, stage("rechazado", "lost")], ahora).fallidas).toHaveLength(0);
    expect(listaDeSeguimiento(cs, ks, [...pipeline, stage("rechazado")], ahora).fallidas).toHaveLength(1);
  });
});

describe("Llamadas pendientes: lo que escribe cada botón, y que hace lo que dice", () => {
  // Se pulsa el botón: el contacto que devuelve la librería se añade al historial y se vuelve a calcular.
  const pulsar = (c: Candidate, ks: Contact[], accion: AccionDeSeguimiento, cuando: string) => {
    const antes = item(c, ks) as ItemDeSeguimiento;
    expect(antes).not.toBeNull();
    const nuevo = contactoDeLaAccion(accion, antes, "es");
    return item(c, [{ id: "nuevo", candidate_id: c.id, created_by: null, created_at: cuando, ...nuevo }, ...ks]);
  };
  const vm = [k("2026-10-20T15:00:00Z", "Call", "Buzón de voz")];

  it("en un buzón: «Ya le llamé» y «Descartar» lo sacan; «Buzón» y «Seguir» lo dejan", () => {
    expect(pulsar(cand({}), vm, "ya-llamado", "2026-10-21T15:00:00Z")).toBeNull();
    expect(pulsar(cand({}), vm, "descartar", "2026-10-21T15:00:00Z")).toBeNull();
    expect(pulsar(cand({}), vm, "buzon", "2026-10-21T15:00:00Z")).toMatchObject({ tipo: "fallida", intentos: 2, ultima: "2026-10-21T15:00:00.000Z" });
    expect(pulsar(cand({}), vm, "seguir", "2026-10-21T15:00:00Z")).toMatchObject({ tipo: "fallida", siguiendoDesde: "2026-10-21T15:00:00.000Z" });
  });

  it("en una cita futura, pulsados ANTES de la hora: «Ya le llamé» y «Descartar» la sacan; «Buzón» la deja agendada", () => {
    const c = cand({ phone_date: "2026-10-22T20:00:00.000Z" });
    expect(pulsar(c, [], "ya-llamado", "2026-10-21T15:00:00Z")).toBeNull();
    expect(pulsar(c, [], "descartar", "2026-10-21T15:00:00Z")).toBeNull();
    expect(pulsar(c, [], "buzon", "2026-10-21T15:00:00Z")).toMatchObject({ tipo: "agendada", intentos: 1 });
  });

  it("en una cita atrasada, el buzón la convierte en «buzón» (sigue en la lista)", () => {
    const c = cand({ phone_date: "2026-10-21T15:00:00.000Z" });
    expect(pulsar(c, [], "buzon", "2026-10-21T17:00:00Z")).toMatchObject({ tipo: "fallida", motivo: "buzon" });
  });

  it("el buzón se guarda traducido, como en la entrevista (D-598); los marcadores, fijos", () => {
    const f = { tipo: "fallida" as const, c: { phone_date: null } };
    expect(contactoDeLaAccion("buzon", f, "es")).toEqual({ type: "Call", result: "Buzón de voz", note: "" });
    expect(contactoDeLaAccion("buzon", f, "en")).toEqual({ type: "Call", result: "Voicemail", note: "" });
    expect(contactoDeLaAccion("descartar", f, "en")).toEqual({ type: "Follow-up", result: RESULTADO_DESCARTADO, note: "" });
    expect(contactoDeLaAccion("ya-llamado", f, "en")).toEqual({ type: "Call", result: RESULTADO_YA_LLAMADO, note: "" });
  });

  it("la etiqueta «call again»: el buzón la pone, «Ya le llamé» y «Descartar» la quitan, «Seguir» no la toca", () => {
    expect(etiquetasTrasLaAccion("buzon", ["vip"], "call again")).toEqual(["vip", "call again"]);
    expect(etiquetasTrasLaAccion("buzon", ["call again"], "call again")).toBeNull();
    expect(etiquetasTrasLaAccion("ya-llamado", ["vip", "call again"], "call again")).toEqual(["vip"]);
    expect(etiquetasTrasLaAccion("descartar", ["call again", "vip"], "call again")).toEqual(["vip"]);
    expect(etiquetasTrasLaAccion("descartar", ["vip"], "call again")).toBeNull();
    expect(etiquetasTrasLaAccion("seguir", ["call again"], "call again")).toBeNull();
  });
});

describe("Llamadas pendientes: la pestaña pasa por la librería", () => {
  it("la pestaña existe y la página calcula con la librería y escribe lo que ella dice", () => {
    const raiz = new URL("../../../", import.meta.url);
    const leer = (p: string) => readFileSync(new URL(p, raiz), "utf8");
    expect(leer("src/lib/recruiting/constants.ts")).toContain('href: "/recruiting/calls"');
    const pagina = leer("src/app/recruiting/(recruiting)/calls/page.tsx");
    expect(pagina).toContain("listaDeSeguimiento(candidates, contacts, stages, now)");
    expect(pagina).toContain("addContact(it.c.id, contactoDeLaAccion(accion, it, lang))");
    expect(pagina).toContain("etiquetasTrasLaAccion(accion, it.c.tags ?? [], CALL_AGAIN_TAG)");
  });
});
