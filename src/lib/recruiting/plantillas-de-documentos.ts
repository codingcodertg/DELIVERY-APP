import { formatoDeDia } from "./hora-de-brownsville";

/**
 * Documentos de ingreso (migración 315): un documento tiene VARIANTES (por puesto u oferta), y cada empleado ve solo los
 * documentos que le tocan por su puesto.
 *
 * Todo puro: la base está en `actions/plantillas.ts`, la pantalla de la biblioteca y la ficha en `components/recruiting/`,
 * y la impresión y el relleno de marcadores en `lib/recruiting/imprimir-documento.ts`. Aquí viven las reglas que tienen
 * que ser iguales en todos esos sitios.
 */

/** Categorías que se sugieren al escribir. El campo acepta cualquier texto: esto es solo ayuda. */
export const CATEGORIAS_SUGERIDAS: readonly string[] = ["Onboarding", "Policy", "Commission", "Tax / Payroll", "Other"];

/** Lo que se acepta como archivo de variante: el documento que RR. HH. edita y luego manda a firmar. */
export const EXTENSIONES_VARIANTE: readonly string[] = ["docx", "pdf", "xlsx"];

/** Lo que se acepta como copia firmada: lo que devuelve la persona, escaneado o fotografiado. */
export const EXTENSIONES_FIRMADO: readonly string[] = ["pdf", "docx", "xlsx", "jpg", "jpeg", "png", "webp", "heic"];

export const MAX_BYTES_VARIANTE = 20 * 1024 * 1024;
export const MAX_BYTES_FIRMADO = 25 * 1024 * 1024;

/** Tipo MIME por extensión. El navegador a veces lo pone mal (o vacío); aquí se decide por el nombre. */
const MIME_POR_EXTENSION: Record<string, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  heic: "image/heic",
};

export type EstadoDocumento = "pending" | "sent" | "signed" | "na";

/** Los estados, con su etiqueta bilingüe. El orden es el del menú. */
export const ESTADOS_DOCUMENTO: readonly { key: EstadoDocumento; en: string; es: string }[] = [
  { key: "pending", en: "Pending", es: "Pendiente" },
  { key: "sent", en: "Sent", es: "Enviado" },
  { key: "signed", en: "Signed", es: "Firmado" },
  { key: "na", en: "Not applicable", es: "No aplica" },
];

export function esEstadoDocumento(v: unknown): v is EstadoDocumento {
  return typeof v === "string" && ESTADOS_DOCUMENTO.some((e) => e.key === v);
}

/** Quita acentos, pasa a minúsculas y colapsa espacios, para comparar textos sin que importen. */
export function normalizaTexto(s: string | null | undefined): string {
  return (s ?? "")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase().replace(/\s+/g, " ").trim();
}

/** Extensión en minúsculas, sin punto, o «» si no tiene. */
export function extensionDe(nombre: string): string {
  const limpio = (nombre ?? "").split(/[\\/]/).pop() ?? "";
  const punto = limpio.lastIndexOf(".");
  if (punto <= 0 || punto === limpio.length - 1) return "";
  return limpio.slice(punto + 1).toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 8);
}

/**
 * Nombre de archivo seguro para guardarlo en el cubo: sin acentos, sin espacios ni símbolos, sin rutas (`../`), con la
 * extensión en minúsculas y largo acotado. Si no queda nada usable, «archivo».
 *
 * «Política de comisiones (2026) final.DOCX» → «Politica-de-comisiones-2026-final.docx»
 */
export function sanitizaNombreDeArchivo(nombre: string): string {
  const ext = extensionDe(nombre);
  const sinRuta = (nombre ?? "").split(/[\\/]/).pop() ?? "";
  const sinExt = ext ? sinRuta.slice(0, sinRuta.length - ext.length - 1) : sinRuta;
  const base = sinExt
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/\.{2,}/g, ".")
    .replace(/^[-.]+|[-.]+$/g, "")
    .slice(0, 100)
    .replace(/[-.]+$/g, "");
  const nombreBase = base || "archivo";
  return ext ? `${nombreBase}.${ext}` : nombreBase;
}

/** ¿La extensión del archivo está entre las permitidas? */
export function extensionPermitida(nombre: string, permitidas: readonly string[]): boolean {
  const ext = extensionDe(nombre);
  return !!ext && permitidas.includes(ext);
}

/** Tipo MIME para subirlo: el que corresponde a su extensión, o «application/octet-stream». */
export function mimePorNombre(nombre: string): string {
  return MIME_POR_EXTENSION[extensionDe(nombre)] ?? "application/octet-stream";
}

/** Un id de la base (uuid) con la forma correcta. Así no entra texto libre en una ruta del cubo. */
export function esIdValido(id: string | null | undefined): id is string {
  return typeof id === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
}

