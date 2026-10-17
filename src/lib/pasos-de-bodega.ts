import type { Texto } from "@/lib/acciones-de-la-ficha";
import type { EscrituraAlComenzar } from "@/lib/confirmar-tarifa";
import type { Delivery, Stage } from "@/lib/types";

// ============================================================
// Lo que ESCRIBEN los dos pasos de bodega —«Comenzar preparación» y «Marcar listo»—, una sola vez para la ficha y la
// fila de Almacén (D-551).
//
// Nota D-573 (2026-10-16): este fichero decidía también QUÉ pasos ofrecía la columna «Siguiente paso» (`pasosDeBodega`,
// `confirmacionDelPaso`). Esa columna ya no existe: la burbuja de Etapa ofrece TODAS las etapas que la base acepta, y
// quién ve qué y qué confirma cada salto lo decide ahora `saltosEnLaFila` (src/lib/etapas-en-la-fila.ts). Aquí quedan
// las escrituras, que siguen siendo las mismas en los dos sitios:
//   - «Comenzar»: UNA escritura, la etapa y —solo si cambió— la tarifa (D-450).
//   - «Marcar listo»: la etapa y `actual_pallets` en la misma escritura (D-143/D-287).
// ============================================================

/** El número con el que abre el campo de pallets: el real si almacén ya lo puso, si no el estimado, si no vacío. */
export function palletsPropuestas(pedido: Pick<Delivery, "actual_pallets" | "est_pallets">): string {
  return String(pedido.actual_pallets ?? pedido.est_pallets ?? "");
}

export interface EscrituraAlMarcarListo {
  pallets: number;
  /** Lo que viaja en la MISMA escritura que la etapa: solo el real. El estimado de ventas no se toca. */
  extra: Pick<Delivery, "actual_pallets">;
  /** La nota del evento de etapa. */
  nota: Texto;
  /** El aviso de la pantalla al terminar. */
  aviso: Texto;
}

/** Qué escribe «Confirmar y marcar listo» con lo tecleado. `null` si no es un número mayor que cero. */
export function escrituraAlMarcarListo(tecleado: string): EscrituraAlMarcarListo | null {
  const n = Number(tecleado);
  if (!Number.isFinite(n) || n <= 0) return null;
  return {
    pallets: n,
    extra: { actual_pallets: n },
    nota: { en: `Pallets confirmed: ${n}`, es: `Pallets confirmadas: ${n}` },
    aviso: { en: `Ready — ${n} pallets confirmed`, es: `Listo — ${n} pallets confirmadas` },
  };
}

export type SetStage = (id: string, stage: Stage, note?: string, extra?: Partial<Delivery>, kind?: string) => Promise<boolean>;
type T = (en: string, es: string) => string;

/**
 * «Comenzar preparación»: UNA escritura, la etapa y —solo si cambió— la tarifa (D-450). `escritura` es lo que decidió
 * `escrituraAlComenzar` en el diálogo; `null` cuando el tipo no pide confirmación, y entonces se mueve la etapa sin
 * nota ni `extra`, que es lo que hacía `move("fulfilling")` en la ficha.
 */
export function escribeComenzar(setStage: SetStage, id: string, escritura: EscrituraAlComenzar | null, t: T): Promise<boolean> {
  if (!escritura) return setStage(id, "fulfilling");
  return setStage(id, "fulfilling", t(escritura.nota.en, escritura.nota.es), escritura.extra);
}

/** «Confirmar y marcar listo»: la etapa y `actual_pallets` en la misma escritura, con «Pallets confirmed: N». */
export function escribeListo(setStage: SetStage, id: string, escritura: EscrituraAlMarcarListo, t: T): Promise<boolean> {
  return setStage(id, "ready", t(escritura.nota.en, escritura.nota.es), escritura.extra);
}
