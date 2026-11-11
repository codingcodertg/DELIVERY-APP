/**
 * Operaciones de almacén — firmas de aprobación de merma (D-9xx, migración 280).
 *
 * El dueño (10 nov): el gerente crea el reporte y lo firma; el supervisor lo revisa y lo firma. Una merma NO se puede
 * aprobar sin las DOS firmas. Pueden firmarse en el mismo aparato (el gerente le pasa el equipo al supervisor), así que
 * la MISMA persona puede llenar los dos espacios (283: ya no se exige que sean dos cuentas distintas). Mientras falte una,
 * queda «pendiente de firma» y sale en la vista «En revisión». Con las dos, se aprueba sola (283). Esta es la regla PURA
 * (sin React, sin red); la MISMA que la base (`warehouse_ops_sign_scrap`/`warehouse_ops_set_scrap_stage`, 280/283).
 */
import type { Etapa, FilaConEtapa, Lang } from "./etapas";
import { etapaDe } from "./etapas";

/** Los dos espacios de firma de una merma, en orden (primero el gerente, luego el supervisor). */
export const SLOTS_DE_FIRMA = ["gerente", "supervisor"] as const;
export type SlotDeFirma = (typeof SLOTS_DE_FIRMA)[number];

export function esSlotDeFirma(v: unknown): v is SlotDeFirma {
  return typeof v === "string" && (SLOTS_DE_FIRMA as readonly string[]).includes(v);
}

/** Una firma guardada. `signature_png` (el dibujo) puede NO venir en la lista (se trae aparte para el PDF/tarjeta). */
export interface FirmaDeMerma {
  slot: SlotDeFirma;
  signer_id: string | null;
  signer_name: string | null;
  signed_at: string;
  signature_png?: string | null;
}

export const ETIQUETA_DE_SLOT: Record<SlotDeFirma, { en: string; es: string }> = {
  gerente: { en: "Manager", es: "Gerente" },
  supervisor: { en: "Supervisor", es: "Supervisor" },
};

export function nombreDeSlot(slot: SlotDeFirma, lang: Lang): string {
  return lang === "es" ? ETIQUETA_DE_SLOT[slot].es : ETIQUETA_DE_SLOT[slot].en;
}

/** La firma de un slot (o undefined si ese espacio sigue en blanco). */
export function firmaDe(firmas: readonly FirmaDeMerma[] | null | undefined, slot: SlotDeFirma): FirmaDeMerma | undefined {
  return (firmas ?? []).find((f) => f.slot === slot);
}

/** ¿Está firmado ese slot? */
export function slotFirmado(firmas: readonly FirmaDeMerma[] | null | undefined, slot: SlotDeFirma): boolean {
  return !!firmaDe(firmas, slot);
}

/** Los slots que todavía faltan por firmar, en orden (gerente primero). */
export function firmasFaltantes(firmas: readonly FirmaDeMerma[] | null | undefined): SlotDeFirma[] {
  return SLOTS_DE_FIRMA.filter((s) => !slotFirmado(firmas, s));
}

/** ¿Están las DOS firmas? (la misma regla que la base para aprobar; 283: ya no hace falta que sean personas distintas). */
export function tieneAmbasFirmas(firmas: readonly FirmaDeMerma[] | null | undefined): boolean {
  return !!firmaDe(firmas, "gerente") && !!firmaDe(firmas, "supervisor");
}

/**
 * ¿Puede ESTA persona firmar ese slot? El slot está libre o es su propia firma. 283: la misma persona SÍ puede firmar
 * los dos espacios (el gerente y el supervisor firman en el mismo aparato), así que ya no se bloquea por haber firmado el
 * otro. Solo no se pisa la firma de OTRA persona en este mismo espacio. Gestionar lo decide quien llama (`puedeCambiarEtapa`).
 */