/** Ruta de una versión de variante en el cubo: `templates/<variante>/<versión>-<nombre>`. */
export function rutaDeVariante(variantId: string, version: number, nombre: string): string {
  return `templates/${variantId}/${version}-${sanitizaNombreDeArchivo(nombre)}`;
}

/** Ruta de una copia firmada: `employees/<empleado>/signed/<documento>-<marca>-<nombre>`. */
export function rutaDeFirmado(employeeId: string, templateId: string, marca: number, nombre: string): string {
  return `employees/${employeeId}/signed/${templateId}-${marca}-${sanitizaNombreDeArchivo(nombre)}`;
}

/** ¿La ruta es de una variante, o de una copia firmada de ESTE empleado (y, si se pide, de este documento)? */
export function rutaPermitida(path: string, employeeId?: string | null, templateId?: string | null): boolean {
  if (!path || path.includes("..")) return false;
  if (path.startsWith("templates/")) return true;
  if (!path.startsWith("employees/")) return false;
  if (!employeeId) return /^employees\/[0-9a-f-]{36}\/signed\//i.test(path);
  const prefijo = `employees/${employeeId}/signed/` + (templateId ? `${templateId}-` : "");
  return path.startsWith(prefijo);
}

/**
 * ¿El puesto del empleado está entre los puestos de la variante? El puesto del expediente puede llevar varios separados
 * por coma («Cashier, Junior Sales Representative»), y cada uno se compara sin acentos ni mayúsculas.
 */
export function coincidePuesto(puestosDeVariante: readonly string[] | string | null | undefined, puestoDelEmpleado: string | null | undefined): boolean {
  const lista = typeof puestosDeVariante === "string" ? [puestosDeVariante] : (puestosDeVariante ?? []);
  const buscados = (puestoDelEmpleado ?? "").split(",").map(normalizaTexto).filter(Boolean);
  if (!buscados.length) return false;
  return lista.some((p) => buscados.includes(normalizaTexto(p)));
}

/** Una variante de un documento, como la lee la pantalla. */
export type VarianteDeDocumento = {
  id: string;
  label: string;
  positions: string[];
  offer_note: string | null;
  active: boolean;
};

/**
 * La variante que se propone para un empleado: la primera ACTIVA cuyo puesto coincide con el suyo. Si ninguna coincide,
 * null (el documento no le toca, salvo que el documento sea «para todos», y entonces la elige RR. HH. a mano).
 */
export function varianteSugerida<V extends VarianteDeDocumento>(variantes: readonly V[], puestoDelEmpleado: string | null | undefined): V | null {
  return variantes
    .filter((v) => v.active && coincidePuesto(v.positions, puestoDelEmpleado))
    .sort((a, b) => a.label.localeCompare(b.label, "es", { sensitivity: "base" }))[0] ?? null;
}

/**
 * Qué documentos ve un empleado, y con qué variante, a partir de la biblioteca completa.
 *
 *   · Un documento «para todos» (`applies_to_all`) siempre aparece; su variante sugerida es la del puesto si hay una.
 *   · Un documento normal aparece SOLO si alguna de sus variantes ACTIVAS coincide con el puesto del empleado. Si no,
 *     no aparece para esa persona (no hay fila «no aplica»: simplemente no le toca).
 *   · Las variantes que se pueden elegir a mano son solo las de ESE documento (las activas).
 */
export function documentosParaEmpleado<
  D extends { id: string; name: string; applies_to_all: boolean; active: boolean },
  V extends VarianteDeDocumento & { template_id: string },
>(
  documentos: readonly D[],
  variantes: readonly V[],
  puestoDelEmpleado: string | null | undefined,
): { documento: D; variantes: V[]; sugerida: V | null }[] {
  const salida: { documento: D; variantes: V[]; sugerida: V | null }[] = [];
  for (const d of documentos) {
    if (!d.active) continue;
    const suyas = variantes.filter((v) => v.template_id === d.id);
    const activas = suyas.filter((v) => v.active);
    const sugerida = varianteSugerida(activas, puestoDelEmpleado);
    if (!d.applies_to_all && !sugerida) continue;
    salida.push({ documento: d, variantes: activas, sugerida });
  }
  return salida;
}

/**
 * Qué variante queda marcada: la que ya se guardó para el empleado (aunque esté archivada, para no perder lo firmado),
 * si no, la sugerida por puesto, si no, ninguna.
 */
export function varianteMarcada<V extends { id: string }>(
  guardada: string | null | undefined,
  sugerida: V | null,
  variantes: readonly V[],
): V | null {
  if (guardada) {
    const v = variantes.find((x) => x.id === guardada);
    if (v) return v;
  }
  return sugerida;
}

