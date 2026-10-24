/* ---- Formato estándar de un cliente (D-635, 2026-10-21) ----
 * El dueño: «en customer haz lo mismo de estandarizar: nombre todos caps, los teléfonos en el formato que te dije».
 * Lo mismo que RR. HH. (D-610) y la orden de Entregas (D-630): el teléfono «(956) 340-5910» y el correo en minúsculas.
 * Los nombres van en MAYÚSCULAS (no «Nombre Propio» como en RR. HH.): así está ya casi toda la lista del Excel.
 *
 * Medido en producción (2026-10-21, 1.190 filas vivas): 708 de 762 teléfonos con otro formato («956-572-6342»,
 * «956*789*2929», «956 367-2273»…); 38 cuentas no van en mayúsculas («Villarreal Homes», «CITY OF McALLEN.») y 13
 * llevan espacios de más («DURGA  PROPERTIES»); 145 correos con mayúsculas.
 *
 * Sin imports a propósito: lo cargan tal cual `scripts/estandariza-clientes.mts` y `scripts/importa-clientes.mjs` con
 * Node, que no resuelve el alias `@/` ni rutas sin extensión. Por eso el teléfono es una copia de `telefonoEstandar`
 * (`src/lib/recruiting/formato.ts`), y una prueba exige que las dos den lo mismo.
 */

/** Los campos que son un nombre: van en MAYÚSCULAS y con un solo espacio. */
export const CAMPOS_EN_MAYUSCULAS = ["account", "unified_account", "contact_name", "contact_title"] as const;

/** «Villarreal  homes » → «VILLARREAL HOMES». */
export const nombreDeCliente = (s: string | null | undefined): string => (s ?? "").replace(/\s+/g, " ").trim().toUpperCase();

/** «(956) 340-5910» con 10 dígitos (o 11 empezando por 1, el país); otra cosa (dos números, un nombre) se deja tal cual, limpia.
 * Con letras tampoco se toca (D-635): «956-246-6915 - Viya, A/P» lleva a quién llamar, y quitarlo lo perdería. */
export function telefonoDeCliente(t: string | null | undefined): string {
  const limpio = (t ?? "").trim();
  if (!limpio) return "";
  if (/\p{L}/u.test(limpio)) return limpio.replace(/\s+/g, " ");
  const d = limpio.replace(/\D/g, "");
  const diez = d.length === 10 ? d : d.length === 11 && d.startsWith("1") ? d.slice(1) : null;
  if (!diez) return limpio.replace(/\s+/g, " ");
  return `(${diez.slice(0, 3)}) ${diez.slice(3, 6)}-${diez.slice(6)}`;
}

/** El correo en minúsculas y sin espacios de más (varios correos separados por «;» siguen juntos, como estaban). */
export const correoDeCliente = (e: string | null | undefined): string => (e ?? "").replace(/\s+/g, " ").trim().toLowerCase();

/** El valor de un campo de texto ya en su formato; los que no tienen formato, solo recortados. */
export function formatoDeCampo(key: string, v: string): string {
  if ((CAMPOS_EN_MAYUSCULAS as readonly string[]).includes(key)) return nombreDeCliente(v);
  if (key === "phone") return telefonoDeCliente(v);
  if (key === "email") return correoDeCliente(v);
  return v.trim();
}

const CON_FORMATO = [...CAMPOS_EN_MAYUSCULAS, "phone", "email"] as const;
type ConFormato = (typeof CON_FORMATO)[number];

/** Lo que cambia de una fila al ponerla en formato (solo los campos que cambian; un vacío sigue siendo null). */
export function estandarizaCliente(fila: Partial<Record<ConFormato, string | null>>): Partial<Record<ConFormato, string | null>> {
  const out: Partial<Record<ConFormato, string | null>> = {};
  for (const k of CON_FORMATO) {
    const antes = fila[k];
    if (typeof antes !== "string") continue;
    const despues = formatoDeCampo(k, antes) || null;
    if (despues !== antes) out[k] = despues;
  }
  return out;
}

