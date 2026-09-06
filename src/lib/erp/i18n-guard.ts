// ============================================================
// Guardián de texto a pelo en el ERP (G-10, D-203).
//
// El ERP se traduce con pares inline —`t("English", "Español")` de usePrefs—, así que no hay un
// diccionario contra el que comprobar claves como en Time Tracker (D-187). Lo que sí se puede
// vigilar es lo contrario: que en un fichero ya traducido no vuelva a colarse texto de pantalla
// en inglés fijo. Esto busca, en el fuente y con las llamadas t("…", "…") ya quitadas, tres
// formas de texto a pelo:
//
//   1. nodos de texto JSX:  <button>Save changes</button>   →  ">Save changes<"
//   2. atributos que se leen: placeholder="…", title="…", aria-label="…", alt="…"
//   3. literales con pinta de frase: "Loading more…", "Needs review", "Saved."
//
// Es una regex, no un parser: pilla lo que un cambio descuidado deja (una frase, una etiqueta
// con espacio, un placeholder) y deja pasar a propósito lo que no es texto de interfaz:
// siglas (SKU, QOH, CSV), símbolos (—, ×, ▲), valores guardados en minúscula ("active"),
// una sola palabra entre comillas ("Edit") que no se puede distinguir de un valor, un nodo
// mixto que empieza por expresión ("{n} left"), y las cabeceras de los ficheros exportados
// (exportCsv/exportXlsx), que son datos del fichero y se quedan en inglés a propósito.
//
// Puro y sin React para que vitest lo cargue tal cual; la prueba lo aplica a los ficheros
// traducidos y a dos fixtures (uno con texto a pelo, otro limpio) para probarse a sí mismo.
// ============================================================

export type Hallazgo = { linea: number; tipo: "jsx" | "atributo" | "literal"; texto: string };

/** Siglas y palabras que son iguales en los dos idiomas o no son texto. */
const PERMITIDAS = new Set([
  "sku", "qoh", "csv", "xlsx", "upc", "mpn", "moq", "seo", "rtg", "erp", "uom", "pdf", "url", "qb",
  "png", "jpg", "svg", "ok", "http", "https",
  // Nombres propios y términos de comercio iguales en los dos idiomas.
  "incoterm", "shopify", "daltile", "excel", "proforma",
]);

function esTexto(s: string): boolean {
  // Al menos una palabra de tres letras que no sea sigla permitida.
  const palabras = s.match(/[A-Za-z]{3,}/g) ?? [];
  return palabras.some((w) => !PERMITIDAS.has(w.toLowerCase()));
}

/** Quita comentarios, las llamadas t("…", "…") / t(`…`, `…`) y las hojas <Tx en es />: es justo el texto ya traducido. */
export function fuenteSinTraducido(src: string): string {
  return src
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    // Lo que va en <code> es literal (un comando, un nombre de columna), no texto de pantalla.
    .replace(/<code\b[^>]*>[\s\S]*?<\/code>/g, "<code />")
    .replace(/\bt\(\s*"(?:[^"\\]|\\.)*"\s*,\s*"(?:[^"\\]|\\.)*"\s*\)/g, "t(…)")
    .replace(/\bt\(\s*`[^`]*`\s*,\s*`[^`]*`\s*\)/g, "t(…)")
    // La hoja de cliente de los server components (5b): <Tx en="…" es="…" />, también traducido.
    .replace(/<Tx\s+en="(?:[^"\\]|\\.)*"\s+es="(?:[^"\\]|\\.)*"\s*\/>/g, "{t(…)}");
}

export function textoAPelo(src: string): Hallazgo[] {
  const out: Hallazgo[] = [];
  const limpio = fuenteSinTraducido(src);
  const lineaDe = (idx: number) => limpio.slice(0, idx).split("\n").length;

  // 1. Nodos de texto tras el cierre de una etiqueta: el ">" va pegado a un nombre, una comilla,
  //    "}" o "/" (un "a > b" lleva espacio delante y no cuenta). El texto no puede empezar por
  //    lo que sigue a un genérico o a una flecha: "(", "=", ")", ";", ",", "[", ".", "&", "|".
  const nodo = /(?<=[\w"'}/]>)([^<>{}]*[A-Za-z][^<>{}]*)(?=[<{])/g;
  for (const m of limpio.matchAll(nodo)) {
    const t = m[1].replace(/\s+/g, " ").trim();
    if (!t || /^[=;)(,.\[&|?:]/.test(t) || !esTexto(t)) continue;
    out.push({ linea: lineaDe(m.index!), tipo: "jsx", texto: t });
  }

  // 2. Atributos con texto que se lee o se anuncia.
  const attr = /\b(placeholder|title|aria-label|alt)="([^"]*)"/g;
  for (const m of limpio.matchAll(attr)) {
    if (esTexto(m[2])) out.push({ linea: lineaDe(m.index!), tipo: "atributo", texto: m[2] });
  }

  // 3. Literales con pinta de frase: mayúscula inicial y, o bien un espacio + otra palabra, o bien
  //    puntos suspensivos / punto final. "Active" (una palabra) no cae; "Needs review" sí.
  //    Las cabeceras de exportación y los imports se dejan fuera línea a línea.
  const lineas = limpio.split("\n");
  const frase = /"([A-Z][a-z]+(?: [^"]+|…|\.))"/g;
  lineas.forEach((l, i) => {
    // `export const metadata = { title: "… — RTG ERP" }` es el título de la pestaña del navegador,
    // que Next lee en el servidor: sin idioma en el servidor se queda en inglés (excepción dicha
    // en la decisión de 5b), y no es texto de la pantalla.
    if (/exportCsv|exportXlsx|const headers|^\s*import |\bfrom "|export const metadata/.test(l)) return;
    for (const m of l.matchAll(frase)) {
      if (esTexto(m[1])) out.push({ linea: i + 1, tipo: "literal", texto: m[1] });
    }
  });

  // Un placeholder="…" cae por 2 y por 3: se cuenta una vez, por línea y texto.
  const vistos = new Set<string>();
  return out.filter((h) => {
    const k = `${h.linea}|${h.texto}`;
    if (vistos.has(k)) return false;
    vistos.add(k);
    return true;
  });
}
