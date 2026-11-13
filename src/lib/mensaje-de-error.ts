/**
 * El fallo de la base, dicho para quien está trabajando (D-1021, auditoría del 12 nov).
 *
 * En ~40 sitios de Operaciones, RR. HH. y Clientes la pantalla pintaba `error.message` tal cual: mensajes de Postgres o
 * de PostgREST, en inglés y con nombres de tablas («new row violates row-level security policy for table…»). Esto los
 * pasa a un texto corto en el idioma de la app:
 *
 *   · lo NUESTRO se respeta: `warehouse_ops: …` (escrito en español en las migraciones) sale sin el prefijo, y los
 *     `RELEVO_*` con su explicación; un `Error` propio sin código ni jerga técnica (p. ej. «En práctica no se guarda.»)
 *     pasa tal cual;
 *   · lo CONOCIDO de la base (permiso, duplicado, dato que falta, sesión vencida, sin conexión…) tiene su frase;
 *   · lo DESCONOCIDO sale como «No se pudo guardar. Intenta de nuevo.» y el detalle crudo va a la consola
 *     (`console.error`), que es donde lo busca quien depura. Nunca se pierde.
 *
 * Puro salvo esa línea de consola. `lang` es opcional: sin él se toma el de la página (`<html lang>`, que pone prefs).
 */
export type Idioma = "en" | "es";
type Par = { en: string; es: string };

/** Qué se estaba haciendo: cambia solo la frase genérica («No se pudo guardar…» / «No se pudo cargar…»). */
export type Accion = "guardar" | "cargar";
const GENERICO: Record<Accion, Par> = {
  guardar: { en: "Could not save. Try again.", es: "No se pudo guardar. Intenta de nuevo." },
  cargar: { en: "Could not load. Try again.", es: "No se pudo cargar. Intenta de nuevo." },
};

/** Códigos de Postgres / PostgREST con frase propia. */
const POR_CODIGO: Record<string, Par> = {
  "42501": { en: "You don't have permission to do this.", es: "No tienes permiso para hacer esto." },
  "23505": { en: "That already exists (duplicate).", es: "Eso ya existe (está repetido)." },
  "23503": { en: "It can't be done: other records depend on this one.", es: "No se puede: hay otros registros que dependen de este." },
  "23502": { en: "A required field is missing.", es: "Falta un dato obligatorio." },
  "23514": { en: "One of the values is not valid.", es: "Uno de los datos no es válido." },
  "22P02": { en: "One of the values has the wrong format.", es: "Uno de los datos no tiene el formato correcto." },
  "22023": { en: "One of the values is not valid.", es: "Uno de los datos no es válido." },
  "22001": { en: "One of the texts is too long.", es: "Uno de los textos es demasiado largo." },
  "57014": { en: "It took too long. Try again.", es: "Tardó demasiado. Intenta de nuevo." },
  "40001": { en: "Someone else changed this at the same time. Try again.", es: "Alguien más cambió esto al mismo tiempo. Intenta de nuevo." },
  "40P01": { en: "Someone else changed this at the same time. Try again.", es: "Alguien más cambió esto al mismo tiempo. Intenta de nuevo." },
  PGRST116: { en: "It was not found (it may have been deleted).", es: "No se encontró (puede que ya lo hayan borrado)." },
  PGRST301: { en: "Your session expired. Sign in again.", es: "Tu sesión venció. Vuelve a entrar." },
  "42P01": { en: "This feature is not set up yet. Tell the admin.", es: "Esta función todavía no está instalada. Avísale al admin." },
  PGRST205: { en: "This feature is not set up yet. Tell the admin.", es: "Esta función todavía no está instalada. Avísale al admin." },
  PGRST202: { en: "This feature is not set up yet. Tell the admin.", es: "Esta función todavía no está instalada. Avísale al admin." },
  "42883": { en: "This feature is not set up yet. Tell the admin.", es: "Esta función todavía no está instalada. Avísale al admin." },
  ENSENANZA: { en: "Practice mode: this was not saved.", es: "Modo práctica: esto no se guardó." },
  CAPACITACION: { en: "Practice mode: this was not saved.", es: "Modo práctica: esto no se guardó." },
};

