import { PESTANA_DOCUMENTO_PENDIENTE } from "@/lib/documento-pendiente";
import { PESTANA_ATRASADAS } from "@/lib/atrasadas";

/**
 * La fila de pastillas de Órdenes: cuáles salen, en qué orden y cuál está encendida (D-313).
 *
 * El dueño: *«el filtro de invoices también falta el filtro de all en órdenes para que lo agregues»*.
 * Hasta ahora, para volver a verlas todas había que **volver a pulsar la pastilla encendida** —la
 * segunda pulsación la apaga— y eso no se descubre mirando la pantalla: nada dice que se pueda.
 * Almacén y Chofer ya tenían su «Todas»; esta fila era la única sin ella.
 *
 * Vive aquí y no en la pantalla porque son tres reglas que se contestan juntas y que hasta ahora
 * estaban repartidas por el JSX: qué pastillas hay, en qué orden, y cuál está activa.
 */

/** La pastilla de «todas»: no es una etapa, es la ausencia de filtro. Su clave ya era el centinela. */
export const PASTILLA_TODAS = "all";

export type PastillaDeOrdenes = {
  /** La clave del filtro. `PASTILLA_TODAS`, una etapa, la pestaña del documento pendiente o «Outdated». */
  key: string;
  /** Lo que la persona vería al pulsarla, con el resto de sus filtros ya aplicados. */
  cuenta: number;
  activa: boolean;
  /** Clase extra, para las dos que se pintan distintas: factura pendiente (D-310) y «Outdated» (D-NEXT). */
  clase?: string;
};

export function pastillasDeOrdenes(args: {
  /** Las etapas que ve este rol, en su orden (`filterStagesFor`). */
  etapas: readonly string[];
  /** Todas las tiendas aprueban solas: entonces nada se queda en «pendiente» y esa pastilla sobra. */
  todasAprueban: boolean;
  /** Las cuentas ya calculadas sobre lo que la persona ve. */
  cuentas: Record<string, number>;
  filtro: string;
}): PastillaDeOrdenes[] {
  const { etapas, todasAprueban, cuentas, filtro } = args;
  const n = (k: string) => cuentas[k] ?? 0;
  const pastilla = (key: string, clase?: string): PastillaDeOrdenes =>
    ({ key, cuenta: n(key), activa: filtro === key, ...(clase ? { clase } : {}) });

  // «Todas» va la PRIMERA, que es donde la buscó el dueño: antes de elegir nada, no después.
  const salida = [pastilla(PASTILLA_TODAS)];

  for (const key of etapas) {
    // Sin aprobación no hay cola de aprobación: la pastilla se cae, y con ella su cuenta a cero, que
    // sería una pastilla que nunca enseña nada.
    if (todasAprueban && key === "pending") continue;
    salida.push(pastilla(key));
  }

  // «Outdated» (D-NEXT) sale SIEMPRE, también con 0, a diferencia de la de factura pendiente. Las
  // atrasadas ya no están en la lista normal: si la pastilla se escondiera al no haber ninguna, el día
  // que hubiera no habría dónde buscarlas, y un 0 dice «no hay nada atrasado», que también es saberlo.
  // Va tras las etapas y antes de la de factura pendiente, que es la que aparece y desaparece: así
  // esta no cambia de sitio.
  salida.push(pastilla(PESTANA_ATRASADAS, "chip-late"));

  // La del documento pendiente (D-310) solo sale si hay algo pendiente **o** si se está dentro de
  // ella: si no, al vaciarse desaparecería bajo el dedo y la lista se quedaría en un filtro invisible.
  if (n(PESTANA_DOCUMENTO_PENDIENTE) > 0 || filtro === PESTANA_DOCUMENTO_PENDIENTE) {
    salida.push(pastilla(PESTANA_DOCUMENTO_PENDIENTE, "chip-pend"));
  }

  return salida;
}
