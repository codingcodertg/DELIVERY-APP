/**
 * Operaciones de almacén (D-921, migración 270): las ETAPAS de una merma y la hoja de aprobación.
 *
 * Roberto (pedido 1aeba1e3, 2026-11-07): «Need a stage column: Documented → Photographed → Approved → Dumped. Need
 * to be able to select rows that will be printed for approval. They will sign the sheet, manager will attach it to
 * that report and then the status will turn to Approved. Date approved will be registered and date Dumped as well.
 * Dumped means the manager approved and they threw it in trash.» Y después: «Last step will be 'Adjusted' which would
 * be when manager uploads screenshot that they registered it in the system.»
 *
 *   documented    la merma se guardó, todavía sin foto (la apuntaron en papel, 268).
 *   photographed  tiene al menos una foto. Sola: en cuanto hay fotos (el trigger de la 270).
 *   approved      el gerente adjuntó la hoja de aprobación FIRMADA (approved_at, approved_by, approval_sheet).
 *   dumped        el gerente marcó que ya se tiró a la basura (dumped_at, dumped_by).
 *   adjusted      el gerente subió la captura de pantalla del ajuste en el sistema de inventario
 *                 (adjusted_at, adjusted_by, adjustment_proof).
 *
 * La base guarda `stage` y lo recalcula un trigger a partir de las fechas; `warehouse_ops_set_scrap_stage` hace las
 * transiciones con la MISMA regla que `transicion` de aquí (la prueba lee el SQL). Esto no importa React: lo usan la
 * lista, la tarjeta, la hoja impresa (página del servidor) y las pruebas.
 */
import type { TipoDeReporte } from "./tipos";
import { puedeCorregirMerma, veLosReportes, type Quien } from "./visibilidad";
import { nivelDe } from "./nivel";

export const ETAPAS = ["documented", "photographed", "approved", "dumped", "adjusted"] as const;
export type Etapa = (typeof ETAPAS)[number];
export type Lang = "en" | "es";

export function esEtapa(v: unknown): v is Etapa {
  return typeof v === "string" && (ETAPAS as readonly string[]).includes(v);
}

/** Etiquetas y el tono del chip (`.ops-etapa[data-etapa]` en operaciones.css). */
export const INFO_DE_ETAPA: Record<Etapa, { en: string; es: string; corta_en: string; corta_es: string }> = {
  documented: { en: "Documented", es: "Documentada", corta_en: "Documented", corta_es: "Documentada" },
  photographed: { en: "Photographed", es: "Fotografiada", corta_en: "Photographed", corta_es: "Fotografiada" },
  approved: { en: "Approved", es: "Aprobada", corta_en: "Approved", corta_es: "Aprobada" },
  dumped: { en: "Dumped", es: "Desechada", corta_en: "Dumped", corta_es: "Desechada" },
  adjusted: { en: "Adjusted", es: "Ajustada", corta_en: "Adjusted", corta_es: "Ajustada" },
};

export function nombreDeEtapa(e: Etapa, lang: Lang): string {
  return lang === "es" ? INFO_DE_ETAPA[e].es : INFO_DE_ETAPA[e].en;
}

/** Lo mínimo de una fila para las cuentas de aquí. Las columnas de la 270 pueden NO venir (base sin la 270). */
export interface FilaConEtapa {
  kind: TipoDeReporte | string;
  created_at: string;
  photos?: string[] | null;
  stage?: string | null;
  photographed_at?: string | null;
  approved_at?: string | null;
  approved_by?: string | null;
  approval_sheet?: string | null;
  dumped_at?: string | null;
  dumped_by?: string | null;
  adjusted_at?: string | null;
  adjusted_by?: string | null;
  adjustment_proof?: string | null;
}

/** ¿La fila trae las columnas de la 270? Sin ellas no hay controles de etapa (la pantalla no se rompe, solo no ofrece). */
export function tieneEtapas(r: FilaConEtapa): boolean {
  return "stage" in r && r.stage !== undefined;
}

