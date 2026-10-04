import { describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { deflateSync } from "node:zlib";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { BotonesDeArchivo, ListaDeCompetencia } from "@/app/estimator/Competencia";
import { ListaDeEstimados } from "@/app/estimator/EstimadosCompetencia";
import { AvisoSin161, LISTA_DE_COMPETIDORES, ListaDeCompetidores, TablaDeProductos } from "@/app/estimator/ProductosCompetencia";
import { ACCEPT_DE_CAMARA, ACCEPT_DE_COMPETENCIA, type EstimadoDeCompetencia } from "./competencia";
import { LECTURA_DEMO, almacenDeLecturasDemo } from "./demo";
import { lineaSfVacia, lineaUnidadVacia, totalDeLinea } from "./modelo";
import {
  RUTA_DE_LECTURA, TOPES_DE_LECTURA, almacenDeLecturasDeLaBase, competidoresUsados, diferenciaDePrecio, empresaDe, fechaIso,
  filaDeLectura, lecturaDeFila, lecturaEnBlanco, lecturaVacia, lineaEmparejada, lineasPropias, mensajeDeLectura,
  normalizaLectura, productoVacio, resultadoDeLaRuta, totalDe, unidadNormalizada,
  type LecturaDeCompetencia, type LecturaGuardada, type ProductoDeCompetencia,
} from "./lectura";
import {
  ESQUEMA_DE_LECTURA, INSTRUCCIONES, LIMITES_DE_LECTURA, MAX_TOKENS_DE_SALIDA, MODELO_POR_DEFECTO, URL_DE_MENSAJES,
  cabecerasDeClaude, lecturaDeLaRespuesta, leerCompetencia, modeloDeLectura, paginasDePdf, peticionAClaude, tieneElModulo,
  topeDiario, usoDeLaRespuesta, type ArchivoALeer, type DepsDeLectura,
} from "./lectura-servidor";

/**
 * D-466: leer el estimado de la competencia y sacar sus productos. El dueño, 2026-10-04: «in the quote builder addd
 * the compettiton pdf or pcicture upload / compettiros company name and also products from the  and the ocr to
 * recognize the images,».
 *
 * **Ninguna prueba de aquí llama a la API de Anthropic**: `pedir` (el `fetch` de la ruta) es siempre un falso, y las
 * pruebas comprueban además cuándo NO se llega a llamar.
 */

const leer = (r: string) => readFileSync(r, "utf8").split("\r\n").join("\n");
const t = (en: string) => en;
const ID = "00000000-0000-4000-8000-0000000a0161";

const prod = (p: Partial<ProductoDeCompetencia> = {}): ProductoDeCompetencia => ({ ...productoVacio(), id: "p1", description: "Tile 24x48", ...p });
const lectura = (p: Partial<LecturaDeCompetencia> = {}): LecturaDeCompetencia => ({ ...lecturaVacia(), ...p });

// ---- lo no leído es null -------------------------------------------------------------------------------

describe("validar lo leído: lo que no se leyó queda null, nunca inventado", () => {
  it("un producto con campos que faltan o vienen mal los deja en null", () => {
    const l = normalizaLectura({
      competitor: "  Rival Tiles  ", doc_date: "2026-10-01", doc_number: 5512, subtotal: "1,836.00", tax: null, total: 1987.468,
      items: [{ description: " Porcelain 24x48 ", brand: "", sku: undefined, quantity: 500, unit: "sq ft", unit_price: "2.19", line_total: Number.NaN }],
    }, "ocr")!;
    expect(l.competitor).toBe("Rival Tiles");
    expect(l.doc_number).toBeNull(); // un número donde va un texto no se convierte
    expect(l.subtotal).toBeNull(); // un texto donde va un número no se adivina
    expect(l.tax).toBeNull();
    expect(l.total).toBe(1987.47);
    expect(l.source).toBe("ocr");
    expect(l.items).toHaveLength(1);
    expect(l.items[0]).toMatchObject({
      description: "Porcelain 24x48", brand: null, sku: null, quantity: 500, unit: "SF", unit_price: null, line_total: null, matched_line_id: null,
    });
  });
  it("un número negativo o infinito es null", () => {
    const l = normalizaLectura({ items: [{ description: "x", quantity: -3, unit_price: Infinity, line_total: 10 }], total: -1 }, "ocr")!;
    expect(l.items[0].quantity).toBeNull();
    expect(l.items[0].unit_price).toBeNull();
    expect(l.items[0].line_total).toBe(10);
    expect(l.total).toBeNull();
  });
  it("el precio unitario guarda cuatro decimales (un $/SF de 1.899) y los totales dos", () => {
    const l = normalizaLectura({ items: [{ description: "x", unit_price: 1.89949, line_total: 10.005 }] }, "ocr")!;
    expect(l.items[0].unit_price).toBe(1.8995);
    expect(l.items[0].line_total).toBe(10.01);
  });
  it("una fecha que no es AAAA-MM-DD, o que no existe, es null: no se adivina si 10/04 es abril u octubre", () => {
    expect(fechaIso("2026-10-04")).toBe("2026-10-04");
    expect(fechaIso("10/04/2026")).toBeNull();
    expect(fechaIso("2026-02-30")).toBeNull();
    expect(fechaIso(20261004)).toBeNull();
  });
  it("las filas en blanco se caen; lo que no es un objeto, también", () => {
    const l = normalizaLectura({ items: [{ description: null, quantity: null }, "texto", null, { sku: "A-1" }] }, "manual")!;
    expect(l.items.map((p) => p.sku)).toEqual(["A-1"]);
  });
  it(`como mucho ${TOPES_DE_LECTURA.maxProductos} productos`, () => {
    const items = Array.from({ length: TOPES_DE_LECTURA.maxProductos + 5 }, (_, i) => ({ description: `p${i}` }));
    expect(normalizaLectura({ items }, "ocr")!.items).toHaveLength(TOPES_DE_LECTURA.maxProductos);
  });
  it("dos filas con el mismo id no se quedan con el mismo id", () => {
    const l = normalizaLectura({ items: [{ id: "a", description: "x" }, { id: "a", description: "y" }] }, "manual")!;
    expect(l.items[0].id).toBe("a");
    expect(l.items[1].id).not.toBe("a");
  });
  it("lo que no trae una lista de productos no es una lectura", () => {
    expect(normalizaLectura({ competitor: "X" }, "ocr")).toBeNull();
    expect(normalizaLectura("texto", "ocr")).toBeNull();
    expect(normalizaLectura([], "ocr")).toBeNull();
  });
  it("las unidades: SF, box y piece con sus otros nombres; las demás, como vienen", () => {
    expect(unidadNormalizada("Sq Ft")).toBe("SF");
    expect(unidadNormalizada("CTN")).toBe("box");
    expect(unidadNormalizada("cajas")).toBe("box");
    expect(unidadNormalizada("EA")).toBe("piece");
    expect(unidadNormalizada("Lot")).toBe("Lot");
    expect(unidadNormalizada("  ")).toBeNull();
    expect(unidadNormalizada(3)).toBeNull();
  });
});

// ---- la respuesta de la API ----------------------------------------------------------------------------

const respuesta = (json: unknown, extra: Record<string, unknown> = {}) => ({
  id: "msg_1", type: "message", role: "assistant", model: MODELO_POR_DEFECTO, stop_reason: "end_turn",
  content: [{ type: "thinking", thinking: "" }, { type: "text", text: typeof json === "string" ? json : JSON.stringify(json) }],
  usage: { input_tokens: 3210, output_tokens: 987 }, ...extra,
});
const LEIDO = {
  competitor: "Rival Tiles", doc_date: "2026-10-01", doc_number: "RT-5512", subtotal: 1836, tax: 151.47, total: 1987.47,
  items: [
    { description: "Porcelain 24x48", brand: "Acme", sku: "RT-2448", quantity: 500, unit: "SF", unit_price: 2.19, line_total: 1095 },
    { description: "Thinset", brand: null, sku: null, quantity: 4, unit: null, unit_price: null, line_total: null },
  ],
};

describe("parsear la respuesta de Claude", () => {
  it("saca la lectura del bloque de texto, saltándose el de razonamiento", () => {
    const r = lecturaDeLaRespuesta(respuesta(LEIDO));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.lectura.competitor).toBe("Rival Tiles");
    expect(r.lectura.doc_number).toBe("RT-5512");
    expect(r.lectura.total).toBe(1987.47);
    expect(r.lectura.source).toBe("ocr");
    expect(r.lectura.items).toHaveLength(2);
    expect(r.lectura.items[0]).toMatchObject({ sku: "RT-2448", quantity: 500, unit: "SF", unit_price: 2.19, line_total: 1095 });
  });
  it("lo que el modelo devolvió null sigue null", () => {
    const r = lecturaDeLaRespuesta(respuesta(LEIDO));
    if (!r.ok) throw new Error("no ok");
    expect(r.lectura.items[1]).toMatchObject({ description: "Thinset", brand: null, sku: null, unit: null, unit_price: null, line_total: null });
  });
  it("una negativa (refusal) no se lee, aunque traiga texto", () => {
    const r = lecturaDeLaRespuesta(respuesta(LEIDO, { stop_reason: "refusal" }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("declined");
  });
  it("una respuesta cortada (max_tokens) no se lee: el JSON puede estar a medias", () => {
    const r = lecturaDeLaRespuesta(respuesta(LEIDO, { stop_reason: "max_tokens" }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("cut off");
  });
  it("un texto que no es JSON, o un JSON sin la forma, es un error y no una lectura vacía", () => {
    expect(lecturaDeLaRespuesta(respuesta("I could not read it")).ok).toBe(false);
    expect(lecturaDeLaRespuesta(respuesta({ competitor: "X" })).ok).toBe(false);
    expect(lecturaDeLaRespuesta({ stop_reason: "end_turn", content: [] }).ok).toBe(false);
    expect(lecturaDeLaRespuesta(null).ok).toBe(false);
  });
  it("el emparejado nunca viene de la lectura: aunque la respuesta lo traiga, se quita", () => {
    const r = lecturaDeLaRespuesta(respuesta({ ...LEIDO, items: [{ ...LEIDO.items[0], id: "fijo", matched_line_id: "l-123" }] }));
    if (!r.ok) throw new Error("no ok");
    expect(r.lectura.items[0].matched_line_id).toBeNull();
    expect(r.lectura.items[0].id).not.toBe("fijo");
  });
  it("los tokens gastados salen de usage; si no vienen, null", () => {
    expect(usoDeLaRespuesta(respuesta(LEIDO))).toEqual({ input_tokens: 3210, output_tokens: 987 });
    expect(usoDeLaRespuesta({})).toEqual({ input_tokens: null, output_tokens: null });
  });
});

// ---- lo que se manda -----------------------------------------------------------------------------------

describe("la petición a Claude", () => {
  it("un PDF va como documento y una foto como imagen, en base64 y antes del texto", () => {
    const pdf = peticionAClaude({ modelo: MODELO_POR_DEFECTO, tipo: "application/pdf", base64: "QUJD" });
    expect(pdf.messages[0].content[0]).toEqual({ type: "document", source: { type: "base64", media_type: "application/pdf", data: "QUJD" } });
    expect(pdf.messages[0].content[1]).toMatchObject({ type: "text" });
    const foto = peticionAClaude({ modelo: MODELO_POR_DEFECTO, tipo: "image/jpeg", base64: "QUJD" });
    expect(foto.messages[0].content[0]).toEqual({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: "QUJD" } });
  });
  it("pide salida con esquema, con techo de tokens y esfuerzo dicho; sin tool_choice forzado ni thinking a mano", () => {
    const p = peticionAClaude({ modelo: MODELO_POR_DEFECTO, tipo: "application/pdf", base64: "x" }) as Record<string, unknown>;
    expect(p.model).toBe("claude-opus-5-5");
    expect(p.max_tokens).toBe(MAX_TOKENS_DE_SALIDA);
    expect(p.output_config).toEqual({ effort: "medium", format: { type: "json_schema", schema: ESQUEMA_DE_LECTURA } });
    expect(p.system).toBe(INSTRUCCIONES);
    expect(Object.keys(p)).not.toContain("tool_choice");
    expect(Object.keys(p)).not.toContain("thinking");
    expect(Object.keys(p)).not.toContain("temperature");
  });
  it("el esquema: todo campo puede ser null, todos son obligatorios y no se admite ninguno de más", () => {
    expect(ESQUEMA_DE_LECTURA.additionalProperties).toBe(false);
    expect([...ESQUEMA_DE_LECTURA.required].sort()).toEqual(Object.keys(ESQUEMA_DE_LECTURA.properties).sort());
    const item = ESQUEMA_DE_LECTURA.properties.items.items;
    expect(item.additionalProperties).toBe(false);
    expect([...item.required].sort()).toEqual(["brand", "description", "line_total", "quantity", "sku", "unit", "unit_price"]);
    for (const campo of Object.values(item.properties)) expect(campo.anyOf).toContainEqual({ type: "null" });
    for (const k of ["competitor", "doc_date", "doc_number", "subtotal", "tax", "total"] as const) {
      expect(ESQUEMA_DE_LECTURA.properties[k].anyOf).toContainEqual({ type: "null" });
    }
  });
  it("las instrucciones prohíben adivinar y calcular", () => {
    expect(INSTRUCCIONES).toContain("Never guess, infer, calculate or complete a value");
    expect(INSTRUCCIONES).toContain("return null");
  });
  it("la llave va en x-api-key; el respaldo ante negativas solo en los modelos que lo aceptan", () => {
    const c = cabecerasDeClaude("sk-prueba", MODELO_POR_DEFECTO);
    expect(c["x-api-key"]).toBe("sk-prueba");
    expect(c["anthropic-version"]).toBe("2023-06-01");
    expect(c["anthropic-beta"]).toBe("server-side-fallback-2026-07-01");
    expect((peticionAClaude({ modelo: MODELO_POR_DEFECTO, tipo: "image/png", base64: "x" }) as Record<string, unknown>).fallbacks).toBe("default");
    expect(cabecerasDeClaude("k", "claude-haiku-4-5")["anthropic-beta"]).toBeUndefined();
    expect(Object.keys(peticionAClaude({ modelo: "claude-haiku-4-5", tipo: "image/png", base64: "x" }))).not.toContain("fallbacks");
  });
  it("el modelo y el tope del día se cambian por variable, y lo que no vale cae al de por defecto", () => {
    expect(modeloDeLectura(undefined)).toBe("claude-opus-5-5");
    expect(modeloDeLectura(" claude-fable-5-1 ")).toBe("claude-fable-5-1");
    expect(modeloDeLectura("gpt-x; rm -rf")).toBe("claude-opus-5-5");
    expect(topeDiario(undefined)).toBe(LIMITES_DE_LECTURA.topeDiario);
    expect(topeDiario("5")).toBe(5);
    expect(topeDiario("0")).toBe(0);
    expect(topeDiario("-3")).toBe(LIMITES_DE_LECTURA.topeDiario);
    expect(topeDiario("muchas")).toBe(LIMITES_DE_LECTURA.topeDiario);
  });
});

// ---- las páginas de un PDF -----------------------------------------------------------------------------

const enc = (s: string) => new Uint8Array(Buffer.from(s, "latin1"));
const pdfPlano = (paginas: number) => enc(
  "%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Count " + paginas + " >>\nendobj\n"
  + Array.from({ length: paginas }, (_, i) => `${i + 3} 0 obj\n<< /Type /Page /Parent 2 0 R >>\nendobj\n`).join("") + "%%EOF",
);
function pdfComprimido(paginas: number): Uint8Array {
  const dentro = Array.from({ length: paginas }, () => "<</Type/Page/Parent 2 0 R>>").join(" ");
  const z = deflateSync(Buffer.from(dentro, "latin1"));
  return new Uint8Array(Buffer.concat([
    Buffer.from(`%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\n5 0 obj\n<< /Type /ObjStm /N ${paginas} /First 10 /Length ${z.length} /Filter /FlateDecode >>\nstream\n`, "latin1"),
    z, Buffer.from("\nendstream\nendobj\n%%EOF", "latin1"),
  ]));
}

describe("contar las páginas de un PDF sin librería", () => {
  it("cuenta los /Type /Page y no el /Type /Pages", () => {
    expect(paginasDePdf(pdfPlano(1))).toBe(1);
    expect(paginasDePdf(pdfPlano(12))).toBe(12);
  });
  it("cuenta también las que van dentro de un object stream comprimido (PDF 1.5+)", () => {
    expect(paginasDePdf(pdfComprimido(3))).toBe(3);
    expect(paginasDePdf(pdfComprimido(14))).toBe(14);
  });
  it("si no encuentra ninguna, null (y entonces no se manda)", () => {
    expect(paginasDePdf(enc("%PDF-1.7\nnada que contar\n%%EOF"))).toBeNull();
    expect(paginasDePdf(enc("esto no es un pdf"))).toBeNull();
  });
});

// ---- la ruta entera, con todo falso -------------------------------------------------------------------

function montar(o: {
  perfil?: { role: string | null; module_access: string[] | null; full_name: string | null } | null;
  env?: DepsDeLectura["env"]; archivo?: Partial<ArchivoALeer> | null; bytes?: Uint8Array | null; hechas?: number | "sin-tabla";
  api?: { status?: number; json?: unknown; revienta?: boolean }; anotacion?: string | null;
} = {}) {
  const pasos: string[] = [];
  const pedir = vi.fn(async (_url: unknown, _init?: unknown) => {
    pasos.push("api");
    if (o.api?.revienta) throw new Error("socket hang up");
    const status = o.api?.status ?? 200;
    return { ok: status >= 200 && status < 300, status, json: async () => o.api?.json ?? respuesta(LEIDO) } as unknown as Response;
  });
  const registrar = vi.fn(async (_r: unknown) => { pasos.push("registrar"); return o.anotacion === undefined ? "anot-1" : o.anotacion; });
  const cerrar = vi.fn(async (_id: string, _fin: unknown) => { pasos.push("cerrar"); });
  const descargar = vi.fn(async (_p: string) => { pasos.push("descargar"); return o.bytes === undefined ? pdfPlano(2) : o.bytes; });
  const lecturasDesde = vi.fn(async (_d: Date) => { pasos.push("contar"); return o.hechas ?? 0; });
  const archivo = vi.fn(async (_id: string) => (o.archivo === null ? null : {
    id: ID, path: "general/u-1/a.pdf", file_name: "a.pdf", mime_type: "application/pdf", size_bytes: 2048, uploaded_by: "u-1", ...o.archivo,
  }));
  const d: DepsDeLectura = {
    env: o.env ?? { ANTHROPIC_API_KEY: "sk-de-mentira" },
    usuario: { id: "u-1" },
    perfil: async () => (o.perfil === undefined ? { role: "sales", module_access: ["estimator"], full_name: "Ana Ventas" } : o.perfil),
    archivo, lecturasDesde, descargar, registrar, cerrar,
    pedir: pedir as unknown as typeof fetch,
    ahora: () => new Date("2026-10-04T18:00:00Z"),
  };
  return { d, pasos, pedir, registrar, cerrar, descargar, lecturasDesde, archivo };
}
const codigo = (r: { cuerpo: unknown }) => (r.cuerpo as { codigo?: string }).codigo;

describe("leer el estimado: quién puede", () => {
  it("sin el módulo estimator: 403 y no se mira nada más", async () => {
    const m = montar({ perfil: { role: "sales", module_access: ["deliveries"], full_name: "X" } });
    const r = await leerCompetencia(ID, m.d);
    expect(r.status).toBe(403);
    expect(codigo(r)).toBe("sin-modulo");
    expect(m.archivo).not.toHaveBeenCalled();
    expect(m.pedir).not.toHaveBeenCalled();
  });
  it("sin perfil: 403", async () => {
    expect((await leerCompetencia(ID, montar({ perfil: null }).d)).status).toBe(403);
  });
  it("el admin tiene el módulo aunque no tenga la casilla", () => {
    expect(tieneElModulo({ role: "admin", module_access: [] })).toBe(true);
    expect(tieneElModulo({ role: "sales", module_access: ["estimator"] })).toBe(true);
    expect(tieneElModulo({ role: "manager", module_access: null })).toBe(false);
  });
  it("un archivo que subió OTRO no lo lee un vendedor (403), y sí el admin", async () => {
    const m = montar({ archivo: { uploaded_by: "u-otro" } });
    const r = await leerCompetencia(ID, m.d);
    expect(r.status).toBe(403);
    expect(codigo(r)).toBe("no-es-tuyo");
    expect(m.pedir).not.toHaveBeenCalled();
    const a = montar({ archivo: { uploaded_by: "u-otro" }, perfil: { role: "admin", module_access: null, full_name: "Jefa" } });
    expect((await leerCompetencia(ID, a.d)).status).toBe(200);
  });
  it("un archivo que su sesión no ve (o no existe): 404", async () => {
    const m = montar({ archivo: null });
    const r = await leerCompetencia(ID, m.d);
    expect(r.status).toBe(404);
    expect(m.descargar).not.toHaveBeenCalled();
  });
  it("sin fileId, o con algo que no es un id: 400 sin consultar", async () => {
    const m = montar();
    expect((await leerCompetencia(undefined, m.d)).status).toBe(400);
    expect((await leerCompetencia("../../etc/passwd", m.d)).status).toBe(400);
    expect(m.archivo).not.toHaveBeenCalled();
  });
});

describe("leer el estimado: sin llave", () => {
  it("sin ANTHROPIC_API_KEY contesta 503 con un mensaje que dice qué falta, y no llama a nada", async () => {
    for (const env of [{}, { ANTHROPIC_API_KEY: "" }, { ANTHROPIC_API_KEY: "   " }]) {
      const m = montar({ env });
      const r = await leerCompetencia(ID, m.d);
      expect(r.status).toBe(503);
      expect(codigo(r)).toBe("sin-llave");
      expect((r.cuerpo as { error: string }).error).toContain("Falta configurar ANTHROPIC_API_KEY");
      expect(m.pedir).not.toHaveBeenCalled();
      expect(m.descargar).not.toHaveBeenCalled();
      expect(m.registrar).not.toHaveBeenCalled();
    }
  });
  it("a quien no tiene el módulo no se le dice si hay llave o no", async () => {
    const r = await leerCompetencia(ID, montar({ env: {}, perfil: { role: "sales", module_access: [], full_name: null } }).d);
    expect(codigo(r)).toBe("sin-modulo");
  });
});

describe("leer el estimado: topes (nada de esto llega a la API)", () => {
  it("HEIC no se lee: 415", async () => {
    const m = montar({ archivo: { mime_type: "image/heic", file_name: "f.heic" } });
    const r = await leerCompetencia(ID, m.d);
    expect(r.status).toBe(415);
    expect(codigo(r)).toBe("tipo");
    expect(m.pedir).not.toHaveBeenCalled();
  });
  it("una foto de más de 5 MB: 413; de 5 MB justos, pasa", async () => {
    const grande = montar({ archivo: { mime_type: "image/jpeg", size_bytes: LIMITES_DE_LECTURA.maxBytesImagen + 1 } });
    const r = await leerCompetencia(ID, grande.d);
    expect(r.status).toBe(413);
    expect(codigo(r)).toBe("tamano");
    expect(grande.descargar).not.toHaveBeenCalled();
    const justa = montar({ archivo: { mime_type: "image/jpeg", size_bytes: LIMITES_DE_LECTURA.maxBytesImagen }, bytes: new Uint8Array([1, 2, 3]) });
    expect((await leerCompetencia(ID, justa.d)).status).toBe(200);
  });
  it("un PDF de más de 10 MB: 413", async () => {
    const m = montar({ archivo: { size_bytes: LIMITES_DE_LECTURA.maxBytesPdf + 1 } });
    expect((await leerCompetencia(ID, m.d)).status).toBe(413);
    expect(m.pedir).not.toHaveBeenCalled();
  });
  it("si la fila dice un tamaño y el archivo bajado pesa más, manda el archivo: 413", async () => {
    const m = montar({ archivo: { mime_type: "image/png", size_bytes: 10 }, bytes: new Uint8Array(LIMITES_DE_LECTURA.maxBytesImagen + 1) });
    const r = await leerCompetencia(ID, m.d);
    expect(r.status).toBe(413);
    expect(m.pedir).not.toHaveBeenCalled();
  });
  it(`un PDF de más de ${LIMITES_DE_LECTURA.maxPaginas} páginas no se manda; de ${LIMITES_DE_LECTURA.maxPaginas} justas, sí`, async () => {
    const largo = montar({ bytes: pdfPlano(LIMITES_DE_LECTURA.maxPaginas + 1) });
    const r = await leerCompetencia(ID, largo.d);
    expect(r.status).toBe(413);
    expect(codigo(r)).toBe("paginas");
    expect(largo.pedir).not.toHaveBeenCalled();
    expect(largo.registrar).not.toHaveBeenCalled();
    const justo = montar({ bytes: pdfPlano(LIMITES_DE_LECTURA.maxPaginas) });
    const ok = await leerCompetencia(ID, justo.d);
    expect(ok.status).toBe(200);
    expect((ok.cuerpo as { paginas: number }).paginas).toBe(LIMITES_DE_LECTURA.maxPaginas);
  });
  it("un PDF cuyas páginas no se pueden contar no se manda", async () => {
    const m = montar({ bytes: enc("%PDF-1.7 sin paginas") });
    const r = await leerCompetencia(ID, m.d);
    expect(codigo(r)).toBe("paginas");
    expect(m.pedir).not.toHaveBeenCalled();
  });
  it("el tope del día: al llegar, 429 sin bajar el archivo ni llamar; uno menos, pasa", async () => {
    const lleno = montar({ hechas: LIMITES_DE_LECTURA.topeDiario });
    const r = await leerCompetencia(ID, lleno.d);
    expect(r.status).toBe(429);
    expect(codigo(r)).toBe("tope");
    expect(lleno.descargar).not.toHaveBeenCalled();
    expect(lleno.pedir).not.toHaveBeenCalled();
    expect((await leerCompetencia(ID, montar({ hechas: LIMITES_DE_LECTURA.topeDiario - 1 }).d)).status).toBe(200);
  });
  it("el tope se cambia con COMPETENCIA_LECTURAS_DIA, y 0 apaga la lectura", async () => {
    const env = { ANTHROPIC_API_KEY: "k", COMPETENCIA_LECTURAS_DIA: "3" };
    expect((await leerCompetencia(ID, montar({ env, hechas: 3 }).d)).status).toBe(429);
    expect((await leerCompetencia(ID, montar({ env, hechas: 2 }).d)).status).toBe(200);
    expect((await leerCompetencia(ID, montar({ env: { ANTHROPIC_API_KEY: "k", COMPETENCIA_LECTURAS_DIA: "0" }, hechas: 0 }).d)).status).toBe(429);
  });
  it("el tope cuenta las últimas 24 horas", async () => {
    const m = montar();
    await leerCompetencia(ID, m.d);
    expect(m.lecturasDesde.mock.calls[0][0].toISOString()).toBe("2026-10-03T18:00:00.000Z");
  });
  it("sin la migración 161 (no hay registro): 503 sin-161 y no se llama", async () => {
    const m = montar({ hechas: "sin-tabla" });
    const r = await leerCompetencia(ID, m.d);
    expect(r.status).toBe(503);
    expect(codigo(r)).toBe("sin-161");
    expect(m.pedir).not.toHaveBeenCalled();
  });
  it("si la lectura no se puede apuntar, no se hace: sin registro no hay tope", async () => {
    const m = montar({ anotacion: null });
    const r = await leerCompetencia(ID, m.d);
    expect(r.status).toBe(503);
    expect(m.pedir).not.toHaveBeenCalled();
  });
});

describe("leer el estimado: la llamada y el registro", () => {
  it("llama UNA vez a /v1/messages con la llave, el modelo y el archivo, y devuelve la lectura", async () => {
    const m = montar();
    const r = await leerCompetencia(ID, m.d);
    expect(r.status).toBe(200);
    expect(m.pedir).toHaveBeenCalledTimes(1);
    const [url, init] = m.pedir.mock.calls[0] as [string, { method: string; headers: Record<string, string>; body: string }];
    expect(url).toBe(URL_DE_MENSAJES);
    expect(url).toBe("https://api.anthropic.com/v1/messages");
    expect(init.method).toBe("POST");
    expect(init.headers["x-api-key"]).toBe("sk-de-mentira");
    const cuerpo = JSON.parse(init.body);
    expect(cuerpo.model).toBe("claude-opus-5-5");
    expect(cuerpo.messages[0].content[0].source.data).toBe(Buffer.from(pdfPlano(2)).toString("base64"));
    const c = r.cuerpo as { lectura: LecturaDeCompetencia; paginas: number; modelo: string };
    expect(c.lectura.items).toHaveLength(2);
    expect(c.lectura.competitor).toBe("Rival Tiles");
    expect(c.paginas).toBe(2);
    expect(c.modelo).toBe("claude-opus-5-5");
  });
  it("la ruta del archivo sale de la fila, no de quien pide", async () => {
    const m = montar({ archivo: { path: "general/u-1/el-de-la-fila.pdf" } });
    await leerCompetencia(ID, m.d);
    expect(m.descargar).toHaveBeenCalledWith("general/u-1/el-de-la-fila.pdf");
  });
  it("apunta quién leyó qué ANTES de llamar, y cierra con los tokens", async () => {
    const m = montar();
    await leerCompetencia(ID, m.d);
    expect(m.pasos).toEqual(["contar", "descargar", "registrar", "api", "cerrar"]);
    expect(m.registrar).toHaveBeenCalledWith({
      file_id: ID, file_name: "a.pdf", read_by: "u-1", read_by_name: "Ana Ventas", model: "claude-opus-5-5", pages: 2, bytes: pdfPlano(2).byteLength,
    });
    expect(m.cerrar).toHaveBeenCalledWith("anot-1", { status: "ok", error: null, input_tokens: 3210, output_tokens: 987 });
  });
  it("COMPETENCIA_MODELO cambia el modelo que se pide y el que se apunta", async () => {
    const m = montar({ env: { ANTHROPIC_API_KEY: "k", COMPETENCIA_MODELO: "claude-fable-5-1" } });
    await leerCompetencia(ID, m.d);
    expect(JSON.parse((m.pedir.mock.calls[0] as [string, { body: string }])[1].body).model).toBe("claude-fable-5-1");
    expect((m.registrar.mock.calls[0][0] as { model: string }).model).toBe("claude-fable-5-1");
  });
  it("la llave rechazada (401): 502 con un mensaje que lo dice, y el registro cerrado en error", async () => {
    const m = montar({ api: { status: 401, json: { type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } } } });
    const r = await leerCompetencia(ID, m.d);
    expect(r.status).toBe(502);
    expect(codigo(r)).toBe("proveedor");
    expect((r.cuerpo as { error: string }).error).toContain("ANTHROPIC_API_KEY was rejected");
    expect(m.cerrar).toHaveBeenCalledWith("anot-1", expect.objectContaining({ status: "error" }));
  });
  it("un 400 de la API enseña su mensaje; un 429, que hay que esperar", async () => {
    const m = montar({ api: { status: 400, json: { error: { message: "image exceeds 5 MB" } } } });
    expect(((await leerCompetencia(ID, m.d)).cuerpo as { error: string }).error).toContain("400: image exceeds 5 MB");
    const o = montar({ api: { status: 429, json: {} } });
    expect(((await leerCompetencia(ID, o.d)).cuerpo as { error: string }).error).toContain("rate limited");
  });
  it("si la red revienta: 502 y el registro cerrado en error (la lectura cuenta para el tope)", async () => {
    const m = montar({ api: { revienta: true } });
    const r = await leerCompetencia(ID, m.d);
    expect(r.status).toBe(502);
    expect((r.cuerpo as { error: string }).error).toContain("socket hang up");
    expect(m.pasos).toEqual(["contar", "descargar", "registrar", "api", "cerrar"]);
  });
  it("una negativa del modelo: 502 `respuesta`, con los tokens apuntados", async () => {
    const m = montar({ api: { json: respuesta(LEIDO, { stop_reason: "refusal" }) } });
    const r = await leerCompetencia(ID, m.d);
    expect(r.status).toBe(502);
    expect(codigo(r)).toBe("respuesta");
    expect(m.cerrar).toHaveBeenCalledWith("anot-1", expect.objectContaining({ status: "error", input_tokens: 3210, output_tokens: 987 }));
  });
});

// ---- el lado del navegador -----------------------------------------------------------------------------

describe("lo que contesta la ruta, visto desde la pantalla", () => {
  it("un 200 con lectura es una lectura (vuelta a validar)", () => {
    const r = resultadoDeLaRuta(200, { lectura: { ...LEIDO, source: "ocr" } });
    expect(r.ok && r.lectura.items.length).toBe(2);
  });
  it("un 200 sin la forma no se da por bueno", () => {
    const r = resultadoDeLaRuta(200, { lectura: "nada" });
    expect(!r.ok && r.codigo).toBe("respuesta");
  });
  it("un error trae su código; uno desconocido es del proveedor", () => {
    const r = resultadoDeLaRuta(503, { codigo: "sin-llave", error: "Falta configurar ANTHROPIC_API_KEY" });
    expect(!r.ok && r.codigo).toBe("sin-llave");
    const d = resultadoDeLaRuta(500, { codigo: "inventado" });
    expect(!d.ok && d.codigo).toBe("proveedor");
    expect(!d.ok && d.error).toBe("HTTP 500");
  });
  it("sin llave, la pantalla dice qué falta y que se puede teclear a mano", () => {
    const m = mensajeDeLectura("sin-llave", "x", t);
    expect(m).toContain("ANTHROPIC_API_KEY");
    expect(m).toContain("Type the products by hand");
    expect(mensajeDeLectura("tope", "x", t)).toContain("limit");
    expect(mensajeDeLectura("sin-161", "x", t)).toContain("migration 161");
    expect(mensajeDeLectura("proveedor", "boom", t)).toContain("boom");
  });
});

describe("guardar y cargar los productos (161)", () => {
  function falso(o: { error?: { code: string; message: string }; filas?: Record<string, unknown>[] } = {}) {
    let subido: Record<string, unknown> | null = null;
    let conflicto = "";
    let ids: string[] = [];
    const fila = { file_id: ID, competitor: "Rival", doc_date: null, doc_number: null, subtotal: null, tax: null, total: 99.5,
      items: [{ id: "p1", description: "Tile" }], source: "ocr", saved_by_name: "Ana", saved_at: "2026-10-04T10:00:00Z" };
    const filas = o.filas ?? [fila];
    const tabla = {
      select: vi.fn(() => tabla),
      limit: vi.fn(async () => ({ data: [], error: o.error ?? null })),
      in: vi.fn(async (_c: string, v: string[]) => { ids = v; return { data: o.error ? null : filas, error: o.error ?? null }; }),
      upsert: vi.fn((f: Record<string, unknown>, opt: { onConflict: string }) => {
        subido = f; conflicto = opt.onConflict;
        return { select: async () => ({ data: o.error ? null : filas, error: o.error ?? null }) };
      }),
    };
    const sb = { from: vi.fn(() => tabla) } as unknown as SupabaseClient;
    return { sb, tabla, subido: () => subido, conflicto: () => conflicto, ids: () => ids };
  }
  it("la fila que se manda: validada, sin filas en blanco y sin quién ni cuándo", () => {
    const f = filaDeLectura(ID, lectura({ competitor: "  Rival ", total: 10, source: "ocr", items: [prod(), productoVacio(), prod({ id: "p2", description: null, sku: "A" })] }));
    expect(f.file_id).toBe(ID);
    expect(f.competitor).toBe("Rival");
    expect(f.items.map((p) => p.id)).toEqual(["p1", "p2"]);
    expect(f.source).toBe("ocr");
    expect(Object.keys(f)).not.toContain("saved_by");
    expect(Object.keys(f)).not.toContain("saved_at");
  });
  it("guardar es un upsert por archivo", async () => {
    const f = falso();
    const r = await almacenDeLecturasDeLaBase(f.sb).guardar(ID, lectura({ competitor: "Rival", items: [prod()] }));
    expect(r.ok && r.valor.file_id).toBe(ID);
    expect(r.ok && r.valor.saved_by_name).toBe("Ana");
    expect(f.sb.from).toHaveBeenCalledWith("estimator_competitor_extracts");
    expect(f.conflicto()).toBe("file_id");
    expect(f.subido()).toMatchObject({ file_id: ID, competitor: "Rival" });
  });
  it("cero filas sin error (la política no dejó) no es «guardado»", async () => {
    const r = await almacenDeLecturasDeLaBase(falso({ filas: [] }).sb).guardar(ID, lectura({ items: [prod()] }));
    expect(r.ok).toBe(false);
    expect(!r.ok && r.sinTabla).toBe(false);
  });
  it("sin la 161 (PGRST205) cargar y guardar dicen sinTabla, no un error", async () => {
    const e = { code: "PGRST205", message: "Could not find the table" };
    const c = await almacenDeLecturasDeLaBase(falso({ error: e }).sb).cargar([ID]);
    expect(!c.ok && c.sinTabla).toBe(true);
    const sinArchivos = await almacenDeLecturasDeLaBase(falso({ error: e }).sb).cargar([]);
    expect(!sinArchivos.ok && sinArchivos.sinTabla).toBe(true);
    const g = await almacenDeLecturasDeLaBase(falso({ error: e }).sb).guardar(ID, lectura({ items: [prod()] }));
    expect(!g.ok && g.sinTabla).toBe(true);
  });
  it("cargar pide las de esos archivos y las devuelve por file_id", async () => {
    const f = falso();
    const r = await almacenDeLecturasDeLaBase(f.sb).cargar([ID, "otro"]);
    expect(f.ids()).toEqual([ID, "otro"]);
    expect(r.ok && Object.keys(r.valor)).toEqual([ID]);
    expect(r.ok && r.valor[ID].total).toBe(99.5);
  });
  it("una fila con un jsonb raro no rompe la lista", () => {
    expect(lecturaDeFila({ file_id: ID, items: "roto" })).toBeNull();
    expect(lecturaDeFila({ file_id: ID, items: [{ description: "x", quantity: "muchas" }], source: "otro" })).toMatchObject({ source: "manual", items: [{ quantity: null }] });
  });
  it("leer llama a la ruta del servidor con el id del archivo, nunca a Anthropic desde el navegador", async () => {
    const pedir = vi.fn(async (_u: unknown, _i?: unknown) => ({ status: 200, json: async () => ({ lectura: LEIDO }) }) as unknown as Response);
    const r = await almacenDeLecturasDeLaBase(falso().sb, pedir as unknown as typeof fetch).leer(ID);
    expect(r.ok).toBe(true);
    const [url, init] = pedir.mock.calls[0] as [string, { method: string; body: string }];
    expect(url).toBe("/api/estimator/leer-competencia");
    expect(RUTA_DE_LECTURA).toBe("/api/estimator/leer-competencia");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ fileId: ID });
  });
  it("si la red falla al leer, es un error con código `red`, no una excepción", async () => {
    const pedir = vi.fn(async () => { throw new Error("offline"); });
    const r = await almacenDeLecturasDeLaBase(falso().sb, pedir as unknown as typeof fetch).leer(ID);
    expect(!r.ok && r.codigo).toBe("red");
  });
  it("una lectura sin nada no se guarda; con una fila o con la empresa, sí", () => {
    expect(lecturaEnBlanco(lecturaVacia())).toBe(true);
    expect(lecturaEnBlanco(lectura({ items: [productoVacio()] }))).toBe(true);
    expect(lecturaEnBlanco(lectura({ items: [prod()] }))).toBe(false);
    expect(lecturaEnBlanco(lectura({ competitor: "Rival" }))).toBe(false);
    expect(lecturaEnBlanco(lectura({ total: 10 }))).toBe(false);
  });
});

