import "server-only";
import type { createClient } from "@/lib/supabase/server";
import type { NuevaEntrada } from "@/lib/recruiting/historial";

/**
 * Escribir una fila del historial de RR. HH. (D-734, migración 212) desde una acción de servidor.
 *
 * Se llama DESPUÉS de que la acción haya hecho lo suyo, y nunca la hunde: si la 212 no está, o la inserción falla, la
 * baja o la asignación ya están hechas y eso es lo que importa; el historial es el registro, no la acción. El nombre de
 * quien actúa y el del empleado se copian en la fila para que sobrevivan a la cuenta y al expediente.
 */
export async function anotaEnHistorial(
  supabase: Awaited<ReturnType<typeof createClient>>, actorId: string, e: NuevaEntrada,
): Promise<void> {
  try {
    const [{ data: actor }, { data: empleado }] = await Promise.all([
      supabase.from("profiles").select("full_name").eq("id", actorId).maybeSingle(),
      e.employeeId
        ? supabase.schema("recruiting").from("employee_files").select("full_name").eq("id", e.employeeId).maybeSingle()
        : Promise.resolve({ data: null as { full_name?: string | null } | null }),
    ]);
    await supabase.schema("recruiting").from("hr_history").insert({
      kind: e.kind,
      employee_id: e.employeeId ?? null,
      employee_name: empleado?.full_name ?? null,
      asset_id: e.assetId ?? null,
      asset_text: e.assetText ?? null,
      actor_id: actorId,
      actor_name: actor?.full_name ?? null,
      reason: (e.reason ?? "").trim() || null,
      detail: (e.detail ?? "").trim() || null,
      data: e.data ?? {},
    });
  } catch {
    // Sin la 212, o con la red caída: la acción ya ocurrió; el historial no la deshace ni la bloquea.
  }
}
