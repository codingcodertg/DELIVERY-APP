/**
 * Eliminar y restaurar una solicitud de ayuda (262, D-NEXT): las dos llamadas a la base y qué contestó.
 *
 * Quién puede NO se decide aquí: lo decide la 262 (`delete_help_request` — quien la escribió o un admin;
 * `restore_help_request` — solo un admin). Esto solo traduce la respuesta a algo que la pantalla sabe contar.
 *
 * Sin hooks ni nada de React, a propósito: es una librería que puede acabar importada desde una ruta de servidor,
 * y un módulo así no puede traer `useState` (la lección de `ayuda-ubicacion-hook.ts`).
 */

type ErrorDeBase = { code?: string | null; message?: string | null };

/** Lo justo del cliente de Supabase: así las pruebas pasan uno de mentira. */
export type ClienteDeEliminar = {
  rpc: (fn: string, args: { p_id: string }) => PromiseLike<{ data: unknown; error: ErrorDeBase | null }>;
};

export type ResultadoDeEliminar =
  | { tipo: "hecho" }
  /** La base aún no tiene la 262: no hay función a la que llamar. */
  | { tipo: "sin-migracion" }
  /** La base dijo que no: no es suya, o no existe (contesta lo mismo a propósito). */
  | { tipo: "no-permitido" }
  | { tipo: "error"; mensaje: string };

export const FUNCION_DE_ELIMINAR = "delete_help_request";
export const FUNCION_DE_RESTAURAR = "restore_help_request";

/** PostgREST dice PGRST202 cuando la función no está en su esquema; Postgres, 42883. */
function lee(error: ErrorDeBase | null): ResultadoDeEliminar {
  if (!error) return { tipo: "hecho" };
  if (error.code === "PGRST202" || error.code === "42883") return { tipo: "sin-migracion" };
  if (error.code === "42501") return { tipo: "no-permitido" };
  return { tipo: "error", mensaje: error.message || "?" };
}

async function llama(cliente: ClienteDeEliminar, funcion: string, id: string): Promise<ResultadoDeEliminar> {
  try {
    const { error } = await cliente.rpc(funcion, { p_id: id });
    return lee(error);
  } catch (e) {
    // Sin red: `rpc` no devuelve un error, revienta.
    return { tipo: "error", mensaje: e instanceof Error ? e.message : String(e) };
  }
}

export function eliminaSolicitud(cliente: ClienteDeEliminar, id: string): Promise<ResultadoDeEliminar> {
  return llama(cliente, FUNCION_DE_ELIMINAR, id);
}

export function restauraSolicitud(cliente: ClienteDeEliminar, id: string): Promise<ResultadoDeEliminar> {
  return llama(cliente, FUNCION_DE_RESTAURAR, id);
}

/** Lo que se le dice a la persona cuando no salió. `null` si salió. */
export function mensajeDeEliminar(r: ResultadoDeEliminar, t: (en: string, es: string) => string, accion: "eliminar" | "restaurar" = "eliminar"): string | null {
  if (r.tipo === "hecho") return null;
  if (r.tipo === "sin-migracion") return t("This isn't available yet — try again later.", "Esto todavía no está disponible — intente más tarde.");
  if (r.tipo === "no-permitido") {
    return accion === "eliminar"
      ? t("You can only delete your own requests.", "Solo puede eliminar sus propias solicitudes.")
      : t("Only an admin can restore a request.", "Solo un admin puede restaurar una solicitud.");
  }
  return accion === "eliminar"
    ? t(`Couldn't delete it: ${r.mensaje}`, `No se pudo eliminar: ${r.mensaje}`)
    : t(`Couldn't restore it: ${r.mensaje}`, `No se pudo restaurar: ${r.mensaje}`);
}