/** Filtros de la biblioteca. Un campo vacío no filtra. */
export function filtraDocumentos<T extends { name: string; category?: string | null; description?: string | null }>(
  documentos: readonly T[],
  f: { buscar?: string; categoria?: string },
): T[] {
  const q = normalizaTexto(f.buscar);
  const cat = normalizaTexto(f.categoria);
  return documentos.filter((d) => {
    if (cat && normalizaTexto(d.category) !== cat) return false;
    if (!q) return true;
    return normalizaTexto([d.name, d.category, d.description].filter(Boolean).join(" ")).includes(q);
  });
}

/**
 * ¿Se puede pasar de `actual` a `nuevo`? Reglas:
 *   · hay que elegir un estado válido, y uno distinto del que ya tiene;
 *   · no se vuelve a «pendiente» si ya hay copia firmada subida: la firma es prueba, no se deshace con un clic.
 * Cualquier otro cambio vale (se devuelve atrás: «enviado» → «pendiente» si el correo rebotó).
 */
export function puedeCambiarEstado(
  actual: EstadoDocumento | null | undefined,
  nuevo: unknown,
  tieneCopiaFirmada: boolean,
): { ok: true } | { ok: false; motivo: "invalido" | "igual" | "con_firma" } {
  if (!esEstadoDocumento(nuevo)) return { ok: false, motivo: "invalido" };
  if ((actual ?? "pending") === nuevo) return { ok: false, motivo: "igual" };
  if (nuevo === "pending" && tieneCopiaFirmada) return { ok: false, motivo: "con_firma" };
  return { ok: true };
}

/** Estado que queda al subir una copia firmada: siempre «firmado». */
export function estadoAlSubirFirmado(): EstadoDocumento {
  return "signed";
}

// ---- Marcadores para personalizar un .docx -----------------------------------------------------------------------

/** Los marcadores que entiende la personalización. Se listan en la ayuda de la biblioteca. */
export const MARCADORES: readonly { key: string; en: string; es: string }[] = [
  { key: "employee_name", en: "Employee's full name", es: "Nombre completo del empleado" },
  { key: "position", en: "Position", es: "Puesto" },
  { key: "start_date", en: "Start date (hire date)", es: "Fecha de ingreso" },
  { key: "pay_rate", en: "Pay rate (if on file)", es: "Pago por hora (si existe)" },
  { key: "store", en: "Store", es: "Tienda" },
  { key: "today", en: "Today's date", es: "Fecha de hoy" },
];

/** ¿El XML de un .docx tiene marcadores? Se mira el texto sin etiquetas, porque Word parte las palabras en varias etiquetas. */
export function contieneMarcadores(xml: string): boolean {
  return /\{\{\s*[a-z_]+\s*\}\}/i.test(xml.replace(/<[^>]+>/g, ""));
}

/** Los nombres de marcadores que aparecen en el texto de un .docx (sin repetir). */
export function marcadoresEn(xml: string): string[] {
  const texto = xml.replace(/<[^>]+>/g, "");
  return [...new Set([...texto.matchAll(/\{\{\s*([a-z_]+)\s*\}\}/gi)].map((m) => m[1].toLowerCase()))];
}

/** Fecha «AAAA-MM-DD» o ISO → texto largo en el idioma de la pantalla («16 de noviembre de 2026» / «November 16, 2026»). */
export function fechaLarga(iso: string | null | undefined, lang: "en" | "es"): string {
  if (!iso || !/^\d{4}-\d{2}-\d{2}/.test(iso)) return "";
  // Día de calendario formateado sin la zona horaria del aparato (ver hora-de-brownsville.ts).
  return formatoDeDia(iso, lang === "es" ? "es-MX" : "en-US", { year: "numeric", month: "long", day: "numeric" });
}

/**
 * Los datos del empleado que llenan los marcadores. Lo que no hay queda como «» (nunca «undefined» dentro del documento).
 * `hoy` es «AAAA-MM-DD» (la fecha de hoy en Brownsville, como en el resto del módulo).
 */
export function mapaDeMarcadores(
  datos: { fullName?: string | null; position?: string | null; hireDate?: string | null; payRate?: number | string | null; store?: string | null },
  hoy: string,
  lang: "en" | "es",
): Record<string, string> {
  const pago = datos.payRate === null || datos.payRate === undefined || datos.payRate === "" ? "" : String(datos.payRate);
  return {
    employee_name: (datos.fullName ?? "").trim(),
    position: (datos.position ?? "").split(",")[0]?.trim() ?? "",
    start_date: fechaLarga(datos.hireDate, lang),
    pay_rate: pago,
    store: (datos.store ?? "").trim(),
    today: fechaLarga(hoy, lang),
  };
}

/** Cuántos bytes en texto corto: «512 KB», «3.2 MB». */
export function tamanoLegible(bytes: number | null | undefined): string {
  if (!bytes || bytes < 0) return "—";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
