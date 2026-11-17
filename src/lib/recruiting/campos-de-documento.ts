/**
 * Los campos de un documento de ingreso: el texto RESALTADO EN AMARILLO de un .docx.
 *
 * Así lo quiere el dueño: en Word se marca en amarillo lo que cambia por persona («Effective Date», «Position», la
 * hora, el pago), y la app lo detecta, le pregunta a RR. HH. el valor y lo escribe quitándole el amarillo.
 *
 *   · Un grupo = runs amarillos SEGUIDOS dentro de un párrafo (un solo campo aunque Word lo parta en varios runs).
 *   · La etiqueta es el texto del párrafo antes del campo, hasta los dos puntos («Base Pay: » → «Base Pay»).
 *   · La clave sugerida (start_date, position, weekly_hours, pay_rate, employee_name, store, otro) se decide por la
 *     etiqueta y, si hace falta, por el texto que sigue al campo («40 hours per week» → weekly_hours).
 *   · Los campos con la MISMA clave comparten un solo valor en el formulario («Applies to» y «Position» = position).
 *
 * Solo cuenta el amarillo (`yellow` o relleno FFFF00). El gris claro (`lightGray`), que Word usa en el resto del
 * documento, NO es un campo.
 *
 * Todo puro (pizzip corre en el navegador y en Node). Los marcadores {{...}} de docxtemplater son un camino secundario
 * y se resuelven en `imprimir-documento.ts`.
 */

import PizZip from "pizzip";

export type ClaveDeCampo = "start_date" | "position" | "weekly_hours" | "pay_rate" | "employee_name" | "store" | "otro";

export type CampoDetectado = {
  /** Estable dentro de una versión del archivo: `p<párrafo>-g<grupo>`. */
  id: string;
  /** El texto amarillo tal cual está en el documento. */
  original: string;
  /** Lo que hay antes del campo en su párrafo, sin los dos puntos finales. */
  etiqueta: string;
  clave: ClaveDeCampo;
};

const RE_PARRAFO = /<w:p[ >][\s\S]*?<\/w:p>/g;
const RE_RUN = /<w:r[ >][\s\S]*?<\/w:r>/g;

/** ¿El run es amarillo? Mira solo sus propias propiedades (`w:rPr`), no las del párrafo. */
export function esRunAmarillo(run: string): boolean {
  const rPr = run.match(/<w:rPr>[\s\S]*?<\/w:rPr>/)?.[0] ?? "";
  return /<w:highlight w:val="yellow"\s*\/>/.test(rPr) || /<w:shd\b[^>]*w:fill="FFFF00"[^>]*\/>/i.test(rPr);
}

function textoDeRun(run: string): string {
  const partes = [...run.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g)].map((m) => desescapa(m[1]));
  return partes.join("");
}

function desescapa(s: string): string {
  return s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&apos;/g, "'").replace(/&amp;/g, "&");
}

