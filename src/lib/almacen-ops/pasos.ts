/**
 * Operaciones de almacén (D-883): las preguntas de cada reporte, una por pantalla, y cuándo una está contestada.
 * Son las de Tile Ops (recon §2), con dos mejoras: «¿cuál?» si el equipo es «Otro», y las piezas sueltas en merma.
 */
import type { TipoDeReporte } from "./tipos";
import { cantidadesValidas, piezasTotales, repartoValido, type Cantidades, type Reparto } from "./perdida";
import { fechaDelDanoValida, fmtDia, hoyEnTexas } from "./fecha-del-dano";

export type Opcion = { v: string; en: string; es: string };
export type Paso =
  | { id: string; tipo: "personas"; en: string; es: string; opcional?: boolean }
  | { id: string; tipo: "persona"; en: string; es: string }
  | { id: string; tipo: "opcion"; en: string; es: string; opciones: Opcion[] }
  | { id: string; tipo: "sino"; en: string; es: string }
  | { id: string; tipo: "texto"; en: string; es: string; opcional?: boolean; corto?: boolean; min?: number; si?: { paso: string; vale: string } }
  // `obligatoria` (D-914, 268): la merma no se envía sin al menos una foto; el paso se puede saltar («la tengo en
  // papel») pero el resumen la marca como faltante y «Enviar» queda apagado hasta que la agreguen.
  | { id: string; tipo: "foto"; en: string; es: string; obligatoria?: boolean }
  | { id: string; tipo: "producto"; en: string; es: string }
  | { id: string; tipo: "cantidad"; en: string; es: string }
  // Un día (YYYY-MM-DD), obligatorio y nunca futuro (266: cuándo se rompió la merma).
  | { id: string; tipo: "fecha"; en: string; es: string };

/** El paso de la merma que pregunta cuándo se rompió (266). Va a `warehouse_reports.broken_on`. */
export const PASO_FECHA_DEL_DANO = "broken_on";

/**
 * El producto de la merma. `libre` (migración 252): no está en el catálogo; `id` es null, el nombre lo escribió quien
 * reporta y el costo por pieza es el que puso (o null). Un gerente lo vincula o corrige después.
 */
export interface ProductoElegido { id: number | null; sku: string; name: string; cost: number | null; pieces_per_box: number | null; libre?: boolean }

/** Un producto fuera de catálogo a partir de lo que se escribió. */
export function productoLibre(nombre: string, costo: number | null): ProductoElegido {
  return { id: null, sku: "", name: nombre.trim(), cost: costo, pieces_per_box: null, libre: true };
}

export function productoValido(v: unknown): v is ProductoElegido {
  if (!v || typeof v !== "object") return false;
  const p = v as ProductoElegido;
  if (p.libre) return typeof p.name === "string" && p.name.trim().length >= 2 && (p.cost == null || (Number.isFinite(p.cost) && p.cost >= 0));
  return typeof p.id === "number";
}

/** Un costo escrito a mano: vacío = null (sin costo), NaN si no es un número ≥ 0 con hasta 2 decimales. */
export function costoDelCampo(s: string): number | null {
  const t = s.trim().replace(/^\$/, "");
  if (t === "") return null;
  return /^\d+(\.\d{1,2})?$/.test(t) ? Number(t) : NaN;
}

/**
 * Dañado o muestra. Desde el pedido faa07047 (254) ya no se elige uno: primero el total de piezas y luego cuántas de
 * cada uno (`r.split`); `scrap_type` queda en damaged / sample / mixed. Los reportes viejos traen solo uno de los dos.
 */
export const TIPOS_DE_MERMA: Opcion[] = [
  { v: "damaged", en: "Damaged", es: "Dañado" }, { v: "sample", en: "Sample", es: "Muestra" },
  { v: "mixed", en: "Damaged and sample", es: "Dañado y muestra" },
];
/**
 * De dónde viene la merma. El pedido 714584e6 la quitó del formulario (D-902), pero Roberto lo retiró en el mismo hilo:
 * «It does apply BUT the CRMA is optional and if CRMA is filled then it sums the loss, if no CRMA then no loss». Así que
 * se vuelve a preguntar (D-905), el CRMA es opcional y una devolución de cliente sin CRMA no cuenta como pérdida
 * (ver `cuentaComoPerdida` en perdida.ts y la migración 263).
 */