// ---- Contactos (D-NEXT, migración 193) -----------------------------------------------------------------------------
/* El dueño, 2026-10-24: «en un solo cliente [puede] tener diferentes contactos […] si un mismo contacto tiene varios
 * teléfonos, varios correos, que se pueda ir poniendo», y de lo de hoy: «me dice arriba el número y Omar. […] quiero que
 * el contacto sea Omar y abajo el número de teléfono».
 *
 * Una fila guarda sus contactos en `contacts` (una lista). Hasta que se rellena, salen de las cuatro columnas de antes
 * (`contactosDeLosCampos`), donde el Excel lo escribía todo junto. Medido en producción (2026-10-24, 1.189 filas vivas):
 * 761 con teléfono y 524 con correo; 102 teléfonos llevan texto («956-… - NOMBRE», «… NOMBRE, A/P owner», «NOMBRE 956-…»,
 * «… - NOMBRE, solo Brenda le pueden hablar.»), 1 lleva dos números, 25 correos son varios con «;», 3 correos son un
 * teléfono o «nombre <correo>», y solo 16 filas tienen el contacto en su columna. Aquí, sin imports, como el resto del
 * fichero: lo carga el barrido con Node. */

export interface Contacto {
  name: string | null;
  title: string | null;
  phones: string[];
  emails: string[];
  /** Lo que el Excel decía del contacto y no es ni nombre ni cargo: «solo Brenda le pueden hablar», «for POs». */
  note: string | null;
}

/** Palabras que dicen QUÉ es la persona, no quién: van al cargo. «A/P» es cuentas por pagar. */
const PALABRAS_DE_CARGO = new Set([
  "A/P", "AP", "A/R", "OWNER", "CO-OWNER", "OFFICE", "FINANCE", "DPT", "DEPT", "DEPARTMENT", "ACCOUNTING", "ACCOUNTS", "PAYABLE",
  "WIFE", "HUSBAND", "FATHER", "MOTHER", "SON", "DAUGHTER", "BROTHER", "SISTER", "FRIEND", "CELL", "MANAGER", "MANAGEMENT",
  "BOOKKEEPER", "SECRETARY", "ASSISTANT", "ADMIN", "PURCHASING", "SUPERINTENDENT", "PM", "SALES", "100%",
]);
/** Desde una de estas (detrás de un nombre), lo que sigue es una nota: «Luis Waldo for POs». */
const EMPIEZA_NOTA = new Set(["FOR", "PARA", "SOLO", "ONLY", "NO", "NOT", "DONT", "LE", "CALL"]);
/** Un «nombre» que solo es esto es una nota: «956-592-4346-NO». */
const SOLO_NOTA = new Set(["NO", "SI", "SÍ", "YES", "N/A"]);
/** «Roberto, Jr.»: detrás de una coma, sigue siendo su nombre. */
const SUFIJOS = new Set(["JR", "JR.", "SR", "SR.", "II", "III"]);

