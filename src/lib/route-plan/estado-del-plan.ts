/**
 * En qué está el plan de «Armar las rutas del día» para una fecha, dicho en una pastilla junto al botón de la cabecera
 * del Gestor (D-NEXT).
 *
 * El dueño, 2026-10-01: «el boton de build routes solo ahi dejalo no quiero que siga aparecieron el otro dialog que se
 * abrees inecesario». «El otro» era la tarjeta plegada «🧭 Armar las rutas del día automáticamente ▸ · Borrador v2», que
 * repetía el botón. Se quitó, y lo único que decía plegada —la versión del borrador o del publicado, o cuántas órdenes de
 * la fecha siguen sin plan— es esto, para que no se pierda.
 */
export type EstadoDelPlan = { tipo: "borrador" | "publicado"; version: number } | { tipo: "sin_plan"; ordenes: number };

/** `plan`: el último plan de la fecha, si lo hay. `ordenes`: las ruteables de la fecha. Sin plan y sin órdenes, nada que decir. */
export function estadoDelPlan(plan: { status: string; version: number } | null, ordenes: number): EstadoDelPlan | null {
  if (plan) return { tipo: plan.status === "published" ? "publicado" : "borrador", version: plan.version };
  return ordenes > 0 ? { tipo: "sin_plan", ordenes } : null;
}

/** El texto corto de la pastilla y el largo de su `title`. Los mismos que decía la tarjeta plegada. */
export function textoDelEstadoDelPlan(e: EstadoDelPlan, es: boolean): { texto: string; titulo: string } {
  if (e.tipo === "sin_plan") {
    return es
      ? { texto: `${e.ordenes} sin plan`, titulo: `${e.ordenes} orden(es) de esta fecha sin plan` }
      : { texto: `${e.ordenes} with no plan`, titulo: `${e.ordenes} order(s) on this date with no plan` };
  }
  const publicado = e.tipo === "publicado";
  return es
    ? { texto: `${publicado ? "Publicado" : "Borrador"} v${e.version}`, titulo: publicado ? `El plan de esta fecha está publicado (versión ${e.version})` : `Hay un borrador del plan de esta fecha (versión ${e.version}), sin publicar` }
    : { texto: `${publicado ? "Published" : "Draft"} v${e.version}`, titulo: publicado ? `This date's plan is published (version ${e.version})` : `There is a draft of this date's plan (version ${e.version}), not published yet` };
}
