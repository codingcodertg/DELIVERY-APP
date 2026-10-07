import type { Idioma } from "./idioma";
import type { PreferenciaDeTema } from "./tema";

/**
 * El personalizador del hub (D-490).
 *
 * El dueño, el 2026-10-07: «el botón para español y dark mode y todo eso, todo eso se elige desde su
 * personalizar […] En el RTG Hub tiene que estar un personalizador de toda la aplicación, si es en
 * español, si es en inglés, si es dark mode, y ahí todo es ahí».
 *
 * Hasta ese día el idioma se cambiaba en cuatro sitios —«Mi perfil», y un botón ES/EN en las barras
 * de Time Tracker, RR. HH. y el ERP— y el tema en dos —«Mi perfil» y el 🌙 de Time Tracker—. Ahora se
 * eligen aquí y en ningún otro sitio de las apps; cada barra deja, en su lugar, un enlace hasta aquí.
 *
 * Lo que guarda cada opción no cambia, y por eso no hace falta migración:
 * - **el idioma** va en `public.profiles.language`, por persona, y sigue a la persona entre equipos
 *   (D-266, `lib/idioma.ts`); Time Tracker lo lee de su copia `tt_lang`, que escribe el mismo proveedor;
 * - **el tema** va en `localStorage` `rtg_prefs.theme`, por equipo (`lib/tema.ts`), y lo pintan todas
 *   las apps desde el atributo `data-theme` de `<html>`.
 *
 * La página solo pide sesión, como «Mi perfil» (D-265): el chofer, que no llega al lobby (D-173), entra
 * desde el menú de su nombre en Entregas.
 */
export const RUTA_PERSONALIZAR = "/home/personalizar";

type Opcion<V> = { valor: V; emoji: string; en: string; es: string };

export const OPCIONES_DE_IDIOMA: readonly Opcion<Idioma>[] = [
  { valor: "es", emoji: "🇪🇸", en: "Español", es: "Español" },
  { valor: "en", emoji: "🇬🇧", en: "English", es: "English" },
];

export const OPCIONES_DE_TEMA: readonly Opcion<PreferenciaDeTema>[] = [
  { valor: "light", emoji: "☀️", en: "Light", es: "Claro" },
  { valor: "dark", emoji: "🌙", en: "Dark", es: "Oscuro" },
  { valor: "system", emoji: "🖥️", en: "Same as my device", es: "Como mi equipo" },
];
