/* ---- Los términos de pago de un cliente (2026-11-04) ----
 * El dueño: «terms in customer can a dropdown that says due on receipt / 15 days / 30 days».
 *
 * `erp.customers.terms` es texto (migración 180, «Terms, tal cual» del Excel). Medido en producción el 2026-11-04 (solo
 * lectura, solo conteos, 1.353 filas, 797 con términos): «Due on receipt» 392, «Net 30» 165, «NET 30» 77,
 * «25 Days» 48, «DUE ON RECEIPT» 49, «Net 15» 31, «NET 15» 14, «NET 6» 6, «net 7» 6, «CASH» 3, «CREDIT» 2, «15 Days» 1,
 * «45 days.» 1, «Net 60» 1, «NET 60 DAYS» 1.
 *
 * Lo que se GUARDA son las tres formas que ya eran las más comunes, en texto legible: «Due on receipt», «Net 15» y
 * «Net 30». No un código (`net_30`): así 588 de las 797 filas ya valen tal cual, y lo que lee la columna sin pasar por
 * aquí (Leads, el historial, las solicitudes, el Excel, una consulta a mano) sigue leyendo algo que se entiende. Lo que
 * se ENSEÑA es la etiqueta que pidió el dueño: «Due on receipt / 15 days / 30 days», en el idioma de quien mira.
 *
 * Lo escrito de otra forma que dice lo mismo («NET 30», «30», «Net30», «COD», «Due upon receipt») se lee como su opción.
 * Lo que no es ninguna de las tres («25 Days», «NET 6», «CASH») NUNCA se pierde: se enseña tal cual, y en el desplegable
 * sale como cuarta opción apagada «25 Days (old value)», para que guardar la ficha sin tocarlo lo deje como estaba.
 *
 * Sin imports a propósito: lo carga `scripts/importa-clientes.mjs` con Node, como `formato.ts`.
 */

/** Los tres valores que se guardan, en el orden del desplegable. */
export const TERMINOS = ["Due on receipt", "Net 15", "Net 30"] as const;
export type Termino = (typeof TERMINOS)[number];

/** Lo que se lee de cada uno (el dueño: «due on receipt / 15 days / 30 days»). */
export const ETIQUETAS_DE_TERMINO: Readonly<Record<Termino, { en: string; es: string }>> = {
  "Due on receipt": { en: "Due on receipt", es: "Al recibir" },
  "Net 15": { en: "15 days", es: "15 días" },
  "Net 30": { en: "30 days", es: "30 días" },
};

type T = (en: string, es: string) => string;

/** Minúsculas, sin acentos ni signos, sin espacios: «Due upon receipt.» → «dueuponreceipt»; «NET 30 días» → «net30dias». */
const compacto = (s: string): string => s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "");

const AL_RECIBIR = new Set([
  "dueonreceipt", "dueuponreceipt", "duereceipt", "uponreceipt", "onreceipt", "payableonreceipt", "dueatreceipt",
  "cod", "cashondelivery", "alrecibir", "contraentrega",
]);
/** «Net 30», «NET30», «30», «30 days», «N30», «net 30 días» → 30 (y lo mismo con 15). Otro número no casa. */
const NETO = /^(?:net|n)?(15|30)(?:days?|dias?|d)?$/;

/** La opción que dice el texto guardado, si dice una de las tres; null si no (vacío, u otro término). */
export function terminoCanonico(v: string | null | undefined): Termino | null {
  const c = compacto(v ?? "");
  if (!c) return null;
  if (AL_RECIBIR.has(c)) return "Due on receipt";
  const m = NETO.exec(c);
  if (m) return m[1] === "15" ? "Net 15" : "Net 30";
  return null;
}

/** ¿Es exactamente uno de los tres valores que se guardan? */
export const esTermino = (v: string | null | undefined): v is Termino => (TERMINOS as readonly string[]).includes(v ?? "");

/**
 * El valor con el que trabaja la ficha y la lista: la opción si es una de las tres (escrita como sea), y si no el texto
 * guardado, recortado (nunca se tira). Vacío → "".
 */
export function terminoDeFicha(v: string | null | undefined): string {
  return terminoCanonico(v) ?? (v ?? "").trim();
}

/** Lo que se pinta: la etiqueta de la opción; un término viejo, tal cual; nada, «—». */
export function terminoLabel(v: string | null | undefined, t: T): string {
  const k = terminoCanonico(v);
  if (k) return t(ETIQUETAS_DE_TERMINO[k].en, ETIQUETAS_DE_TERMINO[k].es);
  const crudo = (v ?? "").trim();
  return crudo || "—";
}

export interface OpcionDeTermino { value: string; label: string; disabled?: true }

/**
 * Las opciones del desplegable para el valor `valor` (ya pasado por `terminoDeFicha`): vacío, las tres, y —si lo guardado
 * no es ninguna— el valor viejo como cuarta opción APAGADA. Elegida de entrada, se ve; una vez cambiada, no se puede volver
 * a elegir (el dueño quiere tres opciones), pero guardar sin tocarla la deja como estaba.
 */
export function opcionesDeTermino(valor: string, t: T): OpcionDeTermino[] {
  const opciones: OpcionDeTermino[] = [{ value: "", label: "—" }, ...TERMINOS.map((k) => ({ value: k, label: terminoLabel(k, t) }))];
  const v = valor.trim();
  if (v && !esTermino(v)) opciones.push({ value: v, label: t(`${v} (old value)`, `${v} (valor anterior)`), disabled: true });
  return opciones;
}

/**
 * La regla de guardado (la misma que exige la base con la migración 239): vale una de las tres, el vacío, o el valor que ya
 * había sin cambiar. Los dos se comparan pasados por `terminoDeFicha`: «NET 30» → «Net 30» es la misma opción.
 */
export function terminoAceptado(nuevo: string | null | undefined, anterior: string | null | undefined): boolean {
  const n = terminoDeFicha(nuevo);
  return n === "" || esTermino(n) || n === terminoDeFicha(anterior);
}

/** Para ordenar la columna: al recibir, 15, 30; luego los viejos; los vacíos los deja al final quien ordena. */
export function rangoDeTermino(v: string | null | undefined): number {
  const k = terminoCanonico(v);
  return k ? TERMINOS.indexOf(k) : TERMINOS.length;
}
