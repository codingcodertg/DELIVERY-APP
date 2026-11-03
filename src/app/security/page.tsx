import { createClient } from "@/lib/supabase/server";
import { headers } from "next/headers";
import { CABECERA_DISPOSITIVO, dispositivoDeLaPeticion } from "@/lib/security/reglas";
import { PanelDeSeguridad, type BloqueoFila, type DispositivoFila, type UsoFila, type UsuarioFila } from "./PanelDeSeguridad";
import { rangoDeApp } from "@/lib/security/version-de-app";
import { soloActivos } from "@/lib/baja";

export const dynamic = "force-dynamic";

/**
 * Security (D-811): la lista de dispositivos, quién entra desde cuál y cuándo, y el interruptor. Se lee con la sesión
 * del admin (la RLS de la 229 solo le deja a él). Sin la 229 aplicada, las consultas fallan y la pantalla lo dice.
 */
export default async function SecurityPage() {
  const supabase = await createClient();
  
  const desde = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
  const [{ data: policy, error: e1 }, { data: devices, error: e2 }, { data: usos, error: e3 }, { data: bloqueos }, { data: todos }] = await Promise.all([
    supabase.from("security_policy").select("enforced, changed_at, changed_by, web_blocked").eq("id", 1).maybeSingle(),
    supabase.from("security_devices").select("id, label, kind, status, user_agent, first_seen_at, last_seen_at, first_user_id, last_user_id, approved_at, revoked_at, notes, bound, requested_at, requested_by, request_note, last_ip, last_place").order("last_seen_at", { ascending: false }).limit(500),
    supabase.from("security_device_users").select("device_id, user_id, first_seen_at, last_seen_at, seen_count, last_ip, last_place").order("last_seen_at", { ascending: false }).limit(2000),
    // D-818 (232): a quién se le cerró la web, últimos 7 días. Sin la 232 viene error y la lista queda vacía: no rompe la pantalla.
    supabase.from("security_web_blocks").select("id, user_id, device_id, user_agent, path, at, ip, place").gte("at", desde).order("at", { ascending: false }).limit(500),
    // D-822: TODOS los usuarios creados, tengan o no dispositivo: para ver quién ya tiene la app nueva y quién nunca entró.
    supabase.from("profiles").select("id, full_name, role, store, username, left_at").order("full_name"),
  ]);
  const error = e1?.message ?? e2?.message ?? e3?.message ?? null;

  // Los nombres y roles de todos los que aparecen, en una consulta.
  const ids = [...new Set([...(devices ?? []).flatMap((d) => [d.first_user_id, d.last_user_id]), ...(usos ?? []).map((u) => u.user_id), ...(bloqueos ?? []).map((b) => b.user_id)].filter((x): x is string => !!x))];
  const faltan = ids.filter((id) => !(todos ?? []).some((p) => p.id === id));
  const { data: perfiles } = faltan.length ? await supabase.from("profiles").select("id, full_name, role, store").in("id", faltan) : { data: [] as { id: string; full_name: string; role: string; store: string | null }[] };
  const porId = new Map([...(todos ?? []), ...(perfiles ?? [])].map((p) => [p.id, p]));
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
  const bloqueados: BloqueoFila[] = (bloqueos ?? []).map((b) => ({
    ...b,
    persona: nombre(b.user_id),
    rol: porId.get(b.user_id)?.role ?? "",
    tienda: porId.get(b.user_id)?.store ?? null,
    dispositivo: (devices ?? []).find((d) => d.id === b.device_id) ?? null,
  }));
  // D-822: cada usuario con su último dispositivo (el de la última vez que se le vio).
  // D-825: solo los que siguen en la empresa (`left_at`, la regla de D-707): un dado de baja no es un usuario que vigilar.
  const usuarios: UsuarioFila[] = soloActivos(todos ?? []).map((p) => {
    const suyos = uso.filter((u) => u.user_id === p.id).sort((a, b) => Date.parse(b.last_seen_at) - Date.parse(a.last_seen_at));
    const ultimo = suyos[0] ?? null;
    // D-824: «¿tiene la app?» = su MEJOR dispositivo (la app nueva gana a un Chrome visto después); «último» sigue siendo el último.
    const mejor = suyos.reduce<UsoFila | null>((m, u) => !m || rangoDeApp(u.dispositivo?.user_agent, u.dispositivo?.kind) > rangoDeApp(m.dispositivo?.user_agent, m.dispositivo?.kind) ? u : m, null);
    return { id: p.id, persona: p.full_name, usuario: p.username ?? null, rol: p.role, tienda: p.store ?? null, dispositivos: suyos.length, ultimo, mejor };
  });
  const h = await headers();
  const esteDispositivo = dispositivoDeLaPeticion({ cabecera: h.get(CABECERA_DISPOSITIVO), cookie: h.get("cookie") })?.id ?? null;

  return <PanelDeSeguridad enforced={!!policy?.enforced} webBloqueada={!!policy?.web_blocked} cambiadaEn={policy?.changed_at ?? null} dispositivos={filas} uso={uso} bloqueados={bloqueados} usuarios={usuarios} esteDispositivo={esteDispositivo} error={error} />;
}