function escapa(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Quita acentos y pasa a minúsculas, para las reglas de la clave. */
function norm(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/**
 * La clave sugerida de un campo. El orden de las reglas importa: «Base Pay … per hour» es pago, no horas; «Employment
 * Type … hours per week» es horas.
 */
export function claveSugerida(etiqueta: string, despues = "", original = ""): ClaveDeCampo {
  const e = norm(etiqueta);
  const d = norm(despues);
  if (/pay|rate|wage|salary|compens|sueldo|pago|tarifa/.test(e)) return "pay_rate";
  if (/hours?|hora/.test(e) || (/hours?|hora/.test(d) && /^\s*\d+\s*$/.test(original.trim()))) return "weekly_hours";
  if (/date|effective|start|ingreso|fecha|inicio/.test(e)) return "start_date";
  if (/position|applies|title|role|puesto|cargo|job/.test(e)) return "position";
  if (/employee|empleado|nombre|name/.test(e)) return "employee_name";
  if (/store|location|tienda|sucursal/.test(e)) return "store";
  return "otro";
}

/** La clave que decide QUÉ valor pide el formulario: campos con la misma clave comparten uno; «otro» pide el suyo. */
export function claveDeEntrada(campo: Pick<CampoDetectado, "id" | "clave">): string {
  return campo.clave === "otro" ? campo.id : campo.clave;
}

type Grupo = { inicio: number; fin: number; original: string; etiqueta: string; despues: string; clave: ClaveDeCampo; id: string; runs: number[] };

/**
 * Parte un párrafo en sus runs y arma sus grupos amarillos. Devuelve también las posiciones de los runs para poder
 * reescribir el párrafo sin tocar lo demás.
 */
function gruposDelParrafo(parrafo: string, indiceParrafo: number): { runs: { inicio: number; fin: number; xml: string; amarillo: boolean }[]; grupos: Grupo[] } {
  const runs = [...parrafo.matchAll(RE_RUN)].map((m) => ({
    inicio: m.index ?? 0, fin: (m.index ?? 0) + m[0].length, xml: m[0], amarillo: esRunAmarillo(m[0]),
  }));
  const grupos: Grupo[] = [];
  let k = 0;
  let textoAntes = "";
  while (k < runs.length) {
    if (!runs[k].amarillo) { textoAntes += textoDeRun(runs[k].xml); k++; continue; }
    const idx: number[] = [];
    while (k < runs.length && runs[k].amarillo) { idx.push(k); k++; }
    const original = idx.map((i) => textoDeRun(runs[i].xml)).join("");
    // Lo que sigue al campo en su párrafo (para «hours per week»), hasta el siguiente amarillo.
    let despues = "";
    for (let j = k; j < runs.length && despues.length < 40; j++) {
      if (runs[j].amarillo) break;
      despues += textoDeRun(runs[j].xml);
    }
    const etiqueta = etiquetaDe(textoAntes);
    grupos.push({
      inicio: idx[0], fin: idx[idx.length - 1], original, etiqueta, despues,
      clave: claveSugerida(etiqueta, despues, original),
      id: `p${indiceParrafo}-g${grupos.length}`,
      runs: idx,
    });
    textoAntes += original;
  }
  return { runs, grupos };
}

/** Lo que va antes de los dos puntos, o los últimos 60 caracteres si no los hay. */
function etiquetaDe(antes: string): string {
  const limpio = antes.replace(/\s+/g, " ").trim();
  const dosPuntos = limpio.indexOf(":");
  if (dosPuntos >= 0) return limpio.slice(0, dosPuntos).trim();
  return limpio.slice(-60).trim();
}

/** Los párrafos del documento, en orden, con su XML. */
function parrafos(xml: string): string[] {
  return xml.match(RE_PARRAFO) ?? [];
}

/** Campos detectados en el XML de `word/document.xml`. */
export function camposDeXml(xml: string): CampoDetectado[] {
  const salida: CampoDetectado[] = [];
  parrafos(xml).forEach((p, i) => {
    const { grupos } = gruposDelParrafo(p, i);
    for (const g of grupos) salida.push({ id: g.id, original: g.original, etiqueta: g.etiqueta, clave: g.clave });
  });
  return salida;
}

/** Campos detectados en un .docx (sus bytes). Lanza si no es un .docx válido. */
export function camposDeDocx(bytes: ArrayBuffer | Uint8Array): CampoDetectado[] {
  return camposDeXml(leeDocumentXml(bytes));
}

function leeDocumentXml(bytes: ArrayBuffer | Uint8Array): string {
  const zip = new PizZip(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));
  const f = zip.file("word/document.xml");
  if (!f) throw new Error("No es un .docx: falta word/document.xml");
  return f.asText();
}

/** Reescribe un run: pone `texto` en el primero del grupo (`texto` puede ser null = vaciarlo) y le quita el amarillo. */
function reescribeRun(run: string, texto: string | null): string {
  let r = run;
  if (texto === null) {
    r = r.replace(/<w:t(?:\s[^>]*)?>[^<]*<\/w:t>/g, "");
  } else {
    let puesto = false;
    r = r.replace(/<w:t(?:\s[^>]*)?>[^<]*<\/w:t>/g, () => {
      if (puesto) return "";
      puesto = true;
      return `<w:t xml:space="preserve">${escapa(texto)}</w:t>`;
    });
    if (!puesto) r = r.replace(/<\/w:r>$/, `<w:t xml:space="preserve">${escapa(texto)}</w:t></w:r>`);
  }
  // Sin amarillo: el documento impreso no debe conservar el resaltado del campo.
  r = r.replace(/<w:highlight w:val="yellow"\s*\/>/g, "");
  r = r.replace(/<w:shd\b[^>]*\/>/g, (s) => (/w:fill="FFFF00"/i.test(s) ? "" : s));
  return r;
}

/**
 * El marcador que ocupa el campo número `n` (1, 2, 3…, en el orden de `camposDeXml`) cuando el documento se convierte a
 * HTML para verlo. Caracteres que Word no usa en un texto normal, así que no se confunden con nada del documento.
 */
export function marcadorDeCampo(n: number): string {
  return `⟦F${n}⟧`;
}

/**
 * Reescribe cada campo amarillo con el texto que devuelve `texto(campo, n)`, donde `n` es su número de orden en el
 * documento (el mismo que `marcadorDeCampo`). El texto va en el primer run del grupo, los demás se vacían y el amarillo
 * se quita. Lo que no es campo queda igual, byte a byte.
 */
export function reemplazaCamposEnXml(
  xml: string,
  texto: (campo: { id: string; original: string; etiqueta: string; clave: ClaveDeCampo }, n: number) => string,
): string {
  let indice = -1;
  let n = 0;
  return xml.replace(RE_PARRAFO, (parrafo) => {
    indice++;
    const { runs, grupos } = gruposDelParrafo(parrafo, indice);
    if (!grupos.length) return parrafo;
    const nuevoXml = new Map<number, string>();
    for (const g of grupos) {
      n++;
      const valor = texto(g, n);
      g.runs.forEach((ri, k) => {
        nuevoXml.set(ri, reescribeRun(runs[ri].xml, k === 0 ? valor : null));
      });
    }
    // Se reconstruye el párrafo cortando por posiciones, para no tocar nada fuera de los runs del campo.
    let salida = "";
    let cursor = 0;
    runs.forEach((r, ri) => {
      salida += parrafo.slice(cursor, r.inicio);
      salida += nuevoXml.get(ri) ?? r.xml;
      cursor = r.fin;
    });
    salida += parrafo.slice(cursor);
    return salida;
  });
}

/**
 * Escribe los valores en los campos amarillos. `valores` se indexa por la CLAVE DE ENTRADA (`claveDeEntrada`):
 * «position» vale para «Applies to» y «Position» a la vez. Un campo sin valor conserva su texto original.
 */
export function aplicaValoresAXml(xml: string, valores: Record<string, string>): string {
  return reemplazaCamposEnXml(xml, (g) => valores[claveDeEntrada(g)] ?? g.original);
}

/** El XML con un marcador ⟦Fn⟧ en cada campo amarillo (ver `marcadorDeCampo`). Para verlo convertido a HTML. */
export function marcaCamposAXml(xml: string): string {
  return reemplazaCamposEnXml(xml, (_g, n) => marcadorDeCampo(n));
}

/** Un .docx con los valores puestos. Devuelve los bytes nuevos; el resto del archivo viaja igual. */
export function aplicaValoresADocx(bytes: ArrayBuffer | Uint8Array, valores: Record<string, string>): Uint8Array {
  return reescribeDocumentXml(bytes, (xml) => aplicaValoresAXml(xml, valores));
}

/** Un .docx con un marcador ⟦Fn⟧ en cada campo amarillo. Los bytes nuevos; el resto del archivo viaja igual. */
export function marcaCamposDocx(bytes: ArrayBuffer | Uint8Array): Uint8Array {
  return reescribeDocumentXml(bytes, marcaCamposAXml);
}

function reescribeDocumentXml(bytes: ArrayBuffer | Uint8Array, cambia: (xml: string) => string): Uint8Array {
  const zip = new PizZip(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));
  const f = zip.file("word/document.xml");
  if (!f) throw new Error("No es un .docx: falta word/document.xml");
  zip.file("word/document.xml", cambia(f.asText()));
  return zip.generate({ type: "uint8array", compression: "DEFLATE" });
}

