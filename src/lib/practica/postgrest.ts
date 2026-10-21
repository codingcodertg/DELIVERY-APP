/**
 * Lo justo de PostgREST para que la práctica (D-628, `practica/fetch-de-practica.ts`) entienda una consulta sin
 * mandarla: qué tabla, qué filtros, qué orden y cuántas filas. Es puro: entra una URL y salen datos.
 *
 * Solo lo que la app usa. Lo que no entiende (un filtro sobre JSON, una búsqueda de texto completo…) vuelve como
 * `null` («no lo sé») y quien llama decide con prudencia: no quita una fila real por un filtro que no sabe leer, y no
 * añade una de práctica que quizá no tocaba.
 */

export type Fila = Record<string, unknown>;

/** Los parámetros que no son filtros. */
const RESERVADOS = new Set(["select", "order", "limit", "offset", "on_conflict", "columns"]);

/** `/rest/v1/<tabla>` → la tabla; las funciones (`/rest/v1/rpc/…`) y lo demás → `null`. */
export function tablaDeLaRuta(url: string): string | null {
  let ruta = url;
  try { ruta = new URL(url, "http://local").pathname; } catch { /* tal cual */ }
  const resto = ruta.split("/rest/v1/")[1];
  if (!resto || resto.startsWith("rpc/")) return null;
  const tabla = decodeURIComponent(resto.split("/")[0]);
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(tabla) ? tabla : null;
}

/** Parte `a,b(c,d),e` por las comas de fuera de paréntesis y comillas. */
export function partePorComas(texto: string): string[] {
  const out: string[] = [];
  let nivel = 0, comillas = false, actual = "";
  for (let i = 0; i < texto.length; i++) {
    const ch = texto[i];
    if (ch === '"' && texto[i - 1] !== "\\") comillas = !comillas;
    if (!comillas && ch === "(") nivel++;
    if (!comillas && ch === ")") nivel--;
    if (!comillas && nivel === 0 && ch === ",") { out.push(actual); actual = ""; continue; }
    actual += ch;
  }
  if (actual !== "" || out.length) out.push(actual);
  return out;
}

