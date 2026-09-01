"use server";

import { clockinManagerCtx } from "@/lib/clockin/managerCtx";
import { storeScope, NO_MATCH } from "@/lib/clockin/scope";
import { centralWallToUtc, centralShiftMs } from "@/lib/clockin/tz";

/**
 * Todas las fotos de un día, para revisarlas de una sentada.
 *
 * Se sacan cuatro fotos por persona y día —entrada, salida, salir del sitio y volver— y
 * hasta ahora solo se veían de una en una, escarbando dentro del fichaje o de la excepción
 * concreta. Con cientos guardadas, "revisar las fotos de ayer" no era una tarea que se
 * pudiera hacer.
 *
 * Vive en el módulo de fichaje porque es donde están las tablas y el alcance por tienda, pero
 * quien la llama es la pantalla de Auditoría de Time Tracker: el tab de fichaje se va, y sus
 * vistas entran ahí (D-109).
 *
 * Se firman EN BLOQUE. Cobertura las firma una a una dentro de un bucle, lo cual está bien
 * para las de una semana de un equipo pequeño pero es una llamada de red por foto; un día
 * cargado son decenas. `createSignedUrls` (plural) hace lo mismo en una.
 *
 * Una hora de validez, como en el resto del módulo: son fotos de personas y el enlace no
 * debería sobrevivir a la sesión de quien las miró.
 */

export type PhotoKind = "in" | "out" | "left" | "back";

export type DayPhoto = {
  url: string;
  who: string;
  /** UTC ISO del momento en que se tomó. */
  at: string;
  kind: PhotoKind;
  /** true solo cuando el fichaje quedó FUERA de la geocerca; null = no aplica. */
  offSite: boolean | null;
  note: string | null;
};

export type DayPhotosResult =
  | { ok: true; day: string; photos: DayPhoto[]; latestWithPhotos: string | null }
  | { ok: false; message: string };

