import type { Delivery, Stage } from "./types";

/**
 * Qué entra en un cambio en bloque, y qué se dice antes de hacerlo (D-372).
 *
 * **De dónde sale esto.** El 2026-09-23, a las 18:53 de Texas, el dueño cambió por error la fecha de **162 de 245 órdenes**,
 * **110 de ellas ya entregadas**. Dos cosas lo hicieron posible y una tercera impidió arreglarlo:
 *   1. el `<input type="date">` de la barra de selección aplicaba **en cuanto se elegía el día**, sin preguntar;
 *   2. el bloque no miraba la etapa: una entrega cerrada hace un mes se reprogramaba igual que una pendiente;
 *   3. y el historial apuntaba «Changed: Delivery Date» **sin la fecha anterior**, así que las 52 activas no se pudieron
 *      devolver a su día. Eso último se arregla en `changedFieldsNote`; aquí van las dos primeras.
 *
 * **Una entregada o anulada no se toca**, y no por permisos —el admin puede— sino porque en un cambio en bloque nadie las
 * está mirando de una en una. Quien quiera mover una entregada la abre y la mueve, que es donde se ve lo que se hace.
 */

/** Las que un cambio en bloque de fecha o de chofer deja en paz. */
export const ETAPAS_QUE_EL_BLOQUE_NO_TOCA: readonly Stage[] = ["delivered", "canceled"];

export interface RepartoDelBloque<T> { entran: T[]; saltadas: T[] }

/** Separa lo que se va a cambiar de lo que se salta, conservando el orden de la selección. */
export function reparteParaElBloque<T extends Pick<Delivery, "stage">>(seleccion: readonly T[]): RepartoDelBloque<T> {
  const entran: T[] = [], saltadas: T[] = [];
  for (const d of seleccion) (ETAPAS_QUE_EL_BLOQUE_NO_TOCA.includes(d.stage) ? saltadas : entran).push(d);
  return { entran, saltadas };
}

/** Cuántas de las saltadas son de cada etapa, para poder decirlo sin mentir («110 entregadas y 3 anuladas»). */
export function porEtapa<T extends Pick<Delivery, "stage">>(ordenes: readonly T[]): Partial<Record<Stage, number>> {
  const cuenta: Partial<Record<Stage, number>> = {};
  for (const d of ordenes) cuenta[d.stage] = (cuenta[d.stage] ?? 0) + 1;
  return cuenta;
}

/** Cuántas de la muestra se enseñan en la pregunta antes de poner «…». */
export const MUESTRA_DEL_BLOQUE = 8;

export interface TextoDelBloque { en: string; es: string }

/**
 * La pregunta que se hace ANTES de tocar nada: qué se va a hacer, a cuántas, una muestra de cuáles, y qué se salta.
 * `accion` viene ya traducida por quien llama, que es el único que sabe si es una fecha o un chofer.
 */
export function preguntaDelBloque<T extends { id: string }>(opts: {
  accion: TextoDelBloque;
  entran: readonly T[];
  saltadas: readonly (Pick<Delivery, "stage">)[];
  /** Cómo se llama cada orden en la muestra. Genérico para que quien llama no tenga que castear la suya. */
  etiqueta: (d: T) => string;
  etiquetaDeEtapa: (s: Stage, lang: "en" | "es") => string;
}): TextoDelBloque {
  const { accion, entran, saltadas, etiqueta, etiquetaDeEtapa } = opts;
  const muestra = entran.slice(0, MUESTRA_DEL_BLOQUE).map((d) => `#${etiqueta(d)}`).join(", ") + (entran.length > MUESTRA_DEL_BLOQUE ? "…" : "");
  const cuenta = porEtapa(saltadas);
  const trozos = (lang: "en" | "es") => Object.entries(cuenta)
    .sort((a, b) => b[1] - a[1])
    .map(([s, n]) => `${n} ${etiquetaDeEtapa(s as Stage, lang).toLowerCase()}`)
    .join(lang === "es" ? " y " : " and ");
  const saltadasEn = saltadas.length ? `\n\n${saltadas.length} order(s) are skipped: ${trozos("en")}. Open one to change it.` : "";
  const saltadasEs = saltadas.length ? `\n\nSe saltan ${saltadas.length} orden(es): ${trozos("es")}. Para cambiar una, ábrela.` : "";
  return {
    en: `${accion.en}\n\nThis changes ${entran.length} order(s):\n${muestra}${saltadasEn}`,
    es: `${accion.es}\n\nSe cambian ${entran.length} orden(es):\n${muestra}${saltadasEs}`,
  };
}
