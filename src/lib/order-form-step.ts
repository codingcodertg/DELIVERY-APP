// ============================================================
// Qué pantalla enseña el formulario de una orden en modo edición (D-304).
//
// Una orden nueva tiene dos pasos: uno corto (tipo y dirección, para tarifar) y el formulario
// completo. Los tipos tienda-a-tienda saltan el corto. D-302 empezó a saltarlo también cuando la
// orden YA nace de ese tipo (gerente y office abren en Intertienda), pero el formulario completo
// seguía esperando a que alguien pulsara «Siguiente»: la orden nueva no enseñaba ni el paso corto ni
// el completo, y el dueño vio un modal con solo la cabecera. Lo que faltaba no era una condición
// más, sino que las dos salieran del mismo sitio: aquí se decide UNA vez, y no puede salir vacío.
// ============================================================

export type PasoFormulario = "inicial" | "completo";

/**
 * `inicial` solo para una orden nueva, que aún no pasó de «Siguiente» y no es tienda-a-tienda.
 * Todo lo demás es el formulario completo. Nunca «ninguno»: una orden en edición siempre enseña algo.
 */
export function pasoFormulario(esNueva: boolean, pasoDeSiguiente: boolean, tiendaATienda: boolean): PasoFormulario {
  if (!esNueva || pasoDeSiguiente || tiendaATienda) return "completo";
  return "inicial";
}
