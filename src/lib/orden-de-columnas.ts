/**
 * El ORDEN de las columnas de la tabla de Órdenes, elegido por cada persona (D-NEXT). El dueño: «let me rearrange
 * the columns».
 *
 * El orden se guarda APARTE de qué columnas se ven. No es un capricho: los arrays de columnas visibles que ya hay
 * guardados están en el orden en que alguien fue marcando casillas (`[...cols, clave]`), no en un orden que nadie
 * eligiera. Si el array de visibles mandara también en el orden, a todo el que ya tiene algo guardado —y a ventas
 * entera, por `settings.sales_columns`— se le recolocarían las columnas solas. Así que: sin orden guardado, el
 * canónico, exactamente como hasta hoy; nadie nota nada hasta que pulsa una flecha.
 *
 * Y de propina: ocultar una columna y volver a mostrarla no le hace perder su sitio.
 */

/** El orden de TODAS las columnas para esta persona: lo guardado —sin lo que ya no existe ni repetidas—, y al final,
 *  en su orden canónico, las que lo guardado no conoce (una columna nueva entra al final). */
export function ordenEfectivo(canonicas: readonly string[], guardado: readonly string[] | null | undefined): string[] {
  const existen = new Set(canonicas);
  const suyo = [...new Set(guardado ?? [])].filter((k) => existen.has(k));
  const ya = new Set(suyo);
  return [...suyo, ...canonicas.filter((k) => !ya.has(k))];
}

/** Las columnas que se PINTAN: las visibles, en el orden de la persona. */
export function columnasEnOrden(visibles: readonly string[], orden: readonly string[]): string[] {
  const si = new Set(visibles);
  return orden.filter((k) => si.has(k));
}

/**
 * Sube (-1) o baja (+1) una columna un puesto ENTRE LAS VISIBLES, que es lo que la persona ve moverse: si entre dos
 * columnas visibles hay una oculta, una pulsación salta por encima de ella en vez de no hacer nada aparente.
 * En el tope no pasa nada. Una clave desconocida, tampoco. Devuelve siempre una lista nueva.
 */
export function mueveColumna(orden: readonly string[], clave: string, delta: -1 | 1, visibles?: readonly string[]): string[] {
  const r = [...orden];
  const i = r.indexOf(clave);
  if (i < 0) return r;
  const cuenta = visibles ? new Set(visibles) : null;
  // Una columna oculta se mueve de a un puesto; una visible, hasta la siguiente visible.
  const salta = (k: string) => !!cuenta && cuenta.has(clave) && !cuenta.has(k);
  let j = i + delta;
  while (j >= 0 && j < r.length && salta(r[j])) j += delta;
  if (j < 0 || j >= r.length) return r;
  r.splice(i, 1);
  r.splice(j, 0, clave);
  return r;
}
