import { describe, expect, it } from "vitest";
import { archiva, clasifica, deshaz, esComodin, esInterno, esSinNombre, MOTIVOS, motivoDe } from "./archiva-clientes-basura.mjs";

// Ejemplos REALES de lo medido en produccion el 2026-10-16 (cuentas, no personas: son cajones de QuickBooks y basura
// del Excel). Los nombres de clientes de verdad son inventados.

describe("regla 1: sin nombre (account !~ '[A-Za-z]{3}')", () => {
  it("casa con los ocho ejemplos medidos", () => {
    for (const a of ["+", ";", "..", "*", "30.27", "4V", "HB", "SO 10873"]) expect(esSinNombre(a), a).toBe(true);
  });
  it("no casa con una cuenta con tres letras seguidas, aunque lleve numeros; null cuenta como sin nombre", () => {
    expect(esSinNombre("ABC Homes 123")).toBe(false);
    expect(esSinNombre("J&R Tile")).toBe(false);
    expect(esSinNombre("A B C")).toBe(true);
    expect(esSinNombre(null)).toBe(true);
  });
});

describe("regla 2: comodines de QuickBooks (account ~* '(...)')", () => {
  it("casa con cada patron medido, en cualquier posicion y sin distinguir mayusculas", () => {
    for (const a of ["VENTA AL MOSTRADOR", "venta al mostrador MCA", "SALES ORDER 2024", "BAD DEBT", "Damaged Merchandise", "INVENTORY BY STORE",
      "INVENTORY COORD", "DE MCALLEN A PHARR", "DE MISSION A MCALLEN"]) expect(esComodin(a), a).toBe(true);
  });
  it("no casa con un cliente que se parece", () => {
    expect(esComodin("INVENTORY SOLUTIONS LLC")).toBe(false);
    expect(esComodin("MCALLEN BUILDERS")).toBe(false);
    expect(esComodin("Ventas del Valle")).toBe(false);
  });
});

describe("regla 3: interno / proveedor / competencia (activity_status)", () => {
  it("solo esos tres valores, exactos; los demas estados se quedan", () => {
    for (const s of ["Internal", "Supplier", "Competencia"]) expect(esInterno(s), s).toBe(true);
    for (const s of ["One time?", "walk in", "Unknown", "Inactive", null, undefined, "internal", "INTERNAL"]) expect(esInterno(s), String(s)).toBe(false);
  });
});

const fila = (id, account, activity_status = null) => ({ id, account, activity_status });
const LISTA = [
  fila(1, "+"),                                   // sin nombre
  fila(2, "SO 10873", "Internal"),                // sin nombre Y interno: manda «sin nombre»
  fila(3, "VENTA AL MOSTRADOR", "Internal"),      // comodin Y interno: manda «comodin»
  fila(4, "BAD DEBT"),                            // comodin
  fila(5, "Grupo Demo SA", "Supplier"),           // interno
  fila(6, "Competidor Demo", "Competencia"),      // interno
  fila(7, "Cliente Demo LLC", "walk in"),         // se queda
  fila(8, "Otro Cliente Demo", null),             // se queda
  fila(9, "Un Cliente Mas", "Inactive"),          // se queda
];

describe("clasifica", () => {
  it("el motivo de cada fila sigue el orden sin nombre > comodin > interno; un cliente da null", () => {
    expect(motivoDe(LISTA[1])).toBe(MOTIVOS.sinNombre);
    expect(motivoDe(LISTA[2])).toBe(MOTIVOS.comodin);
    expect(motivoDe(LISTA[4])).toBe(MOTIVOS.interno);
    expect(motivoDe(LISTA[6])).toBeNull();
    expect(motivoDe(LISTA[8])).toBeNull();
  });
  it("cuenta por regla CON solape y el total como union; los ids van con el motivo que manda", () => {
    const r = clasifica(LISTA);
    expect(r.vivas).toBe(9);
    expect(r.porRegla).toEqual({ [MOTIVOS.sinNombre]: 2, [MOTIVOS.comodin]: 2, [MOTIVOS.interno]: 4 });
    expect(r.porMotivo).toEqual({ [MOTIVOS.sinNombre]: [1, 2], [MOTIVOS.comodin]: [3, 4], [MOTIVOS.interno]: [5, 6] });
    // 2 + 2 + 4 = 8 con solape; la union son 6.
    expect(r.total).toBe(6);
  });
});

