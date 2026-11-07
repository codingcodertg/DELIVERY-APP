import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import {
  MOTIVOS_DE_MERMA, MOTIVOS_VIEJOS, PASOS, PASO_CUANDO_Y_QUIEN, camposDe, camposVisibles, etiquetaDeOpcion, pasoCompleto,
  pasoInicial, pasosPlanos, pasosVisibles, primerHueco, respuestasIniciales, respuestasParaGuardar,
} from "./pasos";
import { mermaParaEnviar } from "./datos";
import { guardarBorrador, leerBorrador, type Almacen } from "./borradores";

/**
 * Los cinco pedidos de Roberto del 2026-11-07 (Warehouse Ops → Nuevo reporte → Merma), D-919:
 *   c8256a2e  «Transporte» se parte en «del cliente» y «entrega de la tienda» (migración 269).
 *   2121eb16  Los comentarios van justo después del motivo.
 *   0516ed1a  El CRMA va justo después de «¿de dónde viene?».
 *   fb02f65a  Fecha + quién lo rompió + quién lo reportó en UNA pantalla.
 *   319a0f18  El recordatorio de la política de merma arriba del resumen.
 */
const lee = (ruta: string) => readFileSync(join(process.cwd(), ruta), "utf8").replace(/\r\n/g, "\n");
const SQL = lee("supabase/migrations/269_merma_motivo_transporte.sql");
const ASISTENTE = lee("src/app/operaciones/Asistente.tsx");
const CSS = lee("src/app/operaciones/operaciones.css");

const HOY = "2026-11-07";
const producto = { id: 7, sku: "S", name: "N", cost: 1, pieces_per_box: 8 };
const completo = {
  product: producto, qty: { boxes: 1, piecesPerBox: 8, loosePieces: 0 }, split: { damaged: 8, sample: 0 },
  return_type: "internal", reason: "fell", broken_on: "2026-11-01", photo: ["data:image/jpeg;base64,/9j/"],
};
const ids = (ps: { id: string }[]) => ps.map((p) => p.id);

describe("el orden nuevo del formulario de merma", () => {
  it("producto → foto → cantidades → origen → CRMA → motivo → comentarios → (fecha + quién) → resumen", () => {
    expect(ids(PASOS.scrap)).toEqual(["product", "photo", "qty", "return_type", "crma", "reason", "comments", PASO_CUANDO_Y_QUIEN]);
    // Abierto el grupo, cada campo sigue existiendo con su id de siempre (nada cambia en la base).
    expect(ids(pasosPlanos("scrap"))).toEqual(["product", "photo", "qty", "return_type", "crma", "reason", "comments", "broken_on", "broken_by", "reported_by"]);
  });
  it("2121eb16: los comentarios justo después del motivo", () => {
    const x = ids(PASOS.scrap);
    expect(x.indexOf("comments")).toBe(x.indexOf("reason") + 1);
  });
  it("0516ed1a: el CRMA justo después de «¿de dónde viene?», y solo en devolución de cliente", () => {
    const x = ids(PASOS.scrap);
    expect(x.indexOf("crma")).toBe(x.indexOf("return_type") + 1);
    expect(ids(pasosVisibles("scrap", completo))).not.toContain("crma");
    const dev = { ...completo, return_type: "customer_return" };
    expect(ids(pasosVisibles("scrap", dev))).toEqual(["product", "photo", "qty", "return_type", "crma", "reason", "comments", PASO_CUANDO_Y_QUIEN]);
    // Sigue opcional: vacío no deja hueco.
    expect(primerHueco("scrap", dev, HOY)).toBe(-1);
  });
  it("son 8 pantallas más el resumen (antes 10 + 1), y la barra de progreso se calcula de la lista", () => {
    expect(pasosVisibles("scrap", completo)).toHaveLength(7);
    expect(pasosVisibles("scrap", { ...completo, return_type: "customer_return" })).toHaveLength(8);
    expect(ASISTENTE).toContain("{[...pasos, null].map((_, n) => <li key={n}");
  });
});

