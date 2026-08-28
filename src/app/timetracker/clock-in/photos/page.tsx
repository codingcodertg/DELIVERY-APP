import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient, isSupabaseConfigured } from "@/lib/clockin/supabase/server";
import { t, type Lang } from "@/lib/clockin/i18n";
import { centralDateStr } from "@/lib/clockin/schedule";
import { centralWallToUtc } from "@/lib/clockin/tz";
import { storeScope, NO_MATCH } from "@/lib/clockin/scope";
import ManagerHeader from "@/components/clockin/ManagerHeader";

export const dynamic = "force-dynamic";

/**
 * Todas las fotos de un día, para revisarlas de una sentada.
 *
 * Se sacan cuatro fotos por persona y día —entrada, salida, salir del sitio y volver— y
 * hasta ahora solo se veían de una en una, escarbando dentro de la excepción o del fichaje
 * concreto. Con 413 fotos guardadas, "revisar las fotos de ayer" no era una tarea que se
 * pudiera hacer.
 *
 * Se firman EN BLOQUE. Cobertura las firma una a una dentro de un bucle, lo cual está bien
 * para las de una semana de un equipo pequeño pero es una llamada de red por foto; un día
 * cargado son decenas. `createSignedUrls` (plural) hace lo mismo en una.
 *
 * Una hora de validez, como en el resto del módulo: son fotos de personas y el enlace no
 * debería sobrevivir a la sesión de quien las miró.
 */

type Foto = {
  path: string;
  persona: string;
  cuando: string;
  clase: "in" | "out" | "left" | "back";
  dentro: boolean | null;
  nota: string | null;
};

