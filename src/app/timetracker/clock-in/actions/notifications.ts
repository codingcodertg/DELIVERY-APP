"use server";

import { corteDeCapacitacion } from "@/lib/timetracker/capacitacion-servidor";
import { createClient, isSupabaseConfigured } from "@/lib/clockin/supabase/server";

/** Mark all of the current user's notifications as read. */
export async function markAllRead(): Promise<{ ok: boolean }> {
  const corte = await corteDeCapacitacion();
  if (corte) return corte;
  if (!isSupabaseConfigured) return { ok: false };
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false };
  const { error } = await supabase
    .from("notifications")
    .update({ read: true })
    .eq("employee_id", user.id)
    .eq("read", false);
  return { ok: !error };
}

/**
 * Marca como leídos solo estos avisos. Lo usa la vista «Todas» de la campana de Entregas y Clientes (RRHH, un aviso a la
 * vez o «marcar todo leído» de lo que se ve), sin tocar los demás.
 */
export async function markReadByIds(ids: string[]): Promise<{ ok: boolean }> {
  const corte = await corteDeCapacitacion();
  if (corte) return corte;
  if (!ids.length) return { ok: true };
  if (!isSupabaseConfigured) return { ok: false };
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false };
  const { error } = await supabase
    .from("notifications")
    .update({ read: true })
    .eq("employee_id", user.id)
    .in("id", ids);
  return { ok: !error };
}
