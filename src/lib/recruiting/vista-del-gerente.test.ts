import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import type { Candidate, Contact, Stage } from "./types";
import {
  GRUPOS_QUE_SE_PINTAN, RESULTADO_CONTRATAR, RESULTADO_NO_CONTRATAR, ROL_GERENTE_DE_TIENDA,
  agruparParaElGerente, esGerenteDeTienda, grupoDelCandidato, pestanasVisibles, resolucionDelGerente, resolverCandidato,
  textoDeLaResolucion, tiendaCoincide,
} from "./vista-del-gerente";

const stage = (key: string, type: Stage["type"] = "active"): Stage => ({ id: key, key, label: key, color: "#000", type, sort: 0, max_days: null });
const pipeline = [stage("registered"), stage("phone"), stage("inperson"), stage("hired", "won"), stage("discarded", "lost")];
const ahora = new Date("2026-10-19T15:00:00");
const cand = (p: Partial<Candidate>): Candidate => ({
  id: p.id ?? "c", name: "X", phone: "", email: null, role: "Driver", location: "Edinburg", home_location: null, source: null, alt_sources: [],
  reg_date: "2026-10-01", notes: null, status: "inperson", phone_date: null, inperson_date: null, resume_passed: false, favorite: false, photo: null,
  custom: {}, prescreen: {}, interview: null, follow_up: null, summary_sent: false, discard_reason: null, discard_source: null, resume_path: null,
  resume_name: null, offer_salary: null, offer_start_date: null, offer_status: "none", offer_notes: null, tags: [], extra_phones: [], extra_emails: [],
  pinned: false, archived: false, stage_changed_at: "2026-10-10T00:00:00Z", job_id: null, assigned_recruiter: null, created_by: null,
  created_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-01T00:00:00Z", ...p,
});
const contacto = (p: Partial<Contact>): Contact => ({ id: "k", candidate_id: "c", type: "In person", result: null, note: null, created_by: null, created_at: "2026-10-19T00:00:00Z", ...p });

