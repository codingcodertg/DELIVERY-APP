import { accionesDeLaFicha, type Texto } from "@/lib/acciones-de-la-ficha";
import { pideConfirmarTarifa, type EscrituraAlComenzar } from "@/lib/confirmar-tarifa";
import type { OrderTypeRules } from "@/lib/required";
import type { Delivery, Profile, Stage } from "@/lib/types";

// ============================================================
// Los dos pasos de bodega —«Comenzar preparación» y «Marcar listo»— desde la FILA de Almacén (D-NEXT).
//
// El dueño (2026-10-14): «It would be easier if changing the stage for warehouse was a dropdown as a next column
// instead of having to open the orders one by one».
//
// Aquí se decide, sin pantalla:
//   1. QUÉ pasos ofrece la fila a esta persona en esta orden. No se vuelve a escribir la regla: se pregunta a
//      `accionesDeLaFicha` (D-497), la misma función que pinta los botones de la ficha, y se quedan solo los dos pasos
//      de bodega. Si la ficha no lo ofrece, la fila tampoco; si la ficha lo ofrece, la fila lo ofrece igual.
//   2. Si el paso PIDE CONFIRMACIÓN antes de escribir, y cuál: la tarifa al comenzar (D-450, solo los tipos que cobran,
//      `pideConfirmarTarifa`) y los pallets al marcar listo (D-143/D-287). Sin confirmación, la fila escribe ya.
//   3. QUÉ se escribe en cada uno. Las funciones `escribe*` las llaman la ficha y la fila: el mismo `setStage`, con la
//      misma nota y el mismo `extra`, venga de donde venga el toque.
//
// Lo que NO sale en la fila, a propósito, aunque la ficha se lo ofrezca a almacén: «Recoger» (parte cargas cortas,
// estampa GPS y reclama el chofer), «Marcar entregado» (firma y prueba de entrega), «Recibir» (ya tiene su botón en la
// fila de Recepción, D-409) y «Deshacer etapa» (motivo obligatorio, D-383). Esos siguen en la ficha.
// ============================================================

/** Los pasos que la fila sabe dar. Cualquier otra acción de la ficha se queda en la ficha. */
export const PASOS_EN_LA_FILA = ["comenzar", "marcar_listo"] as const;
export type IdDePasoDeBodega = (typeof PASOS_EN_LA_FILA)[number];

/** Qué hay que confirmar antes de escribir. `null`: nada, se escribe al elegirlo. */
export type ConfirmacionDelPaso = "tarifa" | "pallets" | null;

export interface PasoDeBodega {
  id: IdDePasoDeBodega;
  /** La etapa a la que lleva. */
  destino: Stage;
  /** El mismo texto que el botón de la ficha. */
  texto: Texto;
  confirmacion: ConfirmacionDelPaso;
}

const DESTINO: Record<IdDePasoDeBodega, Stage> = { comenzar: "fulfilling", marcar_listo: "ready" };

/**
 * Los pasos de bodega que la fila ofrece a `yo` en `pedido`, en el orden de la ficha. Vacío si no hay ninguno.
 *
 * Se llama a `accionesDeLaFicha` con todo lo demás apagado (nada abierto, nada guardándose, sin edición): de lo que
 * devuelve solo se miran `comenzar` y `marcar_listo`, cuya condición en la ficha es `preparaEnLaFicha(yo)` y la etapa.
 * No se añade ninguna condición propia (ni `canTransition`, que los dos proveedores ya aplican en `setStage`): la fila
 * ofrece lo que la ficha ofrece, ni más ni menos. La primera versión llevaba un `canTransition` aquí y se quitó: la
 * ficha nunca ofrece estos dos pasos fuera de `approved`/`fulfilling`, así que no había caso en que pudiera decidir algo.
 */
export function pasosDeBodega(
  yo: Pick<Profile, "id" | "role" | "full_name" | "permissions">,
  pedido: Pick<Delivery, "stage" | "created_by" | "assigned_sales_rep" | "assigned_driver" | "store" | "order_type">,
  reglas: OrderTypeRules,
): PasoDeBodega[] {
  const fa = accionesDeLaFicha({
    yo,
    pedido,
    edicion: "nada",
    etapaDeEnvio: "pending",
    puedeRecibirla: false,
    deshaceAqui: false,
    borraAqui: false,
    ocupado: false,
    salidaEn: null,
    llegadaEn: null,
    abierto: { anular: false, rechazar: false, recoger: false, dejar: false, pod: false, motivoDeSalto: false, reentrega: false },
  });
  const todas = [...(fa.principal ? [fa.principal] : []), ...fa.menu];
  const pasos: PasoDeBodega[] = [];
  for (const a of todas) {
    const id = PASOS_EN_LA_FILA.find((p) => p === a.id);
    if (!id) continue;
    pasos.push({ id, destino: DESTINO[id], texto: a.texto, confirmacion: confirmacionDelPaso(id, pedido, reglas) });
  }
  return pasos;
}

/**
 * Qué confirma cada paso, lo mismo que la ficha:
 *  - «Comenzar preparación» abre la confirmación del monto SOLO si el tipo cobra tarifa (`pideConfirmarTarifa`, D-450).
 *    Una Intertienda o un Transfer se mueven y ya, como en la ficha.
 *  - «Marcar listo» confirma SIEMPRE los pallets reales: es la escritura de `actual_pallets` (D-143, D-287).
 */
export function confirmacionDelPaso(
  id: IdDePasoDeBodega,
  pedido: Pick<Delivery, "order_type">,
  reglas: OrderTypeRules,
): ConfirmacionDelPaso {
  if (id === "marcar_listo") return "pallets";
  return pideConfirmarTarifa(pedido, reglas) ? "tarifa" : null;
}

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