export const ORIGENES_DE_MERMA: Opcion[] = [
  { v: "internal", en: "Internal", es: "Interno" }, { v: "customer_return", en: "Customer return", es: "Devolución de cliente" },
];
export type Respuestas = Record<string, unknown>;

const o = (v: string, en: string, es: string): Opcion => ({ v, en, es });
const INVOLUCRADOS: Paso = { id: "involved", tipo: "personas", en: "Who was involved?", es: "¿Quién estuvo involucrado?" };
const DESCRIPCION: Paso = { id: "description", tipo: "texto", en: "What happened?", es: "¿Qué pasó?" };
const FOTO: Paso = { id: "photo", tipo: "foto", en: "Add a photo (optional)", es: "Agrega una foto (opcional)" };
/** La foto de la merma (D-914, 268): primero y obligatoria. Reunión del dueño con Roberto: fotos repetidas y tomadas después de capturar. */
export const FOTO_DE_MERMA: Paso = { id: "photo", tipo: "foto", obligatoria: true, en: "Take the photo of the pieces first", es: "Primero toma la foto de las piezas" };

export const PASOS: Record<TipoDeReporte, Paso[]> = {
  incident: [
    INVOLUCRADOS,
    { id: "severity", tipo: "opcion", en: "How serious?", es: "¿Qué tan grave?", opciones: [o("low", "Low", "Baja"), o("medium", "Medium", "Media"), o("high", "High", "Alta"), o("critical", "Critical", "Crítica")] },
    DESCRIPCION, FOTO,
  ],
  zone: [
    INVOLUCRADOS,
    { id: "zone", tipo: "opcion", en: "Which zone?", es: "¿Qué zona?", opciones: [o("showroom", "Showroom", "Sala de exhibición"), o("warehouse", "Warehouse", "Almacén"), o("loading_dock", "Loading dock", "Andén de carga"), o("break_room", "Break room", "Comedor"), o("other", "Other", "Otra")] },
    DESCRIPCION, FOTO,
  ],
  insubordination: [
    INVOLUCRADOS,
    { id: "severity", tipo: "opcion", en: "How serious?", es: "¿Qué tan grave?", opciones: [o("minor", "Minor", "Leve"), o("moderate", "Moderate", "Moderada"), o("severe", "Severe", "Grave")] },
    DESCRIPCION,
    { id: "verbal_warning", tipo: "sino", en: "Was a verbal warning given?", es: "¿Se dio una advertencia verbal?" },
    FOTO,
  ],
  safety: [
    INVOLUCRADOS,
    { id: "safety_type", tipo: "opcion", en: "What kind?", es: "¿De qué tipo?", opciones: [o("ppe", "No protective gear", "Sin equipo de protección"), o("equipment_misuse", "Equipment misuse", "Mal uso de equipo"), o("blocked_exit", "Blocked exit", "Salida bloqueada"), o("forklift", "Forklift", "Montacargas"), o("other", "Other", "Otro")] },
    DESCRIPCION,
    { id: "injured", tipo: "sino", en: "Was anyone injured?", es: "¿Alguien se lastimó?" },
    { id: "injury", tipo: "texto", en: "Describe the injury", es: "Describe la lesión", si: { paso: "injured", vale: "yes" } },
    FOTO,
  ],
  maintenance: [
    { id: "equipment", tipo: "opcion", en: "Which equipment?", es: "¿Qué equipo?", opciones: [o("forklift_1", "Forklift #1", "Montacargas #1"), o("forklift_2", "Forklift #2", "Montacargas #2"), o("pallet_jack", "Pallet jack", "Patín"), o("other", "Other", "Otro")] },
    { id: "equipment_other", tipo: "texto", corto: true, en: "Which one?", es: "¿Cuál?", si: { paso: "equipment", vale: "other" } },
    { id: "issue", tipo: "opcion", en: "What kind of log?", es: "¿Qué tipo de registro?", opciones: [o("routine", "Routine check", "Revisión de rutina"), o("repair_needed", "Needs repair", "Necesita reparación"), o("out_of_service", "Out of service", "Fuera de servicio"), o("completed_repair", "Repair done", "Reparación terminada")] },
    { id: "description", tipo: "texto", en: "Details", es: "Detalles" },
    FOTO,
  ],
  positive: [
    { id: "employee", tipo: "persona", en: "Who are you recognizing?", es: "¿A quién reconoces?" },
    { id: "category", tipo: "opcion", en: "For what?", es: "¿Por qué?", opciones: [o("teamwork", "Teamwork", "Trabajo en equipo"), o("safety", "Safety", "Seguridad"), o("customer_service", "Customer service", "Atención al cliente"), o("efficiency", "Efficiency", "Eficiencia"), o("other", "Other", "Otro")] },
    { id: "description", tipo: "texto", en: "What did they do well?", es: "¿Qué hizo bien?" },
  ],
  scrap: [
    { id: "product", tipo: "producto", en: "Which product?", es: "¿Qué producto?" },
    // La foto va JUSTO después del producto y antes de las cantidades (D-914, 268): se fotografían las piezas antes de
    // capturar nada más, y sin foto no se envía.
    FOTO_DE_MERMA,
    // Primero el total de piezas; luego, de esas, cuántas dañadas y cuántas de muestra (pedido faa07047). Sin piezas sueltas (482720a9).
    { id: "qty", tipo: "cantidad", en: "How many pieces?", es: "¿Cuántas piezas?" },
    // De vuelta en su sitio (D-893 / D-894), tras retirar Roberto el pedido 714584e6.
    { id: "return_type", tipo: "opcion", en: "Where did it come from?", es: "¿De dónde viene?", opciones: ORIGENES_DE_MERMA },
    { id: "reason", tipo: "opcion", en: "Reason", es: "Motivo", opciones: [o("fell", "It fell", "Se cayó"), o("strap", "Strap broke", "Se rompió el fleje"), o("forklift", "Forklift", "Montacargas"), o("transportation", "Transportation", "Transporte"), o("other", "Other", "Otro")] },
    // Cuándo se rompió (pedido del dueño, 266): por defecto hoy en Texas, se puede cambiar, nunca futuro.
    { id: PASO_FECHA_DEL_DANO, tipo: "fecha", en: "What date was it broken?", es: "¿Qué día se rompió?" },
    { id: "broken_by", tipo: "personas", opcional: true, en: "Who broke it? (optional)", es: "¿Quién lo rompió? (opcional)" },
    // Solo si fue devolución de un cliente (pedido 60bbd7ed). OPCIONAL otra vez (la 254 lo exigía; la 263 ya no): suele
    // llegar después del reporte y el gerente lo pone desde la tarjeta. Sin CRMA la devolución no cuenta como pérdida.
    { id: "crma", tipo: "texto", corto: true, opcional: true, si: { paso: "return_type", vale: "customer_return" }, en: "CRMA / claim # (optional)", es: "CRMA / n.º de reclamo (opcional)" },
    { id: "comments", tipo: "texto", opcional: true, en: "Comments (optional)", es: "Comentarios (opcional)" },
  ],
};