// ---- empresa, lista y lado a lado ----------------------------------------------------------------------

describe("la empresa competidora y lo que enseña la lista", () => {
  it("las ya usadas: sin repetir (sin mirar mayúsculas), sin vacías, en orden", () => {
    expect(competidoresUsados(["Rival Tiles", null, " rival tiles ", "", "Floor Depot", undefined, "Acme"])).toEqual(["Acme", "Floor Depot", "Rival Tiles"]);
  });
  it("la empresa y el total corregidos en la lectura ganan a lo escrito al subir", () => {
    expect(empresaDe({ competitor: "rival" }, { competitor: "Rival Tiles LLC" })).toBe("Rival Tiles LLC");
    expect(empresaDe({ competitor: "rival" }, { competitor: null })).toBe("rival");
    expect(empresaDe({ competitor: "rival" }, undefined)).toBe("rival");
    expect(totalDe({ competitor_total: 100 }, { total: 120 })).toBe(120);
    expect(totalDe({ competitor_total: 100 }, null)).toBe(100);
    expect(totalDe({ competitor_total: null }, { total: 0 })).toBe(0);
  });
});

describe("lado a lado con la cotización propia", () => {
  const sf = { ...lineaSfVacia(), id: "l-sf", item_code: "DEMO-2448", customer_category: "24x48 Tile", requested_sf: 100, sf_per_box: 10, price_per_sf: 2.5, lower_price_per_sf: 2 };
  const lote = { ...lineaUnidadVacia(), id: "l-lote", internal_description: "Thinset", quantity: 4, unit: "ea", unit_price: 20 };
  const propias = lineasPropias([sf, lote]);
  it("cada línea propia lleva su número, su precio aplicado (con descuento), su unidad y su total", () => {
    expect(propias[0]).toEqual({ id: "l-sf", etiqueta: "1 · DEMO-2448 · 24x48 Tile", precio: 2, unidad: "SF", total: totalDeLinea(sf) });
    expect(propias[0].total).toBe(200);
    expect(propias[1]).toEqual({ id: "l-lote", etiqueta: "2 · Thinset", precio: 20, unidad: "piece", total: 80 });
  });
  it("el emparejado es el que eligió el vendedor; si la línea ya no existe, no hay", () => {
    expect(lineaEmparejada(prod({ matched_line_id: "l-lote" }), propias)?.id).toBe("l-lote");
    expect(lineaEmparejada(prod({ matched_line_id: "l-borrada" }), propias)).toBeNull();
    expect(lineaEmparejada(prod(), propias)).toBeNull();
  });
  it("la diferencia de precio solo con la misma unidad: no se compara un $/caja con un $/SF", () => {
    expect(diferenciaDePrecio(prod({ unit: "SF", unit_price: 2.19 }), propias[0])).toBe(-0.19);
    expect(diferenciaDePrecio(prod({ unit: "sf", unit_price: 1.5 }), propias[0])).toBe(0.5);
    expect(diferenciaDePrecio(prod({ unit: "box", unit_price: 24 }), propias[0])).toBeNull();
    expect(diferenciaDePrecio(prod({ unit: null, unit_price: 2 }), propias[0])).toBeNull();
    expect(diferenciaDePrecio(prod({ unit: "SF", unit_price: null }), propias[0])).toBeNull();
    expect(diferenciaDePrecio(prod({ unit: "SF", unit_price: 2 }), null)).toBeNull();
  });
});

