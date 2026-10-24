/**
 * Clientes · empresas y duplicados (migración 189). Funciones PURAS, sin importaciones: las usan la pantalla, el demo
 * y el guion de una vez `scripts/junta-clientes-duplicados.mts` (Node las carga tal cual, con type stripping). Lo que
 * decide qué filas son la misma empresa, qué fila sobrevive y qué se apunta en las notas vive aquí y solo aquí; la
 * función de la base (`erp.junta_clientes`, 189) aplica las MISMAS reglas de campos, y el ensayo del guion compara las
 * dos fila por fila.
 *
 * El dueño (2026-10-21): «analices toda la lista otra vez y ver los que son obviamente duplicados, hacerle un merge
 * […] hay uno en Far [Pharr], uno en Browser [Brownsville] […] en la misma aplicación vas a tener uno en Browser, uno
 * en Far […] puedes cambiar las tiendas y va a display otro content information y otro rep. […] los que no son,
 * obviamente, pero que tienen sospecha de ser la misma compañía, tiene que irse a un site que dice Decide to Merge».
 *
 * Tres ideas:
 *  1. Una EMPRESA es un grupo de filas de `erp.customers` (una por tienda) con el mismo `company_id`.
 *  2. OBVIO = mismo nombre normalizado, o misma «cuenta unificada» normalizada (la columna del Excel del dueño). Se
 *     juntan solos: en tiendas distintas → misma empresa; en la misma tienda → una sola fila (sobrevive la más vieja,
 *     la otra se ARCHIVA, nunca se borra).
 *  3. SOSPECHOSO = nombre parecido (o contenido en el otro), o mismo teléfono, o mismo correo, en empresas distintas.
 *     Va a la cola «Decidir si se juntan», y lo decide una persona.
 */

/** Lo mínimo de una fila que miran estas funciones. */
export interface FilaDeCliente {
  id: number;
  store: string;
  account: string;
  unified_account: string | null;
  phone: string | null;
  email: string | null;
  archived_at: string | null;
  /** Migración 189. null/undefined = sin migración: la fila es su propia empresa. */
  company_id?: string | null;
  /** Migración 193 (D-NEXT): sus contactos. Los teléfonos y correos de todos cuentan en el aviso de duplicado. */
  contacts?: readonly { phones: readonly string[]; emails: readonly string[] }[] | null;
}

// ---- Normalizar ---------------------------------------------------------------------------------------------------

/** Las palabras que no distinguen una empresa de otra: la forma jurídica y el artículo. */
export const PALABRAS_DE_FORMA = ["llc", "inc", "co", "corp", "corporation", "company", "ltd", "the"] as const;
const FORMA = new Set<string>(PALABRAS_DE_FORMA);

/**
 * El nombre de una cuenta reducido a lo que la distingue: minúsculas, sin acentos, `&` → «and», sin puntos ni
 * apóstrofos (para que «L.L.C.» sea «llc» y «Lowe's» sea «lowes»), lo demás que no sea letra o número → espacio, y sin
 * las palabras de forma (LLC, INC, CO, CORP, CORPORATION, COMPANY, LTD, THE).
 *   «H & A RGV Construction Corporation» y «H&A RGV Construction Corp.» → «h and a rgv construction».
 */
