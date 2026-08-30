import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Refresca la sesión y —lo que faltaba— **la escribe de vuelta al navegador**.
 *
 * Este es el arreglo del "todo sale vacío hasta que recargo" (D-119), y conviene entender
 * por qué era del servidor y no del cliente, porque se intentó cuatro veces en el cliente.
 *
 * El proyecto tiene `jwt_exp = 3600` y **rotación de refresh tokens activada**: cada refresco
 * emite uno nuevo e invalida el anterior, con 10 s de gracia. Al entrar pasada una hora:
 *
 *   1. el Server Component llama a `getUser()`, ve el token caducado y refresca con R1;
 *   2. obtiene R2 — y **R1 queda quemado**;
 *   3. intenta guardar R2 en la cookie… y un Server Component **no puede escribir cookies**,
 *      así que el `catch` de `server.ts` se lo traga (su comentario dice que es seguro
 *      "cuando el middleware refresca la sesión");
 *   4. ese middleware no existía —vivía en la raíz del repo con la app en `src/`, así que
 *      Next nunca lo emitió: el manifiesto salía vacío—, de modo que **R2 se perdía**;
 *   5. la página se pintaba (el servidor SÍ tenía usuario) pero el cliente se quedaba con R1
 *      muerto, su refresco fallaba y las listas salían vacías.
 *
 * Un middleware sí puede escribir cookies en la respuesta. Con esto, cuando el navegador
 * recibe el HTML ya trae el token nuevo, así que la primera consulta del provider sale
 * autenticada. No hay reintento, ni espera, ni recarga forzada: no hay carrera que ganar.
 *
 * **No redirige.** El guard de rutas vive en `updateSession` (abajo) y sigue sin conectarse:
 * nunca ha corrido en producción y encenderlo es un cambio de comportamiento aparte.
 */
export async function refreshSession(request: NextRequest) {
  if (process.env.NEXT_PUBLIC_LOCAL_MODE === "true") {
    return NextResponse.next({ request });
  }

  // Las rutas de API se saltan el refresco. No renderizan listas, algunas se autentican con
  // un secreto y no con la sesión (el cron), y cobrarles una llamada a Supabase por petición
  // sería pagar latencia por nada. La cookie que leerían es la que acaba de refrescar la
  // petición de página que las precede.
  if (request.nextUrl.pathname.includes("/api/")) {
    return NextResponse.next({ request });
  }

  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet: { name: string; value: string; options?: Record<string, unknown> }[]) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        },
      },
    },
  );

  // getUser() y no getSession(): el primero valida contra el servidor de auth, que es lo que
  // dispara el refresco. getSession() se conforma con lo que traiga la cookie y no renovaría
  // nada — justo el fallo que se está arreglando.
  await supabase.auth.getUser();

  return response;
}

/**
 * Refresco + guard de rutas. **Todavía NO está conectada** (paso 2 de D-119).
 *
 * Este código nunca ha corrido: el fichero que lo invocaba estaba en la raíz y Next no lo
 * cargaba. Encenderlo no es "restaurar" nada, es estrenar redirecciones en producción sobre
 * rutas que hoy funcionan sin ellas, así que va en su propio paso y con su propia revisión.
 * Mientras tanto, cada layout sigue haciendo su propia comprobación como hasta ahora.
 */
export async function updateSession(request: NextRequest) {
  // Local demo mode: skip all auth — the app has no backend.
  if (process.env.NEXT_PUBLIC_LOCAL_MODE === "true") {
    return NextResponse.next({ request });
  }

  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet: { name: string; value: string; options?: Record<string, unknown> }[]) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const path = request.nextUrl.pathname;
  const isPublic =
    path.startsWith("/login") || path.startsWith("/auth") || path.startsWith("/_next");

  // Bounced here from a guarded route while signed out — remember it as
  // `next` so signing in can return here instead of always landing on `/`.
  // Matters most for the timetracker desktop shell (D-076): its Electron
  // window has no address bar, so if login always dropped it on deliveries'
  // board, the only way back to Track Time was the module switcher — which
  // defeats the point of a dedicated client (screenshot/activity capture
  // only runs while mounted on /timetracker).
  if (!user && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", path);
    return NextResponse.redirect(url);
  }

  if (user && path.startsWith("/login")) {
    const url = request.nextUrl.clone();
    const next = request.nextUrl.searchParams.get("next");
    // Must be a real in-app path, not another hop through /login itself
    // (that would loop) or an absolute URL (open-redirect risk).
    url.pathname = next && next.startsWith("/") && !next.startsWith("/login") ? next : "/";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return response;
}
