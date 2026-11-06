import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  accionLabel, accionTono, aplicarCerrar, aplicarNota, aplicarTomar, esTipoDeAccion, filtrar, pasaAccion, TIPOS_DE_ACCION,
  type Lead, type Persona,
} from "./reglas";
import { almacenDemo, leadsDemo, PERSONAS_DEMO } from "./demo";
import { COLUMNAS, COLUMNAS_SIN_253, faltaLaColumna, leadDeLaBase } from "./almacen";

// 253 (ayuda e207d9ef, Roberto): la nota de avance lleva tipo de acción.
const yo: Persona = { id: "u1", name: "Ana", store: "RDZ", admin: false };
const base = (): Lead => ({ ...leadsDemo()[0], status: "taken", holder: "u1", holder_name: "Ana" });
const ahora = "2026-11-05T12:00:00Z";

describe("tipos de acción", () => {
  it("son los siete pedidos, en orden, con EN y ES", () => {
    expect(TIPOS_DE_ACCION.map((a) => accionLabel(a, "en"))).toEqual(
      ["Made Contact", "Didn't Answer", "Had Appointment", "Made Quote", "Under Negotiation", "Closed", "Lost"]);
    for (const a of TIPOS_DE_ACCION) expect(accionLabel(a, "es")).not.toBe(accionLabel(a, "en"));
    expect(accionTono("closed")).toBe("verde");
    expect(accionTono("lost")).toBe("rojo");
    expect(esTipoDeAccion("otra")).toBe(false);
  });
  it("son los mismos valores que el check de la migración", () => {
    const sql = readFileSync("supabase/migrations/253_leads_tipo_de_accion.sql", "utf8");
    const lista = TIPOS_DE_ACCION.map((a) => `'${a}'`).join(", ");
    expect(sql.split(lista).length - 1).toBeGreaterThanOrEqual(3);
    expect(sql).toContain("-- @ledger-below");
    expect(sql).not.toContain("D-NEXT");
  });
});

describe("aplicarNota con tipo", () => {
  it("con tipo, la nota es opcional", () => {
    const r = aplicarNota(base(), yo, "  ", ahora, "no_answer");
    expect(r.ok && r.valor.follow_up_action).toBe("no_answer");
    expect(r.ok && r.valor.follow_up_note).toBeNull();
  });
  it("sin tipo y sin nota, se rechaza como antes; sin tipo con nota, vale", () => {
    expect(aplicarNota(base(), yo, "", ahora)).toEqual({ ok: false, motivo: "falta_nota" });
    const r = aplicarNota(base(), yo, "hola", ahora);
    expect(r.ok && r.valor.follow_up_action).toBeNull();
  });
  it("un tipo desconocido no vale", () => {
    expect(aplicarNota(base(), yo, "x", ahora, "otra" as never)).toEqual({ ok: false, motivo: "dato_invalido" });
  });
  it("tomar y cerrar sin quedarse el lead limpian el tipo; vender lo conserva", () => {
    const r = aplicarNota(base(), yo, "", ahora, "quote");
    if (!r.ok) throw new Error();
    const cerrado = aplicarCerrar(r.valor, yo, "nothing", "nada", ahora);
    expect(cerrado.ok && cerrado.valor.follow_up_action).toBeNull();
    const vendido = aplicarCerrar(r.valor, yo, "sale", "vendido", ahora);
    expect(vendido.ok && vendido.valor.follow_up_action).toBe("quote");
    const libre: Lead = { ...r.valor, status: "free", holder: null };
    const tomado = aplicarTomar(libre, [], yo, 10, ahora);
    expect(tomado.ok && tomado.valor.follow_up_action).toBeNull();
  });
});

describe("filtro por última acción", () => {
  const leads = [{ ...base(), id: "a", follow_up_action: "quote" as const }, { ...base(), id: "b", follow_up_action: null }, { ...base(), id: "c" }];
  it("vacío deja todo; 'sin' los que no tienen (también los viejos sin campo)", () => {
    expect(leads.filter((l) => pasaAccion(l, "")).length).toBe(3);
    expect(leads.filter((l) => pasaAccion(l, "sin")).map((l) => l.id)).toEqual(["b", "c"]);
    expect(leads.filter((l) => pasaAccion(l, "quote")).map((l) => l.id)).toEqual(["a"]);
  });
  it("va dentro de filtrar", () => {
    const r = filtrar(leads, { pool: null, vista: "todas", categoria: "todas", tipo: "", ciudad: "", busca: "", situacion: "", accion: "quote" });
    expect(r.map((l) => l.id)).toEqual(["a"]);
  });
});

describe("la base y el demo", () => {
  it("una fila vieja sin columna lee null; un valor raro también", () => {
    expect(leadDeLaBase({ id: "x" }).follow_up_action).toBeNull();
    expect(leadDeLaBase({ id: "x", follow_up_action: "nope" }).follow_up_action).toBeNull();
    expect(leadDeLaBase({ id: "x", follow_up_action: "lost" }).follow_up_action).toBe("lost");
  });
  it("sin la 253, se relee sin la columna", () => {
    expect(COLUMNAS).toContain("follow_up_action");
    expect(COLUMNAS_SIN_253).not.toContain("follow_up_action");
    expect(faltaLaColumna({ code: "42703" })).toBe(true);
    expect(faltaLaColumna({ code: "42501" })).toBe(false);
  });
  it("el demo guarda el tipo en el lead y en el historial", async () => {
    const quien = PERSONAS_DEMO[0];
    const alm = almacenDemo(() => quien);
    const leidos = await alm.leer();
    if (!leidos.ok) throw new Error();
    const libre = leidos.valor.leads.find((l) => l.status === "free")!;
    expect((await alm.tomar(libre.id)).ok).toBe(true);
    const r = await alm.anotar(libre.id, "", "made_contact");
    expect(r.ok && r.valor.follow_up_action).toBe("made_contact");
    const h = await alm.historial(libre.id);
    expect(h.ok && h.valor.at(-1)?.action).toBe("made_contact");
  });
});

describe("la pantalla", () => {
  const p = readFileSync("src/app/leads/Leads.tsx", "utf8");
  it("la nota de avance exige tipo y pinta la píldora en la tarjeta y el historial", () => {
    expect(p).toContain("const avanceOk = accion !== null");
    expect(p).toContain("{TIPOS_DE_ACCION.map((a) => (");
    expect(p).toContain("<PildoraAccion a={l.follow_up_action} />");
    expect(p).toContain("<PildoraAccion a={e.action} />");
    expect(p).toContain("<SelectAccion valor={accionFiltro}");
  });
});
