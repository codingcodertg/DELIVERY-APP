import { cookies } from "next/headers";
import { COOKIE_CAPACITACION, mensajeDeCapacitacion, valorDeCapacitacion } from "./capacitacion";
import type { Idioma } from "@/lib/idioma";

/**
 * La tercera capa del modo capacitación (D-490, ver `capacitacion.ts`): el servidor.
 *
 * Toda acción de servidor de fichaje que escribe (`app/timetracker/clock-in/actions/*.ts`) empieza así:
 *
 *     const corte = await corteDeCapacitacion();
 *     if (corte) return corte;
 *
 * antes de crear el cliente de Supabase, antes de leer nada y antes de avisar a nadie. Con la cookie de
 * práctica en la petición contesta «no se guardó» y la acción no llega a hacer nada: ni escribir, ni
 * mandar el aviso al gerente, ni geocodificar la parada. `capacitacion-acciones.test.ts` recorre las
 * acciones y exige esas dos líneas en cada una que no esté en su lista de lecturas.
 *
 * La respuesta tiene la forma que las acciones ya devuelven al fallar (`ok: false` y un `message`), y
 * `code: "error"` para que también encaje en el resultado de fichar entrada.
 */
export type RechazoDeCapacitacion = { ok: false; code: "error"; message: string; capacitacion: true };

/** Lo que contesta una acción con la práctica encendida. Aparte, para probarlo sin `next/headers`. */
export function rechazoDeCapacitacion(idioma: Idioma | null): RechazoDeCapacitacion | null {
  return idioma ? { ok: false, code: "error", message: mensajeDeCapacitacion(idioma), capacitacion: true } : null;
}

/** ¿Trae esta petición la práctica encendida? Lo lee de la cookie, que solo se manda a `/timetracker`. */
export async function capacitacionDeLaPeticion(): Promise<Idioma | null> {
  const almacen = await cookies();
  return valorDeCapacitacion(almacen.get(COOKIE_CAPACITACION)?.value);
}

export async function corteDeCapacitacion(): Promise<RechazoDeCapacitacion | null> {
  return rechazoDeCapacitacion(await capacitacionDeLaPeticion());
}
