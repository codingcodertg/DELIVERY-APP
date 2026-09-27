import type { Falta } from "./validar";

/**
 * La política del vendedor, **literal del documento del dueño** («Your rep policy popup»). Sale en
 * una ventana con una casilla obligatoria ANTES de generar la versión del cliente. Va en inglés como
 * él la escribió; la pantalla la acompaña de una traducción, pero la casilla firma este texto.
 */
export const POLITICA_TITULO = "CUSTOMER QUOTE POLICY";
export const POLITICA_PARRAFOS: readonly string[] = [
  "Do not print by default. Review pricing with the customer and encourage them to return for the best available price when ready to purchase.",
  "Printed/customer copy is a last resort. Generate one only when necessary to help close or retain the sale.",
  "One quote only. If the customer is considering multiple options, have them select their preferred option before generating a customer quote.",
  "Do not create competing quotes. Search the estimate number first. If another sales representative owns the estimate, obtain their approval before proceeding.",
];
export const POLITICA_CASILLA = "I have reviewed and will follow the Customer Quote Policy.";

export const POLITICA_PARRAFOS_ES: readonly string[] = [
  "No imprimir por defecto. Revisa los precios con el cliente y anímalo a volver por el mejor precio disponible cuando esté listo para comprar.",
  "La copia impresa para el cliente es el último recurso. Genérala solo cuando haga falta para cerrar o retener la venta.",
  "Una sola cotización. Si el cliente duda entre varias opciones, que elija la que prefiere antes de generar la cotización.",
  "No crees cotizaciones que compitan. Busca primero el número de estimado. Si es de otro vendedor, consigue su aprobación antes de seguir.",
];

/**
 * ¿Se puede abrir la ventana de la política? Solo sin nada pendiente. Y ¿se puede generar? Solo con
 * la casilla marcada. Dos preguntas, una función cada una, para que la pantalla no las mezcle.
 */
export function sePuedePedirLaCopia(faltas: readonly Falta[]): boolean {
  return faltas.length === 0;
}

export function sePuedeGenerar(faltas: readonly Falta[], politicaAceptada: boolean): boolean {
  return sePuedePedirLaCopia(faltas) && politicaAceptada === true;
}
