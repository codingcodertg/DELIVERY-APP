import { AVISO_CLIENTE_APROBADA, AVISO_CLIENTE_NUEVA, AVISO_CLIENTE_RECHAZADA, AVISO_CLIENTE_REVISAR } from "@/lib/customers/avisos-de-solicitud";
import { KIND_RECHAZADA } from "@/lib/acciones-parada";

// ============================================================
// Importantes y secundarios (D-NEXT).
//
// El dueño: «las notificaciones principales SOLO las de Clientes, y de Entregas SOLO si la entrega se canceló, se
// rechazó o se reprogramó. Todo lo demás, a SECUNDARIAS: llegan siempre, pero sin ruido y en otra sección.»
//
// Se decide en el cliente por el `kind`, sin columna nueva: la clase es una regla de presentación, cambia cuando el
// dueño lo diga, y una columna obligaría a migrar y a rellenar cada fila vieja cada vez. Un `kind` que no esté aquí
// es SECUNDARIO: lo nuevo no hace ruido hasta que alguien decida que lo merece.
// ============================================================

export type ClaseDelAviso = "importante" | "secundario";

/** Una orden anulada (`notificationsForStage`, D-656 y D-NEXT: también a su vendedor). */
export const KIND_ANULADA = "canceled";
/** Una orden rechazada por la oficina (etapa `rejected`). */
export const KIND_ORDEN_RECHAZADA = "rejected";
/** Una orden reprogramada a otra fecha (D-NEXT, `avisoDeReprogramacion`). */
export const KIND_REPROGRAMADA = "rescheduled";

/** Los únicos que suenan y cuentan en el número rojo. */
export const KINDS_IMPORTANTES: readonly string[] = [
  // Clientes (D-867, 243).
  AVISO_CLIENTE_NUEVA, AVISO_CLIENTE_APROBADA, AVISO_CLIENTE_RECHAZADA, AVISO_CLIENTE_REVISAR,
  // Entregas: anulada, rechazada (por la oficina o por el cliente en la puerta) y reprogramada.
  KIND_ANULADA, KIND_ORDEN_RECHAZADA, KIND_RECHAZADA, KIND_REPROGRAMADA,
];

export function claseDelAviso(kind: string | null | undefined): ClaseDelAviso {
  return kind && KINDS_IMPORTANTES.includes(kind) ? "importante" : "secundario";
}

export const esImportante = (n: { kind: string }) => claseDelAviso(n.kind) === "importante";

export interface CuentaDeAvisos { total: number; sinLeer: number }

/** Cuántos hay y cuántos sin leer en cada sección. El número rojo de la campana es `importante.sinLeer`, y nada más. */
export function cuentaPorClase(avisos: readonly { kind: string; read: boolean }[]): Record<ClaseDelAviso, CuentaDeAvisos> {
  const c: Record<ClaseDelAviso, CuentaDeAvisos> = { importante: { total: 0, sinLeer: 0 }, secundario: { total: 0, sinLeer: 0 } };
  for (const n of avisos) {
    const k = c[claseDelAviso(n.kind)];
    k.total++;
    if (!n.read) k.sinLeer++;
  }
  return c;
}

/** Los ids sin leer de UNA sección, para «Marcar todo leído» por sección. */
export function sinLeerDeLaClase(avisos: readonly { id: string; kind: string; read: boolean }[], clase: ClaseDelAviso): string[] {
  return avisos.filter((n) => !n.read && claseDelAviso(n.kind) === clase).map((n) => n.id);
}