/** Una «base» falsa que apunta cada consulta y responde con lo que se le diga. */
function baseFalsa(vivas) {
  const consultas = [];
  const consulta = async (sql, params) => {
    consultas.push({ sql, params });
    if (/^select id, account/.test(sql)) return { rows: vivas };
    if (/^update/.test(sql)) return { rows: (params?.[1] ?? [1, 2, 3]).map((id) => ({ id })) };
    if (/^select archived_reason/.test(sql)) return { rows: [{ archived_reason: MOTIVOS.comodin, n: 3 }, { archived_reason: MOTIVOS.interno, n: 1 }] };
    throw new Error("consulta inesperada: " + sql);
  };
  return { consulta, consultas };
}

describe("archiva", () => {
  it("en seco solo lee las vivas (archived_at is null) y no manda ningun UPDATE", async () => {
    const { consulta, consultas } = baseFalsa(LISTA);
    const lineas = [];
    const r = await archiva({ consulta, escribe: false, log: (s) => lineas.push(s) });
    expect(consultas).toHaveLength(1);
    expect(consultas[0].sql).toMatch(/where archived_at is null/);
    expect(r.total).toBe(6);
    expect(lineas.join("\n")).toMatch(/Total a archivar \(union, sin repetir\): 6/);
    expect(lineas.join("\n")).toMatch(/EN SECO/);
  });
  it("con --escribe manda un UPDATE por motivo, con sus ids, solo sobre archived_at is null (idempotente)", async () => {
    const { consulta, consultas } = baseFalsa(LISTA);
    const r = await archiva({ consulta, escribe: true, log: () => {} });
    const updates = consultas.filter((c) => /^update/.test(c.sql));
    expect(updates).toHaveLength(3);
    for (const u of updates) {
      expect(u.sql).toMatch(/set archived_at = now\(\), archived_reason = \$1/);
      expect(u.sql).toMatch(/where archived_at is null/);
    }
    expect(updates.map((u) => u.params)).toEqual([[MOTIVOS.sinNombre, [1, 2]], [MOTIVOS.comodin, [3, 4]], [MOTIVOS.interno, [5, 6]]]);
    expect(r.hechas).toBe(6);
  });
  it("sin nada que archivar (segunda pasada) no manda ningun UPDATE", async () => {
    const { consulta, consultas } = baseFalsa([LISTA[6], LISTA[7]]);
    const r = await archiva({ consulta, escribe: true, log: () => {} });
    expect(consultas.filter((c) => /^update/.test(c.sql))).toHaveLength(0);
    expect(r.hechas).toBe(0);
  });
});

describe("deshaz (--deshacer)", () => {
  it("en seco cuenta por motivo y no escribe; con --escribe quita archived_at y archived_reason SOLO a los tres motivos", async () => {
    const seco = baseFalsa([]);
    const r0 = await deshaz({ consulta: seco.consulta, escribe: false, log: () => {} });
    expect(r0.total).toBe(4);
    expect(seco.consultas.filter((c) => /^update/.test(c.sql))).toHaveLength(0);

    const real = baseFalsa([]);
    const r1 = await deshaz({ consulta: real.consulta, escribe: true, log: () => {} });
    const u = real.consultas.find((c) => /^update/.test(c.sql));
    expect(u.sql).toMatch(/set archived_at = null, archived_reason = null/);
    expect(u.sql).toMatch(/archived_reason = any\(\$1::text\[\]\)/);
    expect(u.params).toEqual([[MOTIVOS.sinNombre, MOTIVOS.comodin, MOTIVOS.interno]]);
    expect(r1.hechas).toBe(3);
  });
});