const sinComillas = (v: string) => (v.length >= 2 && v.startsWith('"') && v.endsWith('"') ? v.slice(1, -1).replace(/\\"/g, '"') : v);

const esNumero = (v: unknown) => typeof v === "number" || (typeof v === "string" && v.trim() !== "" && !Number.isNaN(Number(v)));
const pareceFecha = (v: string) => /^\d{4}-\d{2}-\d{2}/.test(v) && !Number.isNaN(Date.parse(v));

/** Compara un valor de la fila con el texto del filtro: números como números, fechas como fechas, lo demás como texto. */
function compara(valor: unknown, texto: string): number | null {
  if (valor === null || valor === undefined) return null;
  if (typeof valor === "boolean") return String(valor) === texto ? 0 : String(valor) < texto ? -1 : 1;
  if (esNumero(valor) && esNumero(texto)) return Math.sign(Number(valor) - Number(texto));
  const s = typeof valor === "string" ? valor : JSON.stringify(valor);
  if (pareceFecha(s) && pareceFecha(texto)) return Math.sign(Date.parse(s) - Date.parse(texto));
  return s === texto ? 0 : s < texto ? -1 : 1;
}

const comoRegex = (patron: string, flags: string) =>
  new RegExp("^" + patron.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/[*%]/g, ".*").replace(/_/g, ".") + "$", flags);

/** Las listas de PostgREST: `(a,"b c")` para `in`, `{a,b}` para arrays. */
function lista(texto: string): string[] {
  const dentro = texto.replace(/^[({]/, "").replace(/[)}]$/, "");
  return dentro === "" ? [] : partePorComas(dentro).map((x) => sinComillas(x.trim()));
}

/**
 * ¿La fila cumple `columna=op.valor`? `true`/`false`, o `null` si el filtro no se sabe leer aquí.
 * Admite `not.` delante de cualquier operador.
 */
export function cumpleFiltro(fila: Fila, columna: string, expresion: string): boolean | null {
  if (/->|::|\./.test(columna)) return null; // JSON, casts o recursos anidados: no se sabe
  let e = expresion;
  let niega = false;
  if (e.startsWith("not.")) { niega = true; e = e.slice(4); }
  const punto = e.indexOf(".");
  if (punto < 0) return null;
  const op = e.slice(0, punto);
  const valorTexto = sinComillas(e.slice(punto + 1));
  const v = fila[columna];
  if (!(columna in fila)) return null;
  let r: boolean | null;
  switch (op) {
    case "eq": { const c = compara(v, valorTexto); r = c === null ? false : c === 0; break; }
    case "neq": { const c = compara(v, valorTexto); r = c === null ? false : c !== 0; break; }
    case "gt": { const c = compara(v, valorTexto); r = c === null ? false : c > 0; break; }
    case "gte": { const c = compara(v, valorTexto); r = c === null ? false : c >= 0; break; }
    case "lt": { const c = compara(v, valorTexto); r = c === null ? false : c < 0; break; }
    case "lte": { const c = compara(v, valorTexto); r = c === null ? false : c <= 0; break; }
    case "like": r = v == null ? false : comoRegex(valorTexto, "").test(String(v)); break;
    case "ilike": r = v == null ? false : comoRegex(valorTexto, "i").test(String(v)); break;
    case "is":
      if (valorTexto === "null") r = v === null || v === undefined;
      else if (valorTexto === "true") r = v === true;
      else if (valorTexto === "false") r = v === false;
      else r = null;
      break;
    case "in": r = v == null ? false : lista(valorTexto).some((x) => compara(v, x) === 0); break;
    case "cs": r = Array.isArray(v) ? lista(valorTexto).every((x) => v.map(String).includes(x)) : null; break;
    case "cd": r = Array.isArray(v) ? v.map(String).every((x) => lista(valorTexto).includes(x)) : null; break;
    case "ov": r = Array.isArray(v) ? lista(valorTexto).some((x) => v.map(String).includes(x)) : null; break;
    default: r = null;
  }
  if (r === null) return null;
  return niega ? !r : r;
}

/** `or=(a.eq.1,and(b.gt.2,c.is.null))` y `and=(…)`: el contenido entre paréntesis. */
function cumpleLogico(fila: Fila, tipo: "or" | "and", contenido: string): boolean | null {
  const partes = partePorComas(contenido.replace(/^\(/, "").replace(/\)$/, ""));
  const res = partes.map((p) => cumpleTermino(fila, p.trim()));
  if (tipo === "or") {
    if (res.some((x) => x === true)) return true;
    return res.some((x) => x === null) ? null : false;
  }
  if (res.some((x) => x === false)) return false;
  return res.some((x) => x === null) ? null : true;
}

/** Un término dentro de `or`/`and`: `col.op.valor`, `not.and(…)`, `or(…)`. */
function cumpleTermino(fila: Fila, termino: string): boolean | null {
  let t = termino;
  let niega = false;
  if (t.startsWith("not.")) { niega = true; t = t.slice(4); }
  let r: boolean | null;
  if (t.startsWith("or(") || t.startsWith("and(")) {
    const tipo = t.startsWith("or(") ? "or" : "and";
    r = cumpleLogico(fila, tipo, t.slice(tipo.length));
  } else {
    const punto = t.indexOf(".");
    if (punto < 0) return null;
    r = cumpleFiltro(fila, t.slice(0, punto), t.slice(punto + 1));
  }
  if (r === null) return null;
  return niega ? !r : r;
}

/** ¿Cumple TODOS los filtros de la consulta? `null` si alguno no se sabe leer y ninguno la descarta. */
export function cumpleConsulta(fila: Fila, params: URLSearchParams): boolean | null {
  let incierto = false;
  for (const [clave, valor] of params) {
    if (RESERVADOS.has(clave)) continue;
    let r: boolean | null;
    if (clave === "or" || clave === "and") r = cumpleLogico(fila, clave, valor);
    else if (clave === "not.or" || clave === "not.and") {
      const x = cumpleLogico(fila, clave.slice(4) as "or" | "and", valor);
      r = x === null ? null : !x;
    } else r = cumpleFiltro(fila, clave, valor);
    if (r === false) return false;
    if (r === null) incierto = true;
  }
  return incierto ? null : true;
}

/** Ordena como `order=a.desc.nullslast,b`. Sin `order`, deja el orden que traen. */
export function ordena(filas: Fila[], order: string | null): Fila[] {
  if (!order) return filas;
  const claves = partePorComas(order).map((p) => {
    const [col, ...mods] = p.trim().split(".");
    const desc = mods.includes("desc");
    const nullsFirst = mods.includes("nullsfirst") ? true : mods.includes("nullslast") ? false : desc; // como Postgres
    return { col, desc, nullsFirst };
  });
  return [...filas].sort((a, b) => {
    for (const { col, desc, nullsFirst } of claves) {
      const va = a[col], vb = b[col];
      const na = va === null || va === undefined, nb = vb === null || vb === undefined;
      if (na && nb) continue;
      if (na) return nullsFirst ? -1 : 1;
      if (nb) return nullsFirst ? 1 : -1;
      const c = compara(va, typeof vb === "string" ? vb : String(vb)) ?? 0;
      if (c !== 0) return desc ? -c : c;
    }
    return 0;
  });
}

/**
 * Las columnas de `select` de arriba (sin las de recursos anidados): `["*"]`, o los nombres con su alias
 * (`alias:col` → `{ como: "alias", col: "col" }`). Los anidados vuelven aparte, para dejarles un hueco vacío.
 */
export function columnasDelSelect(select: string | null): { todas: boolean; columnas: { como: string; col: string }[]; anidados: string[] } {
  const s = (select ?? "*").trim() || "*";
  const columnas: { como: string; col: string }[] = [];
  const anidados: string[] = [];
  let todas = false;
  for (const parte of partePorComas(s)) {
    const p = parte.trim();
    if (!p) continue;
    if (p.includes("(")) { anidados.push(p.slice(0, p.indexOf("(")).split(":")[0].replace(/!.*$/, "")); continue; }
    if (p === "*") { todas = true; continue; }
    const [izq, der] = p.includes(":") ? p.split(":") : [p, p];
    columnas.push({ como: izq.trim(), col: der.replace(/::.*$/, "").trim() });
  }
  return { todas, columnas, anidados };
}

/** La fila como la devolvería ese `select`: solo esas columnas, y los anidados vacíos. */
export function proyecta(fila: Fila, select: string | null): Fila {
  const { todas, columnas, anidados } = columnasDelSelect(select);
  const out: Fila = todas ? { ...fila } : {};
  for (const { como, col } of columnas) out[como] = fila[col] ?? null;
  for (const a of anidados) if (!(a in out)) out[a] = [];
  return out;
}