export function puedeFirmarSlot(
  firmas: readonly FirmaDeMerma[] | null | undefined, slot: SlotDeFirma, yoId: string,
  quien?: { role: string; permissions?: readonly string[] | null },
): boolean {
  const propia = firmaDe(firmas, slot);
  if (propia && propia.signer_id && propia.signer_id !== yoId) return false; // ya la firmó otra persona
  if (!quien) return true;
  // Dueño, 11 nov (revierte la parte de D-962 «la misma persona firma los dos»): el gerente firma SOLO «gerente» y el
  // supervisor de almacén SOLO «supervisor»; nadie llena los dos. El admin del hub puede firmar cualquiera (respaldo).
  if (!slotsQuePuedoFirmar(quien).includes(slot)) return false;
  if (quien.role !== "admin") {
    const otra = firmaDe(firmas, slot === "gerente" ? "supervisor" : "gerente");
    if (otra && otra.signer_id === yoId) return false;
  }
  return true;
}

/**
 * Qué espacio PUEDE firmar cada quien (dueño, 11 nov; misma regla que `warehouse_ops_can_sign_slot` de la 293):
 * admin del hub → los dos; gerente → «gerente»; supervisor de almacén (permiso `warehouse_ops_supervisor`) → «supervisor».
 */
export function slotsQuePuedoFirmar(q: { role: string; permissions?: readonly string[] | null }): SlotDeFirma[] {
  if (q.role === "admin") return ["gerente", "supervisor"];
  const out: SlotDeFirma[] = [];
  if (q.role === "manager") out.push("gerente");
  if ((q.permissions ?? []).includes("warehouse_ops_supervisor")) out.push("supervisor");
  return out;
}

/**
 * ¿Esta merma REQUIERE firma (está «En revisión»)? Es una merma ya fotografiada (lista para aprobar) a la que le falta
 * una de las dos firmas. Una documentada (sin foto) aún no entra; una aprobada/desechada/ajustada ya salió.
 */
export function requiereFirma(r: FilaConEtapa & { firmas?: readonly FirmaDeMerma[] | null }): boolean {
  if (r.kind !== "scrap") return false;
  return etapaDe(r) === "photographed" && !tieneAmbasFirmas(r.firmas);
}

/** ¿Se puede aprobar ya? Fotografiada y con las dos firmas. (La base lo vuelve a exigir, y con las dos aprueba sola; 283.) */
export function puedeAprobar(r: FilaConEtapa & { firmas?: readonly FirmaDeMerma[] | null }): boolean {
  if (r.kind !== "scrap") return false;
  return etapaDe(r) === "photographed" && tieneAmbasFirmas(r.firmas);
}

/** El aviso «Pendiente: firma del …» para la lista y la tarjeta. null si no aplica (no es merma, o ya tiene las dos). */
export function mensajePendienteDeFirma(
  r: FilaConEtapa & { firmas?: readonly FirmaDeMerma[] | null },
  lang: Lang,
): string | null {
  if (!requiereFirma(r)) return null;
  const faltan = firmasFaltantes(r.firmas);
  const nombres = faltan.map((s) => nombreDeSlot(s, lang));
  if (lang === "es") {
    return faltan.length === 2 ? "Pendiente de firma (gerente y supervisor)" : `Pendiente: firma del ${nombres[0].toLowerCase()}`;
  }
  return faltan.length === 2 ? "Pending signature (manager and supervisor)" : `Pending: ${nombres[0].toLowerCase()} signature`;
}

/** Valida que un dibujo de firma sea un data URL de imagen no vacío (lo que acepta la base). */
export function firmaValida(png: string | null | undefined): png is string {
  return typeof png === "string" && png.trim().length > 0 && png.startsWith("data:image/");
}

/** Para la vista «En revisión»: filtra las mermas que aún requieren firma. */
export function soloEnRevision<T extends FilaConEtapa & { firmas?: readonly FirmaDeMerma[] | null }>(filas: readonly T[]): T[] {
  return filas.filter((r) => requiereFirma(r));
}

/** La etapa objetivo al firmar/aprobar: siempre `approved` (lo demás no se firma). Útil para el gate de la pantalla. */
export const ETAPA_AL_APROBAR: Etapa = "approved";