/**
 * La etapa de una merma. La que guarda la base si viene; si no (fila de antes de la 270, o demo), se deriva igual que
 * el trigger: la fecha más avanzada manda; sin fechas, con fotos = fotografiada, sin fotos = documentada.
 */
export function etapaDe(r: FilaConEtapa): Etapa {
  if (esEtapa(r.stage)) return r.stage;
  return etapaDerivada(r);
}

/** La regla del trigger `warehouse_report_stage_guard` (270), en TypeScript. */
export function etapaDerivada(r: FilaConEtapa): Etapa {
  if (r.adjusted_at) return "adjusted";
  if (r.dumped_at) return "dumped";
  if (r.approved_at) return "approved";
  if ((r.photos ?? []).length > 0) return "photographed";
  return "documented";
}

export function indiceDeEtapa(e: Etapa): number {
  return ETAPAS.indexOf(e);
}

/** La fecha de cada etapa (null si no se llegó). Documentada = cuando se guardó; fotografiada = cuando entró la foto. */
export function fechaDeEtapa(r: FilaConEtapa, e: Etapa): string | null {
  switch (e) {
    case "documented": return r.created_at;
    case "photographed": return (r.photos ?? []).length > 0 ? (r.photographed_at ?? r.created_at) : null;
    case "approved": return r.approved_at ?? null;
    case "dumped": return r.dumped_at ?? null;
    case "adjusted": return r.adjusted_at ?? null;
  }
}

/** Quién hizo cada etapa (null en las dos primeras: las hace quien llena / la foto). */
export function actorDeEtapa(r: FilaConEtapa, e: Etapa): string | null {
  switch (e) {
    case "approved": return r.approved_by ?? null;
    case "dumped": return r.dumped_by ?? null;
    case "adjusted": return r.adjusted_by ?? null;
    default: return null;
  }
}

/** La fecha de la etapa ACTUAL (la que sale en la columna de la lista). */
export function fechaDeLaEtapaActual(r: FilaConEtapa): string | null {
  return fechaDeEtapa(r, etapaDe(r));
}

/** Las etapas que el gerente pone a mano (las dos primeras las pone la foto). */
export const ETAPAS_DEL_GERENTE: readonly Etapa[] = ["approved", "dumped", "adjusted"];
/** Las que exigen un adjunto: la hoja firmada y la captura del sistema. */
export const ETAPAS_CON_ADJUNTO: readonly Etapa[] = ["approved", "adjusted"];

export type MotivoDeTransicion = "no-es-merma" | "sin-foto" | "salto" | "atras" | "falta-adjunto" | "misma";

/**
 * ¿Vale pasar de `de` a `a`? La MISMA regla que `warehouse_ops_set_scrap_stage` (270):
 *   - solo merma, y solo con foto (de «documentada» no se sale a mano: se sale agregando la foto).
 *   - hacia adelante, de una en una: fotografiada → aprobada → desechada → ajustada.
 *   - aprobada y ajustada exigen su adjunto (la hoja firmada / la captura).
 *   - hacia atrás, solo el admin de la app (deshacer), y solo un paso; no hace falta adjunto.
 */
export function transicion(de: Etapa, a: Etapa, o: { adjunto: boolean; admin: boolean; esMerma?: boolean }): { ok: true } | { ok: false; motivo: MotivoDeTransicion } {
  if (o.esMerma === false) return { ok: false, motivo: "no-es-merma" };
  const i = indiceDeEtapa(de), j = indiceDeEtapa(a);
  if (i === j) return { ok: false, motivo: "misma" };
  if (j < i) {
    if (!o.admin || i - j !== 1 || a === "documented") return { ok: false, motivo: "atras" };
    return { ok: true };
  }
  if (de === "documented") return { ok: false, motivo: "sin-foto" };
  if (j - i !== 1) return { ok: false, motivo: "salto" };
  if (ETAPAS_CON_ADJUNTO.includes(a) && !o.adjunto) return { ok: false, motivo: "falta-adjunto" };
  return { ok: true };
}

/** La siguiente etapa que el gerente puede poner (null si ya está ajustada o aún no tiene foto). */
export function siguienteEtapa(r: FilaConEtapa): Etapa | null {
  const e = etapaDe(r);
  const n = ETAPAS[indiceDeEtapa(e) + 1];
  return n && e !== "documented" ? n : null;
}

