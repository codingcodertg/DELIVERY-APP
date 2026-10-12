/**
 * El tema de la pantalla: claro u oscuro.
 *
 * **Historia, para quien llegue sin contexto.** Hasta D-490 había dos valores, `light` y `dark`, guardados en
 * `localStorage` `rtg_prefs.theme`. D-490 añadió una tercera opción en el personalizador del hub, «Same as my
 * device / Como mi equipo» (`system`), que seguía al sistema del teléfono o del PC, de día y de noche. El dueño la
 * quitó el 2026-10-11 (D-NEXT): *«that same as my device remove it»*. Quedan Claro y Oscuro.
 *
 * **Quien la tenía guardada** no ve cambiar su pantalla: la primera vez que carga una página después del cambio,
 * `system` se convierte en lo que su equipo le está pintando EN ESE MOMENTO —oscuro si el sistema está en oscuro,
 * claro si no— y eso queda guardado como su elección (`temaDeLoGuardado`). Desde entonces ya no cambia solo al
 * anochecer; si quiere el otro, lo elige en «Personalizar». Se descartó pasarlos a todos a Claro: a quien tenía el
 * teléfono en oscuro la pantalla le saltaría a blanco de golpe, sin haber tocado nada.
 *
 * **Dónde se guarda, y por qué no cambia:** sigue en `rtg_prefs.theme`, por equipo. El idioma va en la base y
 * sigue a la persona (D-266); el tema no, y es a propósito: el escritorio de Time Tracker arranca en oscuro
 * (D-080) y un teléfono al sol se lee mejor en claro. No se inventa tabla.
 *
 * Aquí vive lo que se decide sin navegador, para poder probarlo con datos. El guion que corre antes de pintar
 * (`GUION_DE_TEMA`, en `app/layout.tsx`) hace lo mismo en JavaScript plano, y una prueba lo ejecuta contra
 * `temaEfectivo` y `temaDeLoGuardado` con todas las combinaciones.
 */

export type Tema = "light" | "dark";
/** Lo que se puede elegir. Desde D-NEXT es lo mismo que lo que se pinta: no hay opción que se resuelva sola. */
export type PreferenciaDeTema = Tema;

export const PREFERENCIAS_DE_TEMA = ["light", "dark"] as const satisfies readonly PreferenciaDeTema[];

export const esPreferenciaDeTema = (v: unknown): v is PreferenciaDeTema => v === "light" || v === "dark";

/**
 * El valor que guardaba «Same as my device» (D-490). Ya no se ofrece ni se escribe: solo se reconoce al LEER lo
 * guardado, para convertirlo (ver `temaDeLoGuardado`).
 */
export const TEMA_VIEJO_DEL_EQUIPO = "system";

/** Lo que pregunta el navegador para saber si el sistema está en oscuro. Solo lo usa la conversión de arriba. */
export const CONSULTA_OSCURO = "(prefers-color-scheme: dark)";

/**
 * Lo guardado en `rtg_prefs.theme`, convertido a una elección de hoy.
 *
 * - `light` o `dark`: tal cual.
 * - `system` (lo que guardaba «Same as my device», D-490): lo que el equipo está pintando ahora mismo.
 * - Nada, o algo raro: `null` (sin elección).
 */
export function temaDeLoGuardado(guardado: unknown, entorno: { sistemaOscuro: boolean }): Tema | null {
  if (esPreferenciaDeTema(guardado)) return guardado;
  if (guardado === TEMA_VIEJO_DEL_EQUIPO) return entorno.sistemaOscuro ? "dark" : "light";
  return null;
}

/**
 * El tema que se pinta.
 *
 * - Con «claro» u «oscuro» elegido, ese.
 * - Sin nada elegido, lo de siempre: claro, salvo en el escritorio de Time Tracker, que arranca en oscuro (D-080).
 */
export function temaEfectivo(pref: Tema | null | undefined, entorno: { escritorio: boolean }): Tema {
  if (pref === "light" || pref === "dark") return pref;
  return entorno.escritorio ? "dark" : "light";
}

/**
 * Lee `rtg_prefs.theme` de un texto guardado, ya convertido (`temaDeLoGuardado`). Cualquier duda —texto roto,
 * valor raro— es `null`.
 */
export function preferenciaDeTemaGuardada(raw: string | null | undefined, entorno: { sistemaOscuro: boolean }): Tema | null {
  if (!raw) return null;
  try {
    return temaDeLoGuardado((JSON.parse(raw) as { theme?: unknown } | null)?.theme, entorno);
  } catch {
    return null;
  }
}

/**
 * El guion de antes de pintar, para `<head>`. Hace lo mismo que `temaDeLoGuardado` + `temaEfectivo` con lo que hay
 * a mano antes de que cargue React: `rtg_prefs`, `window.ttDesktop` y `matchMedia`. Sin él la página se pinta un
 * instante en claro y luego salta a oscuro.
 *
 * Todavía entiende `system`: quien lo tenía guardado abre la primera página con eso, y el guion tiene que pintar lo
 * mismo que el proveedor va a guardar justo después. Si no, esa primera carga daría un salto de color.
 *
 * Sin barras invertidas ni plantillas: va tal cual dentro de un `<script>`.
 */
export const GUION_DE_TEMA =
  "try{" +
  "var p=JSON.parse(localStorage.getItem('rtg_prefs')||'{}');" +
  "var esc=!!(window.ttDesktop&&window.ttDesktop.isDesktop);" +
  "var osc=!!(window.matchMedia&&window.matchMedia('" + CONSULTA_OSCURO + "').matches);" +
  "var tema=p.theme==='dark'||p.theme==='light'?p.theme:(p.theme==='" + TEMA_VIEJO_DEL_EQUIPO + "'?(osc?'dark':'light'):(esc?'dark':'light'));" +
  "document.documentElement.setAttribute('data-theme',tema);" +
  "if(p.lang){document.documentElement.setAttribute('lang',p.lang);}" +
  "}catch(e){}";