// ---- lo que se pinta -----------------------------------------------------------------------------------

function estimado(p: Partial<EstimadoDeCompetencia> = {}): EstimadoDeCompetencia {
  return {
    id: "e1", quote_id: null, path: "general/u1/x.pdf", file_name: "x.pdf", mime_type: "application/pdf", size_bytes: 10,
    competitor: "rival", competitor_total: 100, note: null, uploaded_by: "u1", uploaded_by_name: "Ana",
    uploaded_at: "2026-10-04T10:00:00Z", customer_name: "Ana Garza", store: "RDZ Pharr", estimate_num: null, ...p,
  };
}
const guardada = (p: Partial<LecturaGuardada> = {}): LecturaGuardada => ({
  ...lectura({ competitor: "Rival Tiles LLC", total: 1987.47, source: "ocr", items: [prod(), prod({ id: "p2", description: "Grout" }), prod({ id: "p3", description: "Trim" })] }),
  file_id: "e1", saved_by_name: "Ana", saved_at: "2026-10-04T10:00:00Z", ...p,
});
const nada = () => undefined;

describe("la pantalla: subir, con cámara", () => {
  it("«Tomar foto» abre la cámara (capture) y «Elegir» acepta image/* y PDF", () => {
    const html = renderToStaticMarkup(createElement(BotonesDeArchivo, { t, apagado: false, onArchivos: nada, marca: "competencia" }));
    expect(html).toContain("Take photo");
    expect(html).toContain('capture="environment"');
    expect(html).toContain(`accept="${ACCEPT_DE_CAMARA}"`);
    expect(html).toContain(`accept="${ACCEPT_DE_COMPETENCIA}"`);
    expect(ACCEPT_DE_COMPETENCIA.startsWith("image/*,application/pdf")).toBe(true);
    expect(ACCEPT_DE_CAMARA).toBe("image/*");
    expect(html).toContain("Choose PDF or photo");
  });
  it("la lista de empresas ya usadas se ofrece al teclear (datalist)", () => {
    const html = renderToStaticMarkup(createElement(ListaDeCompetidores, { nombres: ["Acme", "Rival Tiles"] }));
    expect(html).toContain(`<datalist id="${LISTA_DE_COMPETIDORES}"`);
    expect(html).toContain('value="Rival Tiles"');
    for (const r of ["src/app/estimator/Competencia.tsx", "src/app/estimator/EstimadosCompetencia.tsx", "src/app/estimator/ProductosCompetencia.tsx"]) {
      expect(leer(r), r).toContain("list={LISTA_DE_COMPETIDORES}");
    }
  });
});

