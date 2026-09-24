import type { NamedLocation } from "@/lib/types";

/**
 * A qué ronda se entra cuando alguien escribe `/promos`, y qué hace falta avisar al llegar (D-NEXT).
 *
 * **Por qué desaparece la lista de rondas.** El dueño mandó una captura de esa pantalla —la tabla de
 * rondas con el renglón «Toca una ronda para aprobar o rechazar sus productos»— y dijo: *«esto
 * elimínalo, que entre directo a la tabla»*. La lista era un paso que casi siempre tenía **una sola
 * respuesta**: la ronda de este mes. Obligar a elegir entre una cosa no es ofrecer una elección.
 *
 * **Lo que no se puede perder es llegar a una ronda vieja**, que es a lo que servía la lista: una
 * decisión de hace dos meses se consulta, y el admin puede necesitar reabrir. Por eso lo que se
 * quita es la *página*, no el *acceso*: el selector vive dentro de la propia tabla, al lado del
 * título, y se sigue entrando por `/promos/<id>` como siempre.
 *
 * Esto es puro a propósito: la página de servidor solo redirige a lo que aquí se decide.
 */

/** Lo mínimo de una ronda para elegir a cuál se entra. */
export interface RondaParaEntrar {
  id: string;
  /** ISO. Es el orden que ya usa la consulta: la más nueva primero. */
  uploaded_at: string;
  closed_at: string | null;
}

/**
 * La ronda a la que se entra: **la más reciente que siga ABIERTA**; si todas están cerradas, la más
 * reciente de todas. `null` cuando no hay ninguna.
 *
 * Lo de preferir una abierta no es un detalle: a una ronda cerrada no se le puede decidir nada, y
 * entrar a una pantalla donde todos los botones están apagados se lee como que la app está rota.
 * Con una cerrada delante y una abierta detrás —que pasa el día que se sube la siguiente sin haber
 * cerrado la anterior— entrar a la cerrada sería entrar justo a la que no toca.
 *
 * No supone que la lista venga ordenada: ordenar aquí cuesta nada y quita una dependencia
 * silenciosa con el `order` de la consulta, que está en otro fichero y se puede cambiar sin mirar.
 */
export function rondaDeEntrada(rondas: readonly RondaParaEntrar[]): RondaParaEntrar | null {
  if (rondas.length === 0) return null;
  const porFecha = [...rondas].sort((a, b) => (a.uploaded_at < b.uploaded_at ? 1 : a.uploaded_at > b.uploaded_at ? -1 : 0));
  return porFecha.find((r) => r.closed_at === null) ?? porFecha[0];
}

/**
 * Las tiendas a las que les falta el grupo de promociones.
 *
 * El aviso de «pon el grupo de cada tienda en Datos» se enseñaba **siempre** al admin, en la
 * pantalla que ahora desaparece. Un aviso permanente sobre algo que ya está hecho —los seis grupos
 * llevan puestos desde que se estrenó el módulo— deja de leerse a las dos semanas, y entonces
 * tampoco se lee el día que sí falta uno. Así que ahora se enseña **solo si falta alguno**, y
 * diciendo **cuáles**, que es lo que hace falta para arreglarlo.
 *
 * Una tienda sin grupo no es un detalle de configuración: nadie de esa tienda puede aprobar nada.
 */
export function tiendasSinGrupoDePromos(tiendas: readonly NamedLocation[]): string[] {
  return tiendas
    .filter((t) => ((t.promo_group ?? "").trim() === ""))
    .map((t) => (t.name ?? "").trim())
    .filter((n) => n !== "");
}
