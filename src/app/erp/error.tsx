"use client";

import { ProfileReadError } from "@/components/ProfileReadError";

/**
 * La frontera de error del ERP (D-NEXT).
 *
 * `getSessionInfo()` **lanza** cuando el perfil no se puede leer, en vez de
 * seguir con un rol inventado. Lo que lanza cae aquí, y aquí se pinta **la misma
 * pantalla que en el resto del hub** (D-234): un solo camino de error para todo,
 * y no dos versiones que envejecen por separado.
 *
 * **Por qué nunca sale el detalle aquí, aunque quien mire sea admin:** Next borra
 * el mensaje de un error lanzado en el servidor antes de mandarlo al navegador y
 * solo deja un `digest`. Es una protección suya, no un descuido nuestro, y no hay
 * forma de saltársela sin mandar el mensaje por otro canal. Por eso
 * `getSessionInfo()` escribe el mensaje entero en el log del servidor antes de
 * lanzar, y aquí se enseña el `digest` como referencia: con él, quien mire el log
 * encuentra la línea.
 */
export default function ErpError({ error }: { error: Error & { digest?: string } }) {
  return (
    <ProfileReadError
      error={{ message: error.message, code: error.digest ?? null }}
      // Nunca. No es una decisión de permisos: es que aquí no hay detalle que
      // enseñar — lo que llega ya viene sin él.
      verDetalle={false}
    />
  );
}
