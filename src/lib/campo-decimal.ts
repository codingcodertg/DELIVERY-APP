/**
 * Un campo de número que deja escribir decimales (D-420).
 *
 * El fallo: el Estimador guardaba el número ya leído y lo volvía a pintar con `String(n)`. Al teclear «23.» se leía
 * 23 y se pintaba «23»: el punto desaparecía antes de poder escribir el 8, y no había forma de meter 23.80 ni 1.89.
 * La salida es pintar LO QUE SE TECLEÓ mientras diga el mismo número que el valor guardado, y solo cuando el valor
 * cambia desde fuera (el catálogo rellena el precio, se vacía la línea) pintar el valor nuevo.
 */

/** El número de lo tecleado, o `null` si no hay número. Las comas de miles se ignoran («1,250» = 1250). */
export function leeDecimal(texto: string): number | null {
  const limpio = texto.replace(/,/g, "").trim();
  if (limpio === "" || limpio === "." || limpio === "-") return null;
  const n = Number(limpio.endsWith(".") ? limpio.slice(0, -1) : limpio);
  return Number.isFinite(n) ? n : null;
}

/** Solo lo que puede formar un número: dígitos, un punto, comas de miles y un signo delante. */
export function limpiaDecimal(texto: string): string {
  let visto = false;
  let out = "";
  for (const [i, ch] of [...texto].entries()) {
    if (ch >= "0" && ch <= "9") out += ch;
    else if (ch === ",") out += ch;
    else if (ch === "." && !visto) { visto = true; out += ch; }
    else if (ch === "-" && i === 0) out += ch;
  }
  return out;
}

export const aTexto = (v: number | null | undefined): string => (v === null || v === undefined ? "" : String(v));

/** Lo que se pinta: lo tecleado si todavía dice `valor`; si no, `valor` (cambió desde fuera). */
export function textoAPintar(tecleado: string, valor: number | null | undefined): string {
  return leeDecimal(tecleado) === (valor ?? null) ? tecleado : aTexto(valor);
}
