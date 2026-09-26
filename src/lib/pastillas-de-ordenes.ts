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
  /** Clase extra, para las dos que se pintan distintas: factura pendiente (D-310) y «Outdated» (D-384). */
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
  /**
   * ¿Es alguien a quien «Factura pendiente» corta por tienda y no tiene tienda? (D-404) Entonces la
   * pastilla sale aunque diga 0, para que al pulsarla lea por qué no hay nada, en vez de no saber que
   * existe. Lo decide `alcancePendientes` de `ordenesVisibles`, el mismo valor que cortó la lista.
   */
  pendientesSinTienda: boolean;
}): PastillaDeOrdenes[] {
  const { etapas, todasAprueban, cuentas, filtro, pendientesSinTienda } = args;
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

  // «Outdated» (D-384), en rojo. Desde D-404 funciona **como la de factura pendiente**, que es lo que
  // pidió el dueño (*«a similar filter like invoice pending pero en rojo»*): sale si tiene algo dentro
  // o si se está en ella —si no, al vaciarse desaparecería bajo el dedo—, y **para todos los roles**,
  // cada uno con las atrasadas que ve (admin y logística, todas; los demás, las de ayer, D-392).
  // Antes salía siempre, también con 0 (D-384), y solo para admin y logística (D-392).
  // Va tras las etapas y antes de la de factura pendiente.
  if (n(PESTANA_ATRASADAS) > 0 || filtro === PESTANA_ATRASADAS) {
    salida.push(pastilla(PESTANA_ATRASADAS, "chip-late"));
  }

  // La del documento pendiente (D-310) solo sale si hay algo pendiente **o** si se está dentro de
  // ella: si no, al vaciarse desaparecería bajo el dedo y la lista se quedaría en un filtro invisible.
  // Y a quien no tiene tienda le sale siempre, con 0 (D-404): dentro se le dice por qué.
  if (n(PESTANA_DOCUMENTO_PENDIENTE) > 0 || filtro === PESTANA_DOCUMENTO_PENDIENTE || pendientesSinTienda) {
    salida.push(pastilla(PESTANA_DOCUMENTO_PENDIENTE, "chip-pend"));
  }

  return salida;
}