describe("la pantalla: la lista dice empresa, total y nº de productos", () => {
  const pinta = (lecturas?: Record<string, LecturaGuardada>, abierto: string | null = null) => renderToStaticMarkup(createElement(ListaDeEstimados, {
    estimados: [estimado()], me: { id: "u1", name: "Ana", admin: false }, t, lang: "en", confirmando: null, ocupado: false,
    onAbrir: nada, onQuitar: nada, onConfirmar: nada, lecturas, abierto, onProductos: nada,
    detalle: (e: EstimadoDeCompetencia) => createElement("div", { "data-detalle": e.id }, "TABLA"),
  }));
  it("con productos guardados: la empresa y el total de la lectura, y cuántos productos", () => {
    const html = pinta({ e1: guardada() });
    expect(html).toContain("<b data-estimado-empresa=\"true\">Rival Tiles LLC</b>");
    expect(html).toContain("$1,987.47");
    expect(html).toContain("3 product(s)");
    expect(html).toContain("Products (3)");
  });
  it("sin productos guardados: lo escrito al subir, y el botón sin número", () => {
    const html = pinta({});
    expect(html).toContain("<b data-estimado-empresa=\"true\">rival</b>");
    expect(html).toContain("$100.00");
    expect(html).not.toContain("product(s)");
    expect(html).toContain("Products</button>");
  });
  it("el estimado abierto enseña su tabla; los demás no", () => {
    expect(pinta({ e1: guardada() }, "e1")).toContain("data-detalle=\"e1\"");
    expect(pinta({ e1: guardada() }, null)).not.toContain("data-detalle");
    expect(pinta({ e1: guardada() }, "otro")).not.toContain("data-detalle");
  });
  it("en la cotización, la misma lista dice lo mismo", () => {
    const html = renderToStaticMarkup(createElement(ListaDeCompetencia, {
      archivos: [estimado()], me: { id: "u1", name: "Ana", admin: false }, t, lang: "en", confirmando: null, ocupado: false,
      onAbrir: nada, onQuitar: nada, onConfirmar: nada, lecturas: { e1: guardada() }, abierto: "e1", onProductos: nada,
      detalle: () => createElement("div", { "data-detalle": "x" }, "TABLA"),
    }));
    expect(html).toContain("<b data-competencia-empresa=\"true\">Rival Tiles LLC</b>");
    expect(html).toContain("3 product(s)");
    expect(html).toContain("data-detalle");
  });
});

