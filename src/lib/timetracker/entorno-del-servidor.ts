import "server-only";
import { createClient } from "@/lib/supabase/server";
import { estadoDeLectura, puedeVerDetalle, type ErrorDeLectura } from "@/lib/profile-read";
import { resolverTiendaYPuesto } from "@/lib/timetracker/tienda-y-puesto";
import type { Employee } from "@/lib/timetracker/types";

/**
 * Lo que el Time Tracker necesita saber del servidor antes de montar su proveedor de datos:
 * quién es, su perfil del Time Tracker, sus ajustes y las tiendas de fichaje. Es la misma
 * lectura que hace `src/app/timetracker/(timetracker)/layout.tsx`, copiada aquí a propósito
 * para que RR. HH. (/recruiting/tt-*) la use sin tocar el layout (tt/a-hr). Si alguien quiere
 * que el layout la use también, es una limpieza posterior: las consultas y los campos son los
 * mismos, y cualquier cambio aquí debe reflejarse allí.
 *
 * No decide acceso. Quien lo decide es el armazón (`MarcoDelTtEnRrhh`), que mira
 * `perfil.timetracker_role` antes de renderizar nada.
 */

export type TiendaDeFichaje = { id: string; name: string; active: boolean };

export type EntornoDelServidor =
  | { estado: "sin-sesion" }
  | { estado: "fallo"; error: ErrorDeLectura; verDetalle: boolean }
  | {
      estado: "ok";
      /** Null si no hay fila de perfil: el armazón lo trata como «sin acceso». */
      perfil: { timetracker_role: string | null } | null;
      /** Null si no hay fila de perfil. */
      me: Employee | null;
      tiendasDeFichaje: TiendaDeFichaje[];
    };

export async function leerEntornoDelServidor(): Promise<EntornoDelServidor> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { estado: "sin-sesion" };

  const { data: profile, error: errorPerfil } = await supabase
    .from("profiles")
    .select("id, full_name, role, avatar_url, timetracker_role, module_access, store")
    .eq("id", user.id)
    .maybeSingle();
  // Tres desenlaces, no dos (D-234), igual que en el layout del Time Tracker.
  if (estadoDeLectura({ data: profile, error: errorPerfil }) === "fallo") {
    return { estado: "fallo", error: errorPerfil as ErrorDeLectura, verDetalle: puedeVerDetalle(user) };
  }

  if (!profile) return { estado: "ok", perfil: null, me: null, tiendasDeFichaje: [] };

  // employee_settings y la tienda/puesto de fichaje, en la misma ida (igual que el layout).
  const [{ data: es }, { data: ficha }, { data: sitios }] = await Promise.all([
    supabase.schema("timetracker").from("employee_settings").select("*").eq("id", user.id).maybeSingle(),
    supabase.schema("clockin").from("employee_settings").select("store_id, position").eq("id", user.id).maybeSingle(),
    supabase.schema("clockin").from("job_sites").select("id, name, active"),
  ]);
  const { tienda, puesto } = resolverTiendaYPuesto({
    fichaje: ficha,
    tiendas: new Map((sitios ?? []).map((s) => [s.id as string, s.name as string])),
    tiendaDelHub: profile.store,
  });

  const tiendasDeFichaje: TiendaDeFichaje[] = (sitios ?? []).map((s) => ({
    id: s.id as string,
    name: s.name as string,
    active: (s.active as boolean | null) ?? true,
  }));

  const me: Employee = {
    id: profile.id,
    fullName: profile.full_name ?? user.email ?? "Me",
    email: user.email ?? null,
    role: profile.timetracker_role as Employee["role"],
    city: es?.city ?? null,
    payMethod: es?.pay_method ?? null,
    payDetails: es?.pay_details ?? null,
    workerType: (es?.worker_type as Employee["workerType"]) ?? null,
    multiStore: (es?.multi_store as boolean | null | undefined) ?? false,
    trackMode: (es?.track_mode as Employee["trackMode"]) ?? null,
    breaksEnabled: es?.breaks_enabled ?? null,
    active: es?.active ?? false,
    deletedAt: es?.deleted_at ?? null,
    tienda,
    puesto,
  };

  return {
    estado: "ok",
    perfil: { timetracker_role: (profile.timetracker_role as string | null) ?? null },
    me,
    tiendasDeFichaje,
  };
}
