/**
 * El tema de la pantalla: claro, oscuro o **el del equipo** (D-NEXT, el personalizador del hub).
 *
 * Hasta ahora solo había dos valores, `light` y `dark`, guardados en `localStorage` `rtg_prefs.theme`
 * y elegidos en «Mi perfil» o con el botón 🌙 de la barra de Time Tracker. El dueño pidió que el
 * idioma y el tema se elijan en un solo sitio del hub, «el personalizador», y ahí se añade la tercera
 * opción que pide cualquier personalizador: seguir lo que diga el sistema del teléfono o del PC.
 *
 * **Dónde se guarda, y por qué no cambia:** sigue en `rtg_prefs.theme`, por equipo. El idioma va en la
 * base y sigue a la persona (D-266); el tema no, y es a propósito: el escritorio de Time Tracker
 * arranca en oscuro (D-080) y un teléfono al sol se lee mejor en claro. No se inventa tabla.
 *
 * Aquí vive lo que se decide sin navegador, para poder probarlo con datos. El guion que corre antes de
 * pintar (`GUION_DE_TEMA`, en `app/layout.tsx`) hace lo mismo en JavaScript plano, y una prueba lo
 * ejecuta contra `temaEfectivo` con todas las combinaciones.
 */

export type Tema = "light" | "dark";
export type PreferenciaDeTema = Tema | "system";

export const PREFERENCIAS_DE_TEMA = ["light", "dark", "system"] as const satisfies readonly PreferenciaDeTema[];

export const esPreferenciaDeTema = (v: unknown): v is PreferenciaDeTema =>
  v === "light" || v === "dark" || v === "system";

/** Lo que pregunta el navegador para saber si el sistema está en oscuro. */
export const CONSULTA_OSCURO = "(prefers-color-scheme: dark)";

/**
 * El tema que se pinta.
 *
 * - Con «claro» u «oscuro» elegido, ese.
 * - Con «el del equipo», lo que diga el sistema en este momento.
 * - Sin nada elegido, lo de siempre: claro, salvo en el escritorio de Time Tracker, que arranca en
 *   oscuro (D-080). No se cambia a «el del equipo» por defecto: nadie vería cambiar su pantalla solo
 *   por desplegar esto.
 */
export function temaEfectivo(
  pref: PreferenciaDeTema | null | undefined,
  entorno: { sistemaOscuro: boolean; escritorio: boolean },
): Tema {
  if (pref === "light" || pref === "dark") return pref;
  if (pref === "system") return entorno.sistemaOscuro ? "dark" : "light";
  return entorno.escritorio ? "dark" : "light";
}

/** Lee `rtg_prefs.theme` de un texto guardado. Cualquier duda —texto roto, valor raro— es `null`. */
export function preferenciaDeTemaGuardada(raw: string | null | undefined): PreferenciaDeTema | null {
  if (!raw) return null;
  try {
    const v = (JSON.parse(raw) as { theme?: unknown } | null)?.theme;
    return esPreferenciaDeTema(v) ? v : null;
  } catch {
    return null;
  }
}

/**
 * El guion de antes de pintar, para `<head>`. Hace lo mismo que `temaEfectivo` con lo que hay a mano
 * antes de que cargue React: `rtg_prefs`, `window.ttDesktop` y `matchMedia`. Sin él la página se pinta
 * un instante en claro y luego salta a oscuro.
 *
 * Sin barras invertidas ni plantillas: va tal cual dentro de un `<script>`.
 */
export const GUION_DE_TEMA =
  "try{" +
  "var p=JSON.parse(localStorage.getItem('rtg_prefs')||'{}');" +
  "var esc=!!(window.ttDesktop&&window.ttDesktop.isDesktop);" +
  "var osc=!!(window.matchMedia&&window.matchMedia('" + CONSULTA_OSCURO + "').matches);" +
  "var tema=p.theme==='dark'||p.theme==='light'?p.theme:(p.theme==='system'?(osc?'dark':'light'):(esc?'dark':'light'));" +
  "document.documentElement.setAttribute('data-theme',tema);" +
  "if(p.lang){document.documentElement.setAttribute('lang',p.lang);}" +
  "}catch(e){}";
