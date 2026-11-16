/**
 * Ejecuta `fn` sobre cada elemento con como mucho `limite` en vuelo a la vez, y devuelve los resultados EN EL ORDEN DE
 * LA ENTRADA (no en el de terminación). Sirve para sustituir un `for … await` secuencial sin cambiar lo que sale:
 * cada elemento sigue siendo independiente, y si uno lanza, la promesa rechaza igual que el bucle que sustituye.
 *
 * Es un pool mínimo a propósito: nada de dependencias para seis líneas de cola.
 */
export async function enParalelo<T, R>(
  items: readonly T[],
  limite: number,
  fn: (item: T, indice: number) => Promise<R>,
): Promise<R[]> {
  const tope = Math.max(1, Math.floor(limite));
  const salida: R[] = new Array(items.length);
  let siguiente = 0;
  async function obrero(): Promise<void> {
    while (siguiente < items.length) {
      const i = siguiente++;
      salida[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(tope, items.length) }, () => obrero()));
  return salida;
}
