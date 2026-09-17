/**
 * Cambiar el propio nombre desde «Mi perfil» (D-274).
 *
 * Hasta hoy se cambiaba en la pantalla de Cuenta de Entregas, que deja de existir: redirige a «Mi
 * perfil», que es donde el hub centraliza la cuenta (D-265).
 *
 * La escritura es la misma que hacía la pantalla vieja, una actualización de `full_name` sobre la propia
 * fila de `profiles`. Que la base la deja pasar está medido dos veces: en el texto de las migraciones
 * (la política de actualización de la 099 deja escribir la propia fila; el guardia de la 104, la última
 * que lo define, solo le impide a un no-admin tocar permisos, tienda, usuario, rol del ERP y título), y
 * contra la base por el orquestador el 2026-09-17, con `ROLLBACK` y como un vendedor real: su propio
 * `full_name` → 1 fila; el de otro vendedor → 0 filas.
 *
 * Ese cero es la razón de `guardaMiNombre`. Un UPDATE que la política no deja pasar no da error en
 * PostgREST: vuelve limpio con cero filas. La pantalla vieja miraba el error pero no las filas, y decía
 * «Nombre actualizado» igual. Aquí se pide la fila de vuelta y sin ella no se da por guardado.
 */

/** El nombre que se guardaría, recortado y con los espacios de dentro unificados. Null si no vale. */
export function nombreParaGuardar(v: string | null | undefined): string | null {
  const limpio = (v ?? "").trim().replace(/\s+/g, " ");
  return limpio ? limpio : null;
}

/** ¿Hay algo que guardar? Un nombre vacío o igual al actual no llama a la base. */
export function hayCambioDeNombre(actual: string | null | undefined, propuesto: string | null | undefined): boolean {
  const nuevo = nombreParaGuardar(propuesto);
  return nuevo !== null && nuevo !== nombreParaGuardar(actual);
}

export type ClienteDePerfil = {
  from: (tabla: "profiles") => {
    update: (v: { full_name: string }) => { eq: (c: "id", v: string) => { select: (col: "id") => PromiseLike<{ data: unknown[] | null; error: unknown }> } };
  };
};

export type ResultadoDeNombre = { ok: true; nombre: string } | { ok: false; motivo: "vacio" | "escritura" | "sin_fila" };

export async function guardaMiNombre(cliente: ClienteDePerfil, id: string, propuesto: string): Promise<ResultadoDeNombre> {
  const nombre = nombreParaGuardar(propuesto);
  if (!nombre) return { ok: false, motivo: "vacio" };
  const { data, error } = await cliente.from("profiles").update({ full_name: nombre }).eq("id", id).select("id");
  if (error) return { ok: false, motivo: "escritura" };
  if (!data || data.length !== 1) return { ok: false, motivo: "sin_fila" };
  return { ok: true, nombre };
}