describe("vista del gerente de tienda (D-600, migración 183)", () => {
  it("el rol es «store_manager» y SOLO ve la pestaña Candidatos; los demás roles ven las suyas como antes", () => {
    expect(ROL_GERENTE_DE_TIENDA).toBe("store_manager");
    expect(esGerenteDeTienda("store_manager")).toBe(true);
    expect(esGerenteDeTienda("manager")).toBe(false);
    const tabs = [
      { id: "today", href: "/recruiting/today" }, { id: "employees", roles: ["admin", "manager"] }, { id: "candidates" },
      { id: "settings", adminOnly: true }, { id: "board" },
    ];
    expect(pestanasVisibles(tabs, "store_manager").map((t) => t.id)).toEqual(["candidates"]);
    expect(pestanasVisibles(tabs, "recruiter").map((t) => t.id)).toEqual(["today", "candidates", "board"]);
    expect(pestanasVisibles(tabs, "manager").map((t) => t.id)).toEqual(["today", "employees", "candidates", "board"]);
    expect(pestanasVisibles(tabs, "admin").map((t) => t.id)).toEqual(["today", "employees", "candidates", "settings", "board"]);
  });

  it("espejo de la 183: la sede del candidato es palabra ENTERA de la tienda del perfil; un trozo no vale; sin uno de los dos, no", () => {
    expect(tiendaCoincide("RDZ Edinburg", "Edinburg")).toBe(true);
    expect(tiendaCoincide("RDZ Edinburg", " edinburg ")).toBe(true);
    expect(tiendaCoincide("RDZ Edinburg", "Ed")).toBe(false);
    expect(tiendaCoincide("RDZ Edinburg", "Pharr")).toBe(false);
    expect(tiendaCoincide(null, "Edinburg")).toBe(false);
    expect(tiendaCoincide("RDZ Edinburg", "")).toBe(false);
  });

  it("grupos: resuelto si la etapa no es activa; hoy / próximos / pendientes por el DÍA de la cita (la hora no decide); sin fecha, pendiente", () => {
    expect(grupoDelCandidato(cand({ status: "hired" }), pipeline, ahora)).toBe("resueltos");
    expect(grupoDelCandidato(cand({ status: "discarded", inperson_date: "2026-10-19T10:00:00" }), pipeline, ahora)).toBe("resueltos");
    expect(grupoDelCandidato(cand({ inperson_date: new Date("2026-10-19T09:00:00").toISOString() }), pipeline, ahora)).toBe("hoy");
    expect(grupoDelCandidato(cand({ inperson_date: new Date("2026-10-19T18:00:00").toISOString() }), pipeline, ahora)).toBe("hoy");
    expect(grupoDelCandidato(cand({ inperson_date: new Date("2026-10-20T09:00:00").toISOString() }), pipeline, ahora)).toBe("proximos");
    expect(grupoDelCandidato(cand({ inperson_date: new Date("2026-10-18T09:00:00").toISOString() }), pipeline, ahora)).toBe("pendientes");
    expect(grupoDelCandidato(cand({ inperson_date: null }), pipeline, ahora)).toBe("pendientes");
    expect(grupoDelCandidato(cand({ inperson_date: "basura" }), pipeline, ahora)).toBe("pendientes");
  });

  it("agrupar: hoy y próximos del más cercano al más lejano, pendientes del más reciente, resueltos por cuándo se resolvió; los archivados fuera", () => {
    const iso = (s: string) => new Date(s).toISOString();
    const g = agruparParaElGerente([
      cand({ id: "h2", inperson_date: iso("2026-10-19T16:00:00") }),
      cand({ id: "h1", inperson_date: iso("2026-10-19T09:00:00") }),
      cand({ id: "p2", inperson_date: iso("2026-10-22T09:00:00") }),
      cand({ id: "p1", inperson_date: iso("2026-10-20T09:00:00") }),
      cand({ id: "v1", inperson_date: iso("2026-10-15T09:00:00") }),
      cand({ id: "v2", inperson_date: iso("2026-10-17T09:00:00") }),
      cand({ id: "r1", status: "hired", stage_changed_at: "2026-10-18T00:00:00Z" }),
      cand({ id: "r2", status: "discarded", stage_changed_at: "2026-10-19T00:00:00Z" }),
      cand({ id: "arch", archived: true, inperson_date: iso("2026-10-19T12:00:00") }),
    ], pipeline, ahora);
    expect(g.hoy.map((c) => c.id)).toEqual(["h1", "h2"]);
    expect(g.proximos.map((c) => c.id)).toEqual(["p1", "p2"]);
    expect(g.pendientes.map((c) => c.id)).toEqual(["v2", "v1"]);
    expect(g.resueltos.map((c) => c.id)).toEqual(["r2", "r1"]);
  });

  it("resolver: «Contratar» pasa a la etapa ganada y deja contacto marcado; «No contratar» exige razón y la escribe con discard_source = manager", () => {
    const h = resolverCandidato("hire", "  buen perfil ", pipeline);
    expect(h).toEqual({ ok: true, patch: { status: "hired" }, contacto: { type: "In person", result: RESULTADO_CONTRATAR, note: "buen perfil" } });
    const n = resolverCandidato("no_hire", " no pasó la prueba ", pipeline);
    expect(n).toEqual({
      ok: true,
      patch: { status: "discarded", discard_reason: "no pasó la prueba", discard_source: "manager" },
      contacto: { type: "In person", result: RESULTADO_NO_CONTRATAR, note: "no pasó la prueba" },
    });
    expect(resolverCandidato("no_hire", "   ", pipeline)).toEqual({ ok: false, motivo: "sin-razon" });
    expect(resolverCandidato("hire", "", pipeline).ok).toBe(true);
    expect(resolverCandidato("hire", "", pipeline.filter((s) => s.type !== "won"))).toEqual({ ok: false, motivo: "sin-etapa" });
    expect(resolverCandidato("no_hire", "x", pipeline.filter((s) => s.type !== "lost"))).toEqual({ ok: false, motivo: "sin-etapa" });
  });

  it("la resolución que ve el reclutador: la ÚLTIMA marcada, con razón, fecha y quién; otros contactos «In person» no cuentan", () => {
    const ks = [
      contacto({ id: "1", result: "Scheduled", created_at: "2026-10-19T10:00:00Z" }),
      contacto({ id: "2", result: RESULTADO_NO_CONTRATAR, note: "no vino", created_by: "u1", created_at: "2026-10-19T11:00:00Z" }),
      contacto({ id: "3", result: RESULTADO_CONTRATAR, note: "", created_by: "u2", created_at: "2026-10-19T12:00:00Z" }),
      contacto({ id: "4", candidate_id: "otro", result: RESULTADO_NO_CONTRATAR, created_at: "2026-10-19T13:00:00Z" }),
    ];
    const r = resolucionDelGerente(ks, "c");
    expect(r).toEqual({ decision: "hire", razon: "", cuando: "2026-10-19T12:00:00Z", por: "u2" });
    expect(resolucionDelGerente([ks[0]], "c")).toBeNull();
    expect(textoDeLaResolucion(r!, "es", "Melissa")).toMatch(/^Resolución del gerente: Contratar · \d+ \w+\.? · Melissa$/);
    const n = resolucionDelGerente(ks.slice(0, 2), "c")!;
    expect(textoDeLaResolucion(n, "es", null)).toMatch(/^Resolución del gerente: No contratar · no vino · \d+ \w+\.?$/);
    expect(textoDeLaResolucion(n, "en", null)).toContain("Manager's decision: No hire · no vino");
  });

  it("se pintan SOLO Hoy y Próximos (D-606): ni pendientes de resolver ni resueltos; y la vista recorre esa lista, no las cuatro", () => {
    expect([...GRUPOS_QUE_SE_PINTAN]).toEqual(["hoy", "proximos"]);
    const vista = readFileSync(new URL("../../components/recruiting/VistaDelGerente.tsx", import.meta.url), "utf8");
    expect(vista).toContain("const orden = GRUPOS_QUE_SE_PINTAN.map(");
    expect(vista).not.toMatch(/\{ id: "pendientes", titulo/);
  });

  it("adjuntos (D-NEXT): la tarjeta del gerente lista los documentos del candidato, los abre, adjunta por el mismo camino que la ficha y solo quita los suyos", () => {
    const vista = readFileSync(new URL("../../components/recruiting/VistaDelGerente.tsx", import.meta.url), "utf8");
    expect(vista).toContain("attachmentsFor, addAttachment, removeAttachment, openAttachment");
    expect(vista).toContain("adjuntar={(f) => addAttachment(c.id, f)}");
    expect(vista).toContain("abrirAdjunto={(id) => openAttachment(id)}");
    expect(vista).toContain("a.created_by && a.created_by === me?.id ? removeAttachment(a.id)");
    expect(vista).toContain('<input type="file"');
  });

  it("puerta: la pestaña, la página de candidatos, la fila y el hub pasan por la librería; la 183 limita candidatos y lo que cuelga de ellos", () => {
    const raiz = new URL("../../../", import.meta.url);
    const leer = (p: string) => readFileSync(new URL(p, raiz), "utf8");
    expect(leer("src/components/recruiting/TopBar.tsx")).toContain("pestanasVisibles(TABS, me.role)");
    expect(leer("src/app/recruiting/(recruiting)/page.tsx")).toContain("if (esGerenteDeTienda(me?.role)) return <VistaDelGerente />;");
    expect(leer("src/components/recruiting/CandidateRow.tsx")).toContain("resolucionDelGerente(");
    expect(leer("src/components/recruiting/VistaDelGerente.tsx")).toContain("resolverCandidato(");
    expect(leer("src/lib/constants.ts")).toMatch(/store_manager: \{ en: "Store Manager", es: "Gerente de tienda" \}/);
    const sql = leer("supabase/migrations/183_gerente_de_tienda.sql");
    expect(sql).toContain("'admin', 'manager', 'recruiter', 'store_manager'");
    expect(sql).toContain("coalesce(p_status, '') in ('inperson', 'hired', 'discarded')");
    expect(sql).toContain("like ('% ' || lower(btrim(p_location)) || ' %')");
    for (const p of ["read candidates", "write candidates", "read contacts", "write contacts", "read attachments", "write attachments"]) {
      expect(sql).toContain(`alter policy "recruiting ${p}"`);
    }
    expect(sql).toContain('alter policy "stage_history select"');
    for (const tabla of ["jobs", "question_sets", "questions", "stages", "templates", "custom_fields"]) {
      expect(sql).toContain(`alter policy "recruiting write ${tabla}"`);
    }
    // El registro de la migración lleva su checksum, no el marcador de borrador.
    expect(sql).not.toContain("'PENDIENTE'");
  });
});
