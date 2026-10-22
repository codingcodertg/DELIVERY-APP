import { DEFAULT_HELP_EMAIL } from "@/lib/constants";

/**
 * La burbuja de Ayuda, igual en todas las apps (D-530).
 *
 * El dueño, el 2026-10-11: *«the help buttom bubble should be evene thoguht all the apps»*. Hasta ese día la burbuja
 * («? Help» abajo a la derecha, con su panel, la foto de la pantalla de D-509/D-513 y «Mis solicitudes») solo
 * existía en Entregas: la montaban `(app)/layout.tsx` y `LocalApp.tsx`, y dependía del `DataProvider` de Entregas
 * para dos cosas —los ajustes de ayuda y el aviso de abajo—. En el hub, Time Tracker, RR. HH., el ERP, Quote Builder,
 * Leads, Encuestas y Promociones no había nada.
 *
 * Ahora es UN componente (`HelpButton`) montado UNA vez, en el layout raíz, que es el único por el que pasan todas
 * las apps (como `VersionStamp` y `CierreDiario`). Ya no depende de ninguna app: lo que le hacía falta de Entregas
 * lo pide a `/api/help` (ver `ContactoDeAyuda`). Así es la misma burbuja, en el mismo sitio y con el mismo
 * comportamiento en todas, y una app nueva la tiene sin acordarse de ponerla.
 *
 * Lo que decide aquí es solo DÓNDE NO sale: las pantallas que se ven sin haber entrado a ninguna app.
 */

/**
 * El panel de Ayuda se abre por encima de CUALQUIER ventana (D-641). Con el `.overlay` de siempre (50) salía debajo
 * de las ventanas que se abren sobre una orden («Agregar material», 60) y de las preguntas (10000), y quien pedía
 * ayuda justo por lo que tenía abierto no podía escribir. Encima del panel, a +10 el recuadro para señalar el
 * problema y a +20 los avisos de Ayuda (que antes, a 99, ya iban por encima del panel).
 */
export const Z_PANEL_DE_AYUDA = 10010;

/**
 * Donde NO sale la burbuja, y por qué. Todas son pantallas de antes (o de fuera) de las apps: pedir ayuda exige
 * sesión (`/api/help` contesta 401 sin ella) y la solicitud se guarda a nombre de quien la escribe.
 *
 * `soloDebajo`: la ruta exacta SÍ lleva burbuja y solo lo de debajo no. Es el caso de `/track`: `/track` a secas es
 * «Rastreo» de Entregas (`app/(app)/track`), y `/track/<id>` es el enlace público que se manda al cliente por SMS.
 */
export const RUTAS_SIN_AYUDA: readonly { ruta: string; soloDebajo?: true; porque: string }[] = [
  { ruta: "/login", porque: "el login: todavía no hay sesión" },
  { ruta: "/auth", porque: "el canje del enlace del correo y la salida: no son pantallas" },
  { ruta: "/reset-password", porque: "se llega desde un correo, sin sesión" },
  { ruta: "/change-password", porque: "la contraseña obligatoria (D-486): se ve antes de entrar a ninguna app, como el login" },
  { ruta: "/no-access", porque: "quien entró pero no tiene ninguna app: no está en una app (y se sirve también sin sesión)" },
  { ruta: "/track", soloDebajo: true, porque: "el seguimiento que se manda al CLIENTE por SMS: no tiene cuenta" },
  { ruta: "/unsubscribe", porque: "la baja de los avisos del CLIENTE (D-416): no tiene cuenta" },
];

/** ¿Sale la burbuja de Ayuda en esta ruta? En todas las de las apps, sí; en las de `RUTAS_SIN_AYUDA`, no. */
export function ayudaEnLaRuta(pathname: string | null): boolean {
  const p = pathname ?? "/";
  return !RUTAS_SIN_AYUDA.some(({ ruta, soloDebajo }) =>
    // El separador importa, como en `appForPath`: sin él, `/login-algo` se leería como el login.
    (!soloDebajo && p === ruta) || p.startsWith(ruta + "/"),
  );
}

/**
 * Lo que la burbuja necesita saber para mandar una solicitud, y que antes sacaba del `DataProvider` de Entregas.
 * Lo contesta `GET /api/help` con la sesión, para que sea lo mismo en todas las apps:
 *
 * - **el teléfono de ayuda** (`settings.help_phone`, el botón «📞 Llámanos»). La tabla `settings` solo la puede leer
 *   quien tiene Entregas (`has_deliveries_access()`, migración 100): desde Time Tracker o RR. HH. una persona sin
 *   Entregas no lo vería. El servidor lo lee con la llave de servicio y devuelve SOLO el teléfono.
 * - **quién escribe**: su id (la carpeta de sus adjuntos en el cubo lleva ese nombre), y su nombre y su rol, de su
 *   propia fila de `profiles`.
 */
export type ContactoDeAyuda = { id: string; telefono: string | null; nombre: string | null; rol: string | null };

/**
 * A dónde va el correo de una solicitud: el de Ajustes (`settings.help_email`) si es una dirección, y si no la de
 * siempre (`DEFAULT_HELP_EMAIL`).
 *
 * Lo decide el SERVIDOR (D-530). Antes lo mandaba el navegador en `to`, leído de `settings` con la sesión de la
 * persona; y quien no tiene Entregas no puede leer `settings`, así que su solicitud se iba a la dirección por
 * defecto aunque Ajustes dijera otra. Ahora la burbuja está en todas las apps y eso le pasaría a cualquiera que
 * pida ayuda desde Time Tracker sin tener Entregas. El `to` que siga llegando del navegador se ignora.
 */
export function destinoDeAyuda(configurado: string | null | undefined): string {
  const c = (configurado ?? "").trim();
  return CORREO.test(c) ? c : DEFAULT_HELP_EMAIL;
}

const CORREO = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