// ---- Valores sugeridos por clave -----------------------------------------------------------------------------------

/** Fecha «AAAA-MM-DD» → «MM/DD/YYYY», el formato del documento de comisiones. */
export function fechaMDY(iso: string | null | undefined): string {
  const m = (iso ?? "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[2]}/${m[3]}/${m[1]}` : "";
}

/** Pago por hora → «$11» (sin decimales si son enteros). Vacío si no hay número. */
export function pagoFormateado(tarifa: number | string | null | undefined): string {
  if (tarifa === null || tarifa === undefined || tarifa === "") return "";
  const n = Number(tarifa);
  if (!Number.isFinite(n)) return "";
  return `$${Number.isInteger(n) ? n : n.toFixed(2)}`;
}

/**
 * El valor que se propone para cada CLAVE DE ENTRADA, a partir de los datos del empleado. Lo que no hay queda como el
 * texto original del documento (el formulario lo muestra y RR. HH. lo cambia si hace falta).
 */
export function valoresSugeridos(
  campos: readonly CampoDetectado[],
  datos: { fullName?: string | null; position?: string | null; hireDate?: string | null; payRate?: number | string | null; store?: string | null },
): Record<string, string> {
  const salida: Record<string, string> = {};
  for (const c of campos) {
    const entrada = claveDeEntrada(c);
    if (salida[entrada] !== undefined) continue;
    let v: string | undefined;
    // Horas y pago se escriben A MANO en cada documento: nunca salen del expediente ni se guardan en él.
    // Se deja vacío (el original va solo como pista en el formulario) y son obligatorios para imprimir.
    if (c.clave === "weekly_hours" || c.clave === "pay_rate") { salida[entrada] = ""; continue; }
    switch (c.clave) {
      case "start_date": v = fechaMDY(datos.hireDate) || undefined; break;
      case "position": v = (datos.position ?? "").split(",")[0]?.trim() || undefined; break;
      case "employee_name": v = (datos.fullName ?? "").trim() || undefined; break;
      case "store": v = (datos.store ?? "").trim() || undefined; break;
      default: v = undefined;
    }
    salida[entrada] = v ?? c.original;
  }
  return salida;
}

/** Campos que RR. HH. debe escribir a mano antes de imprimir (horas y pago). */
export function clavesObligatorias(campos: readonly CampoDetectado[]): string[] {
  return [...new Set(campos.filter((c) => c.clave === "weekly_hours" || c.clave === "pay_rate").map((c) => claveDeEntrada(c)))];
}

/** Las claves obligatorias que siguen vacías. Con alguna, el botón de imprimir no se activa. */
export function faltanCampos(campos: readonly CampoDetectado[], valores: Record<string, string>): string[] {
  return clavesObligatorias(campos).filter((k) => !(valores[k] ?? "").trim());
}

/** Las etiquetas que se le enseñan a RR. HH. en la biblioteca: «Effective Date, Position, Employment Type, Base Pay». */
export function etiquetasDeCampos(campos: readonly CampoDetectado[]): string[] {
  const vistas = new Set<string>();
  const salida: string[] = [];
  for (const c of campos) {
    const e = c.etiqueta || "?";
    if (vistas.has(e)) continue;
    vistas.add(e);
    salida.push(e);
  }
  return salida;
}