const CORREO = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;
/** Un número escrito de cualquier manera: dígitos con espacios, guiones, puntos, asteriscos o paréntesis por medio. */
const NUMERO = /\+?\(?\d[\d\s().*-]*\d/g;
/** «A/P» y «A/R» son una palabra, no dos trozos: se protegen antes de partir por «/». */
const AP = /\bA\s*\/\s*([PR])\b/gi;

const digitosDe = (s: string) => s.replace(/\D/g, "");
const unicos = (xs: string[]) => [...new Set(xs)];
/** Un trozo de texto sin la puntuación de los bordes: «- Emmanuel,» → «Emmanuel». Solo puntuación → "". */
const sinBordes = (s: string) => s.replace(/^[\s,.;:\-–—/()]+|[\s,;:\-–—/(]+$/g, "").replace(/\s+/g, " ").trim();
const juntos = (a: string | null, b: string | null) => (a && b ? `${a} ${b}` : a || b);

/** Nombre, cargo y nota de un trozo de texto: las palabras de cargo, al cargo; desde una de `EMPIEZA_NOTA`, a la nota. */
function nombreYCargo(texto: string): { name: string | null; title: string | null; note: string | null } {
  const nombre: string[] = [];
  const cargo: string[] = [];
  let note: string | null = null;
  const palabras = sinBordes(texto).split(/\s+/);
  for (let i = 0; i < palabras.length; i++) {
    const limpia = palabras[i].replace(/^[([]+|[)\],;]+$/g, "");
    if (!limpia) continue;
    const may = limpia.toUpperCase().replace(/\.$/, "");
    if (EMPIEZA_NOTA.has(may) && nombre.length) { note = sinBordes(palabras.slice(i).join(" ")); break; }
    if (may === "A_P" || may === "A_R" || may === "AP") cargo.push(may === "AP" ? "A/P" : may.replace("_", "/"));
    else (PALABRAS_DE_CARGO.has(may) ? cargo : nombre).push(limpia);
  }
  if (nombre.length && nombre.every((w) => SOLO_NOTA.has(w.toUpperCase()))) { note = juntos(nombre.join(" "), note); nombre.length = 0; }
  const n = sinBordes(nombre.join(" "));
  const c = sinBordes(cargo.join(" "));
  return { name: n ? nombreDeCliente(n) : null, title: c ? nombreDeCliente(c) : null, note };
}

/**
 * Los números de un trozo: 10 dígitos (u 11 con el 1) es un número; 20 o 30 seguidos, dos o tres. 7 dígitos detrás de un
 * número completo llevan su código de área («956-292-0955 - 655-2802»); 4 solos cambian sus 4 últimos («…9756 and
 * 9750»). Con 7 o más dígitos que no cuadran, sigue siendo un teléfono, tal cual; con menos, no es un número y se queda
 * en el texto (el «100%» de un cargo).
 */
function numerosDe(trozo: string, anterior: string | null): { phones: string[]; resto: string } {
  const phones: string[] = [];
  let ultimo = anterior;
  const resto = trozo.replace(NUMERO, (m) => {
    let d = digitosDe(m);
    if (d.length === 11 && d.startsWith("1")) d = d.slice(1);
    const salen: string[] = [];
    if (d.length > 0 && d.length % 10 === 0) for (let i = 0; i < d.length; i += 10) salen.push(d.slice(i, i + 10));
    else if (d.length === 7 && ultimo) salen.push(ultimo.slice(0, 3) + d);
    else if (d.length === 4 && ultimo && !/\p{L}/u.test(trozo)) salen.push(ultimo.slice(0, 6) + d);
    // 7 o más dígitos que no cuadran siguen siendo un teléfono (mal escrito, pero un teléfono): tal cual, sin formato.
    else if (d.length >= 7) { phones.push(telefonoDeCliente(m)); return " "; }
    else return m;
    for (const n of salen) { phones.push(telefonoDeCliente(n)); ultimo = n; }
    return " ";
  });
  return { phones, resto };
}

/** Los separadores de un campo de teléfono, capturados: «/», «,», «;», «&», « - » (con espacios), « and », « y », « u ». */
const SEPARADOR = /(\s+[-–—]\s+|[,;/&|]|\s+(?:and|y|u|or)\s+)/i;
/** Los que juntan a DOS PERSONAS («Peter y Mayra Vargas», «FERNANDA / OSCAR»); una coma o un guion, no. */
const DE_PERSONAS = /^\s*(?:[/&]|and|y|u)\s*$/i;
/** Un nombre de persona: hasta tres palabras, solo letras (y los puntos de «Sra.»). */
const esNombreSolo = (n: string) => n.split(" ").length <= 3 && /^[\p{L}. ]+$/u.test(n);

/**
 * Los contactos de una fila sacados de sus cuatro columnas de antes. El texto que va con un número es su contacto; otro
 * nombre con otro número es otro contacto; un nombre suelto detrás de «y», «/» o «&» es otra persona del mismo número.
 * Lo demás que no es nombre ni cargo va a la nota del contacto. El nombre de la columna «contacto» manda sobre el del
 * teléfono si es el mismo (o si el teléfono no traía nombre); si es otro, son dos, y el suyo va primero. Los correos van
 * al primero (no se sabe de quién es cada uno). Un número escrito en el correo va a los teléfonos; «Nombre <correo>» da
 * el nombre si falta.
 */
export function contactosDeLosCampos(f: { contact_name?: string | null; contact_title?: string | null; phone?: string | null; email?: string | null }): Contacto[] {
  const lista: Contacto[] = [];
  const nuevo = (): Contacto => { const c: Contacto = { name: null, title: null, phones: [], emails: [], note: null }; lista.push(c); return c; };
  let actual: Contacto | null = null;
  let ultimo: string | null = null;
  const partes = (f.phone ?? "").replace(AP, "A_$1").split(SEPARADOR);
  for (let i = 0; i < partes.length; i += 2) {
    const trozo = partes[i];
    if (!trozo || !trozo.trim()) continue;
    const separador = i > 0 ? partes[i - 1] : "";
    const { phones, resto } = numerosDe(trozo, ultimo);
    if (phones.length) ultimo = digitosDe(phones[phones.length - 1]);
    const { name, title, note } = nombreYCargo(resto);
    if (!actual) actual = nuevo();
    if (phones.length) {
      if (name && actual.name && name !== actual.name) actual = nuevo();
      actual.phones.push(...phones);
      if (name) actual.name = name;
    } else if (name && !actual.name) {
      actual.name = name;
    } else if (name && SUFIJOS.has(name)) {
      actual.name = `${actual.name} ${name}`;
    } else if (name && name !== actual.name && DE_PERSONAS.test(separador) && esNombreSolo(name) && !title && !note) {
      const deAntes: Contacto = actual;
      actual = nuevo();
      actual.name = name;
      actual.phones.push(...deAntes.phones);
    } else if (name && name !== actual.name) {
      actual.note = juntos(actual.note, sinBordes(resto.replace(/A_([PR])/g, "A/$1")));
      continue;
    }
    if (title) actual.title = juntos(actual.title, title);
    if (note) actual.note = juntos(actual.note, note);
  }
  const suyo = nombreYCargo(f.contact_name ?? "").name;
  const suCargo = sinBordes(f.contact_title ?? "") ? nombreDeCliente(sinBordes(f.contact_title ?? "")) : null;
  if (suyo || suCargo) {
    const primero = lista[0];
    if (primero && (!primero.name || !suyo || primero.name === suyo)) {
      primero.name = suyo ?? primero.name;
      primero.title = suCargo ?? primero.title;
    } else {
      lista.unshift({ name: suyo, title: suCargo, phones: [], emails: [], note: null });
    }
  }
  const textoDelCorreo = f.email ?? "";
  const emails = (textoDelCorreo.match(CORREO) ?? []).map(correoDeCliente);
  const sobra = numerosDe(textoDelCorreo.replace(CORREO, " ").replace(/[<>]/g, " "), null);
  if (emails.length || sobra.phones.length) {
    const primero = lista[0] ?? nuevo();
    primero.emails.push(...emails);
    primero.phones.push(...sobra.phones);
    const nombreDelCorreo = nombreYCargo(sobra.resto).name;
    if (!primero.name && nombreDelCorreo && emails.length) primero.name = nombreDelCorreo;
  }
  return normalizaContactos(lista);
}

/**
 * Una lista de contactos en su formato: nombre y cargo en MAYÚSCULAS, teléfonos «(956) 340-5910», correos en minúsculas,
 * sin repetidos ni vacíos; la nota, recortada; fuera los contactos que se quedan sin nada. Acepta lo que venga de la base
 * (un jsonb que pudo escribir cualquiera): lo que no tiene la forma se ignora.
 */
export function normalizaContactos(lista: unknown): Contacto[] {
  if (!Array.isArray(lista)) return [];
  const textos = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
  const out: Contacto[] = [];
  for (const x of lista) {
    if (!x || typeof x !== "object") continue;
    const o = x as Record<string, unknown>;
    const name = typeof o.name === "string" ? nombreDeCliente(sinBordes(o.name)) || null : null;
    const title = typeof o.title === "string" ? nombreDeCliente(sinBordes(o.title)) || null : null;
    const phones = unicos(textos(o.phones).map(telefonoDeCliente).filter(Boolean));
    const emails = unicos(textos(o.emails).map(correoDeCliente).filter(Boolean));
    const note = typeof o.note === "string" ? o.note.replace(/\s+/g, " ").trim() || null : null;
    if (!name && !title && !phones.length && !emails.length && !note) continue;
    out.push({ name, title, phones, emails, note });
  }
  return out;
}

/**
 * Las cuatro columnas de antes como ESPEJO de la lista: el nombre y el cargo del primer contacto, el primer teléfono y el
 * primer correo (del primero que tenga). Las siguen leyendo la búsqueda, el aviso de duplicado y «Decidir si se juntan».
 */
export function espejoDeContactos(lista: readonly Contacto[]): { contact_name: string | null; contact_title: string | null; phone: string | null; email: string | null } {
  return {
    contact_name: lista[0]?.name ?? null,
    contact_title: lista[0]?.title ?? null,
    phone: lista.flatMap((c) => c.phones)[0] ?? null,
    email: lista.flatMap((c) => c.emails)[0] ?? null,
  };
}
