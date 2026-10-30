"use server";

import { clockinManagerCtx } from "@/lib/clockin/managerCtx";
import { canManageEmployee } from "@/lib/clockin/mgrScope";
import { armarFotos, type EntradaTurno, type FilaExcepcion, type FilaFichaje, type FilaParada, type SitioFoto } from "@/lib/clockin/day-photos";
import type { DayPhoto } from "./photos";

/**
 * La bitácora de UN fichaje (D-758, 2026-10-29): todo lo que pasó en ese turno, para verlo debajo de la fila de Nómina
 * sin ir a Auditoría. El dueño: «que diga salió a lunch a esta hora, fue a ver a cliente a esta hora, aquí están las dos
 * fotos […] pequeñito […] y cuando se expande, que enseñe todo eso, hasta las fotos que tomó todas».
 *
 * Se arma con las mismas piezas que `getDayPhotos` (fotos de entrada/salida, de salir y volver, y de visitas y paradas,
 * por `armarFotos`), pero acotado al fichaje por `time_entry_id`: así no hay que cuadrar nombres ni días que cruzan la
 * medianoche. Además de las fotos devuelve las salidas (comida y demás, con sus horas) y las paradas (con su hora y
 * dirección), para pintar la línea de tiempo aunque algo no lleve foto. Quien la pide tiene que poder gestionar a esa
 * persona (`canManageEmployee`), como en el resto de Nómina. Se firma en bloque, una hora.
 */

export type SalidaDelTurno = { id: string; reason: string | null; note: string | null; leftAt: string; returnedAt: string | null };
export type ParadaDelTurno = { label: string | null; address: string | null; note: string | null; arrivedAt: string; departedAt: string | null; conFoto: boolean };

export type BitacoraResult =
  | { ok: true; entryId: string; photos: DayPhoto[]; salidas: SalidaDelTurno[]; paradas: ParadaDelTurno[] }
  | { ok: false; message: string };

export async function getEntryDayLog(entryId: string): Promise<BitacoraResult> {
  if (!/^[0-9a-f-]{36}$/i.test(entryId)) return { ok: false, message: "Bad id." };
  const ctx = await clockinManagerCtx();
  if (!ctx.ok) return { ok: false, message: ctx.message };
  const { supabase, companyId } = ctx;

  const { data: punch } = await supabase
    .from("time_entries")
    .select("id, employee_id, clock_in_at, clock_out_at, clock_in_photo_path, clock_out_photo_path, clock_in_in_radius, clock_out_in_radius, clock_in_lat, clock_in_lng, clock_in_site_id, clock_out_lat, clock_out_lng, clock_out_site_id")
    .eq("company_id", companyId)
    .eq("id", entryId)
    .maybeSingle();
  if (!punch) return { ok: false, message: "Not found." };
  const fila = punch as unknown as FilaFichaje & { id: string };
  if (!(await canManageEmployee(supabase, ctx.me, fila.employee_id))) return { ok: false, message: "Not allowed." };

  const [{ data: excs }, { data: stops }, { data: who }, { data: sites }] = await Promise.all([
    supabase
      .from("exceptions")
      .select("id, employee_id, time_entry_id, type, reason, note, photo_path, returned_photo_path, left_at, returned_at, created_at, latitude, longitude, returned_lat, returned_lng")
      .eq("company_id", companyId)
      .eq("time_entry_id", entryId)
      .order("created_at"),
    supabase
      .from("trip_stops")
      .select("employee_id, label, note, address, photo_path, arrived_at, departed_at, latitude, longitude")
      .eq("company_id", companyId)
      .eq("time_entry_id", entryId)
      .order("arrived_at"),
    supabase.from("profiles").select("id, full_name").eq("id", fila.employee_id).maybeSingle(),
    supabase.from("job_sites").select("id, name, latitude, longitude, radius_meters, boundary, padding_meters").eq("company_id", companyId),
  ]);

  const nombre = new Map([[fila.employee_id, ((who as { full_name?: string | null } | null)?.full_name ?? "—")]]);
  const entradas: EntradaTurno[] = [{ id: fila.id, employee_id: fila.employee_id, clock_in_at: fila.clock_in_at, clock_out_at: fila.clock_out_at, clock_in_site_id: fila.clock_in_site_id }];
  const filasExc = (excs ?? []) as unknown as (FilaExcepcion & { id: string })[];
  const filasStop = (stops ?? []) as unknown as (FilaParada & { departed_at: string | null })[];
  const raw = armarFotos({
    punches: [fila],
    excs: filasExc,
    stops: filasStop.filter((s) => !!s.photo_path),
    sites: (sites ?? []) as unknown as SitioFoto[],
    entradas,
    nombre,
  });

  const url = new Map<string, string>();
  if (raw.length) {
    const { data: signed } = await supabase.storage.from("exception-photos").createSignedUrls(raw.map((r) => r.path), 3600);
    for (const s of signed ?? []) if (s.path && s.signedUrl) url.set(s.path, s.signedUrl);
  }
  const photos: DayPhoto[] = [];
  for (const r of raw) {
    const u = url.get(r.path);
    if (u) photos.push({ url: u, who: r.who, at: r.at, kind: r.kind, offSite: r.offSite, note: r.note, lat: r.lat, lng: r.lng, siteName: r.siteName, siteId: r.siteId, distanceM: r.distanceM });
  }
  const salidas: SalidaDelTurno[] = filasExc
    .filter((e) => !!e.left_at)
    .map((e) => ({ id: e.id, reason: e.reason ?? null, note: e.note ?? null, leftAt: e.left_at as string, returnedAt: e.returned_at ?? null }));
  const paradas: ParadaDelTurno[] = filasStop.map((s) => ({
    label: s.label ?? null, address: s.address ?? null, note: s.note ?? null, arrivedAt: s.arrived_at, departedAt: s.departed_at ?? null, conFoto: !!s.photo_path,
  }));
  return { ok: true, entryId, photos, salidas, paradas };
}
