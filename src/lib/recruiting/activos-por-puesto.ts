/**
 * Reasignar activos por puesto, semiautomático — D-936 (migración 277).
 *
 * Roberto en la junta: al contratar para un puesto (p. ej. «accounts receivable»: de Maricella que se fue a Christy que
 * entra), poder reasignar el correo / teléfono / extensión que quedaron libres al nuevo, sugiriendo los activos liberados
 * del MISMO puesto. Aquí lo puro: normalizar el puesto, comparar, sugerir y el parche de reasignación. La acción de
 * servidor `reasignarActivo` (solo admin de RR. HH.) y la pantalla usan esto.
 */
import type { Activo, EstadoDeActivo, TipoDeActivo } from "./activos";

/** El puesto normalizado para comparar: sin acentos, en minúsculas y con espacios colapsados. Vacío → null. */
export function normalizaPuesto(v: string | null | undefined): string | null {
  const limpio = (v ?? "")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase().replace(/\s+/g, " ").trim();
  return limpio || null;
}

/** ¿Dos puestos son el mismo? Comparación tolerante (acentos, mayúsculas, espacios). Null en cualquiera → false. */
export function mismoPuesto(a: string | null | undefined, b: string | null | undefined): boolean {
  const na = normalizaPuesto(a);
  const nb = normalizaPuesto(b);
  return na !== null && na === nb;
}

/** Un activo está libre para reasignar si no está asignado a nadie (disponible, sin uso o pendiente de respaldo). */
export function esReasignable(a: Pick<Activo, "status">): boolean {
  return a.status !== "assigned";
}

/**
 * Los activos que se pueden ofrecer para un puesto al dar de alta a alguien: los que NO están asignados. Primero los del
 * mismo puesto (lo que Roberto quiere sugerir), luego el resto; dentro de cada grupo, correos antes que teléfonos y por
 * valor. Si no se pasa puesto, devuelve todos los reasignables sin preferencia.
 */
export function sugerenciasDeActivosPorPuesto(activos: readonly Activo[], puesto: string | null | undefined): Activo[] {
  const libres = activos.filter(esReasignable);
  const normal = normalizaPuesto(puesto);
  return [...libres].sort((a, b) => {
    if (normal) {
      const pa = mismoPuesto(a.position, normal) ? 0 : 1;
      const pb = mismoPuesto(b.position, normal) ? 0 : 1;
      if (pa !== pb) return pa - pb;
    }
    if (a.kind !== b.kind) return a.kind === "email" ? -1 : 1;
    return a.value.localeCompare(b.value);
  });
}

/** Solo los del mismo puesto (la lista corta que la pantalla resalta como «activos de este puesto»). */
export function activosDelPuesto(activos: readonly Activo[], puesto: string | null | undefined): Activo[] {
  const normal = normalizaPuesto(puesto);
  if (!normal) return [];
  return sugerenciasDeActivosPorPuesto(activos.filter((a) => mismoPuesto(a.position, normal)), normal);
}

/**
 * El parche para reasignar un activo libre a una persona en un puesto: pasa a «asignado», con esa persona y, si se da, el
 * puesto (si no, conserva el que traía). Devuelve null si el activo estaba asignado (hay que liberarlo antes).
 */
export function parcheReasignar(
  a: Pick<Activo, "status" | "position">, employeeId: string, puesto?: string | null,
): { status: "assigned"; employee_id: string; position: string | null } | null {
  if (!esReasignable(a)) return null;
  const limpio = (puesto ?? "").trim();
  return { status: "assigned", employee_id: employeeId, position: limpio || (a.position ?? null) };
}

/** Lista de tipos para iterar sin repetir el literal. */
export const TIPOS_DE_ACTIVO: readonly TipoDeActivo[] = ["email", "phone"];
export const ESTADOS_LIBRES: readonly EstadoDeActivo[] = ["available", "not_in_use", "pending_backup"];
