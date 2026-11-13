import { pasosDelRelevo, type Bilingue } from "./relevo";
import { esPasoDeRelevo, etiquetaDeRelevo, letraDelPaso } from "./relevo-etiqueta";

/**
 * LA REGLA DE LAS FECHAS de una transferencia por relevo (D-1018, auditoría del 12 nov).
 *
 * D-994 ya impide que, el MISMO día, la recogida del paso b se planee antes de que llegue el paso a (+60 min). Faltaba la
 * regla entre DÍAS: reprogramar (el 📅 de la fila, «Reprogramar N», «Fecha pendiente», Recomendaciones) movía un paso sin
 * mirar al otro, y el paso b podía quedar un día ANTES que el a: un chofer saldría a recoger mercancía que no ha llegado.
 *
 *   · Un paso b (c, d…) nunca queda con día anterior al del paso que le precede (mientras ese no esté entregado). Si el
 *     anterior no tiene día («Fecha pendiente»), este tampoco puede tenerlo: se bloquea y se dice por qué.
 *   · Si un paso se mueve a un día POSTERIOR al de los que le siguen (o se queda sin día), los siguientes que todavía no
 *     salieron se mueven con él al mismo día (o se quedan sin día): `arrastra`, del último al primero, para que cada
 *     escritura sea válida por sí sola (la base repite la regla, migración 302).
 *
 * Regla pura: no escribe nada. `null` = sin día.
 */
type Paso = {
  id: string; order_no: number | string; order_code?: string | null; order_suffix?: string | null; relay_step?: number | null;
  is_training?: boolean; stage?: string; delivery_date?: string | null;
};

export type PlanDeFechaDelRelevo = { bloqueo: Bilingue | null; arrastra: { id: string; fecha: string | null }[] };

const SIN_CAMBIO: PlanDeFechaDelRelevo = { bloqueo: null, arrastra: [] };
const dia = (f: string | null | undefined) => (f ? f.slice(0, 10) : null);
const rotulo = (p: Paso) => etiquetaDeRelevo(p.order_code || p.order_no, p.order_suffix ?? letraDelPaso(p.relay_step ?? 1));
/** Un paso que ya salió (o se cerró) no se mueve ni frena a nadie. */
const YA_SALIO = new Set(["picked_up", "delivered", "canceled"]);

export function planDeFechaDelRelevo<T extends Paso>(d: T, nueva: string | null, todas: readonly T[]): PlanDeFechaDelRelevo {
  if (!esPasoDeRelevo(d)) return SIN_CAMBIO;
  const pasos = pasosDelRelevo(todas as never, d as never) as unknown as T[];
  const n = d.relay_step ?? 0;
  const f = dia(nueva);

  const anterior = pasos.find((p) => (p.relay_step ?? 0) === n - 1);
  if (anterior && anterior.stage !== "delivered" && f) {
    const fa = dia(anterior.delivery_date);
    if (!fa) {
      return { arrastra: [], bloqueo: {
        en: `Not yet: transfer step ${rotulo(anterior)} has no delivery date. Give that step a date first; this one can't go before it.`,
        es: `Todavía no: el paso ${rotulo(anterior)} de la transferencia no tiene día. Ponle día primero a ese paso; este no puede ir antes.`,
      } };
    }
    if (fa > f) {
      return { arrastra: [], bloqueo: {
        en: `Not allowed: transfer step ${rotulo(anterior)} is on ${fa}. This step can't be scheduled before it (the material would not be there yet).`,
        es: `No se puede: el paso ${rotulo(anterior)} de la transferencia va el ${fa}. Este paso no puede ir antes (la mercancía todavía no estaría ahí).`,
      } };
    }
  }

  const arrastra = pasos
    .filter((p) => (p.relay_step ?? 0) > n && !YA_SALIO.has(p.stage ?? ""))
    .filter((p) => { const fp = dia(p.delivery_date); return !!fp && (f === null || fp < f); })
    .sort((a, b) => (b.relay_step ?? 0) - (a.relay_step ?? 0))
    .map((p) => ({ id: p.id, fecha: f }));
  return { bloqueo: null, arrastra };
}

/** La nota que queda en el historial del paso que se movió arrastrado por el anterior. */
export function notaDeArrastre(fecha: string | null, lang: "en" | "es"): string {
  const a = fecha ?? (lang === "es" ? "Fecha pendiente" : "Pending Delivery Date");
  return lang === "es"
    ? `Movida a ${a} junto con el paso anterior de la transferencia (un paso no puede ir antes que el anterior).`
    : `Moved to ${a} together with the previous transfer step (a step can't go before the previous one).`;
}
