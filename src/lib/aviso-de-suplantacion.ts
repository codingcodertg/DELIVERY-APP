import { esIdioma, idiomaDeRtgPrefs, type Idioma } from "./idioma";

/**
 * En qué idioma habla el aviso amarillo de «Entrar como» (D-243), y qué dice (D-NEXT).
 *
 * D-483 lo dejó en una línea corta… y en español fijo: el aviso vive en el layout raíz, FUERA de
 * `PrefsProvider`, y no tenía de dónde sacar el idioma. El dueño, 2026-10-11: «For some reason when i switch
 * users the switch back language is spanish even though the language is set to ENG».
 *
 * **Habla el idioma del admin que entró, no el de la pantalla.** Durante la suplantación la sesión es la de la
 * otra persona, y `PrefsProvider` pinta la app en SU idioma (`profiles.language` de ella, D-266). El aviso no
 * es de ella: es lo único de la pantalla que le habla al admin —«estás como Ernesto, vuelve a tu cuenta»—, así
 * que va en el idioma que el admin eligió en «Personalizar» (D-490), el de SU fila de `profiles`. Lo trae
 * `/api/impersonate/state` (`idioma`), que lo lee con el `adminId` de la cookie de vuelta.
 *
 * Si el admin nunca eligió (columna vacía), la copia de pantalla de este equipo (`rtg_prefs.lang`, la misma
 * que pinta la app antes de que responda la red); y si tampoco hay, inglés, que es el de siempre de la app.
 */
export function idiomaDelAviso(a: { delAdmin: unknown; copiaLocal: string | null | undefined }): Idioma {
  if (esIdioma(a.delAdmin)) return a.delAdmin;
  return idiomaDeRtgPrefs(a.copiaLocal) ?? "en";
}

/**
 * El `t(en, es)` del aviso. El aviso no puede usar `usePrefs` (vive fuera del proveedor, y el proveedor de la
 * sesión hablaría el idioma de la otra persona), así que se lo hace con el idioma de `idiomaDelAviso`.
 */
export function traduce(idioma: Idioma): (en: string, es: string) => string {
  return (en, es) => (idioma === "es" ? es : en);
}
