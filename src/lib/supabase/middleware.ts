import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { decide, skipsSession } from "@/lib/route-guard";
import { impersonacionCaducada } from "@/lib/impersonation";
import { COOKIE_RETORNO, desempaquetar } from "@/lib/impersonation-cookie";
import { debeCerrarSesion } from "@/lib/session-cutoff";

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
 * **El cierre de las 18:30 (D-NEXT).** Aquí, y no en un cron ni en la pantalla, porque este es
 * el único punto por el que pasa **cada navegación** autenticada de las cinco apps. No es «a las
 * 18:30 corre un cierre»: es que una sesión de un rol no exento **no vale** si se autenticó
 * antes del último corte que ya pasó. Escrito así cubre los tres casos con una sola condición
 * —la app abierta a esa hora, la cookie de ayer usada de noche, y la cookie de ayer usada esta
 * mañana— y no depende de que ningún proceso se despierte a la hora justa.
 *
 * Los tres datos vienen de `public.session_gate()` (migración 107), una llamada por navegación.
 * No es gratis, pero es la única que hay: la hora de autenticación vive en `auth.sessions`, que
 * no se puede leer de otra forma, y guardarla en una cookie sería dejar que la editara justo
 * quien querría alargarse el plazo.
 *
 * Y si esa llamada falla —la 107 todavía no aplicada, o el JWT sin `session_id`— **no se cierra
 * a nadie**. Un error leyendo la hora no puede dejar a la empresa entera fuera de la app.
 *
 * `deps.getUser` y `deps.gate` existen solo para las pruebas: sustituyen la consulta al servidor
 * de auth y la de la puerta por respuestas fijas, sin red. `getUser` devuelve **tres** cosas y no
 * dos —`true`, `false` y `null`— porque en producción hay tres: hay sesión, no la hay, y **no se
 * pudo preguntar**. Un stub booleano no puede expresar la tercera, y es justo la que decide si se
 * barre la cookie de retorno.
 */
export type PuertaDeSesion = {
  session_created_at: string | null;
  deliveries_role: string | null;
  clockin_role: string | null;
};

export async function updateSession(
  request: NextRequest,
  deps: {
    getUser?: (req: NextRequest) => Promise<boolean | null>;
    gate?: (req: NextRequest) => Promise<PuertaDeSesion | null>;
    ahora?: Date;
  } = {},
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

  // El respaldo de la caducidad de «entrar como» (D-243). Cuando la pestaña está abierta, el
  // banner devuelve al admin a su cuenta al cumplirse la hora, que es la salida buena. Esto es
  // para la que no lo está: sin JavaScript corriendo, lo único que se puede hacer desde aquí es
  // **cortar** —fuera las cookies de sesión y al login—, y eso es mejor que una sesión ajena
  // abierta y sin vigilancia en un equipo compartido.
  // La ruta que devuelve al admin a su cuenta sin que nadie pulse nada. Lleva `/api/` a
  // propósito: `skipsSession` la salta, así que no se mira a sí misma ni entra en bucle.
  const RUTA_VUELTA_AUTOMATICA = "/api/impersonate/auto-return";

  const cruda = request.cookies.get(COOKIE_RETORNO)?.value ?? null;
  const vuelta = desempaquetar(cruda);
  if (vuelta && impersonacionCaducada(vuelta.inicio, Date.now())) {
    // Se manda al restaurador, no al login (D-NEXT, al rebasar sobre D-243). Antes esto cortaba
    // —fuera cookies y a poner la contraseña— porque el middleware no tenía forma de devolver
    // la sesión del admin; con la ruta de vuelta sí la hay, y la vuelta buena es la misma que
    // pulsando el botón. **Sin borrar nada aquí**: la cookie de retorno es lo único de donde
    // puede salir esa sesión.
    return NextResponse.redirect(
      new URL(`${RUTA_VUELTA_AUTOMATICA}?motivo=expired`, request.nextUrl.origin),
    );
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
  let leerPuerta: (() => Promise<PuertaDeSesion | null>) | null = null;
  if (deps.getUser) {
    const v = await deps.getUser(request);
    hasUser = v === true;
    // `null` es «no pude preguntar»: ni hay usuario ni está confirmado que no lo haya.
    sinUsuarioConfirmado = v === false;
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
    if (user) leerPuerta = async () => {
      const { data, error } = await supabase.rpc("session_gate").single<PuertaDeSesion>();
      // Cualquier fallo —la función no existe todavía, la red, un permiso— vale `null`, y
      // `null` significa «no cerrar». Es la dirección segura y además resuelve el orden de
      // despliegue: hasta que la 107 esté aplicada, la regla simplemente no aplica.
      return error ? null : data;
    };
  }

  // El cierre diario, antes del guard: si esta sesión ya no vale, lo que decida el guard sobre
  // la ruta da igual, porque la persona va al login de todas formas.
  if (hasUser) {
    const leer = deps.gate ?? leerPuerta;
    const puerta = leer ? await leer(request).catch(() => null) : null;
    if (puerta && debeCerrarSesion({
      sesionCreadaEn: puerta.session_created_at ? new Date(puerta.session_created_at) : null,
      rolEntregas: puerta.deliveries_role,
      rolFichaje: puerta.clockin_role,
      ahora: deps.ahora,
    })) {
      // Se va al login con la ruta a la que iba, igual que cualquier otro rebote sin sesión: al
      // volver a entrar, la persona aterriza donde estaba. Las cookies de sesión se borran en
      // la respuesta; `remembered-accounts` vive en `localStorage` y esto no lo toca, que es
      // lo que hace que el login rápido siga estando (D-193).
      // …salvo si quien está dentro es un admin impersonando (D-243 + D-NEXT). Mandarlo al
      // login **como el vendedor** sería justo lo que la decisión de «entrar como» promete que
      // no pasa: quedarse fuera de la propia cuenta por una regla que ni siquiera es suya. Se
      // le devuelve su sesión, y la fila de fin se escribe con motivo `cutoff`.
      //
      // Y aquí NO se borra ninguna cookie: la de retorno es de donde sale la sesión del admin,
      // y borrarla ahora dejaría al restaurador sin nada que restaurar.
      if (vuelta) {
        return NextResponse.redirect(
          new URL(`${RUTA_VUELTA_AUTOMATICA}?motivo=cutoff`, request.nextUrl.origin),
        );
      }
      const login = new URL(`/login?next=${encodeURIComponent(path + request.nextUrl.search)}`, request.nextUrl.origin);
      const fuera = NextResponse.redirect(login);
      for (const c of request.cookies.getAll()) {
        if (c.name.startsWith("sb-")) fuera.cookies.delete(c.name);
      }
      return fuera;
    }
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
