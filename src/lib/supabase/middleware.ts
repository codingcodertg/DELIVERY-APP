import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { decide, skipsSession } from "@/lib/route-guard";
import { impersonacionCaducada } from "@/lib/impersonation";
import { COOKIE_RETORNO, desempaquetar } from "@/lib/impersonation-cookie";

// La lista de públicas vive ahora en lib/route-guard.ts; se reexporta para quien la importaba
// de aquí (public-paths.test.ts, D-156).
export { isPublicPath } from "@/lib/route-guard";

/**
 * Refresca la sesión, **la escribe de vuelta al navegador**, y aplica el guard de rutas.
 *
 * El refresco es el arreglo del "todo sale vacío hasta que recargo" (D-119), y conviene
 * entender por qué era del servidor y no del cliente, porque se intentó cuatro veces en el
 * cliente.
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
 * **El guard (G-29, D-208).** Desde D-119 esta función estaba escrita y nadie la llamaba:
 * `src/middleware.ts` invocaba `refreshSession`, que solo refrescaba. Sin guard, cada layout
 * rebotaba al login por su cuenta y perdía la ruta exacta (`/login?next=/` en Entregas, G-2).
 * Ahora el middleware la llama, y lo que decide —qué se sirve sin sesión, qué rebota y con qué
 * `next`, y a dónde va quien ya entró y pisa el login— vive en `lib/route-guard.ts`, puro y con
 * su tabla de pruebas. `refreshSession` se retira: esta función la cubre entera (mismo refresco,
 * mismo salto de `/api/`, ampliado a los ficheros estáticos).
 *
 * `deps.getUser` existe solo para las pruebas: sustituye la consulta al servidor de auth por
 * una respuesta fija, sin red.
 */
export async function updateSession(
  request: NextRequest,
  deps: { getUser?: (req: NextRequest) => Promise<boolean> } = {},
) {
  // Local demo mode: skip all auth — the app has no backend.
  if (process.env.NEXT_PUBLIC_LOCAL_MODE === "true") {
    return NextResponse.next({ request });
  }

  const path = request.nextUrl.pathname;

  // Rutas de datos, ficheros estáticos, internos de Next: ni refresco ni guard. Las rutas de
  // datos se autentican solas (los crons con su secreto) y una llamada sin sesión debe
  // contestar 401, no una redirección a una página de login que un `fetch` intentaría leer
  // como JSON.
  if (skipsSession(path)) {
    return NextResponse.next({ request });
  }

  // El respaldo de la caducidad de «entrar como» (D-NEXT). Cuando la pestaña está abierta, el
  // banner devuelve al admin a su cuenta al cumplirse la hora, que es la salida buena. Esto es
  // para la que no lo está: sin JavaScript corriendo, lo único que se puede hacer desde aquí es
  // **cortar** —fuera las cookies de sesión y al login—, y eso es mejor que una sesión ajena
  // abierta y sin vigilancia en un equipo compartido.
  const vuelta = desempaquetar(request.cookies.get(COOKIE_RETORNO)?.value ?? null);
  if (vuelta && impersonacionCaducada(vuelta.inicio, Date.now())) {
    const fuera = NextResponse.redirect(new URL("/login", request.nextUrl.origin));
    for (const c of request.cookies.getAll()) {
      if (c.name.startsWith("sb-")) fuera.cookies.delete(c.name);
    }
    fuera.cookies.delete(COOKIE_RETORNO);
    return fuera;
  }

  let response = NextResponse.next({ request });

  let hasUser: boolean;
  if (deps.getUser) {
    hasUser = await deps.getUser(request);
  } else {
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
    const { data: { user } } = await supabase.auth.getUser();
    hasUser = !!user;
  }

  const d = decide(path + request.nextUrl.search, request.nextUrl.searchParams.get("next"), hasUser);
  if (d.kind === "redirect") {
    // La URL de destino es siempre interna (route-guard la sanea); se construye sobre el origen
    // de la petición y no sobre `nextUrl.clone()` para que el `?next=` no arrastre la query
    // anterior.
    return NextResponse.redirect(new URL(d.to, request.nextUrl.origin));
  }

  // Lo público y lo protegido con sesión se sirven con LA MISMA respuesta que preparó el
  // refresco: ahí van las cookies renovadas, y devolver otra tiraría la sesión recién renovada.
  return response;
}
