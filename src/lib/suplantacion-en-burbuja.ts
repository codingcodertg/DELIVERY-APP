import { ayudaEnLaRuta } from "./ayuda-flotante";
import { idiomaDelAviso, traduce } from "./aviso-de-suplantacion";
import { destinoDeLaApp } from "./boton-general";
import { impersonacionCaducada } from "./impersonation";
import type { Idioma } from "./idioma";

/**
 * «Entrar como» se avisa en la burbuja, no en una franja arriba (D-NEXT).
 *
 * El dueño, 2026-11-04: «cuando haces el switch user, el tag verde de arriba estorba y quita mucho espacio. El botón
 * de ayuda ya tiene las opciones de cambiar de usuario y de vista móvil, así que eso va ahí. Cuando cambias de
 * usuario, la burbuja simplemente se pone naranja y le dice "oye, estás en otro usuario". Encima de la burbuja
 * naranja hay otro botón rojo que dice "volver a mi usuario". Si vuelvo a pulsar la burbuja naranja, me salen las
 * opciones de seguir cambiando a otro usuario o a la vista móvil. Ya no quiero esa línea de arriba cuando cambio de
 * usuario; es ineficiente».
 *
 * Lo que NO cambia de D-243 es la regla de fondo: mientras se está dentro de otra persona el aviso se ve en TODAS las
 * pantallas de todas las apps y no se puede cerrar. Antes lo cumplía la franja `sticky` del layout raíz; ahora lo
 * cumple la burbuja, que también vive en el layout raíz y que, dentro de una suplantación, sale incluso en las rutas
 * donde la Ayuda no sale (`burbujaEnLaRuta`): un admin que entra como alguien sin apps cae en `/no-access`, y ahí el
 * botón rojo es la única salida.
 *
 * Aquí vive lo que decide, puro, para probarlo importándolo: cuándo sale y de qué color, qué dice, y la vuelta, que
 * es LA MISMA de la franja: `POST /api/impersonate/return` y recarga entera a la portada de la app (D-623).
 */

/** Lo que dice el servidor de la suplantación en curso, ya leído. `null`: no se está dentro de nadie. */
export type Suplantacion = { como: string; inicio: number; cambiaContrasena: boolean; idioma: Idioma };

/** La pregunta («¿estoy dentro de otra persona?») y la salida. Las dos sin bandera (D-243): nadie se queda atrapado. */
export const RUTA_DEL_ESTADO = "/api/impersonate/state";
export const RUTA_DE_VUELTA = "/api/impersonate/return";

/**
 * Lee la respuesta de `GET /api/impersonate/state`. Sin nombre o sin hora de inicio no hay suplantación que avisar:
 * es el caso de casi todas las cargas (`{}`). El idioma es el del ADMIN que entró (D-516), con la copia de pantalla
 * de este equipo de respaldo.
 */
export function suplantacionDelEstado(d: unknown, copiaLocal: string | null | undefined): Suplantacion | null {
  if (!d || typeof d !== "object") return null;
  const r = d as { como?: unknown; inicio?: unknown; cambiaContrasena?: unknown; idioma?: unknown };
  if (typeof r.como !== "string" || !r.como || typeof r.inicio !== "number") return null;
  return {
    como: r.como,
    inicio: r.inicio,
    cambiaContrasena: r.cambiaContrasena === true,
    idioma: idiomaDelAviso({ delAdmin: r.idioma, copiaLocal }),
  };
}

/**
 * ¿Sale la burbuja en esta ruta? Donde sale la Ayuda, siempre; y dentro de una suplantación, en TODAS: el aviso y la
 * vuelta no pueden faltar en ninguna pantalla (D-243), y la franja de antes salía también en el login o en `/no-access`.
 */
export function burbujaEnLaRuta(pathname: string | null, suplantando: boolean): boolean {
  return suplantando || ayudaEnLaRuta(pathname);
}

/** El color de la burbuja: la de siempre, o naranja mientras se está dentro de otra persona. */
export function colorDeLaBurbuja(s: Suplantacion | null): "normal" | "naranja" {
  return s ? "naranja" : "normal";
}

/**
 * Lo que dicen la burbuja naranja y el botón rojo, en el idioma del admin (`traduce`, D-516: la pantalla habla el de
 * la persona en la que se entró, pero esto le habla a él).
 */
export function textosDeSuplantacion(a: { como: string; idioma: Idioma; volviendo?: boolean; cambiaContrasena?: boolean }) {
  const t = traduce(a.idioma);
  return {
    /** Lo que se lee en la burbuja, sin pasar el ratón: corto, cabe en un teléfono. */
    etiqueta: t(`You're viewing as ${a.como}`, `Estás como ${a.como}`),
    /** El nombre accesible y el globo de la burbuja: lo de arriba y qué pasa al pulsarla. */
    titulo: t(
      `You're viewing as ${a.como}. Tap for options: switch user, mobile view, help`,
      `Estás como ${a.como}. Pulsa para ver las opciones: cambiar usuario, vista móvil, ayuda`,
    ),
    volver: a.volviendo ? t("Going back…", "Volviendo…") : t("↩ Back to my user", "↩ Volver a mi usuario"),
    /** D-486: esa persona tiene una contraseña temporal; a ella se le pide cambiarla al entrar, al admin no. */
    contrasena: a.cambiaContrasena
      ? t("🔑 Temporary password: they change it when they sign in, you are not asked to",
          "🔑 Contraseña temporal: la cambia ella al entrar, a ti no se te pide")
      : null,
  };
}

/** ¿Toca devolver al admin a su cuenta? La misma cuenta de los 60 minutos que el servidor (`impersonacionCaducada`). */
export function tocaVolverSolo(s: Suplantacion | null, ahora: number): boolean {
  return s !== null && impersonacionCaducada(s.inicio, ahora);
}

/**
 * Volver a la cuenta propia: LA vuelta, la única. La pulsa el botón rojo («manual») y la dispara la hora («expired»).
 * Es la de la franja de antes, tal cual (D-243, D-623): `POST /api/impersonate/return`, que restaura la sesión del
 * admin, borra la cookie y deja el rastro; y luego recarga ENTERA a la portada de la app en la que se está. Recarga y
 * no `router.refresh()`: todo lo que hay en memoria es de la otra persona.
 *
 * El navegador se recibe por parámetro para probarla sin ventana. Un fallo de red no la para: se recarga igual y el
 * servidor decide con lo que haya.
 */
export async function volverAMiCuenta(
  motivo: "manual" | "expired",
  nav: { fetch: typeof fetch; ubicacion: { pathname: string; href: string } },
): Promise<void> {
  try {
    await nav.fetch(RUTA_DE_VUELTA, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ motivo }),
    });
  } catch { /* da igual: se recarga y el servidor decide con lo que haya */ }
  nav.ubicacion.href = destinoDeLaApp(nav.ubicacion.pathname);
}