export function normalizaNombre(s: string | null | undefined): string {
  const x = (s ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/&/g, " and ")
    .replace(/[.'’`´]/g, "")
    .replace(/[^a-z0-9]+/g, " ");
  return x.split(" ").filter((t) => t !== "" && !FORMA.has(t)).join(" ");
}

/** Los teléfonos de un campo (puede traer dos: «956-708-0518 / 956-378-3332»), como 10 dígitos. Sin el 1 de delante. */
export function telefonos(s: string | null | undefined): string[] {
  const out = new Set<string>();
  for (const trozo of (s ?? "").split(/[/,;|]|\band\b|\bor\b|\by\b/i)) {
    let d = trozo.replace(/\D/g, "");
    if (d.length === 11 && d.startsWith("1")) d = d.slice(1);
    if (d.length !== 10) continue;
    if (/^(\d)\1{9}$/.test(d)) continue; // 0000000000, 9999999999: no es un teléfono
    out.add(d);
  }
  return [...out];
}

/** Los correos de un campo (a veces trae varios separados por «;» o «Nombre <correo>»), en minúsculas. */
export function correos(s: string | null | undefined): string[] {
  return [...new Set((s ?? "").toLowerCase().match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/g) ?? [])];
}

/** Los dominios de correo gratuitos: que dos empresas tengan gmail no dice nada; que tengan el MISMO correo de gmail, sí. */
export const CORREO_GRATUITO = new Set([
  "gmail.com", "yahoo.com", "hotmail.com", "aol.com", "icloud.com", "outlook.com", "live.com", "msn.com", "sbcglobal.net",
  "att.net", "rgv.rr.com", "me.com", "ymail.com", "yahoo.com.mx", "hotmail.es", "prodigy.net.mx",
]);

/**
 * Un dominio que NO es gratuito y que aparece con muchas direcciones distintas es el de alguien que da su propio
 * correo de trabajo en fichas ajenas (un vendedor, envíos, contabilidad): ese correo no es del cliente y no prueba que
 * dos clientes sean el mismo. Medido el 2026-10-21 sobre los 1.199 vivos: un dominio tenía 14 direcciones en fichas de
 * empresas que no tienen nada que ver entre sí; el siguiente dominio propio, 3. El corte va entre medias.
 */
export const DIRECCIONES_DE_UN_DOMINIO_COMPARTIDO = 6;
export function dominiosCompartidos(filas: readonly Pick<FilaDeCliente, "email">[]): Set<string> {
  const por = new Map<string, Set<string>>();
  for (const f of filas) for (const c of correos(f.email)) {
    const d = c.split("@")[1];
    if (CORREO_GRATUITO.has(d)) continue;
    if (!por.has(d)) por.set(d, new Set());
    por.get(d)!.add(c);
  }
  return new Set([...por].filter(([, s]) => s.size >= DIRECCIONES_DE_UN_DOMINIO_COMPARTIDO).map(([d]) => d));
}

// ---- Parecido -----------------------------------------------------------------------------------------------------

/** Distancia de Levenshtein (inserciones, borrados y cambios de una letra). */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

/** 1 = iguales, 0 = nada que ver: 1 − distancia / largo del más largo. */
export function similitud(a: string, b: string): number {
  const m = Math.max(a.length, b.length);
  if (m === 0) return 0;
  return 1 - levenshtein(a, b) / m;
}

export const SIMILITUD_SOSPECHOSA = 0.85;

/** ¿Todas las palabras del nombre más corto (al menos dos) están en el otro? «antre homes» ⊂ «antre signature homes». */
export function nombreContenido(a: string, b: string): boolean {
  if (a === b) return false;
  const ta = a.split(" ").filter(Boolean), tb = b.split(" ").filter(Boolean);
  const [corto, largo] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
  if (corto.length < 2) return false;
  const set = new Set(largo);
  return corto.every((t) => set.has(t));
}

// ---- Empresas -----------------------------------------------------------------------------------------------------

/** La empresa de una fila: su `company_id`, o ella misma si aún no hay (código antes que la 189). */
export function claveDeEmpresa(f: Pick<FilaDeCliente, "id" | "company_id">): string {
  return f.company_id ? f.company_id : `#${f.id}`;
}

export const codigoDeTienda = (s: string | null | undefined): string => (s ?? "").trim().toUpperCase();

/** Unión-búsqueda sobre ids. */
function unionBusqueda(ids: readonly number[]) {
  const padre = new Map<number, number>(ids.map((i) => [i, i]));
  const raiz = (x: number): number => { let r = x; while (padre.get(r) !== r) r = padre.get(r)!; padre.set(x, r); return r; };
  const une = (a: number, b: number) => { const ra = raiz(a), rb = raiz(b); if (ra !== rb) padre.set(Math.max(ra, rb), Math.min(ra, rb)); };
  return { raiz, une };
}

/**
 * La clave de nombre para lo OBVIO: el nombre normalizado SIN espacios, para que «EVENCIO LARA» y «EVENCIOLARA», «O J
 * MORALES» y «OJ MORALES», o «D' SOL» y «D`SOL» sean el mismo nombre. Vacía si no queda nada de dos letras o más.
 */
export function claveDeNombre(s: string | null | undefined): string {
  const k = normalizaNombre(s).replace(/ /g, "");
  return k.length >= 2 ? k : "";
}

/**
 * Los grupos OBVIOS entre las filas VIVAS (las archivadas no se tocan). Dos pasos:
 *  1. Mismo nombre (`claveDeNombre`), o ya la misma empresa. Transitivo.
 *  2. Misma «cuenta unificada» normalizada (la agrupación del Excel del dueño): une esos grupos ENTRE TIENDAS. Si la
 *     unión pondría en la MISMA tienda dos filas de nombre distinto, solo se une si los nombres son casi iguales
 *     (similitud ≥ 0,85: «ORTEGON INVESTMENT» / «ORTEGON INVESTMENTS»); si no («EL CIELO HOME CENTER» / «LOS PINOS
 *     HOME CENTER», las dos en Pharr con la misma cuenta unificada) NO es obvio: dos cuentas de una misma tienda con
 *     nombres distintos pueden ser dos negocios con su propio crédito. Ese par queda para «Decidir si se juntan»
 *     (`sospechosos`, motivo «cuenta_unificada»).
 * Solo grupos de 2 o más, cada uno ordenado por id, y los grupos por su primer id.
 */
export function gruposObvios(filas: readonly FilaDeCliente[]): number[][] {
  const vivas = filas.filter((f) => !f.archived_at);
  const ub = unionBusqueda(vivas.map((f) => f.id));
  const primera = new Map<string, number>();
  const engancha = (clave: string, id: number) => {
    const otra = primera.get(clave);
    if (otra === undefined) primera.set(clave, id); else ub.une(otra, id);
  };
  for (const f of vivas) {
    const n = claveDeNombre(f.account);
    if (n) engancha(`n:${n}`, f.id);
    if (f.company_id) engancha(`e:${f.company_id}`, f.id);
  }
  // Paso 2: por cuenta unificada, grupo a grupo en orden de id.
  const miembros = (raiz: number) => vivas.filter((f) => ub.raiz(f.id) === raiz);
  const porUnificada = new Map<string, number[]>();
  for (const f of vivas) {
    const u = claveDeNombre(f.unified_account);
    if (!u) continue;
    if (!porUnificada.has(u)) porUnificada.set(u, []);
    porUnificada.get(u)!.push(f.id);
  }
  const casiIguales = (a: FilaDeCliente, b: FilaDeCliente) =>
    claveDeNombre(a.account) === claveDeNombre(b.account) || similitud(normalizaNombre(a.account), normalizaNombre(b.account)) >= SIMILITUD_SOSPECHOSA;
  for (const ids of [...porUnificada.values()].sort((x, y) => Math.min(...x) - Math.min(...y))) {
    const raices = [...new Set(ids.map((i) => ub.raiz(i)))].sort((x, y) => x - y);
    for (const r of raices.slice(1)) {
      const base = miembros(ub.raiz(raices[0])), otros = miembros(ub.raiz(r));
      if (ub.raiz(raices[0]) === ub.raiz(r)) continue;
      const choca = base.some((x) => otros.some((y) => codigoDeTienda(x.store) === codigoDeTienda(y.store) && !casiIguales(x, y)));
      if (!choca) ub.une(raices[0], r);
    }
  }
  const grupos = new Map<number, number[]>();
  for (const f of vivas) { const r = ub.raiz(f.id); if (!grupos.has(r)) grupos.set(r, []); grupos.get(r)!.push(f.id); }
  return [...grupos.values()].filter((g) => g.length > 1).map((g) => g.sort((a, b) => a - b)).sort((a, b) => a[0] - b[0]);
}

// ---- Juntar dos filas de la MISMA tienda ----------------------------------------------------------------------------

/**
 * Los campos que se juntan, con la etiqueta que va a las notas y cómo se comparan. `t` texto (sin mayúsculas ni espacios
 * de más), `p` teléfono (por dígitos), `e` correo (minúsculas), `m` número, `s` se rellena pero un choque NO se apunta
 * (House # y la tanda son de la fila del Excel, no del cliente), `n` no se rellena nunca y un choque SÍ se apunta (la
 * cuenta: la superviviente se queda con su nombre, y el otro queda escrito).
 *
 * La función de la base `erp.junta_clientes` (189) lleva esta MISMA lista; `modulo.test.ts` lo comprueba.
 */
export type ComoSeCompara = "t" | "p" | "e" | "m" | "s" | "n";
export const CAMPOS_DE_UNION: readonly (readonly [string, string, ComoSeCompara])[] = [
  ["account", "cuenta", "n"],
  ["unified_account", "cuenta unificada", "t"],
  ["house_no", "House #", "s"],
  ["added_batch", "tanda", "s"],
  ["qb_status", "QuickBooks", "t"],
  ["activity_status", "actividad", "t"],
  ["status_store", "estado (tienda)", "t"],
  ["status_group", "estado (grupo)", "t"],
  ["history_store", "historial (tienda)", "t"],
  ["history_group", "historial (grupo)", "t"],
  ["crm_type_store", "tipo CRM (tienda)", "t"],
  ["crm_type_group", "tipo CRM (grupo)", "t"],
  ["associated_with", "asociado con", "t"],
  ["rep_history", "vendedor grupo (historial)", "t"],
  ["rep_qb", "vendedor grupo (QB)", "t"],
  ["rep_store", "vendedor tienda (QB)", "t"],
  ["contact_name", "contacto", "t"],
  ["contact_title", "cargo", "t"],
  ["address", "dirección", "t"],
  ["phone", "teléfono", "p"],
  ["email", "correo", "e"],
  ["credit_limit", "límite de crédito", "m"],
  ["euler_limit", "límite Euler", "m"],
  ["terms", "términos", "t"],
  ["account_no", "cuenta/crédito", "t"],
];

type Valor = string | number | null | undefined;
const vacio = (v: Valor): boolean => v === null || v === undefined || String(v).trim() === "";
const textoDe = (v: Valor): string => String(v ?? "").trim();

/** ¿Dicen lo mismo? Cada clase de campo con su vara: el teléfono por dígitos, el correo sin mayúsculas, el número como número. */
export function igualesParaUnir(como: ComoSeCompara, a: Valor, b: Valor): boolean {
  const ta = textoDe(a), tb = textoDe(b);
  switch (como) {
    case "p": { const da = ta.replace(/\D/g, ""), db = tb.replace(/\D/g, ""); return da !== "" || db !== "" ? da === db : ta.toLowerCase() === tb.toLowerCase(); }
    case "e": return ta.toLowerCase() === tb.toLowerCase();
    case "m": return Number(ta) === Number(tb);
    default: return ta.toLowerCase().replace(/\s+/g, " ") === tb.toLowerCase().replace(/\s+/g, " ");
  }
}

/**
 * Juntar la fila `otra` en `sobrevive` (las dos de la MISMA tienda; sobrevive la más vieja, la de id menor). Regla:
 *  - un campo vacío en la superviviente se rellena con el de la otra;
 *  - si los dos tienen valor y no dicen lo mismo, se queda el de la superviviente y el de la otra se APUNTA en las notas:
 *    «Del duplicado #id: teléfono «…»; correo «…»» (o «sin datos distintos» si no hay nada que apuntar);
 *  - las notas de la otra se añaden debajo: «Del duplicado #id (notas): …».
 * Devuelve SOLO lo que cambia en la superviviente (el parche) y la línea de la nota.
 */
export function unionDeFilas(
  sobrevive: Record<string, Valor> & { id: number; notes?: Valor },
  otra: Record<string, Valor> & { id: number; notes?: Valor },
): { parche: Record<string, Valor>; linea: string } {
  const parche: Record<string, Valor> = {};
  const partes: string[] = [];
  for (const [k, etiqueta, como] of CAMPOS_DE_UNION) {
    const a = sobrevive[k], b = otra[k];
    if (vacio(b)) continue;
    if (vacio(a)) { if (como !== "n") parche[k] = b; continue; }
    if (como === "s" || igualesParaUnir(como, a, b)) continue;
    partes.push(`${etiqueta} «${textoDe(b)}»`);
  }
  const linea = `Del duplicado #${otra.id}: ${partes.length ? partes.join("; ") : "sin datos distintos"}`;
  const notas = [vacio(sobrevive.notes) ? null : textoDe(sobrevive.notes), linea, vacio(otra.notes) ? null : `Del duplicado #${otra.id} (notas): ${textoDe(otra.notes)}`];
  parche.notes = notas.filter((x) => x !== null).join("\n");
  return { parche, linea };
}

export const motivoDeDuplicado = (sobreviveId: number): string => `duplicado: unido a #${sobreviveId}`;

// ---- Juntar (en memoria): el espejo de erp.junta_clientes ----------------------------------------------------------

export interface PasoDeUnion { sobrevive: number; archivada: number; linea: string }

/**
 * Juntar las empresas de `aId` y `bId`, como lo hace `erp.junta_clientes` (189), sobre una lista en memoria:
 *  1. las dos empresas pasan a ser una, con el `company_id` de la fila más vieja de las dos;
 *  2. en cada tienda donde la empresa quede con más de una fila VIVA, sobrevive la de id menor y las demás se le juntan
 *     (`unionDeFilas`) y se archivan con «duplicado: unido a #id».
 * Lo usan el demo (no tiene base), la vista previa del guion y las pruebas. No toca la lista que recibe.
 */
export function juntaEnMemoria<F extends FilaDeCliente>(
  filas: readonly F[], aId: number, bId: number, ahora: string, nuevaClave: () => string,
): { filas: F[]; pasos: PasoDeUnion[] } {
  const lista = filas.map((f) => ({ ...f }));
  const a = lista.find((f) => f.id === aId), b = lista.find((f) => f.id === bId);
  if (!a || !b) throw new Error("no existe la fila");
  if (a.archived_at || b.archived_at) throw new Error("una de las dos está archivada");
  const ka = claveDeEmpresa(a), kb = claveDeEmpresa(b);
  const deLas2 = lista.filter((f) => claveDeEmpresa(f) === ka || claveDeEmpresa(f) === kb);
  const mayor = deLas2.reduce((m, f) => (f.id < m.id ? f : m));
  const destino = mayor.company_id || nuevaClave();
  for (const f of deLas2) f.company_id = destino;
  const pasos: PasoDeUnion[] = [];
  const porTienda = new Map<string, F[]>();
  for (const f of deLas2) if (!f.archived_at) {
    const t = codigoDeTienda(f.store);
    if (!porTienda.has(t)) porTienda.set(t, []);
    porTienda.get(t)!.push(f);
  }
  for (const grupo of porTienda.values()) {
    grupo.sort((x, y) => x.id - y.id);
    const [s, ...resto] = grupo;
    for (const o of resto) {
      const { parche, linea } = unionDeFilas(s as never, o as never);
      Object.assign(s, parche);
      o.archived_at = ahora;
      (o as unknown as Record<string, unknown>).archived_reason = motivoDeDuplicado(s.id);
      pasos.push({ sobrevive: s.id, archivada: o.id, linea });
    }
  }
  return { filas: lista, pasos };
}

// ---- Sospechosos ----------------------------------------------------------------------------------------------------

export type MotivoDeSospecha = "cuenta_unificada" | "nombre_parecido" | "nombre_contenido" | "telefono" | "correo";
export const MOTIVOS_DE_SOSPECHA: readonly MotivoDeSospecha[] = ["cuenta_unificada", "nombre_parecido", "nombre_contenido", "telefono", "correo"];

export interface Sospecha { a_id: number; b_id: number; motivos: MotivoDeSospecha[]; score: number }

/**
 * Los pares SOSPECHOSOS entre las filas VIVAS de empresas DISTINTAS: la misma cuenta unificada (lo que `gruposObvios`
 * no unió porque chocaba en una tienda), nombre parecido (similitud ≥ 0,85), o el nombre
 * de una contenido en el otro (al menos dos palabras), o un teléfono en común, o un correo en común (los de un dominio
 * compartido no cuentan, `dominiosCompartidos`). Lo obvio (mismo nombre normalizado) no sale aquí: ya se juntó.
 *
 * UNA sospecha por pareja de empresas, no por pareja de filas: si Pharr y Edinburg de una empresa casan con otra, sale
 * una vez. Se queda el par de filas con más motivos (y, a igualdad, el de nombre más parecido); los motivos son la
 * unión, y `score` es la mayor similitud de nombre. `a_id < b_id` siempre (la clave de la cola).
 */
export function sospechosos(filas: readonly FilaDeCliente[]): Sospecha[] {
  const vivas = filas.filter((f) => !f.archived_at);
  const compartidos = dominiosCompartidos(vivas);
  const datos = vivas.map((f) => ({
    f,
    empresa: claveDeEmpresa(f),
    nombre: normalizaNombre(f.account),
    unificada: claveDeNombre(f.unified_account),
    tels: telefonos(f.phone),
    mails: correos(f.email).filter((c) => !compartidos.has(c.split("@")[1])),
  }));
  const porEmpresas = new Map<string, Sospecha & { mejor: number }>();
  for (let i = 0; i < datos.length; i++) {
    const x = datos[i];
    for (let j = i + 1; j < datos.length; j++) {
      const y = datos[j];
      if (x.empresa === y.empresa) continue;
      const motivos: MotivoDeSospecha[] = [];
      let sim = 0;
      const largo = Math.max(x.nombre.length, y.nombre.length);
      // Si los largos difieren más de un 15 %, la similitud no puede llegar a 0,85: no se calcula.
      if (largo > 0 && Math.abs(x.nombre.length - y.nombre.length) / largo <= 1 - SIMILITUD_SOSPECHOSA + 1e-9) sim = similitud(x.nombre, y.nombre);
      if (sim >= SIMILITUD_SOSPECHOSA) motivos.push("nombre_parecido");
      else if (nombreContenido(x.nombre, y.nombre)) motivos.push("nombre_contenido");
      if (x.tels.some((t) => y.tels.includes(t))) motivos.push("telefono");
      if (x.mails.some((c) => y.mails.includes(c))) motivos.push("correo");
      if (x.unificada && x.unificada === y.unificada) motivos.unshift("cuenta_unificada");
      if (!motivos.length) continue;
      if (sim === 0 && largo > 0) sim = similitud(x.nombre, y.nombre);
      const [ea, eb] = x.empresa < y.empresa ? [x.empresa, y.empresa] : [y.empresa, x.empresa];
      const clave = `${ea}|${eb}`;
      const [aId, bId] = x.f.id < y.f.id ? [x.f.id, y.f.id] : [y.f.id, x.f.id];
      const peso = motivos.length * 10 + sim;
      const ya = porEmpresas.get(clave);
      if (!ya) { porEmpresas.set(clave, { a_id: aId, b_id: bId, motivos, score: sim, mejor: peso }); continue; }
      ya.motivos = MOTIVOS_DE_SOSPECHA.filter((m) => ya.motivos.includes(m) || motivos.includes(m));
      ya.score = Math.max(ya.score, sim);
      if (peso > ya.mejor) { ya.a_id = aId; ya.b_id = bId; ya.mejor = peso; }
    }
  }
  return [...porEmpresas.values()]
    .map(({ a_id, b_id, motivos, score }) => ({ a_id, b_id, motivos, score: Math.round(score * 1000) / 1000 }))
    .sort((p, q) => q.motivos.length - p.motivos.length || q.score - p.score || p.a_id - q.a_id || p.b_id - q.b_id);
}

/** Cómo se guarda en la cola: los motivos separados por coma, en su orden fijo. */
export const motivoDeLaCola = (m: readonly MotivoDeSospecha[]): string => MOTIVOS_DE_SOSPECHA.filter((x) => m.includes(x)).join(",");
export const motivosDeLaCola = (s: string | null | undefined): MotivoDeSospecha[] =>
  MOTIVOS_DE_SOSPECHA.filter((m) => (s ?? "").split(",").map((x) => x.trim()).includes(m));

// ---- El plan del guion de una vez ------------------------------------------------------------------------------------

/**
 * Lo que hará el guion: juntar cada grupo obvio (el primero con cada uno de los demás, en orden de id: así lo hace
 * también contra la base, llamando a `erp.junta_clientes`), y después buscar los sospechosos sobre lo que quede.
 */
export function planDeJuntar<F extends FilaDeCliente>(filas: readonly F[], ahora: string, nuevaClave: () => string) {
  const grupos = gruposObvios(filas);
  let lista = filas.map((f) => ({ ...f }));
  const pasos: PasoDeUnion[] = [];
  const llamadas: [number, number][] = [];
  for (const g of grupos) {
    for (const otro of g.slice(1)) {
      const a = lista.find((f) => f.id === g[0])!, b = lista.find((f) => f.id === otro)!;
      // Ya la misma empresa y no hace falta unir filas: la llamada no cambiaría nada.
      const mismaEmpresa = claveDeEmpresa(a) === claveDeEmpresa(b);
      if (mismaEmpresa && codigoDeTienda(a.store) !== codigoDeTienda(b.store)) continue;
      if (b.archived_at || a.archived_at) continue;
      llamadas.push([g[0], otro]);
      const r = juntaEnMemoria(lista, g[0], otro, ahora, nuevaClave);
      lista = r.filas;
      pasos.push(...r.pasos);
    }
  }
  return { grupos, llamadas, pasos, filas: lista, sospechas: sospechosos(lista) };
}