describe("c8256a2e: transporte del cliente o entrega de la tienda", () => {
  it("las opciones del motivo", () => {
    expect(MOTIVOS_DE_MERMA.map((o) => o.v)).toEqual(["fell", "strap", "forklift", "transportation_customer", "transportation_delivery", "other"]);
    expect(MOTIVOS_DE_MERMA.find((o) => o.v === "transportation_customer")).toMatchObject({ en: "Transportation – customer", es: "Transporte – del cliente" });
    expect(MOTIVOS_DE_MERMA.find((o) => o.v === "transportation_delivery")).toMatchObject({ en: "Transportation – store delivery", es: "Transporte – entrega de la tienda" });
    const paso = PASOS.scrap.find((p) => p.id === "reason")!;
    expect(paso.tipo === "opcion" && paso.opciones).toBe(MOTIVOS_DE_MERMA);
  });
  it("el valor viejo «transportation» ya no se elige, pero se sigue leyendo", () => {
    expect(MOTIVOS_DE_MERMA.some((o) => o.v === "transportation")).toBe(false);
    expect(MOTIVOS_VIEJOS.map((o) => o.v)).toEqual(["transportation"]);
    expect(etiquetaDeOpcion("scrap", "reason", "transportation", "en")).toBe("Transportation (unspecified)");
    expect(etiquetaDeOpcion("scrap", "reason", "transportation", "es")).toBe("Transporte (sin especificar)");
    expect(etiquetaDeOpcion("scrap", "reason", "transportation_delivery", "es")).toBe("Transporte – entrega de la tienda");
    expect(etiquetaDeOpcion("scrap", "reason", "basura", "en")).toBe("");
    // Un borrador viejo con «transportation» vuelve a preguntar el motivo (ya no es una opción válida).
    const paso = PASOS.scrap.find((p) => p.id === "reason")!;
    expect(pasoCompleto(paso, { reason: "transportation" })).toBe(false);
    expect(pasoCompleto(paso, { reason: "transportation_customer" })).toBe(true);
  });
  it("viaja tal cual a la columna reason", () => {
    expect(mermaParaEnviar({ ...completo, reason: "transportation_customer" }).reason).toBe("transportation_customer");
    expect(respuestasParaGuardar("scrap", { ...completo, reason: "transportation_delivery" }).reason).toBe("transportation_delivery");
  });
  it("la migración 269 amplía el check de la columna sin tocar los reportes viejos", () => {
    expect(SQL).toContain("alter table public.warehouse_reports drop constraint if exists warehouse_reports_reason_check;");
    expect(SQL).toContain("check (reason in ('fell', 'strap', 'forklift', 'transportation', 'transportation_customer', 'transportation_delivery', 'other'));");
    expect(SQL).not.toMatch(/\bupdate public\.warehouse_reports\b/);
    expect(SQL).not.toMatch(/\b(begin|commit);/i);
    const [cuerpo, registro] = SQL.split("-- @ledger-below");
    const sha = createHash("sha256").update(cuerpo, "utf8").digest("hex");
    expect(registro).toContain(`values ('269_merma_motivo_transporte.sql', '${sha}')`);
  });
});

describe("fb02f65a: fecha + quién lo rompió + quién lo reportó en una pantalla", () => {
  const grupo = PASOS.scrap.find((p) => p.id === PASO_CUANDO_Y_QUIEN)!;
  it("es la última pantalla antes del resumen, con la fecha primero", () => {
    expect(PASOS.scrap[PASOS.scrap.length - 1]).toBe(grupo);
    expect(grupo.tipo).toBe("grupo");
    expect(ids(camposDe(grupo))).toEqual(["broken_on", "broken_by", "reported_by"]);
    expect(camposDe(grupo).map((c) => c.tipo)).toEqual(["fecha", "personas", "personas"]);
    expect(camposDe(PASOS.scrap[0])).toEqual([PASOS.scrap[0]]);
  });
  it("está completa cuando la fecha vale; los dos «quién» son opcionales", () => {
    expect(pasoCompleto(grupo, { broken_on: "2026-11-01" }, HOY)).toBe(true);
    expect(pasoCompleto(grupo, { broken_on: "2026-11-01", broken_by: [], reported_by: [] }, HOY)).toBe(true);
    expect(pasoCompleto(grupo, { broken_on: "2026-12-01" }, HOY)).toBe(false);
    expect(pasoCompleto(grupo, {}, HOY)).toBe(false);
    const i = pasosVisibles("scrap", completo).findIndex((p) => p.id === PASO_CUANDO_Y_QUIEN);
    expect(primerHueco("scrap", { ...completo, broken_on: "" }, HOY)).toBe(i);
    expect(primerHueco("scrap", completo, HOY)).toBe(-1);
  });
  it("cada campo se guarda bajo su propio id, como antes (broken_on, broken_by, answers.reported_by)", () => {
    const r = { ...completo, broken_by: ["a"], reported_by: ["b", "Pedro"], comments: " hola " };
    expect(respuestasParaGuardar("scrap", r)).toEqual({ return_type: "internal", reason: "fell", comments: "hola", broken_on: "2026-11-01", broken_by: ["a"], reported_by: ["b", "Pedro"] });
    expect(respuestasParaGuardar("scrap", r)).not.toHaveProperty(PASO_CUANDO_Y_QUIEN);
    expect(mermaParaEnviar(r).broken_by).toEqual(["a"]);
    expect(respuestasIniciales("scrap", null, HOY)).toEqual({ broken_on: HOY });
  });
  it("el resumen enseña una fila por campo, todas abren la misma pantalla", () => {
    expect(ids(camposVisibles("scrap", completo))).toEqual(["product", "photo", "qty", "return_type", "reason", "comments", "broken_on", "broken_by", "reported_by"]);
    expect(ASISTENTE).toContain("{pasos.flatMap((p, n) => camposDe(p).filter((c) => seMuestra(c, r)).map((c) => (");
    expect(ASISTENTE).toContain("onClick={() => editar(n)} data-editar={c.id}");
    // La pantalla del grupo pinta cada campo con su título y su línea de ayuda.
    expect(ASISTENTE).toContain('case "grupo":');
    expect(ASISTENTE).toContain('<section key={c.id} className="ops-grupo-campo" data-campo-del-grupo={c.id}>');
    expect(CSS).toContain(".ops-grupo-campo h3");
    // Cambiar de tienda también limpia a la gente elegida dentro del grupo.
    expect(ASISTENTE).toContain("for (const p of pasosVisibles(tipo, x).flatMap(camposDe)) {");
  });
});