/** ¿Se pregunta este paso con estas respuestas? (los condicionales: lesión, «otro» equipo). */
export function seMuestra(p: Paso, r: Respuestas): boolean {
  return !("si" in p && p.si) || r[p.si.paso] === p.si.vale;
}

export function pasosVisibles(tipo: TipoDeReporte, r: Respuestas): Paso[] {
  return PASOS[tipo].filter((p) => seMuestra(p, r));
}

/** ¿Está contestado lo bastante para seguir? */
export function pasoCompleto(p: Paso, r: Respuestas, hoy: string = hoyEnTexas()): boolean {
  const v = r[p.id];
  switch (p.tipo) {
    case "fecha": return fechaDelDanoValida(v, hoy);
    case "foto": return !p.obligatoria || (Array.isArray(v) && v.length > 0);
    case "personas": return !!p.opcional || (Array.isArray(v) && v.length > 0);
    case "persona": return typeof v === "string" && v.length > 0;
    case "opcion": return typeof v === "string" && p.opciones.some((x) => x.v === v);
    case "sino": return v === "yes" || v === "no";
    case "texto": return !!p.opcional || (typeof v === "string" && v.trim().length >= (p.min ?? 3));
    case "producto": return productoValido(v);
    case "cantidad": {
      const q = v as Partial<Cantidades>;
      return cantidadesValidas(q) && repartoValido(piezasTotales(q), r.split as Partial<Reparto> | undefined);
    }
  }
}