describe("la pantalla: la tabla de productos", () => {
  const sf = { ...lineaSfVacia(), id: "l-sf", item_code: "DEMO-2448", requested_sf: 100, sf_per_box: 10, price_per_sf: 2.5 };
  const propias = lineasPropias([sf]);
  const l = lectura({ items: [prod({ sku: "RT-1", quantity: 500, unit: "SF", unit_price: 2.19, line_total: 1095, matched_line_id: "l-sf" }), prod({ id: "p2", description: "Grout", brand: null })] });
  it("editable: un campo por dato, quitar fila y elegir la línea propia", () => {
    const html = renderToStaticMarkup(createElement(TablaDeProductos, { lectura: l, editable: true, propias, t }));
    expect(html).toContain('data-prod="description"');
    expect(html).toContain('value="Tile 24x48"');
    expect(html).toContain('data-prod="unit_price"');
    expect(html).toContain("data-prod-quitar");
    expect(html).toContain("data-emparejar");
    expect(html).toContain("— not matched —");
    expect(html).toContain("1 · DEMO-2448");
  });
  it("solo lectura: sin campos ni botones, y lo no leído como «—»", () => {
    const html = renderToStaticMarkup(createElement(TablaDeProductos, { lectura: l, editable: false, t }));
    expect(html).not.toContain("<input");
    expect(html).not.toContain("data-prod-quitar");
    expect(html).toContain('<span data-prod="brand">—</span>');
    expect(html).toContain("$2.19");
    expect(html).toContain("$1,095.00");
  });
  it("lado a lado solo en la fila emparejada: lo suyo, lo nuestro y la diferencia", () => {
    const html = renderToStaticMarkup(createElement(TablaDeProductos, { lectura: l, editable: true, propias, t }));
    expect(html.match(/data-lado-a-lado/g) ?? []).toHaveLength(1);
    expect(html).toContain('data-lado-a-lado="p1"');
    expect(html).toContain("Theirs");
    expect(html).toContain("Ours (1 · DEMO-2448)");
    expect(html).toContain("We are $0.31 / SF higher");
  });
  it("sin líneas propias (la pestaña) no hay columna de emparejar ni lado a lado", () => {
    const html = renderToStaticMarkup(createElement(TablaDeProductos, { lectura: l, editable: true, t }));
    expect(html).not.toContain("data-emparejar");
    expect(html).not.toContain("data-lado-a-lado");
  });
  it("sin productos lo dice; sin la 161, también", () => {
    expect(renderToStaticMarkup(createElement(TablaDeProductos, { lectura: lecturaVacia(), editable: true, t }))).toContain("No products yet.");
    expect(renderToStaticMarkup(createElement(AvisoSin161, { t }))).toContain("migration 161");
  });
});

