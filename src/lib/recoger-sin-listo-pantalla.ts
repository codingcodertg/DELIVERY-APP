import { notaSinListoValida } from "./recogida-del-chofer";

/* ---- La pantalla simple de «Recogido» sin «listo» (D-603, 2026-10-19) ----
 * Ernesto (chofer): «When driver picks something up that warehouse hasnt marked ready it opens the order and requires them
 * to explain why theyre picking it up. Its too much information showing at a time so when they pick up stuff thats not
 * marked ready lets just have a screen that says: Not marked ready by Warehouse / Why are you picking up / Dropdown: It
 * is Ready, Im taking Partial, Other with text box for explanation. After they confirm pickup, now it can open up the
 * order to see the details». Y de la ficha: «This text is not necessary, its adding noise» (el aviso de a quién se avisa).
 *
 * Hasta aquí (D-527) «Recogido» en `approved`/`fulfilling` abría la ficha entera con el paso «Recoger de todos modos» y
 * una nota libre obligatoria. Ahora sale un cuadro pequeño (como el de pallets, D-547) con un motivo de un toque; «Otro»
 * pide el texto. La ESCRITURA es la misma de la ficha (`notaDeRecogidaSinListo`, evento, avisos al almacén y logística);
 * aquí solo se decide qué nota va. Al confirmar, se abre la ficha para ver los detalles. */

export type MotivoSinListo = "lista" | "parcial" | "otro";

export const MOTIVOS_SIN_LISTO: readonly { clave: MotivoSinListo; en: string; es: string }[] = [
  { clave: "lista", en: "It is ready", es: "Sí está lista" },
  { clave: "parcial", en: "I'm taking a partial load", es: "Me llevo una parte" },
  { clave: "otro", en: "Other", es: "Otro" },
];

/** Las etapas en que «Recogido» abre este cuadro: aprobada sin que el almacén la haya marcado lista (D-527). */
export const ETAPAS_SIN_LISTO: ReadonlySet<string> = new Set(["approved", "fulfilling"]);

export function abreElCuadroSinListo(stage: string | null | undefined): boolean {
  return ETAPAS_SIN_LISTO.has(stage ?? "");
}

/**
 * La nota que va al evento (la misma que la ficha validaba con `notaSinListoValida`): el motivo en el idioma de quien recoge,
 * y con «Otro», lo que escribió. `null` = no se puede confirmar (Otro sin texto, o texto demasiado corto).
 */
export function notaDelMotivoSinListo(motivo: MotivoSinListo | null, texto: string, lang: "en" | "es"): string | null {
  if (!motivo) return null;
  const m = MOTIVOS_SIN_LISTO.find((x) => x.clave === motivo)!;
  if (motivo !== "otro") return m[lang];
  return notaSinListoValida(texto);
}
