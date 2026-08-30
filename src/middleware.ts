import { type NextRequest } from "next/server";
import { refreshSession } from "@/lib/supabase/middleware";

/**
 * EN `src/`, Y ESO ES EL ARREGLO (D-119).
 *
 * Este fichero existía en la raíz del repo. Next busca el middleware **al lado de la carpeta
 * `app`**, y aquí `app` está en `src/`, así que nunca se emitió: el manifiesto del build salía
 * literalmente vacío. Estuvo muerto todo este tiempo sin que nada lo dijera — ningún error,
 * ningún aviso, solo funciones que no ocurrían.
 *
 * Si alguien lo mueve otra vez a la raíz, vuelve el fallo de "todo sale vacío hasta que
 * recargo" y no habrá nada en pantalla que lo explique. `middleware-location.test.ts` está
 * para que eso salte en las pruebas y no en producción un lunes por la mañana.
 *
 * De momento SOLO refresca la sesión. El guard de rutas está escrito y sigue desconectado a
 * propósito: es el paso 2, y es un cambio de comportamiento que se revisa aparte.
 */
export async function middleware(request: NextRequest) {
  return await refreshSession(request);
}

export const config = {
  matcher: [
    // Todo menos estáticos, imágenes y el túnel de Sentry — esa ruta transporta los sobres de
    // error del navegador y no debe pasar por aquí. Las rutas de API se excluyen dentro de
    // `refreshSession`, porque van anidadas (/timetracker/clock-in/api/...) y un lookahead
    // anclado al principio no las alcanza.
    "/((?!monitoring|_next/static|_next/image|favicon.ico|.*\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