/** Jerga técnica en el texto (sin código) → la misma frase que su código. Se mira en orden. */
const POR_TEXTO: [RegExp, string | Par][] = [
  [/failed to fetch|networkerror|load failed|network request failed|err_internet|fetch failed/i, { en: "No connection. Check your internet and try again.", es: "Sin conexión. Revisa tu internet e intenta de nuevo." }],
  [/jwt expired|invalid jwt|not authenticated|session.*(expired|missing)/i, "PGRST301"],
  [/row-level security|permission denied|not authorized|insufficient.privilege/i, "42501"],
  [/duplicate key value|violates unique constraint/i, "23505"],
  [/violates foreign key/i, "23503"],
  [/null value in column|violates not-null/i, "23502"],
  [/violates check constraint/i, "23514"],
  [/invalid input (syntax|value)/i, "22P02"],
  [/value too long/i, "22001"],
  [/statement timeout|canceling statement|timed out|timeout/i, "57014"],
  [/schema cache|could not find the (function|table)|(relation|column|function|operator|schema|type) .*does not exist/i, "42P01"],
];

/** Los `RELEVO_*` de las migraciones de relevos (texto de la base en inglés). */
const RELEVOS: Record<string, Par> = {
  RELEVO_ORDEN: { en: "This transfer step can't be picked up until the previous step is delivered at the relay store.", es: "Este tramo no se puede recoger hasta que el tramo anterior se entregue en la tienda de relevo." },
  RELEVO_ORDEN_DESHACER: { en: "It can't be undone: the next transfer step was already picked up.", es: "No se puede deshacer: el siguiente tramo del relevo ya se recogió." },
  RELEVO_FECHA: { en: "Step B can't be picked up before today or before step A.", es: "El tramo B no se puede recoger antes de hoy ni antes del tramo A." },
  RELEVO_FIJO: { en: "This is a relay transfer step: undo the relay instead of changing it by hand.", es: "Es un tramo de relevo: deshaz el relevo en vez de cambiarlo a mano." },
  RELEVO_FORBIDDEN: { en: "Only route planners or an admin can set up or undo a relay.", es: "Solo quien planea rutas o un admin arma o deshace un relevo." },
  RELEVO_NO_APLICA: { en: "A relay doesn't apply to this order.", es: "El relevo no aplica a esta orden." },
  RELEVO_NOT_FOUND: { en: "The order was not found.", es: "No se encontró la orden." },
};

/** Lo más común de `warehouse_ops: …` (las migraciones lo escriben en español) para quien usa la app en inglés. */
const WAREHOUSE_EN: [RegExp, string][] = [
  [/^sin acceso a esa tienda/, "You don't have access to that store."],
  [/^sin acceso|^sin sesion/, "You don't have access to this."],
  [/^reporte desconocido/, "That report no longer exists."],
  [/^grupo desconocido/, "That group no longer exists."],
  [/^empleado desconocido/, "That employee is not recognized."],
  [/^producto desconocido/, "That product is not recognized."],
  [/^el grupo ya esta aprobado/, "The group is already approved."],
  [/^su grupo ya est[aá] aprobado/, "Its group is already approved; undo the approval first."],
  [/^ese espacio ya lo firm[oó] otra persona/, "Someone else already signed that line."],
  [/^ya firmaste el otro espacio/, "You already signed the other line; someone else must sign this one."],
  [/^faltan las dos firmas/, "Both signatures are needed (manager and supervisor), from different people."],
  [/^solo el admin deshace/, "Only an admin can undo, one step at a time."],
  [/^solo el admin/, "Only an admin can do this."],
  [/^solo el gerente|^solo gerencia|^solo quien gestiona/, "Only the store's manager can do this."],
  [/^solo quien firm[oó]/, "Only whoever signed (or an admin) can remove the signature."],
  [/^primero la foto/, "Add the photo of the pieces first."],
  [/^las etapas van de una en una/, "Stages go one step at a time."],
  [/^ya esta en esa etapa/, "It is already in that stage."],
  [/^solo mermas fotografiadas/, "Only photographed scrap that is not approved and not in a group."],
  [/^este reporte ya tiene su foto/, "This report already has its photo."],
];

