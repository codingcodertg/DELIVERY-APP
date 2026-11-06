/**
 * Entrar como otra persona (D-243).
 *
 * El dueño lo pidió así: *«como change roles pero desde el usuario»*. La diferencia con «ver
 * como» (`setViewAs`) no es de grado: aquel cambia **el rol** en el cliente y esto cambia **la
 * identidad** en el servidor. Con «ver como», un admin mirando la app de un vendedor sigue
 * siendo el admin para la base — ve sus propios datos con otra pintura. Aquí la sesión es la de
 * la otra persona, así que lo que sale en pantalla es lo que esa persona vería, con su RLS, su
 * tienda y sus permisos concedidos.
 *
 * Esa potencia es justo por lo que el permiso vive aquí, en una sola función pura, y no
 * repartido entre la ruta y los botones. Un botón que no se pinta no es una barrera; la barrera
 * es el servidor, y este fichero es lo que el servidor pregunta.
 */

/** Lo que hace falta saber de las dos personas para decidir. Nada más. */
export type QuienEntra = {
  /** El id de Auth de quien pide entrar. */
  id: string;
  /** Su rol de Entregas, leído de `public.profiles` en el servidor. */
  rol: string | null | undefined;
};

export type AQuienEntra = {
  id: string;
  rol: string | null | undefined;
};

export type MotivoNegado =
  | "no-eres-admin"
  | "es-admin"
  | "eres-tu-mismo"
  | "sin-destino";

/**
 * ¿Puede este admin entrar como esta persona?
 *
 * Cuatro condiciones, y las cuatro niegan por defecto: la función devuelve el permiso solo
 * cuando todo cuadra, así que un campo que llega vacío o una forma inesperada **no dejan pasar**.
 *
 *  1. **Quien entra es admin de Entregas**, y ese rol lo trae el servidor de `public.profiles`.
 *     Nunca de `user_metadata`: eso lo puede escribir la propia persona con la llave anón del
 *     navegador, y usarlo aquí sería regalar la impersonación a cualquiera que lo sepa.
 *  2. **El destino NO es admin.** Entrar como otro administrador es escalar a un sitio donde ya
 *     se puede todo, y deja un rastro que no distingue quién hizo qué. Es la condición que más
 *     duele en el día a día —dos admins no pueden ayudarse mirando la pantalla del otro— y se
 *     queda igual: para eso está compartir pantalla.
 *  3. **No es uno mismo.** No hace daño, pero crea una sesión impersonada sobre la propia
 *     cuenta, con su banner y su rastro, que es ruido puro.
 *  4. **Hay destino.** Un id vacío no es un destino.
 */
export function puedeEntrarComo(
  quien: QuienEntra | null | undefined,
  destino: AQuienEntra | null | undefined,
): { permitido: true } | { permitido: false; motivo: MotivoNegado } {
  if (!destino || !destino.id?.trim()) return { permitido: false, motivo: "sin-destino" };
  if (!esAdmin(quien?.rol)) return { permitido: false, motivo: "no-eres-admin" };
  if (esAdmin(destino.rol)) return { permitido: false, motivo: "es-admin" };
  if (quien?.id && quien.id === destino.id) return { permitido: false, motivo: "eres-tu-mismo" };
  return { permitido: true };
}

/** Un solo sitio donde se compara el rol, para que no haya dos formas de escribir «admin». */
export function esAdmin(rol: string | null | undefined): boolean {
  return (rol ?? "").trim().toLowerCase() === "admin";
}

/**
 * Cuánto dura una sesión impersonada, en minutos.
 *
 * No es un límite de seguridad —quien entró ya está dentro— sino de **olvido**: el riesgo real
 * de esto no es el uso indebido, es el admin que entra a mirar un bug, se distrae, y sigue
 * escribiendo como otra persona una hora después sin acordarse. Sesenta minutos es lo que dijo
 * el encargo, y el banner está para el rato de antes.
 */
export const IMPERSONACION_MINUTOS = 60;

/** Los dos momentos que se apuntan en `security_events`. */
export const EVENTO_ENTRAR = "impersonation_start";
export const EVENTO_VOLVER = "impersonation_end";