describe("la pantalla usa estas piezas", () => {
  const pantalla = leer("src/app/estimator/Estimador.tsx");
  const seccion = leer("src/app/estimator/Competencia.tsx");
  const pestana = leer("src/app/estimator/EstimadosCompetencia.tsx");
  const panel = leer("src/app/estimator/ProductosCompetencia.tsx");
  const ruta = leer("src/app/api/estimator/leer-competencia/route.ts");
  it("el Quote Builder pasa el almacén de lecturas y las líneas propias a la sección, y el almacén a la pestaña", () => {
    expect(pantalla).toContain("demo ? almacenDeLecturasDemo(() => meRef.current, { sin161: sin161Demo, sinLlave: sinLlaveDemo }) : almacenDeLecturasDeLaBase(createClient())");
    expect(pantalla).toContain("const propias = useMemo(() => lineasPropias(draft.lines), [draft.lines]);");
    expect(pantalla).toContain("lecturas={almacenLecturas} propias={propias}");
    expect(pantalla).toContain("<EstimadosCompetencia almacen={almacenCompetencia} lecturas={almacenLecturas} me={me} t={t} lang={lang}");
    expect(pantalla).toContain("guardarCotizacion={{ puede: !ocupado && puedeGuardar(draft, estado), hacer: () => void guardar() }} />");
  });
  it("la sección y la pestaña cargan las lecturas de sus archivos y abren la tabla de cada uno", () => {
    expect(seccion).toContain("const l = await almacenLecturas.cargar(r.valor.map((a) => a.id));");
    expect(pestana).toContain("const l = await almacenLecturas.cargar(r.valor.map((e) => e.id));");
    for (const f of [seccion, pestana]) {
      expect(f).toContain("lecturas={lecturas} abierto={abierto} onProductos={setAbierto}");
      expect(f).toContain("base161 === false ? <AvisoSin161 t={t} /> : (");
      expect(f).toContain("else if (l.sinTabla) setBase161(false);");
      expect(f).toContain("<BotonesDeArchivo t={t}");
    }
    expect(seccion).toContain("puedeEditar={puedeQuitar(a, me)} propias={propias} t={t}");
    expect(pestana).toContain("puedeEditar={puedeQuitar(e, me)} t={t}");
  });
  it("el panel: «Leer productos» pide la lectura, la deja sin guardar, y «Guardar» la guarda", () => {
    expect(panel).toContain("const r = await almacen.leer(archivo.id);");
    expect(panel).toContain("const r = await almacen.guardar(archivo.id, borrador);");
    expect(panel).toContain("if (!puedeEditar || guardando || lecturaEnBlanco(borrador)) return;");
    expect(panel).toContain("if (!puedeEditar || leyendo) return;");
    expect(panel).toContain("mensajeDeLectura(r.codigo, r.error, t)");
    expect(panel).toContain('if (r.codigo === "sin-161") { onSin161(); return; }');
    expect(panel).toContain("data-leer-productos");
    expect(panel).toContain("data-guardar-productos");
    expect(panel).toContain("cambia({ items: [...borrador.items, productoVacio()] })");
    expect(panel).toContain("<TablaDeProductos key={`tabla-${version}`} lectura={borrador} editable={puedeEditar} propias={propias} t={t}");
  });
  it("la ruta exige sesión, usa la llave de servidor (sin NEXT_PUBLIC) y deja la decisión a leerCompetencia", () => {
    expect(ruta).toContain("const auth = await requireUser();");
    expect(ruta).toContain("if (!auth.ok) return auth.response;");
    expect(ruta).toContain("const r = await leerCompetencia(body.fileId, {");
    expect(ruta).toContain("ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,");
    expect(ruta).not.toContain("NEXT_PUBLIC_ANTHROPIC");
    // La fila del archivo, con la sesión; solo los bytes, con la llave de servicio.
    expect(ruta).toContain('const { data } = await auth.supabase\n          .from("estimator_competitor_files")');
    expect(ruta).toContain("servicio().storage.from(CUBO_DE_COMPETENCIA).download(path)");
    expect(ruta).toContain('const TABLA_DE_REGISTRO = "estimator_competitor_reads";');
  });
  it("la llave no llega a ningún fichero del navegador", () => {
    for (const r of ["src/lib/estimator/lectura.ts", "src/app/estimator/ProductosCompetencia.tsx", "src/app/estimator/Competencia.tsx",
      "src/app/estimator/EstimadosCompetencia.tsx", "src/app/estimator/Estimador.tsx", "src/lib/estimator/demo.ts"]) {
      const f = leer(r);
      expect(f, r).not.toContain("process.env.ANTHROPIC");
      expect(f, r).not.toMatch(/from "[^"]*lectura-servidor"/);
      expect(f, r).not.toContain("api.anthropic.com");
    }
  });
});