/** ¿Puede este quien mover la etapa de esta merma? Gerente / supervisor de la tienda con nivel full, store_admin en las suyas, admin. */
export function puedeCambiarEtapa(q: Quien, r: { kind: TipoDeReporte; store: string } & FilaConEtapa): boolean {
  return r.kind === "scrap" && tieneEtapas(r) && puedeCorregirMerma(q, r);
}

/** ¿Puede deshacer un paso (admin de la app: `admin` o `store_admin` en sus tiendas)? */
export function puedeDeshacerEtapa(q: Quien, r: { kind: TipoDeReporte; store: string } & FilaConEtapa): boolean {
  const n = nivelDe(q);
  return (n === "admin" || n === "store_admin") && puedeCambiarEtapa(q, r) && etapaDe(r) !== "documented" && etapaDe(r) !== "photographed";
}

/** ¿Se puede marcar para la hoja de aprobación? Merma con foto que todavía nadie aprobó. */
export function seleccionableParaHoja(r: FilaConEtapa): boolean {
  return r.kind === "scrap" && etapaDe(r) === "photographed";
}

export function mensajeDeTransicion(m: MotivoDeTransicion, lang: Lang): string {
  const es = lang === "es";
  switch (m) {
    case "no-es-merma": return es ? "Solo la merma tiene etapas." : "Only scrap reports have stages.";
    case "sin-foto": return es ? "Primero agrega la foto de las piezas." : "Add the photo of the pieces first.";
    case "salto": return es ? "Las etapas van de una en una." : "Stages go one step at a time.";
    case "atras": return es ? "Solo el admin puede deshacer, y un paso a la vez." : "Only an admin can undo, one step at a time.";
    case "falta-adjunto": return es ? "Falta el adjunto (la hoja firmada o la captura)." : "The attachment is missing (the signed sheet or the screenshot).";
    case "misma": return es ? "Ya está en esa etapa." : "It is already in that stage.";
  }
}

// ---------------------------------------------------------------------------
// Pérdida por etapa (el desglose chico bajo la tabla por tienda, D-911)
// ---------------------------------------------------------------------------

export interface DesgloseDeEtapas { pendiente: number; aprobada: number; desechada: number }

/**
 * La pérdida en dólares por tienda («*» = todas) repartida en tres cubetas: pendiente de aprobar (documentada o
 * fotografiada), aprobada (y no tirada) y desechada (desechada o ajustada). Las filas ya vienen filtradas por rango.
 */
export function perdidaPorEtapa(filas: readonly (FilaConEtapa & { store: string; total_loss: number | null })[]): Record<string, DesgloseDeEtapas> {
  const out: Record<string, DesgloseDeEtapas> = {};
  const suma = (k: string, cubeta: keyof DesgloseDeEtapas, v: number) => {
    const t = (out[k] ??= { pendiente: 0, aprobada: 0, desechada: 0 });
    t[cubeta] += v;
  };
  for (const f of filas) {
    if (f.kind !== "scrap") continue;
    const v = Number(f.total_loss ?? 0) || 0;
    const e = etapaDe(f);
    const cubeta: keyof DesgloseDeEtapas = e === "approved" ? "aprobada" : e === "dumped" || e === "adjusted" ? "desechada" : "pendiente";
    suma("*", cubeta, v);
    suma(f.store, cubeta, v);
  }
  return out;
}

// ---------------------------------------------------------------------------
// La hoja de aprobación impresa (/operaciones/reportes/hoja-de-aprobacion?ids=…)
// ---------------------------------------------------------------------------

export const EMPRESA = "Rodriguez Tile Group";
export const MAX_EN_HOJA = 50;
export const RUTA_DE_HOJA = "/operaciones/reportes/hoja-de-aprobacion";