/** ¿Caducó ya esta sesión impersonada? */
export function impersonacionCaducada(inicioMs: number, ahoraMs: number, minutos: number = IMPERSONACION_MINUTOS): boolean {
  if (!Number.isFinite(inicioMs) || inicioMs <= 0) return true; // sin hora de inicio, se acabó
  return ahoraMs - inicioMs >= minutos * 60_000;
}

/** El texto del rastro, para que la fila se entienda sin abrir el código. */
export function detalleDelRastro(args: { comoNombre: string; desdeIp?: string | null }): string {
  const ip = (args.desdeIp ?? "").trim();
  return ip ? `como ${args.comoNombre} · desde ${ip}` : `como ${args.comoNombre}`;
}

/** Lo mínimo que el panel pinta de cada candidato: nada de correos, permisos ni módulos. */
export type Candidato = { id: string; full_name: string | null; role: string | null; store: string | null };

/**
 * A quién se puede saltar (D-307): la misma regla que decide si se puede entrar —`puedeEntrarComo`—,
 * aplicada a toda la plantilla, para que la lista no enseñe a nadie a quien la ruta vaya a rechazar.
 * Si quien pregunta no es admin, la lista es vacía: no hay nada que prometer.
 */
export function candidatosParaSaltar(quien: QuienEntra, plantilla: readonly Candidato[]): Candidato[] {
  if (!esAdmin(quien.rol)) return [];
  return plantilla
    .filter((p) => puedeEntrarComo(quien, { id: p.id, rol: p.role }).permitido)
    .map(({ id, full_name, role, store }) => ({ id, full_name, role, store }));
}

/**
 * ¿Esta sesión nació de «Entrar como»? Derivado del propio JWT, no de la cookie de retorno.
 *
 * EL FALLO que esto cierra: la cookie de retorno era la ÚNICA marca de «esto es una suplantación», y caducaba a los
 * 61 minutos (`maxAge`), mientras que las cookies `sb-` de Supabase duran meses. El dueño entró como Zulema, cerró el
 * equipo, y al volver horas después la cookie de retorno ya no existía: el middleware no veía nada que caducar, la
 * burbuja no veía nada que pintar, y la sesión de Zulema —real, minada con un magic link— seguía viva. Era suya.
 *
 * La marca que no se pierde: en esta app el ÚNICO camino que abre sesión con un magic link es «Entrar como» (y su
 * «saltar», D-247); las personas entran con contraseña. Supabase apunta el método en el claim `amr` del access token,
 * así que una sesión con `amr` de `magiclink`/`otp` y SIN cookie de retorno válida es una suplantación huérfana, y se
 * cierra. Se decodifica sin verificar la firma A PROPÓSITO: quien llama ya validó la sesión con `getUser()`, y esto
 * solo decide si CERRAR — un token falsificado como mucho consigue que lo saquen.
 */
export const METODOS_DE_ENTRAR_COMO: readonly string[] = ["magiclink", "otp"];

export function sesionDeEntrarComo(accessToken: string | null | undefined): boolean {
  const partes = (accessToken ?? "").split(".");
  if (partes.length < 2 || !partes[1]) return false;
  try {
    const b64 = partes[1].replace(/-/g, "+").replace(/_/g, "/");
    const json = JSON.parse(atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4))) as { amr?: unknown };
    if (!Array.isArray(json.amr)) return false;
    return json.amr.some((e) => {
      const m = typeof e === "string" ? e : (e as { method?: unknown } | null)?.method;
      return typeof m === "string" && METODOS_DE_ENTRAR_COMO.includes(m);
    });
  } catch {
    return false;
  }
}

/**
 * Las pantallas donde una sesión de correo es legítima y no se toca: la del enlace de «olvidé mi contraseña» (D-263)
 * y el canje de `/auth/callback`. Ahí la sesión puede venir de un correo y no de «Entrar como».
 */
export function rutaConSesionDeCorreo(path: string): boolean {
  return path === "/reset-password" || path.startsWith("/reset-password/") || path.startsWith("/auth/");
}

/** El motivo de la vuelta cuando la sesión es de «Entrar como» pero la marca se perdió. */
export const MOTIVO_MARCA_PERDIDA = "lost";
