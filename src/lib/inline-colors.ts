// ============================================================
// Guardián de colores a pelo (G-13 / G-14, HR).
//
// Un color escrito a mano dentro de `style={{ … }}` no cambia con el tema: en oscuro se queda
// claro. Esto cuenta esos colores por fichero, para que la prueba (inline-colors.test.ts) caiga
// si el número SUBE respecto a la tabla de la decisión. No exige cero: impide volver atrás.
//
// Qué cuenta: literales `#hex`, `rgb()`/`rgba()`, `hsl()`/`hsla()` dentro de un bloque
// `style={{ … }}` (llaves emparejadas, así que un estilo de varias líneas cuenta entero).
// Qué NO cuenta: el respaldo de una variable, `var(--red, #d64545)` —ahí manda la variable y el
// hex solo aparece si nadie la definió—, y cualquier color fuera de `style={{}}` (una clase, un
// SVG, un `fill` de gráfica), que no es lo que se mide.
//
// Para CSS: `coloresSueltosCss` cuenta los colores que no son la definición de un token
// (`--x: #hex`). En recruiting.css los tokens son las dos paletas (claro y oscuro) y no son deuda;
// lo suelto es lo que hay que mirar (blancos sobre color, sombras, el velo).
//
// Puro y sin React para que vitest lo cargue tal cual.
// ============================================================

export type Color = { linea: number; texto: string };

const COLOR = /#[0-9a-fA-F]{3,8}\b|\brgba?\([^)]*\)|\bhsla?\([^)]*\)/g;

/** Cada bloque `style={{ … }}` del fuente, con la línea en que empieza. */
export function bloquesStyle(src: string): { linea: number; texto: string }[] {
  const out: { linea: number; texto: string }[] = [];
  let i = 0;
  for (;;) {
    const j = src.indexOf("style={{", i);
    if (j < 0) break;
    let k = j + "style={".length;
    let depth = 0;
    for (; k < src.length; k++) {
      const c = src[k];
      if (c === "{") depth++;
      else if (c === "}") {
        depth--;
        if (depth === 0) break;
      }
    }
    out.push({ linea: src.slice(0, j).split("\n").length, texto: src.slice(j, k + 1) });
    i = k + 1;
  }
  return out;
}

/** Colores a pelo dentro de `style={{}}`, sin los respaldos de `var()`. */
export function coloresAPelo(src: string): Color[] {
  const out: Color[] = [];
  for (const b of bloquesStyle(src)) {
    const limpio = b.texto.replace(/var\([^)]*\)/g, "var()");
    for (const m of limpio.matchAll(COLOR)) {
      out.push({ linea: b.linea + limpio.slice(0, m.index).split("\n").length - 1, texto: m[0] });
    }
  }
  return out;
}

/** Colores de una hoja CSS que no son la definición de un token (`--x: …`). Comentarios fuera. */
export function coloresSueltosCss(css: string): Color[] {
  const out: Color[] = [];
  const sinComentarios = css.replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, " "));
  sinComentarios.split("\n").forEach((l, i) => {
    const sinTokens = l.replace(/--[\w-]+\s*:[^;}]*/g, "");
    for (const m of sinTokens.matchAll(COLOR)) out.push({ linea: i + 1, texto: m[0] });
  });
  return out;
}
