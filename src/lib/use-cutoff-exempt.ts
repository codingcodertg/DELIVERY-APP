"use client";

import { useEffect, useState } from "react";

/**
 * ¿A quien está mirando le toca el cierre de las 18:30? (D-NEXT)
 *
 * Lo pregunta al servidor, porque **el cliente no lo puede saber**. La exención es «admin de
 * Entregas» (`public.profiles.role`) u «owner de fichaje» (`clockin.profiles.role`), y ninguno de
 * los dos está a mano en el navegador: el `me.role` del Time Tracker es
 * `"admin" | "employee"` y sale de `profiles.timetracker_role`, que es **otra columna y otra
 * pregunta** — un `admin` de Time Tracker no es un `admin` de Entregas ni un `owner` de fichaje.
 * Deducirlo de ahí habría eximido a gente que no lo está.
 *
 * La respuesta se comparte entre quien la pida: el aviso de la esquina y el cronómetro preguntan
 * lo mismo, y sin esto serían dos peticiones por lo mismo y dos respuestas que podrían no
 * coincidir. Se pide **una vez por carga de página** y no caduca: la exención va con el rol, que
 * no cambia a media tarde, y si cambiara, la barrera de verdad sigue siendo el middleware.
 *
 * **Devuelve `null` mientras no se sabe, y también si la respuesta no llega**, y la dirección en
 * que eso se resuelve la decide cada quien, porque no es la misma:
 *
 *   · El aviso **no avisa** sin respuesta. Asustar a alguien por un fallo de red es peor que
 *     callarse, y la barrera de verdad sigue siendo el middleware.
 *   · El cronómetro **sí para** sin respuesta. Es el fallo recuperable: a un exento le cuesta un
 *     clic en Empezar, y al que no lo es le evita quedarse con la sesión muerta, el reloj
 *     corriendo y una fila huérfana que el cron cierra a los quince minutos (D-241).
 *
 * **Y hay que preguntar ANTES del corte.** Después, `/auth/cutoff` no es una consulta inofensiva:
 * pasa por el middleware como cualquier navegación —no lleva `/api/`, así que `skipsSession` no
 * la salta— y a un no exento le devuelve la redirección al login con las cookies ya borradas. O
 * sea que preguntar tarde no da «no exento»: da un `json()` que revienta.
 */
let enCurso: Promise<boolean | null> | null = null;

/**
 * La consulta, compartida. **Se cachea el «sí» y el «no», no el «no se sabe».**
 *
 * Un `sí` o un `no` son estables: van con el rol, que no cambia a media tarde. Un fallo no es
 * una respuesta, y dejarlo cacheado convertía un parpadeo de red de las 18:20 en un `null`
 * permanente **para toda la vida de la pestaña** — y el cronómetro es justo la pestaña que se
 * deja abierta, así que al `owner` se le habría parado el reloj hoy y todos los días hasta que
 * recargara, sin que nada lo dijera.
 *
 * `exento` puede venir `null` del servidor cuando la puerta no contesta, y aquí se respeta tal
 * cual en vez de aplanarlo a `false`: quien decide la dirección es cada consumidor.
 */
export function consultarExencion(): Promise<boolean | null> {
  enCurso ??= fetch("/auth/cutoff")
    .then((r) => r.json())
    .then((d: { exento?: boolean | null }) => (d.exento === true ? true : d.exento === false ? false : null))
    .catch(() => null)
    .then((v) => {
      if (v === null) enCurso = null; // no se sabe: la próxima vez se vuelve a preguntar
      return v;
    });
  return enCurso;
}

/**
 * Olvida la respuesta compartida. **Se llama al cerrar sesión**, y hace falta de verdad.
 *
 * La caché es de módulo, o sea de la carga de página. El «Cerrar sesión» de la pantalla sin
 * acceso hace `router.replace("/login")` —una navegación de cliente, sin recarga—, así que en
 * una tienda donde sale un `owner` y entra un vendedor en el mismo equipo, el vendedor heredaría
 * el `true` del anterior y a las 18:30 su reloj no se pararía. La respuesta va con la persona.
 *
 * También la usan las pruebas para aislarse entre casos; ese es su segundo motivo, no el primero.
 */
export function olvidarExencion() { enCurso = null; }

/** Cada cuánto se reintenta mientras no haya respuesta. El mismo tic que mira la hora. */
export const REINTENTO_MS = 30_000;

/**
 * Pregunta hasta tener una respuesta de verdad, y entonces para.
 *
 * Vaciar la caché tras un fallo **no basta**, y es un detalle que engaña: deja el sitio libre
 * pero nadie vuelve a ocuparlo. En el hook, `setExento(null)` sobre un estado que ya es `null`
 * no re-renderiza, y el `activo` del cronómetro pasa de `false` a `true` una sola vez, así que
 * sin esto un parpadeo de red a las 18:20 seguiría siendo un `null` definitivo — el mismo daño
 * que la caché pegada, con el arreglo puesto.
 *
 * Vive fuera del hook, como función corriente, para poder probar justo esa propiedad: **mientras
 * no se sabe se vuelve a preguntar; en cuanto se sabe, se deja de preguntar.**
 *
 * Un reintento que llega tarde no hace daño: como en el minuto del corte `null` para, solo
 * puede convertir un paro en un no-paro **antes** de las 18:30, nunca después.
 */
export function vigilarExencion(alSaber: (v: boolean) => void, intervaloMs: number = REINTENTO_MS): () => void {
  let vivo = true;
  let id: ReturnType<typeof setInterval> | null = null;
  const parar = () => { if (id !== null) { clearInterval(id); id = null; } };

  const intentar = () => {
    void consultarExencion().then((v) => {
      if (!vivo || v === null) return;
      parar();
      alSaber(v);
    });
  };

  intentar();
  id = setInterval(intentar, intervaloMs);
  return () => { vivo = false; parar(); };
}

export function useCutoffExempt(activo: boolean): boolean | null {
  const [exento, setExento] = useState<boolean | null>(null);

  useEffect(() => {
    if (!activo || exento !== null) return;
    return vigilarExencion(setExento);
  }, [activo, exento]);

  return exento;
}