export default async function PhotosPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>;
}) {
  if (!isSupabaseConfigured) redirect("/timetracker/clock-in/clock");
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/timetracker/clock-in/photos");

  const { data: me } = await supabase
    .from("profiles")
    .select("company_id, language, role, store_id")
    .eq("id", user.id)
    .single();
  if (!me || (me.role !== "manager" && me.role !== "owner")) redirect("/timetracker/clock-in/clock");
  const lang = (me.language === "es" ? "es" : "en") as Lang;
  const tr = t(lang);
  const es = lang === "es";

  const { date } = await searchParams;
  const dia = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : centralDateStr();
  const desde = centralWallToUtc(`${dia}T00:00`);
  const hasta = new Date(new Date(desde).getTime() + 86400000).toISOString();

  // Mismo alcance que el resto del módulo: un gerente con tienda ve su cuadrilla.
  const { ids } = await storeScope(supabase, me.company_id, me.role, me.store_id);
  const inEmp = ids ? (ids.length ? ids : NO_MATCH) : null;

  let punchQ = supabase
    .from("time_entries")
    .select("employee_id, clock_in_at, clock_out_at, clock_in_photo_path, clock_out_photo_path, clock_in_in_radius, clock_out_in_radius")
    .eq("company_id", me.company_id)
    .gte("clock_in_at", desde)
    .lt("clock_in_at", hasta);
  let excQ = supabase
    .from("exceptions")
    .select("employee_id, type, reason, note, photo_path, returned_photo_path, left_at, returned_at, created_at")
    .eq("company_id", me.company_id)
    .gte("created_at", desde)
    .lt("created_at", hasta);
  if (inEmp) {
    punchQ = punchQ.in("employee_id", inEmp);
    excQ = excQ.in("employee_id", inEmp);
  }

  const [{ data: punches }, { data: excs }, { data: people }] = await Promise.all([
    punchQ,
    excQ,
    supabase.from("profiles").select("id, full_name").eq("company_id", me.company_id),
  ]);

  const nombre = new Map((people ?? []).map((p) => [p.id as string, (p.full_name as string) ?? "—"]));
  const fotos: Foto[] = [];
  for (const p of punches ?? []) {
    const quien = nombre.get(p.employee_id as string) ?? "—";
    if (p.clock_in_photo_path)
      fotos.push({ path: p.clock_in_photo_path as string, persona: quien, cuando: p.clock_in_at as string, clase: "in", dentro: p.clock_in_in_radius as boolean | null, nota: null });
    if (p.clock_out_photo_path)
      fotos.push({ path: p.clock_out_photo_path as string, persona: quien, cuando: p.clock_out_at as string, clase: "out", dentro: p.clock_out_in_radius as boolean | null, nota: null });
  }
  for (const e of excs ?? []) {
    const quien = nombre.get(e.employee_id as string) ?? "—";
    const motivo = (e.note as string) || (e.reason as string) || (e.type as string);
    if (e.photo_path)
      fotos.push({ path: e.photo_path as string, persona: quien, cuando: (e.left_at as string) || (e.created_at as string), clase: "left", dentro: null, nota: motivo });
    if (e.returned_photo_path)
      fotos.push({ path: e.returned_photo_path as string, persona: quien, cuando: (e.returned_at as string) || (e.created_at as string), clase: "back", dentro: null, nota: motivo });
  }
  fotos.sort((a, b) => Date.parse(a.cuando) - Date.parse(b.cuando));

  // Una sola llamada para todas, en vez de una por foto.
  const firmadas = new Map<string, string>();
  if (fotos.length) {
    const { data } = await supabase.storage
      .from("exception-photos")
      .createSignedUrls(fotos.map((f) => f.path), 3600);
    for (const s of data ?? []) if (s.path && s.signedUrl) firmadas.set(s.path, s.signedUrl);
  }

  const salta = (n: number) => {
    const d = new Date(`${dia}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  };
  const hoy = centralDateStr();

  const ETIQUETA: Record<Foto["clase"], { es: string; en: string; color: string }> = {
    in: { es: "Entrada", en: "Clock in", color: "bg-emerald-600" },
    out: { es: "Salida", en: "Clock out", color: "bg-zinc-600" },
    left: { es: "Salió del sitio", en: "Left the site", color: "bg-amber-600" },
    back: { es: "Regresó", en: "Back", color: "bg-sky-600" },
  };

  const hora = (iso: string) =>
    new Date(iso).toLocaleTimeString(es ? "es-MX" : "en-US", {
      hour: "2-digit", minute: "2-digit", timeZone: "America/Chicago",
    });

  const porPersona = new Map<string, Foto[]>();
  for (const f of fotos) porPersona.set(f.persona, [...(porPersona.get(f.persona) ?? []), f]);

  return (
    <main className="flex-1 w-full max-w-5xl mx-auto p-5 flex flex-col gap-5">
      <ManagerHeader
        lang={lang}
        active="photos"
        title={es ? "Fotos del día" : "Photos of the day"}
        subtitle={
          fotos.length
            ? `${fotos.length} ${es ? "fotos · " : "photos · "}${porPersona.size} ${es ? "personas" : "people"}`
            : es ? "Sin fotos este día" : "No photos this day"
        }
        isOwner={me.role === "owner"}
      />

      {/* Navegación por día. Enlaces y no un selector con JavaScript: así funciona el
          botón de atrás del navegador y una fecha concreta se puede compartir por su URL. */}
      <div className="flex items-center gap-2 flex-wrap">
        <Link href={`/timetracker/clock-in/photos?date=${salta(-1)}`}
          className="rounded-xl border border-zinc-200 dark:border-zinc-800 h-10 px-3 text-sm font-semibold flex items-center hover:border-emerald-400">
          ← {es ? "día anterior" : "previous day"}
        </Link>
        <span className="rounded-xl bg-zinc-100 dark:bg-zinc-800 h-10 px-4 text-sm font-semibold flex items-center">{dia}</span>
        <Link href={`/timetracker/clock-in/photos?date=${salta(1)}`}
          className="rounded-xl border border-zinc-200 dark:border-zinc-800 h-10 px-3 text-sm font-semibold flex items-center hover:border-emerald-400">
          {es ? "día siguiente" : "next day"} →
        </Link>
        {dia !== hoy && (
          <Link href="/timetracker/clock-in/photos"
            className="rounded-xl border border-emerald-400 text-emerald-600 h-10 px-3 text-sm font-semibold flex items-center">
            {es ? "hoy" : "today"}
          </Link>
        )}
      </div>

      {fotos.length === 0 ? (
        <p className="text-sm text-zinc-500">
          {es
            ? "Nadie fichó ni registró una salida este día — o las fotos de ese día ya se borraron (se guardan 60 días)."
            : "Nobody punched or logged a trip this day — or that day's photos have been cleaned up (they are kept 60 days)."}
        </p>
      ) : (
        [...porPersona.entries()].map(([persona, suyas]) => (
          <section key={persona} className="flex flex-col gap-2">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">
              {persona} · {suyas.length}
            </h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
              {suyas.map((f, i) => {
                const url = firmadas.get(f.path);
                const et = ETIQUETA[f.clase];
                return (
                  <figure key={f.path + i} className="rounded-xl border border-zinc-200 dark:border-zinc-800 overflow-hidden bg-white dark:bg-zinc-900">
                    {url ? (
                      // Se abre en pestaña nueva para verla a tamaño completo: una foto de
                      // fichaje se mira para reconocer una cara o un sitio, y en miniatura
                      // no se distingue.
                      <a href={url} target="_blank" rel="noreferrer">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={url} alt={`${persona} · ${et[lang]}`} loading="lazy"
                          className="w-full h-40 object-cover bg-zinc-100 dark:bg-zinc-800" />
                      </a>
                    ) : (
                      <div className="w-full h-40 flex items-center justify-center text-xs text-zinc-400 bg-zinc-100 dark:bg-zinc-800">
                        {es ? "no se pudo cargar" : "could not load"}
                      </div>
                    )}
                    <figcaption className="p-2 flex flex-col gap-1">
                      <span className="flex items-center gap-1.5 flex-wrap">
                        <span className={`${et.color} text-white text-[11px] font-semibold rounded px-1.5 py-0.5`}>{et[lang]}</span>
                        <span className="text-xs text-zinc-500">{hora(f.cuando)}</span>
                        {f.dentro === false && (
                          <span className="text-[11px] font-semibold rounded px-1.5 py-0.5 bg-red-600 text-white">
                            {es ? "fuera del sitio" : "off site"}
                          </span>
                        )}
                      </span>
                      {f.nota && <span className="text-[11px] text-zinc-500 line-clamp-2">{f.nota}</span>}
                    </figcaption>
                  </figure>
                );
              })}
            </div>
          </section>
        ))
      )}

      <p className="text-xs text-zinc-500 border-t border-zinc-200 dark:border-zinc-800 pt-3">
        {es
          ? "Las fotos se guardan 60 días y luego se borran solas. Las horas nunca se borran."
          : "Photos are kept for 60 days and then deleted automatically. The hours are never deleted."}
        {" · "}
        {tr.mgr.exceptions}: <Link className="text-emerald-600" href="/timetracker/team-requests">{es ? "Pendientes" : "Pending"}</Link>
      </p>
    </main>
  );
}
