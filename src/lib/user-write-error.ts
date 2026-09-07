// ============================================================
// El fallo de la base al guardar permisos, dicho en cristiano (D-NEXT).
//
// Hasta ahora el aviso pintaba `error.message` tal cual, y lo que veía un administrador al
// marcar una casilla era:
//
//   new row for relation "profiles" violates check constraint "profiles_module_access_known"
//
// que no dice ni qué falló, ni qué hacer, ni en qué idioma está la app. Los tres constraints
// que puede tocar esta pantalla tienen una explicación corta y accionable, y esos son los que
// se traducen; cualquier otro fallo se enseña como venga, porque inventar un texto genérico
// para lo desconocido esconde justo lo que haría falta leer.
//
// El mensaje crudo NO se pierde: va a la consola (`detalleAConsola`), que es donde lo busca
// quien está depurando, y el texto de pantalla es para quien está trabajando.
//
// Puro y sin React: la prueba lo corre tal cual.
// ============================================================

export type ErrorEscritura = { message: string; code?: string | null; details?: string | null; hint?: string | null };

type Par = { en: string; es: string };

/**
 * Constraint → qué pasó y qué hacer. El nombre es el de la base (095, 083): si alguien lo
 * renombra, este mapa deja de acertar y se cae en el mensaje crudo, que es el fallo correcto:
 * enseñar de más, nunca callar.
 */
const POR_CONSTRAINT: Record<string, Par> = {
  profiles_module_access_known: {
    en: "This profile still carries an old module name that the database no longer accepts. Save it again after the pending migration is applied, or ask an admin to clean the row.",
    es: "Este perfil todavía lleva un nombre de módulo antiguo que la base ya no acepta. Vuelve a guardarlo cuando se aplique la migración pendiente, o pide a un administrador que limpie la fila.",
  },
  profiles_timetracker_access_needs_role: {
    en: "Time Tracker needs a tier: pick one for this person before granting the module.",
    es: "Time Tracker necesita un tramo: elige uno para esta persona antes de concederle el módulo.",
  },
  profiles_erp_role_valid: {
    en: "That ERP tier is not one of the allowed values.",
    es: "Ese tramo del ERP no es uno de los valores permitidos.",
  },
};

/** El nombre del constraint que la base nombra en el mensaje, si lo nombra. */
export function constraintDe(error: ErrorEscritura): string | null {
  const m = /violates check constraint "([^"]+)"/.exec(error.message ?? "");
  return m ? m[1] : null;
}

/**
 * El texto para el aviso. Con constraint conocido, la explicación en el idioma del usuario; sin
 * él, el mensaje de la base tal cual (dato del servidor, D-192).
 */
export function mensajeEscrituraPerfil(error: ErrorEscritura, lang: string): string {
  const nombre = constraintDe(error);
  const par = nombre ? POR_CONSTRAINT[nombre] : undefined;
  if (!par) return error.message;
  return lang === "es" ? par.es : par.en;
}

/** Lo que se manda a la consola: el crudo entero, para quien depura. */
export function detalleAConsola(error: ErrorEscritura): string {
  const extra = [error.code && `code=${error.code}`, error.details && `details=${error.details}`, error.hint && `hint=${error.hint}`]
    .filter(Boolean)
    .join(" · ");
  return `[perfiles] ${error.message}${extra ? ` (${extra})` : ""}`;
}