describe("interno: nada de esto llega a la hoja del cliente (D-425)", () => {
  it("ni hoja.ts ni HojaCliente.tsx conocen las lecturas", () => {
    for (const r of ["src/lib/estimator/hoja.ts", "src/app/estimator/HojaCliente.tsx"]) {
      expect(leer(r), r).not.toMatch(/lectura|Lectura|ProductosCompetencia|competitor|extract/);
    }
  });
  it("en la cotización, la tabla de productos vive dentro de la sección que el @media print quita", () => {
    const seccion = leer("src/app/estimator/Competencia.tsx");
    const card = seccion.indexOf("className={`card est-competencia");
    expect(card).toBeGreaterThan(-1);
    expect(seccion.indexOf("<ProductosDeCompetencia ")).toBeGreaterThan(card);
    const css = leer("src/app/estimator/estimator.css");
    expect(css.slice(css.indexOf("@media print"))).toContain(".est-competencia, .est-competencia * { display: none !important; }");
    const pantalla = leer("src/app/estimator/Estimador.tsx");
    expect(pantalla.slice(pantalla.indexOf("data-vista-previa"))).not.toMatch(/Competencia|propias|Lecturas/);
  });
});

describe("el demo", () => {
  const yo = () => ({ id: "u-admin", name: "You (Admin)", admin: true });
  it("«lee» un estimado inventado, sin red, con campos sin leer", async () => {
    const r = await almacenDeLecturasDemo(yo).leer("x");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.lectura.competitor).toBe(LECTURA_DEMO.competitor);
    expect(r.lectura.items).toHaveLength(3);
    expect(r.lectura.items[1]).toMatchObject({ brand: null, sku: null, unit: "box" });
    expect(r.lectura.items[2]).toMatchObject({ unit: "piece", unit_price: null, line_total: null });
  });
  it("guarda y vuelve a cargar, a nombre de quien guarda", async () => {
    const a = almacenDeLecturasDemo(yo);
    const g = await a.guardar("f1", lectura({ competitor: "Rival", items: [prod()] }));
    expect(g.ok && g.valor.saved_by_name).toBe("You (Admin)");
    const c = await a.cargar(["f1", "f2"]);
    expect(c.ok && Object.keys(c.valor)).toEqual(["f1"]);
  });
  it("?sinLlave=1: leer dice sin-llave y guardar a mano sigue", async () => {
    const a = almacenDeLecturasDemo(yo, { sinLlave: true });
    const r = await a.leer("x");
    expect(!r.ok && r.codigo).toBe("sin-llave");
    expect((await a.guardar("f1", lectura({ items: [prod()] }))).ok).toBe(true);
  });
  it("?sin161=1: nada se carga ni se guarda, como la base sin la 161", async () => {
    const a = almacenDeLecturasDemo(yo, { sin161: true });
    const c = await a.cargar([]);
    expect(!c.ok && c.sinTabla).toBe(true);
    const g = await a.guardar("f1", lectura({ items: [prod()] }));
    expect(!g.ok && g.sinTabla).toBe(true);
    const r = await a.leer("x");
    expect(!r.ok && r.codigo).toBe("sin-161");
  });
});

