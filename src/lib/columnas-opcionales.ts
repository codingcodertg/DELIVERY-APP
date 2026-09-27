/**
 * Leer pidiendo columnas que la base puede no tener todavía (D-415 lo hizo para `priority`; D-NEXT lo generaliza para
 * los requisitos del camión, 151).
 *
 * Las migraciones se aplican DESPUÉS de fusionar, así que hay una ventana en la que el código nuevo corre contra la base
 * vieja. PostgREST no devuelve las demás columnas sin la que falta: rechaza la consulta ENTERA (`42703` o `PGRST204`,
 * nombrándola; los dos códigos se midieron contra producción al escribir D-412/D-415). Entonces se quita ESA columna y
 * se vuelve a leer, hasta que no falte ninguna. Cualquier otro error —o uno que nombra otra columna— se devuelve tal
 * cual: no es cosa de estas. Nunca lee más veces que columnas opcionales más una.
 */
export type LecturaConError<D> = { data: D; error: { code?: string; message: string } | null };

/** ¿Nombra el mensaje esa columna, como palabra entera? `morning_priority` no nombra `priority`. */
export const nombraLaColumna = (mensaje: string, columna: string): boolean => mensaje.split(/[^A-Za-z0-9_]+/).includes(columna);

export async function leeConOpcionales<D>(
  lee: (columnas: string) => PromiseLike<LecturaConError<D>>,
  base: string,
  opcionales: readonly string[],
): Promise<LecturaConError<D>> {
  let quedan = [...opcionales];
  for (;;) {
    const r = await lee([base, ...quedan].join(", "));
    const e = r.error;
    const falta = e && (e.code === "42703" || e.code === "PGRST204") ? quedan.find((c) => nombraLaColumna(e.message, c)) : undefined;
    if (!falta) return r;
    quedan = quedan.filter((c) => c !== falta);
  }
}
