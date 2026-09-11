// ============================================================
// Leer el perfil en un layout: tres desenlaces, no dos (D-234).
//
// Todos los puntos de entrada hacen lo mismo:
//
//   const { data: profile } = await supabase.from("profiles").select(…).maybeSingle();
//   if (!profile) redirect("/login");
//
// y **descartan el `error`**. Eso mete dos situaciones distintas en el mismo
// cajón:
//
//   · **No hay fila** (`data: null`, `error: null`) — la sesión degradada de
//     D-081. Mandar al login es lo correcto: hay que volver a autenticarse.
//   · **La consulta falló** (`data: null` y `error` con mensaje) — una columna
//     que no existe, una política, la red. Mandar al login **no** arregla nada,
//     y como el login devuelve aquí, el fallo se convierte en un bucle.
//
// El 2026-09-10 pasó: se fusionó una rama cuya migración no se había aplicado,
// el `select` pidió columnas que no existían y el hub entró en bucle de
// redirecciones en producción. El dueño lo descubrió entrando. El mismo
// despliegue, mirando el `error`, habría sido «column profiles.title does not
// exist» en pantalla.
//
// La regla, que es lo que hay que recordar cuando esto se lea dentro de un año:
// **un `redirect` en el camino de error convierte cualquier fallo de consulta
// en una caída muda.**
// ============================================================

/** La forma del error que devuelve supabase-js. Se declara aquí para que esto
 * sea probable sin arrastrar el cliente. */
export interface ErrorDeLectura {
  message: string;
  code?: string | null;
  details?: string | null;
  hint?: string | null;
}

export type EstadoDeLectura = "fallo" | "sin-fila" | "ok";

/** Los tres desenlaces, en el orden en que hay que preguntarlos: **el error
 * primero**. Con `data` nulo y error presente, «no hay fila» es una conclusión
 * falsa — no se sabe si la hay. */
export function estadoDeLectura(res: { data: unknown; error?: ErrorDeLectura | null }): EstadoDeLectura {
  if (res.error) return "fallo";
  return res.data ? "ok" : "sin-fila";
}

/** Un identificador corto y **estable** del fallo, para que quien lo ve pueda
 * decirlo por teléfono y quien lo arregla lo encuentre en el log. Estable a
 * propósito: el mismo fallo da la misma referencia, así que dos personas que
 * llaman por lo mismo se reconocen como lo mismo. */
export function referenciaDeFallo(e: ErrorDeLectura): string {
  const codigo = (e.code ?? "ERR").toString().trim() || "ERR";
  return `${codigo}-${huella(e.message ?? "")}`.toUpperCase();
}

/** Una huella corta, hecha a mano y no con `node:crypto`, para que este módulo
 * sirva en el servidor **y** en el cliente: la frontera de error del ERP es un
 * componente de cliente y pinta esta misma pantalla (D-235). No es un hash
 * criptográfico y no hace falta que lo sea — solo tiene que ser estable y
 * repartir; lo que no puede es traer una dependencia de Node a un bundle. */
function huella(texto: string): string {
  let h = 5381;
  for (let i = 0; i < texto.length; i++) h = (((h << 5) + h) ^ texto.charCodeAt(i)) >>> 0;
  return h.toString(16).padStart(6, "0").slice(-6);
}

/** ¿A esta persona se le enseña el mensaje de Postgres entero?
 *
 * Solo a un admin, y hay que decidirlo **sin** el perfil, que es justo lo que no
 * se pudo leer. La fuente es el rol que viaja en los metadatos del usuario de
 * Auth, que es de donde `handle_new_user` saca el rol al crear la cuenta.
 *
 * Puede quedarse viejo si a alguien le cambian el rol después, y eso está bien
 * en esta dirección: el que se quede corto ve el texto genérico con su
 * referencia, que es suficiente para reportarlo. Lo que no puede pasar es lo
 * contrario, que un mensaje con nombres de tablas y columnas salga en la
 * pantalla de cualquiera con sesión. */
export function puedeVerDetalle(user: { user_metadata?: Record<string, unknown> | null } | null | undefined): boolean {
  const rol = user?.user_metadata?.role;
  return typeof rol === "string" && rol.trim().toLowerCase() === "admin";
}

/** Lo que se pinta, ya decidido: qué texto, y si lleva detalle o no. */
export function textoDeFallo(
  e: ErrorDeLectura,
  verDetalle: boolean,
): { titulo: string; titulo_en: string; cuerpo: string; cuerpo_en: string; detalle: string | null; ref: string } {
  const ref = referenciaDeFallo(e);
  return {
    titulo: "No se pudo leer tu perfil",
    titulo_en: "We couldn't load your profile",
    cuerpo:
      "No es tu sesión: la consulta a la base falló. Vuelve a intentarlo en un momento; " +
      "si sigue igual, dile a un administrador esta referencia.",
    cuerpo_en:
      "This isn't your session: the database query failed. Try again in a moment; " +
      "if it keeps happening, give an administrator this reference.",
    detalle: verDetalle ? [e.message, e.details, e.hint].filter(Boolean).join(" · ") : null,
    ref,
  };
}

/** El codigo con el que PostgREST dice «la consulta no devolvio ninguna fila».
 * Con `.single()` eso llega como ERROR, no como `data: null`, asi que hay que
 * separarlo del resto o una sesion degradada se contaria como fallo de lectura. */
export const SIN_FILA = "PGRST116";

export function esSinFila(e: ErrorDeLectura | null | undefined): boolean {
  return (e?.code ?? "") === SIN_FILA;
}

/**
 * Lo que se lanza cuando el perfil no se pudo leer y el que llama no puede
 * seguir sin el (D-235).
 *
 * Lanzar y no devolver un valor por defecto es la decision: un fallo de lectura
 * no puede parecerse a un rol legitimo. En `getSessionInfo()` se parecia — el
 * ERP decidia permisos con `staff` y nadie se enteraba de que era un error.
 */
export class PerfilNoLeido extends Error {
  readonly lectura: ErrorDeLectura;
  readonly ref: string;
  constructor(e: ErrorDeLectura) {
    const ref = referenciaDeFallo(e);
    super(`No se pudo leer el perfil [${ref}]: ${e.message}`);
    this.name = "PerfilNoLeido";
    this.lectura = e;
    this.ref = ref;
  }
}
