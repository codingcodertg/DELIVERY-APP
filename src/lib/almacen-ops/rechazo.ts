/**
 * Rechazar una merma (327): «la merma sigue siendo vendible, no es merma». Reglas PURAS; la base vuelve a exigirlas.
 *
 *   - Quién: quien gestiona la merma de esa tienda (`puedeCorregirMerma` = `warehouse_ops_can_manage`): la misma puerta
 *     que aprueba. El supervisor de almacén no, el almacenista (scrap_only) no.
 *   - Desde qué etapa: documentada, fotografiada (incluye «pendiente» en un grupo) y aprobada. No desechada ni ajustada.
 *   - Motivo obligatorio: de 3 a 500 caracteres (sin contar espacios de los extremos).
 *   - Deshacer: quien puede rechazar, y solo si está rechazada. Regresa a la etapa que tenía (la base la deriva de las
 *     fechas que se conservan).
 *   - Si la 327 no está aplicada, las filas no traen `rejected_at` y NO se ofrece nada (la pantalla no se rompe).
 */
import type { TipoDeReporte } from "./tipos";
import { puedeCorregirMerma, type Quien } from "./visibilidad";
import { esRechazadaFila, etapaDe, tieneEtapas, type EtapaDeMerma, type FilaConEtapa } from "./etapas";

export const MOTIVO_RECHAZO_MIN = 3;
export const MOTIVO_RECHAZO_MAX = 500;
/** El ejemplo que sale de guía en el campo del motivo (el dueño lo pidió así). */
export const EJEMPLO_MOTIVO_RECHAZO = "Still sellable — not scrap / Aún se puede vender — no es merma";

/** Las etapas desde las que se puede rechazar (antes de «desechada»). «Pendiente» es fotografiada dentro de un grupo. */
export const ETAPAS_RECHAZABLES: readonly EtapaDeMerma[] = ["documented", "photographed", "approved"];

/** ¿El motivo tiene entre 3 y 500 caracteres (espacios de los extremos fuera)? */
export function motivoDeRechazoValido(motivo: string | null | undefined): boolean {
  const n = (motivo ?? "").trim().length;
  return n >= MOTIVO_RECHAZO_MIN && n <= MOTIVO_RECHAZO_MAX;
}

/** ¿La fila trae las columnas de la 327? Sin ellas no se ofrece rechazar ni deshacer. */
export function tieneColumnasDeRechazo(r: object): boolean {
  return "rejected_at" in r;
}

/** Quién puede rechazar esta merma y desde su etapa actual. */
export function puedeRechazar(q: Quien, r: { kind: TipoDeReporte; store: string } & FilaConEtapa): boolean {
  return r.kind === "scrap" && tieneColumnasDeRechazo(r) && tieneEtapas(r) && puedeCorregirMerma(q, r)
    && !esRechazadaFila(r) && ETAPAS_RECHAZABLES.includes(etapaDe(r));
}

/** Quién puede deshacer un rechazo (la misma puerta) y solo si la merma está rechazada. */
export function puedeDeshacerRechazo(q: Quien, r: { kind: TipoDeReporte; store: string } & FilaConEtapa): boolean {
  return r.kind === "scrap" && tieneColumnasDeRechazo(r) && esRechazadaFila(r) && puedeCorregirMerma(q, r);
}

/** Las filas que cuentan para dinero y pendientes: sin las rechazadas. */
export function sinRechazadas<T extends FilaConEtapa>(filas: readonly T[]): T[] {
  return filas.filter((r) => !esRechazadaFila(r));
}

export type MotivoNoRechazable = "no-es-merma" | "sin-columnas" | "sin-permiso" | "ya-rechazada" | "etapa-posterior";

/** Por qué no se puede rechazar (null si sí). Para mostrar un aviso claro en vez de un error de la base. */
export function motivoNoRechazable(q: Quien, r: { kind: TipoDeReporte; store: string } & FilaConEtapa): MotivoNoRechazable | null {
  if (r.kind !== "scrap") return "no-es-merma";
  if (!tieneColumnasDeRechazo(r)) return "sin-columnas";
  if (esRechazadaFila(r)) return "ya-rechazada";
  if (!puedeCorregirMerma(q, r)) return "sin-permiso";
  if (!ETAPAS_RECHAZABLES.includes(etapaDe(r))) return "etapa-posterior";
  return null;
}
