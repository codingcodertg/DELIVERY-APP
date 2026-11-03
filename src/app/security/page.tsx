import { createClient } from "@/lib/supabase/server";
import { headers } from "next/headers";
import { CABECERA_DISPOSITIVO, dispositivoDeLaPeticion } from "@/lib/security/reglas";
import { PanelDeSeguridad, type DispositivoFila, type UsoFila } from "./PanelDeSeguridad";

export const dynamic = "force-dynamic";

/**
 * Security (D-811): la lista de dispositivos, quién entra desde cuál y cuándo, y el interruptor. Se lee con la sesión
 * del admin (la RLS de la 229 solo le deja a él). Sin la 229 aplicada, las consultas fallan y la pantalla lo dice.
 */
export default async function SecurityPage() {
  const supabase = await createClient();
  
  const [{ data: policy, error: e1 }, { data: devices, error: e2 }, { data: usos, error: e3 }] = await Promise.all([
    supabase.from("security_policy").select("enforced, changed_at, changed_by, web_blocked").eq("id", 1).maybeSingle(),
    supabase.from("security_devices").select("id, label, kind, status, user_agent, first_seen_at, last_seen_at, first_user_id, last_user_id, approved_at, revoked_at, notes, bound, requested_at, requested_by, request_note").order("last_seen_at", { ascending: false }).limit(500),
    supabase.from("security_device_users").select("device_id, user_id, first_seen_at, last_seen_at, seen_count").order("last_seen_at", { ascending: false }).limit(2000),
  ]);
  const error = e1?.message ?? e2?.message ?? e3?.message ?? null;

  // Los nombres y roles de todos los que aparecen, en una consulta.
  const ids = [...new Set([...(devices ?? []).flatMap((d) => [d.first_user_id, d.last_user_id]), ...(usos ?? []).map((u) => u.user_id)].filter((x): x is string => !!x))];
  const { data: perfiles } = ids.length ? await supabase.from("profiles").select("id, full_name, role, store").in("id", ids) : { data: [] as { id: string; full_name: string; role: string; store: string | null }[] };
  const porId = new Map((perfiles ?? []).map((p) => [p.id, p]));
  const nombre = (id: string | null) => (id && porId.get(id)?.full_name) || "—";

  const filas: DispositivoFila[] = (devices ?? []).map((d) => ({
    ...d,
    primero: nombre(d.first_user_id),
    solicitante: nombre(d.requested_by),
    ultimo: nombre(d.last_user_id),
    personas: (usos ?? []).filter((u) => u.device_id === d.id).length,
  }));
  const uso: UsoFila[] = (usos ?? []).map((u) => ({
    ...u,
    persona: nombre(u.user_id),
    rol: porId.get(u.user_id)?.role ?? "",
    tienda: porId.get(u.user_id)?.store ?? null,
    dispositivo: (devices ?? []).find((d) => d.id === u.device_id) ?? null,
  }));
  const h = await headers();
  const esteDispositivo = dispositivoDeLaPeticion({ cabecera: h.get(CABECERA_DISPOSITIVO), cookie: h.get("cookie") })?.id ?? null;

  return <PanelDeSeguridad enforced={!!policy?.enforced} webBloqueada={!!policy?.web_blocked} cambiadaEn={policy?.changed_at ?? null} dispositivos={filas} uso={uso} esteDispositivo={esteDispositivo} error={error} />;
}