describe("319a0f18: el recordatorio arriba de «Revisa y envía»", () => {
  it("texto exacto en los dos idiomas, solo en la merma", () => {
    const i = ASISTENTE.indexOf('{tipo === "scrap" && (\n            <p className="ops-recordatorio" role="note" data-recordatorio="merma">');
    expect(i).toBeGreaterThan(0);
    expect(i).toBeGreaterThan(ASISTENTE.indexOf('<h2>{t("Check and send", "Revisa y envía")}</h2>'));
    expect(i).toBeLessThan(ASISTENTE.indexOf("<Perdida r={r} grande />"));
    expect(ASISTENTE).toContain("Este formato debe llenarse cada vez que se detecte material dañado. El material no podrá desecharse hasta que se hayan tomado fotografías, guardado la evidencia y obtenido la autorización de Gerencia a través de la aplicación.");
    expect(ASISTENTE).toContain("This form must be filled out every time damaged material is found. The material cannot be discarded until photos have been taken, the evidence saved, and Management's authorization obtained through the app.");
    expect(CSS).toContain(".ops-recordatorio {");
  });
});

describe("los borradores de antes del reorden se abren igual", () => {
  const mem = (): Almacen => { const m = new Map<string, string>(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), removeItem: (k) => m.delete(k) }; };
  it("las respuestas viven por id, así que ninguna se pierde", () => {
    const a = mem();
    const viejo = { ...completo, broken_by: ["a"], reported_by: ["Pedro"], comments: "x" };
    guardarBorrador("u", { id: "b1", tipo: "scrap", r: viejo, paso: 7, tienda: "RDZ Pharr", guardado: "2026-11-06T10:00:00Z" }, a);
    const b = leerBorrador("u", "b1", a)!;
    expect(respuestasIniciales("scrap", b.r, HOY)).toEqual(viejo);
    expect(primerHueco("scrap", respuestasIniciales("scrap", b.r, HOY), HOY)).toBe(-1);
  });
  it("el índice guardado nunca se pasa del resumen (la lista vieja tenía 10 pantallas; la nueva 7 u 8)", () => {
    expect(pasoInicial("scrap", completo, 10)).toBe(7); // el resumen
    expect(pasoInicial("scrap", completo, 9)).toBe(7);
    expect(pasoInicial("scrap", completo, 3)).toBe(3);
    expect(pasoInicial("scrap", { ...completo, return_type: "customer_return" }, 10)).toBe(8);
    expect(pasoInicial("scrap", completo, undefined)).toBe(0);
    expect(pasoInicial("scrap", completo, -2)).toBe(0);
    expect(pasoInicial("scrap", completo, Number.NaN)).toBe(0);
    expect(ASISTENTE).toContain("useState(() => pasoInicial(tipo, arranque, inicial?.paso))");
  });
});
