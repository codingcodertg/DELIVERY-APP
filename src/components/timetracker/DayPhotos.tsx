"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getDayPhotos, type DayPhoto, type PhotoKind } from "@/app/timetracker/clock-in/actions/photos";
import { PhotoLightbox } from "@/components/PhotoLightbox";
import { dateISO, addDaysISO, fmtDayLong } from "@/lib/timetracker/helpers";
import { usePrefs } from "@/lib/prefs";

/**
 * Las fotos de fichaje de un día, dentro de Auditoría.
 *
 * Van aquí y no en una pantalla propia porque el tab de fichaje se retira: sus vistas de
 * gerente entran en las de Time Tracker, y "revisar las fotos" es la misma pregunta que hace
 * el registro de auditoría —qué pasó, quién, cuándo— con la prueba delante (D-109).
 *
 * El día se cambia con flechas y con el selector nativo de fecha. Es un componente de cliente
 * y no un enlace por día como el primer intento: dentro de Auditoría el día es un estado de
 * la pantalla, no una URL, y así no se recarga el registro entero al mover un día.
 *
 * Al abrir una foto se usa el visor del hub (PhotoLightbox) en lugar de una pestaña nueva.
 * `window.open` no hace nada dentro de la app de escritorio ni del WebView — es justo el
 * motivo por el que ese visor existe — y una foto de fichaje se abre precisamente para
 * ampliarla: una cara, una matrícula, dónde está parado alguien.
 */

const KIND: Record<PhotoKind, { label: string; cls: string }> = {
  in: { label: "Clock in", cls: "on" },
  out: { label: "Clock out", cls: "" },
  left: { label: "Left site", cls: "wait" },
  back: { label: "Back", cls: "" },
};

const ONLY = "en-US";

