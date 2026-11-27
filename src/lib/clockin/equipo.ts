import type { AnySupabase } from "@/lib/clockin/supabase/types";

/**
 * La gente que quien llama puede gestionar en Time Tracker (migración 358).
 *
 * Por qué existe: la 291 cierra la lectura de `public.profiles` a la propia fila, admin y RR. HH.
 * Time Tracker lee las filas de OTRAS personas a través de la vista `clockin.profiles`, que hereda
 * ese RLS. Sin esto, un gerente sin RR. HH. no vería a su cuadrilla. La función aplica el mismo
 * alcance que `scope.ts` y `mgrScope.ts`, así que la lista ya viene acotada: quien la use no
 * vuelve a ampliarla, solo filtra en memoria (por id, por empresa, por tienda, por activo).
 *
 * Si la función no existe todavía (358 sin aplicar), cae a la lectura de antes, que es la que
 * funciona mientras la tabla siga abierta. Así el código se puede publicar antes de la migración.
 */

export type PersonaDeEquipo = {
  id: string;
  full_name: string | null;
  role: string | null;
  company_id: string | null;
  store_id: string | null;
  extra_store_ids: string[] | null;
  active: boolean | null;
  position: string | null;
  default_schedule: string | null;
  custom_schedule: unknown;
  is_runner: boolean | null;
  vehicle_id: string | null;
  /** Rol de Time Tracker (`public.profiles.timetracker_role`). Con la lectura de antes va vacío. */
  timetracker_role: string | null;
};

/** Columnas de la lectura de antes: las mismas que la función, sin `timetracker_role` (la vista no la tiene). */
const COLUMNAS_LEGADO =
  "id, full_name, role, company_id, store_id, extra_store_ids, active, position, default_schedule, custom_schedule, is_runner, vehicle_id";

/** PostgREST devuelve PGRST202 (o 42883 en el SQL) cuando la función no existe en el esquema. */
function esFuncionAusente(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  if (error.code === "PGRST202" || error.code === "42883") return true;
  return /could not find the function|function .* does not exist/i.test(error.message ?? "");
}

/**
 * Devuelve las personas del alcance de quien llama. Ante un error real (que no sea «no existe la
 * función») devuelve lista vacía: el alcance se acota, nunca se amplía por un fallo.
 */
export async function perfilesDeMiEquipo(supabase: AnySupabase): Promise<PersonaDeEquipo[]> {
  const { data, error } = await supabase.schema("clockin").rpc("perfiles_de_mi_equipo");
  if (!error) return (data ?? []) as PersonaDeEquipo[];
  if (!esFuncionAusente(error)) return [];

  // Compatibilidad: 358 todavía no aplicada. Se lee la vista de antes (la tabla sigue abierta).
  const { data: viejo, error: errorViejo } = await supabase.from("profiles").select(COLUMNAS_LEGADO);
  if (errorViejo || !viejo) return [];
  return (viejo as unknown as Omit<PersonaDeEquipo, "timetracker_role">[]).map((p) => ({ ...p, timetracker_role: null }));
}

/**
 * Filtra la lista ya acotada como antes filtraban las consultas: misma empresa, tiendas (si las
 * hay), solo activos y/o sin dueños. Ordena por nombre, como el `.order("full_name")` de antes.
 */
export function delEquipo(
  lista: PersonaDeEquipo[],
  f: { companyId: string | null; tiendas: string[] | null; soloActivos?: boolean; sinDuenos?: boolean },
): PersonaDeEquipo[] {
  return lista
    .filter(
      (p) =>
        p.company_id === f.companyId &&
        (!f.tiendas || (!!p.store_id && f.tiendas.includes(p.store_id))) &&
        (!f.soloActivos || p.active === true) &&
        (!f.sinDuenos || p.role !== "owner"),
    )
    .sort((a, b) => (a.full_name ?? "").localeCompare(b.full_name ?? ""));
}

/** La persona con ese id, si está en el alcance de quien llama. */
export async function personaDeMiEquipo(supabase: AnySupabase, id: string): Promise<PersonaDeEquipo | null> {
  const lista = await perfilesDeMiEquipo(supabase);
  return lista.find((p) => p.id === id) ?? null;
}