describe("la migración 161", () => {
  const SQL = leer("supabase/migrations/161_competencia_productos.sql");
  const cuerpo = SQL.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
  const politica = (nombre: string) => {
    const i = cuerpo.indexOf(`create policy "${nombre}"`);
    expect(i, nombre).toBeGreaterThan(-1);
    return cuerpo.slice(i, cuerpo.indexOf(";", i));
  };
  it("se para con un mensaje claro si la 156 no está", () => {
    expect(cuerpo).toContain("column_name = 'customer_name'");
    expect(cuerpo).toContain("raise exception '161: falta la migracion 156 (estimator_competitor_files no tiene customer_name). Aplica la 156 antes que la 161.';");
    expect(cuerpo.indexOf("161: falta la migracion 156")).toBeLessThan(cuerpo.indexOf("create table"));
  });
  it("los productos: una fila por archivo, que se va con él, con el mismo techo que la pantalla", () => {
    expect(cuerpo).toContain("file_id        uuid primary key references public.estimator_competitor_files(id) on delete cascade,");
    expect(cuerpo).toContain(`jsonb_typeof(items) = 'array' and jsonb_array_length(items) <= ${TOPES_DE_LECTURA.maxProductos} and`);
    expect(cuerpo).toContain("check (source in ('ocr', 'manual'))");
  });
  it("VER: con el módulo. GUARDAR y CORREGIR: quien subió el archivo o el admin. Sin DELETE", () => {
    expect(politica("estimator_competitor_extracts select")).toContain("using ((select public.has_estimator_access()))");
    for (const p of ["estimator_competitor_extracts insert", "estimator_competitor_extracts update"]) {
      const texto = politica(p);
      expect(texto, p).toContain("(select public.has_estimator_access())");
      expect(texto, p).toContain("and ((select public.is_admin())");
      expect(texto, p).toContain("or exists (select 1 from public.estimator_competitor_files f where f.id = file_id and f.uploaded_by = (select auth.uid())))");
    }
    expect(cuerpo).toContain("grant select, insert, update on public.estimator_competitor_extracts to authenticated;");
    expect(cuerpo).not.toMatch(/for (delete|all)\b/i);
  });
  it("quién guarda lo pone el disparador, no el navegador, y la lectura no se muda de archivo", () => {
    expect(cuerpo).toContain("new.saved_by := yo;");
    expect(cuerpo).toContain("new.file_id := old.file_id;");
    expect(cuerpo).toContain("create trigger estimator_competitor_extracts_guard before insert or update on public.estimator_competitor_extracts");
  });
  it("el registro de lecturas: nadie con sesión lo escribe (de él sale el tope); lo ve el admin y cada uno lo suyo", () => {
    expect(cuerpo).toContain("grant select on public.estimator_competitor_reads to authenticated;");
    expect(cuerpo).not.toMatch(/grant [a-z, ]*(insert|update|delete)[a-z, ]* on public\.estimator_competitor_reads/);
    expect(politica("estimator_competitor_reads select")).toContain("using ((select public.is_admin()) or ((select public.has_estimator_access()) and read_by = (select auth.uid())))");
    expect(cuerpo.match(/create policy "estimator_competitor_reads/g) ?? []).toHaveLength(1);
    expect(cuerpo).toContain("file_id        uuid references public.estimator_competitor_files(id) on delete set null,");
  });
  it("las columnas del registro son las que escribe la ruta", () => {
    for (const c of ["file_id", "file_name", "read_by", "read_by_name", "read_at", "model", "pages", "bytes", "input_tokens", "output_tokens", "status", "error"]) {
      expect(cuerpo, c).toMatch(new RegExp(`\\n  ${c}\\s+(uuid|text|timestamptz|integer|bigint)`));
    }
    expect(cuerpo).toContain("check (status in ('started', 'ok', 'error'))");
  });
  it("sin begin/commit propios, y el registro con el checksum del cuerpo", () => {
    expect(cuerpo).not.toMatch(/^\s*(begin|commit)\s*;/im);
    const [antes] = SQL.split("-- @ledger-below");
    const sha = createHash("sha256").update(antes).digest("hex");
    expect(SQL).toContain(`values ('161_competencia_productos.sql', '${sha}')`);
  });
});