function idiomaDeLaPagina(): Idioma {
  try { return typeof document !== "undefined" && document.documentElement.lang === "es" ? "es" : "en"; } catch { return "en"; }
}

function partes(e: unknown): { texto: string; codigo: string | null; propio: boolean } {
  if (typeof e === "string") return { texto: e, codigo: null, propio: false };
  if (e && typeof e === "object") {
    const o = e as { message?: unknown; code?: unknown; error?: unknown };
    const texto = typeof o.message === "string" ? o.message : typeof o.error === "string" ? o.error : "";
    const codigo = typeof o.code === "string" && o.code ? o.code : null;
    return { texto, codigo, propio: e instanceof Error && !codigo };
  }
  return { texto: e == null ? "" : String(e), codigo: null, propio: false };
}

const mayuscula = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const conPunto = (s: string) => (/[.!?…»)]$/.test(s) ? s : s + ".");

/** ¿El texto es jerga de la base y no una frase para una persona? */
export function esErrorTecnico(texto: string): boolean {
  return POR_TEXTO.some(([re]) => re.test(texto))
    || /\b(relation|column|constraint|syntax error|pg_|postgrest|supabase|function \w+\(|operator does not|unexpected token|undefined|null \(reading|typeerror|at \w+ \()/i.test(texto);
}

export function mensajeDeError(e: unknown, lang: Idioma = idiomaDeLaPagina(), accion: Accion = "guardar"): string {
  const { texto, codigo } = partes(e);
  const limpio = texto.trim();

  // 1. Lo nuestro: `warehouse_ops: …` y `RELEVO_*: …`.
  const wo = /^warehouse_ops:\s*(.+)$/is.exec(limpio);
  if (wo) {
    const cuerpo = wo[1].trim();
    if (lang === "en") { const t = WAREHOUSE_EN.find(([re]) => re.test(cuerpo.toLowerCase())); if (t) return t[1]; }
    return conPunto(mayuscula(cuerpo));
  }
  const rel = /^(RELEVO_[A-Z_]+)\b/.exec(limpio);
  if (rel) {
    const par = RELEVOS[rel[1]] ?? RELEVOS[rel[1].replace(/_[A-Z]+$/, "")];
    if (par) return par[lang];
  }

  // 2. Lo conocido de la base, por código y luego por texto.
  if (codigo && POR_CODIGO[codigo]) { if (!/^(ENSENANZA|CAPACITACION)$/.test(codigo)) registra(e); return POR_CODIGO[codigo][lang]; }
  for (const [re, a] of POR_TEXTO) {
    if (re.test(limpio)) { registra(e); return (typeof a === "string" ? POR_CODIGO[a] : a)[lang]; }
  }

  // 3. Un mensaje para personas (nuestro, sin código ni jerga) pasa tal cual.
  if (limpio && !codigo && !esErrorTecnico(limpio)) return limpio;

  // 4. Lo desconocido: genérico, y el detalle a la consola.
  registra(e);
  return GENERICO[accion][lang];
}

function registra(e: unknown): void {
  try { console.error("[error]", e); } catch { /* sin consola */ }
}

/** Lo mismo para una LECTURA: lo desconocido sale como «No se pudo cargar. Intenta de nuevo.». */
export function mensajeDeErrorAlCargar(e: unknown, lang: Idioma = idiomaDeLaPagina()): string {
  return mensajeDeError(e, lang, "cargar");
}