/** El primer paso sin contestar (el resumen no envía con huecos), o -1. */
export function primerHueco(tipo: TipoDeReporte, r: Respuestas, hoy: string = hoyEnTexas()): number {
  return pasosVisibles(tipo, r).findIndex((p) => !pasoCompleto(p, r, hoy));
}

/** El primer hueco SIN contar la foto (268): si es -1 y solo falta la foto, la merma se puede guardar «sin foto». */
export function primerHuecoSalvoFoto(tipo: TipoDeReporte, r: Respuestas, hoy: string = hoyEnTexas()): number {
  return pasosVisibles(tipo, r).findIndex((p) => p.tipo !== "foto" && !pasoCompleto(p, r, hoy));
}

/**
 * Las respuestas con las que arranca un reporte (266): la merma trae la fecha del daño puesta en hoy (Texas). Un
 * borrador de antes de la 266, o uno guardado con una fecha que ya no vale, también la recibe; una fecha válida que la
 * persona eligió se respeta.
 */
export function respuestasIniciales(tipo: TipoDeReporte, previas?: Respuestas | null, hoy: string = hoyEnTexas()): Respuestas {
  const r = { ...(previas ?? {}) };
  if (tipo === "scrap" && !fechaDelDanoValida(r[PASO_FECHA_DEL_DANO], hoy)) r[PASO_FECHA_DEL_DANO] = hoy;
  return r;
}

/** Lo que va a `answers`: solo lo que se muestra (si «lesión» pasa a «no», su texto no viaja), recortado. */
export function respuestasParaGuardar(tipo: TipoDeReporte, r: Respuestas): Respuestas {
  const out: Respuestas = {};
  for (const p of pasosVisibles(tipo, r)) {
    if (p.tipo === "foto" || p.tipo === "producto" || p.tipo === "cantidad") continue;
    const v = r[p.id];
    if (v === undefined || v === "" || (Array.isArray(v) && v.length === 0)) continue;
    out[p.id] = typeof v === "string" ? v.trim() : v;
  }
  return out;
}

/** Los empleados del reporte (subject_ids): los involucrados o el reconocido. */
export function empleadosDelReporte(tipo: TipoDeReporte, r: Respuestas): string[] {
  if (tipo === "positive") return typeof r.employee === "string" && r.employee ? [r.employee] : [];
  if (tipo === "scrap" || tipo === "maintenance") return [];
  return Array.isArray(r.involved) ? (r.involved as string[]) : [];
}

export function etiquetaDeOpcion(tipo: TipoDeReporte, pasoId: string, v: unknown, lang: "en" | "es"): string {
  const p = PASOS[tipo].find((x) => x.id === pasoId);
  if (tipo === "scrap" && pasoId === "scrap_type") { const x = TIPOS_DE_MERMA.find((y) => y.v === v); return x ? x[lang] : ""; }
  if (tipo === "scrap" && pasoId === "return_type") { const x = ORIGENES_DE_MERMA.find((y) => y.v === v); return x ? x[lang] : ""; }
  if (p?.tipo === "opcion") { const x = p.opciones.find((y) => y.v === v); if (x) return x[lang]; }
  if (p?.tipo === "sino") return v === "yes" ? (lang === "es" ? "Sí" : "Yes") : v === "no" ? "No" : "";
  if (p?.tipo === "fecha") return typeof v === "string" && v ? fmtDia(v, lang) : "";
  return typeof v === "string" ? v : "";
}
