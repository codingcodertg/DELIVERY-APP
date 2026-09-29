import type { Delivery } from "@/lib/types";
import { orderTypeRule, type OrderTypeRules } from "@/lib/required";
import { changedFieldsNote, fmtMoney } from "@/lib/utils";

/**
 * Confirmar la tarifa al «Comenzar preparación» (D-450), SIN bloqueo.
 *
 * El dueño, 2026-09-29: *«It's not asking warehouse to confirm delivery fee before they start preparing
 * they just need to confirm the amount»*. Preguntado si vuelve así, eligió **«confirmar el monto, sin
 * bloqueo»**: al pulsar el botón sale el monto, se confirma o se corrige ahí mismo, y si no hay tarifa se
 * sigue igual, quedando anotado.
 *
 * Es la tercera vuelta de la misma pieza, y conviene leerla con las otras dos delante:
 *  - D-146 la puso aquí y **exigía** una tarifa no vacía (el bloqueo).
 *  - D-287 le abrió la salida «Sin tarifa — continuar igual».
 *  - D-340 quitó el diálogo entero porque el dueño pidió quitar **el bloqueo** — y con él se fue la
 *    confirmación, que en 25 de 46 veces había corregido la tarifa.
 *  - D-373 devolvió al almacén la escritura del campo, sin diálogo.
 * Esta vuelve la confirmación y deja fuera el bloqueo: la salida sin tarifa está siempre que no haya
 * tarifa, y ninguna rama de aquí impide mover la etapa por falta de un número.
 */

/**
 * ¿A esta orden se le pide confirmar la tarifa?
 *
 * Solo a los tipos que **cobran** una tarifa al cliente, y quién cobra lo dice la regla del tipo —la
 * misma que en `required.ts` hace obligatoria la tarifa (`docRef === "invoice"`: Customer y cualquier tipo
 * sin configurar que no sea traslado ni recogida)—. No se vuelve a decidir aquí con una lista de nombres.
 *
 * Una Intertienda o un Transfer no cobran a nadie: la tarifa ahí es opcional y casi siempre vacía, así que
 * preguntar «¿confirma $—?» en cada traslado sería un clic de trámite que enseña a pulsar sin mirar —justo
 * el reflejo que la confirmación viene a romper—. La 🚩 SIN TARIFA de D-148, que sí vale para todos los
 * tipos, **no se toca**: esa sigue avisando de los traslados sin tarifa en la tabla y en la ficha.
 */
export function pideConfirmarTarifa(orden: Pick<Delivery, "order_type">, reglas: OrderTypeRules): boolean {
  return (orderTypeRule(orden.order_type, reglas).docRef ?? "invoice") === "invoice";
}

/** La orden llega sin cobrar: vacía o $0 (D-147). Es cuando se ofrece «Sin tarifa — continuar igual». */
export const llegaSinTarifa = (antes: number | null | undefined): boolean => antes == null || Number(antes) === 0;

export type CasoDeTarifa = "confirmada" | "corregida" | "sin";

export interface EscrituraAlComenzar {
  caso: CasoDeTarifa;
  /** Lo que viaja en la MISMA escritura que la etapa. `undefined` cuando la tarifa no cambia: no se reescribe. */
  extra: Partial<Delivery> | undefined;
  /** La nota del evento de etapa, en los dos idiomas; la pantalla elige con `t`. */
  nota: { en: string; es: string };
}

/**
 * Qué se escribe al comenzar la preparación, según lo que haya en el campo.
 *
 * - `sinTarifa`: el botón «Sin tarifa — continuar igual». **No escribe tarifa** —ni la sugerida ni un
 *   cero—: la orden sigue saliendo con su 🚩 y quien tenga que cobrarla la encuentra (D-287).
 * - Si no, el número tecleado. Igual al que había → «confirmada», sin tocar `delivery_fee`. Distinto →
 *   «corregida», con `delivery_fee` en el `extra` y el rastro de D-372 en la nota: «Delivery Fee: 126 → 80»,
 *   que es lo que permite saber después de qué valor venía.
 *
 * `null` si el número no vale (vacío o negativo): el botón principal no se puede pulsar entonces, así que
 * esto no es un bloqueo sino la otra mitad de pintarlo desactivado. Cero **sí** vale: una entrega de
 * cortesía se confirma a $0.
 */
export function escrituraAlComenzar(
  antes: number | null | undefined,
  tecleada: number | null,
  sinTarifa = false,
): EscrituraAlComenzar | null {
  if (sinTarifa) {
    return {
      caso: "sin",
      extra: undefined,
      nota: { en: "No fee — started without a delivery fee charged", es: "Sin tarifa — se empezó sin tarifa de entrega cobrada" },
    };
  }
  if (tecleada == null || !Number.isFinite(tecleada) || tecleada < 0) return null;
  const previa = antes == null ? null : Number(antes);
  if (previa === tecleada) {
    return {
      caso: "confirmada",
      extra: undefined,
      nota: { en: `Fee confirmed ${fmtMoney(tecleada)}`, es: `Tarifa confirmada ${fmtMoney(tecleada)}` },
    };
  }
  const rastro = changedFieldsNote({ delivery_fee: antes ?? null }, { delivery_fee: tecleada });
  return {
    caso: "corregida",
    extra: { delivery_fee: tecleada },
    nota: { en: `Fee corrected — ${rastro}`, es: `Tarifa corregida — ${rastro}` },
  };
}