export function DayPhotos() {
  const { t } = usePrefs();
  const [day, setDay] = useState(() => dateISO(new Date()));
  const [photos, setPhotos] = useState<DayPhoto[]>([]);
  // El día más reciente que sí tiene fotos. Es la diferencia entre "no hay nada" y "no hay
  // nada AQUÍ": lo primero se lee como una app rota, lo segundo como un día sin trabajo.
  const [ultimoConFotos, setUltimoConFotos] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [who, setWho] = useState("");
  const [viewing, setViewing] = useState<number | null>(null);

  // Qué día se está pidiendo ahora mismo. Pulsar la flecha tres veces seguidas lanza tres
  // cargas y no hay nada que garantice que lleguen en orden: sin esto, la respuesta del
  // primer día puede llegar la última y pintar fotos que no son las del día en pantalla.
  const wanted = useRef(day);

  // Al abrir, si hoy no tiene fotos, se salta al último día que sí (D-161).
  //
  // Abrir en "hoy" parecía lo natural y no lo era: a las nueve de la mañana no ha fichado
  // nadie, los lunes el fin de semana está vacío, y el archivo entero —385 fotos traídas de
  // la app vieja— termina el 30 de agosto. O sea que quien entraba a auditar veía una
  // pantalla en blanco y concluía que las fotos no se habían importado. Pasó.
  //
  // UNA sola vez, y solo si no se ha tocado nada: en cuanto alguien elige un día, manda esa
  // elección — incluso si está vacío. Un navegador que te devuelve solo a otro día es peor
  // que uno que te deja donde pediste.
  const saltoHecho = useRef(false);

  const load = useCallback(async (d: string) => {
    wanted.current = d;
    setLoading(true);
    const res = await getDayPhotos(d);
    if (wanted.current !== d) return;
    if (!res.ok) { setErr(res.message); setPhotos([]); }
    else {
      setErr(null);
      setPhotos(res.photos);
      setUltimoConFotos(res.latestWithPhotos);
      if (!saltoHecho.current) {
        saltoHecho.current = true;
        if (res.photos.length === 0 && res.latestWithPhotos && res.latestWithPhotos !== d) {
          setDay(res.latestWithPhotos);
          return;   // el efecto vuelve a entrar con el día nuevo; no se apaga el "cargando"
        }
      }
    }
    setLoading(false);
  }, []);

  useEffect(() => { void load(day); }, [day, load]);

  const people = useMemo(
    () => Array.from(new Set(photos.map((p) => p.who))).sort(),
    [photos],
  );
  const shown = who ? photos.filter((p) => p.who === who) : photos;

  // El visor recorre lo que se está viendo, en el mismo orden que la rejilla.
  const urls = shown.map((p) => p.url);
  const credits = Object.fromEntries(
    shown.map((p) => [p.url, { name: p.who, role: KIND[p.kind].label }]),
  );

  const byPerson = new Map<string, DayPhoto[]>();
  shown.forEach((p) => byPerson.set(p.who, [...(byPerson.get(p.who) ?? []), p]));

  const today = dateISO(new Date());
  const time = (iso: string) =>
    new Date(iso).toLocaleTimeString(ONLY, { hour: "2-digit", minute: "2-digit", timeZone: "America/Chicago" });

  return (
    <div className="card">
      <div className="between">
        <h2 style={{ margin: 0 }}>📷 Photos</h2>
        <div className="row" style={{ alignItems: "center" }}>
          <button className="btn-ghost btn-sm" onClick={() => setDay((d) => addDaysISO(d, -1))} aria-label="Previous day">←</button>
          <input
            type="date"
            value={day}
            max={today}
            onChange={(e) => { if (e.target.value) setDay(e.target.value); }}
            style={{ width: "auto" }}
          />
          <button className="btn-ghost btn-sm" disabled={day >= today} onClick={() => setDay((d) => addDaysISO(d, 1))} aria-label="Next day">→</button>
          {day !== today && <button className="btn-ghost btn-sm" onClick={() => setDay(today)}>Today</button>}
          {people.length > 1 && (
            <select value={who} onChange={(e) => setWho(e.target.value)} style={{ width: "auto" }}>
              <option value="">Everyone</option>
              {people.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          )}
        </div>
      </div>

      <p className="small muted" style={{ marginTop: 4 }}>
        {fmtDayLong(day)} · {loading ? "loading…" : `${shown.length} photo${shown.length === 1 ? "" : "s"} · ${byPerson.size} ${byPerson.size === 1 ? "person" : "people"}`}
      </p>

      {err && <div className="banner err">{err}</div>}

      {!loading && !err && shown.length === 0 && (
        <div className="banner info">
          <div>
            {t("Nobody punched or logged a trip on", "Nadie fichó ni registró un viaje el")}{" "}
            <strong>{day}</strong>.{" "}
            {t(
              "Photos are kept indefinitely for now, so an empty day means there was no activity — nothing was deleted.",
              "Por ahora las fotos se conservan indefinidamente, así que un día vacío significa que no hubo actividad — no se borró nada.",
            )}
          </div>
          {/* Y, sobre todo, DÓNDE sí hay. Un navegador por días sin esta pista obliga a hacer
              clic hacia atrás a ciegas, y quien abre un lunes ve vacío el fin de semana y da la
              pantalla por rota — que es exactamente lo que pasó. */}
          {ultimoConFotos && ultimoConFotos !== day && (
            <div style={{ marginTop: 8 }}>
              The most recent photos are from <strong>{ultimoConFotos}</strong>.{" "}
              <button className="btn-ghost btn-sm" onClick={() => setDay(ultimoConFotos)}>
                Go to that day
              </button>
            </div>
          )}
        </div>
      )}

      {[...byPerson.entries()].map(([person, theirs]) => (
        <div key={person} style={{ marginTop: 14 }}>
          <div className="rev-who">{person} · {theirs.length}</div>
          <div className="rev-grid">
            {theirs.map((p) => {
              const k = KIND[p.kind];
              return (
                <figure key={p.url} className="rev-item" onClick={() => setViewing(urls.indexOf(p.url))}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={p.url} alt={`${person} · ${k.label}`} loading="lazy" />
                  <figcaption>
                    <span className={`pill ${k.cls}`}>{k.label}</span>
                    <span className="small muted">{time(p.at)}</span>
                    {p.offSite && <span className="pill off">off site</span>}
                    {p.note && <span className="small muted rev-note">{p.note}</span>}
                  </figcaption>
                </figure>
              );
            })}
          </div>
        </div>
      ))}

      <p className="small muted" style={{ marginTop: 14 }}>
        {t(
          "Photos are kept indefinitely for now — no automatic retention policy is active yet. The hours are never deleted.",
          "Por ahora las fotos se conservan indefinidamente — todavía no hay una política de retención automática activa. Las horas nunca se borran.",
        )}
      </p>

      {viewing !== null && urls[viewing] && (
        <PhotoLightbox
          photos={urls}
          index={viewing}
          credits={credits}
          onIndex={setViewing}
          onClose={() => setViewing(null)}
          t={(en) => en}
        />
      )}
    </div>
  );
}
