import { cuentasQueCoinciden } from "./account-search";

/**
 * El campo de cuenta como UN solo control: se escribe y sugiere (D-305).
 *
 * El dueño, con captura: *«I wanted this field be a search bar that autopopulates automatically when
 * you start typing, so it will be a search and dropdown in the same field»*. D-299 había puesto DOS
 * controles —un filtro encima y un `select` debajo— y él veía «elite» escrito arriba y «Select
 * account…» abajo, que es exactamente lo que no quería.
 *
 * Lo que decide este módulo, y por qué está fuera del componente: **cuándo se elige** una cuenta.
 * Elegir dispara el autorrellenado de contacto, teléfono y tipo de orden, así que no puede pasar con
 * cada tecla —eso reescribiría el tipo con nombres a medio escribir—, solo al **confirmar**: clic en
 * una sugerencia, Enter, o salir del campo. Y lo que se escribe sin estar en la lista es una cuenta
 * manual con ese texto, sin botón aparte. El filtro sigue siendo `cuentasQueCoinciden` (D-299).
 */

/**
 * Cuántas letras hay que teclear para que el campo sugiera (D-NEXT, afina D-305). El dueño no quiere que el campo enseñe la
 * lista de cuentas sin más —«cuentas shouldn't show you the list»—: ni al enfocarlo ni con una sola letra.
 */
export const LETRAS_PARA_SUGERIR = 2;

/** Las sugerencias para lo escrito: ninguna hasta haber tecleado `LETRAS_PARA_SUGERIR`. La cuenta ya puesta nunca desaparece
 *  de las que sí salen. */
export function sugerenciasPara(opciones: readonly string[], texto: string, actual?: string | null): string[] {
  if (texto.trim().length < LETRAS_PARA_SUGERIR) return [];
  return cuentasQueCoinciden(opciones, texto, actual);
}

/** Mover el resaltado con las flechas, dando la vuelta; −1 es «ninguna». Sin sugerencias no hay a dónde ir. */
export function siguienteIndice(activo: number, total: number, delta: 1 | -1): number {
  if (total <= 0) return -1;
  if (activo < 0) return delta === 1 ? 0 : total - 1;
  return (activo + delta + total) % total;
}

export type Confirmacion =
  | { origen: "lista"; valor: string }     // una sugerencia: la resaltada, o la única que coincide exacto
  | { origen: "manual"; valor: string }    // texto que no está en la lista: cuenta nueva con ese nombre
  | { origen: "vacio"; valor: "" };        // se borró todo: la orden se queda sin cuenta

/**
 * Qué se elige al confirmar (Enter o salir del campo).
 *
 * 1. Si hay una sugerencia resaltada con las flechas, esa.
 * 2. Si no, y lo escrito es **exactamente** una de las sugerencias (sin importar mayúsculas ni
 *    espacios), esa — para que teclear el nombre completo cuente como elegirlo.
 * 3. Si no, lo escrito es una cuenta manual. Vacío es vacío.
 */
export function decisionAlConfirmar(a: { texto: string; sugerencias: readonly string[]; activo: number }): Confirmacion {
  const texto = a.texto.trim();
  if (a.activo >= 0 && a.activo < a.sugerencias.length) return { origen: "lista", valor: a.sugerencias[a.activo] };
  const exacta = a.sugerencias.find((s) => s.trim().toLowerCase() === texto.toLowerCase());
  if (exacta) return { origen: "lista", valor: exacta };
  if (!texto) return { origen: "vacio", valor: "" };
  return { origen: "manual", valor: texto };
}

/** Solo se avisa al formulario si el valor cambió: confirmar lo que ya estaba no reescribe nada. */
export function hayQueAvisar(actual: string | null | undefined, valor: string): boolean {
  return (actual ?? "") !== valor;
}
