/**
 * Si hay sesión, y —lo que faltaba— si la puede volver a haber.
 *
 * Las pantallas vacías se han arreglado tres veces (D-088, D-099 y el bucle de reintentos que
 * metí encima) y las tres veces volvieron, porque las tres partían de la misma suposición:
 * que una carga fallida se arregla reintentando. Hay un caso en el que no se arregla nunca —
 * **la sesión caducó de verdad**— y ahí reintentar cinco veces, o quinientas, deja lo mismo:
 * una pantalla vacía sin un solo mensaje.
 *
 * Pasa al dormir el ordenador. El token de acceso dura una hora y su temporizador de refresco
 * no corre mientras la máquina duerme; al volver, supabase-js intenta refrescar y, si el token
 * de refresco ya no vale, se queda sin sesión. Desde 081 una consulta sin sesión sale como
 * `anon`, que ya no tiene permisos: de ahí el "permission denied for schema timetracker" al
 * darle a empezar, y de ahí las pantallas vacías al entrar.
 *
 * Por eso esto devuelve TRES estados y no un booleano:
 *
 *   · "ok"      — hay sesión utilizable.
 *   · "offline" — ahora no se pudo, pero puede que sí luego (red caída, petición cancelada a
 *                 media navegación). Reintentar tiene sentido.
 *   · "gone"    — no hay sesión y no la va a haber sin volver a entrar. Reintentar NO sirve;
 *                 lo que toca es decírselo a la persona.
 *
 * La diferencia entre los dos últimos es la que hacía falta y no estaba.
 */

export type SessionState = "ok" | "offline" | "gone";

/** Margen antes de dar por bueno un token: uno que caduca en 30 s caduca a media petición. */
const MIN_LIFE_SEC = 60;

type Sesion = { expires_at?: number | null } | null;

type Probe = {
  auth: {
    getSession: () => Promise<{ data: { session: Sesion } }>;
    refreshSession: () => Promise<{
      data: { session: unknown };
      error: { status?: number } | null;
    }>;
  };
};

/** ¿Esta sesión sirve para trabajar durante el próximo minuto? */
function sirve(session: Sesion): boolean {
  const nowSec = Math.floor(Date.now() / 1000);
  return !!session?.expires_at && session.expires_at - nowSec >= MIN_LIFE_SEC;
}

export async function checkSession(supabase: Probe): Promise<SessionState> {
  let hadSession = false;
  try {
    const { data: { session } } = await supabase.auth.getSession();
    hadSession = !!session;
    if (sirve(session)) return "ok";

    const { data, error } = await supabase.auth.refreshSession();
    if (data?.session) return "ok";

    // Ni siquiera había sesión guardada: no hay nada que refrescar. Esto es cerrar sesión,
    // otra pestaña que la cerró, o el almacenamiento limpiado.
    if (!hadSession) return "gone";

    // El servidor CONTESTÓ y dijo que no (400/401/403). Aquí estaba el fallo: se daba por
    // definitivo, y **«ya usado» no significa que la sesión esté muerta**.
    //
    // Esta app monta CINCO clientes de navegador —Entregas más los cuatro con esquema propio
    // que obliga D-185— y todos comparten el mismo token de refresco. Supabase lo **rota** en
    // cada refresco: si dos clientes refrescan casi a la vez, el primero lo rota y el segundo
    // recibe `400 Invalid Refresh Token: Already Used`. La sesión está perfectamente viva —
    // acaba de renovarla el otro cliente— y esto la declaraba muerta y le cerraba la app en
    // la cara a alguien que estaba fichando.
    //
    // Por eso, antes de la sentencia, **se vuelve a leer**. El que ganó la carrera dejó una
    // sesión nueva en el almacenamiento, así que `getSession()` la ve. Y se le exige el mismo
    // margen de vida que arriba: si lo que hay sigue siendo el token muerto de antes, no
    // cuenta como sesión viva y la respuesta vuelve a ser `gone`.
    const status = error?.status;
    if (typeof status === "number" && status >= 400 && status < 500) {
      const { data: { session: recheck } } = await supabase.auth.getSession();
      return sirve(recheck) ? "ok" : "gone";
    }

    // Sin status —o con 0, o 5xx— es la red o el servidor, no un veredicto sobre la sesión.
    return "offline";
  } catch {
    // Una excepción aquí es la red o una petición cancelada a media navegación (D-088), no
    // una respuesta del servidor. Nunca se trata como sesión perdida: cerrarle la app en la
    // cara a alguien porque se le cayó el wifi un segundo sería peor que la pantalla vacía.
    return "offline";
  }
}

/** Lo que lanzan las escrituras cuando ya no hay sesión, en vez de preguntar sin credenciales. */
export const SESSION_EXPIRED = "SESSION_EXPIRED";

export function isSessionExpired(e: unknown): boolean {
  return (e as { message?: string } | null)?.message === SESSION_EXPIRED;
}

/**
 * Un rechazo de Postgres que en realidad es un token muerto.
 *
 * Antes solo se reconocía "row-level security" y el 42501 de RLS. Faltaba el que aparece
 * desde 081, que es de otra familia: sin sesión la petición sale como `anon`, y anon ya no
 * tiene ni USAGE sobre el esquema, así que Postgres corta antes de mirar ninguna política y
 * responde "permission denied for schema timetracker". Como no decía "row-level security",
 * no se reintentaba con un token nuevo — se le enseñaba el error crudo a la persona.
 */
export function isAuthDenied(e: unknown): boolean {
  const err = e as { message?: string; code?: string } | null;
  const msg = String(err?.message || "").toLowerCase();
  return (
    msg.includes("row-level security") ||
    msg.includes("permission denied") ||
    msg.includes("jwt expired") ||
    msg.includes("42501") ||
    err?.code === "42501"
  );
}

/**
 * ¿Este error es "ya tienes algo abierto"?
 *
 * Desde 092 la base garantiza **una sola sesión viva por persona**, igual que ya garantizaba un
 * solo fichaje abierto. Eso significa que un doble clic en Empezar ya no crea dos filas: la
 * segunda la rechaza Postgres con un 23505.
 *
 * Y eso hay que traducirlo, no enseñarlo. Para quien pulsó dos veces, el resultado correcto es
 * "ya está corriendo" — no un error de clave duplicada, que además le haría pensar que no
 * empezó cuando sí empezó.
 */
export function isAlreadyRunning(e: unknown): boolean {
  const err = e as { code?: string; message?: string } | null;
  const msg = String(err?.message || "").toLowerCase();
  return err?.code === "23505" || msg.includes("sessions_one_live_per_employee") || msg.includes("duplicate key");
}