export async function getDayPhotos(day: string): Promise<DayPhotosResult> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return { ok: false, message: "Bad date." };

  const ctx = await clockinManagerCtx();
  if (!ctx.ok) return { ok: false, message: ctx.message };
  const { supabase, companyId } = ctx;

  const from = centralWallToUtc(`${day}T00:00`);
  const to = new Date(new Date(from).getTime() + 86400000).toISOString();

  // Mismo alcance que el resto del módulo: un gerente con tienda ve su cuadrilla y nadie más.
  const { ids } = await storeScope(supabase, companyId, ctx.role, ctx.storeId, ctx.me.extra_store_ids);
  const inEmp = ids ? (ids.length ? ids : NO_MATCH) : null;

  let punchQ = supabase
    .from("time_entries")
    .select(
      "employee_id, clock_in_at, clock_out_at, clock_in_photo_path, clock_out_photo_path, clock_in_in_radius, clock_out_in_radius",
    )
    .eq("company_id", companyId)
    .gte("clock_in_at", from)
    .lt("clock_in_at", to);
  let excQ = supabase
    .from("exceptions")
    .select("employee_id, type, reason, note, photo_path, returned_photo_path, left_at, returned_at, created_at")
    .eq("company_id", companyId)
    .gte("created_at", from)
    .lt("created_at", to);
  if (inEmp) {
    punchQ = punchQ.in("employee_id", inEmp);
    excQ = excQ.in("employee_id", inEmp);
  }

  // El día más reciente que TIENE fotos. Sin esto, quien abre la pantalla un lunes ve "sin
  // fotos" —porque el fin de semana no se ficha— y concluye que está rota. Un navegador por
  // días sin ninguna señal de dónde están los datos obliga a hacer clic hacia atrás a ciegas.
  //
  // Mira las DOS fuentes (D-161). Miraba solo los fichajes, y las fotos de excepción —salir
  // del sitio, volver— son la mitad del archivo: 137 de las 385 que hay hoy. Un día en el
  // que alguien salió del sitio pero nadie fichó con foto quedaba invisible para esta pista,
  // que es justo el día raro que una auditoría viene a mirar.
  let ultimaPunchQ = supabase
    .from("time_entries")
    .select("clock_in_at")
    .eq("company_id", companyId)
    .not("clock_in_photo_path", "is", null)
    .order("clock_in_at", { ascending: false })
    .limit(1);
  let ultimaExcQ = supabase
    .from("exceptions")
    .select("created_at")
    .eq("company_id", companyId)
    .not("photo_path", "is", null)
    .order("created_at", { ascending: false })
    .limit(1);
  if (inEmp) {
    ultimaPunchQ = ultimaPunchQ.in("employee_id", inEmp);
    ultimaExcQ = ultimaExcQ.in("employee_id", inEmp);
  }

  const [{ data: punches }, { data: excs }, { data: people }, { data: ultimaPunch }, { data: ultimaExc }] = await Promise.all([
    punchQ,
    excQ,
    supabase.from("profiles").select("id, full_name").eq("company_id", companyId),
    ultimaPunchQ,
    ultimaExcQ,
  ]);

  // El día de cada fuente, y se queda el mayor. Se comparan como FECHA local del negocio y
  // no como instante: dos fotos de la misma tarde pueden caer en días UTC distintos, y la
  // pantalla navega por días de aquí, no por días de Greenwich.
  const aDiaLocal = (iso: string | undefined) =>
    iso ? new Date(new Date(iso).getTime() - centralShiftMs(new Date(iso))).toISOString().slice(0, 10) : null;
  const diaPunch = aDiaLocal((ultimaPunch ?? [])[0]?.clock_in_at as string | undefined);
  const diaExc = aDiaLocal((ultimaExc ?? [])[0]?.created_at as string | undefined);
  const latestWithPhotos = [diaPunch, diaExc].filter(Boolean).sort().pop() ?? null;

  const name = new Map((people ?? []).map((p) => [p.id as string, (p.full_name as string) ?? "—"]));
  type Raw = Omit<DayPhoto, "url"> & { path: string };
  const raw: Raw[] = [];

  for (const p of punches ?? []) {
    const who = name.get(p.employee_id as string) ?? "—";
    if (p.clock_in_photo_path)
      raw.push({
        path: p.clock_in_photo_path as string, who, at: p.clock_in_at as string,
        kind: "in", offSite: p.clock_in_in_radius === false, note: null,
      });
    if (p.clock_out_photo_path)
      raw.push({
        path: p.clock_out_photo_path as string, who, at: (p.clock_out_at ?? p.clock_in_at) as string,
        kind: "out", offSite: p.clock_out_in_radius === false, note: null,
      });
  }
  for (const e of excs ?? []) {
    const who = name.get(e.employee_id as string) ?? "—";
    const why = (e.note as string) || (e.reason as string) || (e.type as string) || null;
    if (e.photo_path)
      raw.push({
        path: e.photo_path as string, who, at: (e.left_at ?? e.created_at) as string,
        kind: "left", offSite: null, note: why,
      });
    if (e.returned_photo_path)
      raw.push({
        path: e.returned_photo_path as string, who, at: (e.returned_at ?? e.created_at) as string,
        kind: "back", offSite: null, note: why,
      });
  }
  raw.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  if (!raw.length) return { ok: true, day, photos: [], latestWithPhotos };

  // Una sola llamada para todas, en vez de una por foto.
  const { data: signed } = await supabase.storage
    .from("exception-photos")
    .createSignedUrls(raw.map((r) => r.path), 3600);
  const url = new Map<string, string>();
  for (const s of signed ?? []) if (s.path && s.signedUrl) url.set(s.path, s.signedUrl);

  // Una foto sin firma no se puede enseñar; se cae en silencio en vez de dejar un hueco roto
  // en la rejilla. El contador de la cabecera cuenta las que se ven, que es lo honesto.
  const photos: DayPhoto[] = [];
  for (const r of raw) {
    const u = url.get(r.path);
    if (u) photos.push({ url: u, who: r.who, at: r.at, kind: r.kind, offSite: r.offSite, note: r.note });
  }
  return { ok: true, day, photos, latestWithPhotos };
}
