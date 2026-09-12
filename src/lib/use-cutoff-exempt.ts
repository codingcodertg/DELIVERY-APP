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

function preguntar(): Promise<boolean | null> {
  enCurso ??= fetch("/auth/cutoff")
    .then((r) => r.json())
    .then((d: { exento?: boolean }) => !!d.exento)
    // Sin respuesta se devuelve `null` y NO un valor cómodo: inventarse un `true` aquí sería
    // decidir por los dos consumidores a la vez, y cada uno necesita la contraria.
    .catch(() => null);
  return enCurso;
}

/** Solo para las pruebas: olvida la respuesta compartida. */
export function olvidarExencion() { enCurso = null; }

export function useCutoffExempt(activo: boolean): boolean | null {
  const [exento, setExento] = useState<boolean | null>(null);

  useEffect(() => {
    if (!activo || exento !== null) return;
    let vivo = true;
    preguntar().then((v) => { if (vivo) setExento(v); });
    return () => { vivo = false; };
  }, [activo, exento]);

  return exento;
}