/** El texto obligatorio de la hoja, tal como lo pidió el dueño (en español; abajo va en inglés también). */
export const RECORDATORIO_ES = "Este formato debe llenarse cada vez que se detecte material dañado. El material no podrá desecharse hasta que se hayan tomado fotografías, guardado la evidencia y obtenido la autorización de Gerencia a través de la aplicación.";
export const RECORDATORIO_EN = "This form must be filled out every time damaged material is found. The material may not be thrown away until photos have been taken, the evidence saved and Management's authorization obtained through the app.";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Los ids de `?ids=a,b,c` (o repetido): solo UUID, sin repetidos, como mucho MAX_EN_HOJA. */
export function idsDeConsulta(v: string | string[] | null | undefined): string[] {
  const partes = (Array.isArray(v) ? v : [v ?? ""]).flatMap((s) => s.split(","));
  const out: string[] = [];
  for (const p of partes) {
    const id = p.trim().toLowerCase();
    if (UUID.test(id) && !out.includes(id)) out.push(id);
    if (out.length >= MAX_EN_HOJA) break;
  }
  return out;
}

export function urlDeHoja(ids: readonly string[]): string {
  return `${RUTA_DE_HOJA}?ids=${encodeURIComponent(ids.join(","))}`;
}

/** ¿Quién puede abrir la hoja? La misma puerta que la vista de gerentes («Reportes»); la RLS decide qué filas salen. */
export function puedeImprimirHoja(q: Quien): boolean {
  return veLosReportes(q);
}

/** Los 8 primeros caracteres del id: el folio corto que se escribe en la hoja y se busca en la app. */
export function folioCorto(id: string): string {
  return id.replace(/-/g, "").slice(0, 8).toUpperCase();
}

export interface FilaDeHoja {
  id: string;
  folio: string;
  dia: string;
  producto: string;
  danadas: number;
  perdida: number | null;
  motivo: string;
  rompio: string;
  reporto: string;
  tienda: string;
}

/** Las filas de la hoja, ya con nombres. Solo merma; lo que no es merma se descarta aunque venga en la URL. */
export function filasDeHoja(
  reportes: readonly { id: string; kind: string; store: string; created_at: string; broken_on?: string | null; product_sku: string | null; product_name: string | null; product_not_in_catalog?: boolean; total_loss: number | null; reason: string | null; broken_by: string[]; author_id: string; author_name: string | null; scrap_type: string | null; total_pieces: number | null; damaged_pieces?: number | null; sample_pieces?: number | null }[],
  nombre: (id: string) => string,
  etiquetaDeMotivo: (motivo: string | null) => string,
  danadasDe: (r: { scrap_type: string | null; total_pieces: number | null; damaged_pieces?: number | null; sample_pieces?: number | null }) => number,
): FilaDeHoja[] {
  return reportes.filter((r) => r.kind === "scrap").map((r) => ({
    id: r.id,
    folio: folioCorto(r.id),
    dia: r.broken_on ?? r.created_at.slice(0, 10),
    producto: r.product_not_in_catalog ? `${r.product_name ?? ""} *` : [r.product_sku, r.product_name].filter(Boolean).join(" · "),
    danadas: danadasDe(r),
    perdida: r.total_loss,
    motivo: etiquetaDeMotivo(r.reason),
    rompio: r.broken_by.map(nombre).filter(Boolean).join(", ") || "—",
    reporto: r.author_name ?? nombre(r.author_id),
    tienda: r.store,
  }));
}

/** Las tiendas de la hoja (una, o varias separadas por « / » si se mezclaron). */
export function tiendasDeHoja(filas: readonly { tienda: string }[]): string {
  return Array.from(new Set(filas.map((f) => f.tienda))).join(" / ") || "—";
}

export function totalDeHoja(filas: readonly { perdida: number | null }[]): number {
  return filas.reduce((s, f) => s + (Number(f.perdida ?? 0) || 0), 0);
}


/**
 * «⏳ Pendiente» (dueño, 11 nov: «falta el pending tab en scrap»): las mermas que todavía esperan aprobación — documentadas
 * o fotografiadas, estén o no ya en un grupo pendiente de firma.
 */
export function pendienteDeAprobar(r: Parameters<typeof etapaDe>[0]): boolean {
  const e = etapaDe(r);
  return e === "documented" || e === "photographed";
}
