import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

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
 * Desde G-29 (D-208) refresca la sesión Y aplica el guard de rutas: quien entra sin sesión a
 * una ruta protegida va a `/login?next=<ruta exacta>`; quien ya entró y pisa el login va a su
 * `next` saneado. Lo que se sirve sin sesión y lo que ni se mira está en `lib/route-guard.ts`,
 * con su tabla de pruebas.
 */
export async function middleware(request: NextRequest) {
  return await updateSession(request);
}

export const config = {
  matcher: [
    // Todo menos estáticos, imágenes y el túnel de Sentry — esa ruta transporta los sobres de
    // error del navegador y no debe pasar por aquí. Las rutas de API y los demás ficheros de
    // `public/` (el service worker, el manifest) se saltan dentro de `updateSession`, porque
    // las de API van anidadas (/timetracker/clock-in/api/...) y un lookahead anclado al
    // principio no las alcanza.
    "/((?!monitoring|_next/static|_next/image|favicon.ico|.*\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
