/**
 * Lectura del HTML de un correo SIN expresiones regulares que retrocedan (ReDoS). Todo es una pasada lineal sobre el
 * texto ya acotado a 200 KB; las búsquedas de «>» y de «</a» se precalculan una vez. PURO.
 */

/** Tope de lo que se lee de un correo. Un cuerpo más largo se corta: el candidato sale del principio. */
export const TOPE_CUERPO = 200_000;

export function acotaCuerpo(s: string | null | undefined): string {
  return (s ?? "").slice(0, TOPE_CUERPO);
}

/** `sig[i]` = índice del siguiente «>» desde i (o -1). Una sola pasada hacia atrás. */
function siguienteGt(s: string): Int32Array {
  const n = s.length;
  const sig = new Int32Array(n + 1);
  sig[n] = -1;
  for (let i = n - 1; i >= 0; i--) sig[i] = s.charCodeAt(i) === 62 ? i : sig[i + 1];
  return sig;
}

const BLOQUE = new Set(["p", "div", "tr", "li", "h1", "h2", "h3", "h4", "h5", "h6", "table", "ul", "ol"]);
const CELDA = new Set(["td", "th"]);

/** Quita las etiquetas (los bloques dan salto de línea), los comentarios y el contenido de script/style. */
export function textoPlanoLineal(entrada: string): string {
  const s = acotaCuerpo(entrada).replace(/\r/g, "");
  const n = s.length;
  const sig = siguienteGt(s);
  let low: string | null = null;
  const partes: string[] = [];
  let i = 0;
  while (i < n) {
    if (s.charCodeAt(i) === 60 /* < */) {
      const fin = i + 1 <= n ? sig[i + 1] : -1;
      if (fin !== -1 && fin - i < 2000) {
        if (s.startsWith("<!--", i)) {
          const e = s.indexOf("-->", i + 4);
          i = e === -1 ? n : e + 3;
          continue;
        }
        const etiq = s.slice(i + 1, fin);
        const m = /^(\/?)\s*([a-zA-Z][a-zA-Z0-9]*)/.exec(etiq);
        if (m) {
          const cierre = m[1] === "/";
          const nombre = m[2].toLowerCase();
          if (!cierre && (nombre === "script" || nombre === "style")) {
            if (low === null) low = s.toLowerCase();
            const fc = low.indexOf(`</${nombre}`, fin + 1);
            const gt = fc === -1 ? -1 : sig[fc];
            partes.push(" ");
            i = gt === -1 ? n : gt + 1;
            continue;
          }
          if (nombre === "br" || BLOQUE.has(nombre)) partes.push("\n");
          else if (CELDA.has(nombre) && cierre) partes.push("  ");
          i = fin + 1;
          continue;
        }
      }
      partes.push("<");
      i++;
      continue;
    }
    const prox = s.indexOf("<", i);
    const fin2 = prox === -1 ? n : prox;
    partes.push(s.slice(i, fin2));
    i = fin2;
  }
  const t = partes
    .join("")
    .split("&nbsp;").join(" ")
    .split("&#160;").join(" ")
    .split("&bull;").join("•")
    .split("&middot;").join("·")
    .split("&lt;").join("<")
    .split("&gt;").join(">")
    .split("&quot;").join('"')
    .split("&#39;").join("'")
    .split("&apos;").join("'")
    .split("&amp;").join("&");
  return t
    .split("\n")
    .map((l) => l.replace(/[ \t]+/g, " ").trim())
    .filter((l) => l.length > 0)
    .join("\n");
}

const LOCAL = /[A-Za-z0-9._%+-]/;
const DOMINIO = /^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/i;
const EXTENSIONES_FALSAS = /\.(png|jpe?g|gif|webp|svg)$/i;

/** Direcciones que aparecen, sin repetir y en minúsculas. Busca cada «@» y se extiende a izquierda y derecha (acotado). */
export function extraerEmailsLineal(...textos: string[]): string[] {
  const vistos = new Set<string>();
  for (const t of textos) {
    const s = acotaCuerpo(t);
    let pos = s.indexOf("@");
    while (pos !== -1) {
      let a = pos;
      while (a > 0 && pos - a < 64 && LOCAL.test(s[a - 1])) a--;
      let b = pos + 1;
      while (b < s.length && b - pos < 254 && /[A-Za-z0-9.-]/.test(s[b])) b++;
      const local = s.slice(a, pos);
      const dom = s.slice(pos + 1, b).replace(/\.+$/, "");
      if (local && DOMINIO.test(dom)) {
        const e = `${local}@${dom}`.toLowerCase();
        if (!EXTENSIONES_FALSAS.test(e)) vistos.add(e);
      }
      pos = s.indexOf("@", pos + 1);
    }
  }
  return [...vistos];
}

/** Solo enlaces https cuyo host es indeed.com o un subdominio suyo. Cualquier otro se descarta (devuelve null). */
export function enlaceSeguro(href: string | null | undefined): string | null {
  const h0 = (href ?? "").trim();
  if (!h0 || h0.length > 2000) return null;
  let u: URL;
  try {
    u = new URL(h0);
  } catch {
    return null;
  }
  if (u.protocol !== "https:") return null;
  const host = u.hostname.toLowerCase();
  if (host !== "indeed.com" && !host.endsWith(".indeed.com")) return null;
  return u.toString();
}

/**
 * El primer enlace seguro cuyo TEXTO cumple `etiqueta` (expresión regular sobre el texto ya limpio, corta).
 * Recorre los `<a ...>…</a>` en una pasada; el contenido de cada ancla se acota a 2000 caracteres.
 */
export function enlaceConTexto(cuerpo: string, etiqueta: RegExp): string | null {
  const s = acotaCuerpo(cuerpo);
  const low = s.toLowerCase();
  const sig = siguienteGt(s);
  const cierres: number[] = [];
  for (let p = low.indexOf("</a"); p !== -1; p = low.indexOf("</a", p + 1)) cierres.push(p);
  let k = 0;
  for (let pos = low.indexOf("<a"); pos !== -1; pos = low.indexOf("<a", pos + 2)) {
    const sep = low.charAt(pos + 2);
    if (!(sep === " " || sep === ">" || sep === "\t" || sep === "\n")) continue;
    const fin = sig[pos];
    if (fin === -1 || fin - pos >= 1000) continue;
    const apertura = s.slice(pos, fin + 1);
    const hm = /href\s*=\s*["']([^"']{1,2000})["']/i.exec(apertura);
    if (!hm) continue;
    while (k < cierres.length && cierres[k] <= fin) k++;
    if (k >= cierres.length) break;
    const cierre = cierres[k];
    if (cierre - fin > 2000) continue;
    const texto = textoPlanoLineal(s.slice(fin + 1, cierre));
    if (!etiqueta.test(texto)) continue;
    const seguro = enlaceSeguro(hm[1].replace(/&amp;/g, "&"));
    if (seguro) return seguro;
  }
  return null;
}
