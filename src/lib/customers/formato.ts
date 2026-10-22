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
