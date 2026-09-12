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
  const cruda = request.cookies.get(COOKIE_RETORNO)?.value ?? null;
  const vuelta = desempaquetar(cruda);
  if (vuelta && impersonacionCaducada(vuelta.inicio, Date.now())) {
    const fuera = NextResponse.redirect(new URL("/login", request.nextUrl.origin));
    for (const c of request.cookies.getAll()) {
      if (c.name.startsWith("sb-")) fuera.cookies.delete(c.name);
    }
    fuera.cookies.delete(COOKIE_RETORNO);
    return fuera;
  }
  // Una cookie de retorno que no se entiende se **barre**, no se ignora. Ignorarla la dejaba
  // viva hasta una hora llevando dentro el refresh token de un admin, y sin forma de usarla
  // para nada bueno: `desempaquetar` ya dijo que no vale. Lo que no se puede usar, se tira.
  const barrerHuerfana = !!cruda && !vuelta;

  let response = NextResponse.next({ request });

  let hasUser: boolean;
  // Y si el «no hay usuario» es una RESPUESTA o un «no pude preguntar», que no es lo mismo para
  // quien barre cookies. Medido en `@supabase/auth-js` 2.112.4: `_getUser` devuelve
  // `{ data: { user: null }, error }` ante cualquier `AuthError`, y un fallo de red lo es
  // (`AuthRetryableFetchError`). O sea que un parpadeo de red tiene exactamente la misma forma
  // que una sesión que no existe, y aquí el `error` se descartaba — que es cómo se sigue con
  // datos incompletos sin que nada falle.
  let sinUsuarioConfirmado: boolean;
  if (deps.getUser) {
    hasUser = await deps.getUser(request);
    sinUsuarioConfirmado = !hasUser;
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
    const { data: { user }, error: errUsuario } = await supabase.auth.getUser();
    hasUser = !!user;
    sinUsuarioConfirmado = !user && !errUsuario;
  }

  // Y la que sobrevive a un cierre de sesión: cookie de retorno sin usuario es huérfana por
  // definición. Es la red de seguridad de los dos cierres de cliente, que no pueden borrarla
  // ellos porque es `httpOnly`.
  //
  // **Con «no hay usuario» confirmado, no con «no pude preguntar».** Si un fallo de red de un
  // instante borrara la cookie, el admin perdería la vuelta y acabaría en el login con la
  // sesión de la otra persona todavía viva. Tiene salida —el login— así que no es una trampa,
  // pero es justo lo que esta rama promete que no pasa.
  const barrer = barrerHuerfana || (!!cruda && sinUsuarioConfirmado);

  const d = decide(path + request.nextUrl.search, request.nextUrl.searchParams.get("next"), hasUser);
  if (barrer) response.cookies.delete(COOKIE_RETORNO);
  if (d.kind === "redirect") {
    // La URL de destino es siempre interna (route-guard la sanea); se construye sobre el origen
    // de la petición y no sobre `nextUrl.clone()` para que el `?next=` no arrastre la query
    // anterior.
    const salto = NextResponse.redirect(new URL(d.to, request.nextUrl.origin));
    if (barrer) salto.cookies.delete(COOKIE_RETORNO);
    return salto;
  }

  // Lo público y lo protegido con sesión se sirven con LA MISMA respuesta que preparó el
  // refresco: ahí van las cookies renovadas, y devolver otra tiraría la sesión recién renovada.
  return response;
}
