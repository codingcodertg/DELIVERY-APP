"use server";

import { createClient, isSupabaseConfigured } from "@/lib/clockin/supabase/server";
import { canManageEmployee, type Me } from "@/lib/clockin/mgrScope";
import { clockinManagerCtx } from "@/lib/clockin/managerCtx";
import { storeScope, NO_MATCH } from "@/lib/clockin/scope";

export async function resolveException(id: string): Promise<{ ok: boolean; message?: string }> {
  if (!isSupabaseConfigured) return { ok: false, message: "Not configured." };
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: "Not signed in." };
  const { data: me } = await supabase.from("profiles").select("role, company_id, store_id").eq("id", user.id).single();
  if (!me || (me.role !== "manager" && me.role !== "owner")) return { ok: false, message: "Managers only." };

  // Only resolve exceptions for employees in the manager's store (owner: any).
  const { data: ex } = await supabase.from("exceptions").select("employee_id").eq("id", id).maybeSingle();
  if (!ex) return { ok: false, message: "Exception not found." };
  const meScope: Me = { role: me.role, company_id: me.company_id, store_id: (me.store_id as string) ?? null };
  if (!(await canManageEmployee(supabase, meScope, ex.employee_id))) {
    return { ok: false, message: "That employee isn't in your store." };
  }

  const { error } = await supabase.from("exceptions").update({ resolved: true }).eq("id", id);
  if (error) return { ok: false, message: error.message };
  return { ok: true };
}

/**
 * El historial de excepciones, para Auditoría.
 *
 * `getPendingForInbox` (en timeoff.ts) contesta otra pregunta: **qué falta por resolver**, que
 * es lo que necesita la bandeja de Pendientes. Esta contesta **qué pasó**, resuelto o no, con
 * la foto delante — que es la pregunta de Auditoría, la misma que el registro y las fotos.
 *
 * Es de solo lectura a propósito. Resolver se hace en Pendientes y en un solo sitio (D-106):
 * dos botones que hacen lo mismo en dos pantallas acaban en dos versiones de la verdad sobre
 * si algo está atendido.
 *
 * Las fotos se firman EN BLOQUE. La pantalla vieja las firmaba una a una dentro de un bucle
 * —una llamada de red por foto, hasta 60— y ese era el motivo real de que tardara en abrir.
 */
export async function getExceptionHistory(limit = 80): Promise<
  | {
      ok: true;
      rows: {
        id: string; nombre: string; type: string; reason: string | null; note: string | null;
        created_at: string; left_at: string | null; returned_at: string | null;
        resolved: boolean; photo: string | null; returnedPhoto: string | null;
      }[];
    }
  | { ok: false; message: string }
> {
  const ctx = await clockinManagerCtx();
  if (!ctx.ok) return ctx;
  const { supabase, companyId } = ctx;

  const { ids } = await storeScope(supabase, companyId, ctx.role, ctx.storeId);
  const inEmp = ids ? (ids.length ? ids : NO_MATCH) : null;

  let q = supabase
    .from("exceptions")
    .select("id, employee_id, type, reason, note, photo_path, returned_photo_path, left_at, returned_at, resolved, created_at")
    .order("created_at", { ascending: false })
    .limit(Math.min(Math.max(limit, 1), 200));
  if (inEmp) q = q.in("employee_id", inEmp);

  const [{ data: rows, error }, { data: people }] = await Promise.all([
    q,
    supabase.from("profiles").select("id, full_name").eq("company_id", companyId),
  ]);
  if (error) return { ok: false, message: error.message };

  const nombre = new Map((people ?? []).map((p) => [p.id as string, (p.full_name as string) ?? "—"]));
  const paths = (rows ?? []).flatMap((r) =>
    [r.photo_path, r.returned_photo_path].filter((p): p is string => !!p),
  );
  const firmada = new Map<string, string>();
  if (paths.length) {
    const { data } = await supabase.storage.from("exception-photos").createSignedUrls(paths, 3600);
    for (const s of data ?? []) if (s.path && s.signedUrl) firmada.set(s.path, s.signedUrl);
  }

  return {
    ok: true,
    rows: (rows ?? []).map((r) => ({
      id: r.id as string,
      nombre: nombre.get(r.employee_id as string) ?? "—",
      type: r.type as string,
      reason: (r.reason as string) ?? null,
      note: (r.note as string) ?? null,
      created_at: r.created_at as string,
      left_at: (r.left_at as string) ?? null,
      returned_at: (r.returned_at as string) ?? null,
      resolved: !!r.resolved,
      photo: r.photo_path ? firmada.get(r.photo_path as string) ?? null : null,
      returnedPhoto: r.returned_photo_path ? firmada.get(r.returned_photo_path as string) ?? null : null,
    })),
  };
}
