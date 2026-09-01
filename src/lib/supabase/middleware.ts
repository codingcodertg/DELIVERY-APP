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
/**
 * Lo que se ve SIN haber entrado (D-156).
 *
 * Esta lista es la razón por la que el guard llevaba parado desde D-119, y no era prudencia
 * de más: conectarlo tal y como estaba escrito habría roto dos cosas el mismo minuto.
 *
 *   · **`/track/:id`** — la página que se le manda al CLIENTE para que vea dónde va su
 *     camión. El cliente no tiene cuenta y no la va a tener. Mandarlo a `/login` convierte
 *     el enlace de seguimiento en una puerta cerrada, y ese enlace ya está enviado por SMS
 *     y por correo a gente de fuera.
 *   · **`/api/...`** — una llamada de datos sin sesión debe contestar 401, no una redirección
 *     a una página de login. El `fetch` recibiría el HTML del login con estado 200 y lo
 *     intentaría interpretar como JSON: el fallo aparecería en un sitio que no tiene nada que
 *     ver con la sesión. `refreshSession` ya las salta; el guard tenía que saltarlas también,
 *     y no lo hacía. Van anidadas (`/timetracker/clock-in/api/...`), así que se busca el
 *     segmento en cualquier posición, no al principio.
 *
 * Y lo obvio, que también faltaba: el propio login, el intercambio de OAuth, el
 * restablecimiento de contraseña —al que se llega desde un correo, sin sesión, que es justo
 * el momento en que no se puede entrar— y `/no-access`, que es donde aterriza quien SÍ entró
 * pero no tiene ningún módulo. Redirigirlo a login desde ahí sería un bucle.
 */
export function isPublicPath(path: string): boolean {
  return path === "/login" || path.startsWith("/login/")
    || path.startsWith("/auth")
    || path.startsWith("/reset-password")
    || path === "/no-access"
    || path === "/track" || path.startsWith("/track/")
    || path.startsWith("/_next")
    || path === "/manifest.webmanifest" || path === "/favicon.ico"
    || path.includes("/api/");
}

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

  // Ya dentro y pisando el login: al sitio del que venia, o a la puerta.
  //
  // Va ANTES de la lista de publicas y no despues, porque `/login` ESTA en esa lista
  // -tiene que estarlo, es donde entra quien no ha entrado- y con el orden al reves esta
  // rama no se ejecutaria nunca: quien ya tiene sesion se quedaria mirando un formulario
  // de acceso que no necesita.
  if (user && path.startsWith("/login")) {
    const url = request.nextUrl.clone();
    const next = request.nextUrl.searchParams.get("next");
    // Tiene que ser una ruta de dentro: ni otro salto al propio login (bucle) ni una URL
    // absoluta (redireccion abierta, que es como se roba una sesion).
    url.pathname = next && next.startsWith("/") && !next.startsWith("/login") ? next : "/";
    url.search = "";
    return NextResponse.redirect(url);
  }

  // Lo publico se sirve tal cual -pero con la respuesta de arriba, no una nueva: ahi van
  // las cookies del refresco, y devolver otra cosa tiraria la sesion recien renovada.
  if (isPublicPath(path)) return response;

  // Rebotado desde una ruta protegida sin sesion: se recuerda a donde iba, en `next`, para
  // que al entrar vuelva ahi y no siempre al tablero. Importa sobre todo en el escritorio de
  // Time Tracker (D-076): su ventana de Electron no tiene barra de direcciones.
  if (!user) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", path);
    return NextResponse.redirect(url);
  }


  return response;
}
