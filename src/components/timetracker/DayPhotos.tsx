"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { getDayPhotos, type DayPhoto, type PhotoKind, type PhotoSite } from "@/app/timetracker/clock-in/actions/photos";
import { PhotoLightbox } from "@/components/PhotoLightbox";
import { APP_SETTINGS, dateISO, addDaysISO, fmtDayLong } from "@/lib/timetracker/helpers";
import { getLang, useT } from "@/lib/timetracker/i18n";
import { fmtDistancia } from "@/lib/clockin/day-photos";

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
 *
 * G-9 (D-202): textos por claves mgr.photos.*. Tres frases ya estaban en los dos idiomas, pero
 * por el idioma del HUB (usePrefs), no por el de Time Tracker: la misma pantalla podía salir
 * mitad y mitad. Ahora todo sale por el idioma de Time Tracker, como el resto de Auditoría.
 * fmtDayLong no se toca: el día largo sigue en inglés.
 *
 * Dónde se tomó cada foto: una línea bajo la foto con el sitio y los metros a su geocerca, y el
 * pin es un enlace a Google Maps en pestaña nueva. Enlace y no mapa a propósito: /timetracker
 * no carga Leaflet ni la API de Maps, y un mapa embebido por foto costaría llave y peso para
 * responder una pregunta que un enlace responde igual.
 */

const KIND_CLS: Record<PhotoKind, string> = { in: "on", out: "", left: "wait", back: "" };
// Claves literales, una por tipo, para que la prueba de claves de D-187 las vea en el fuente.
function kindLabel(t: ReturnType<typeof useT>, k: PhotoKind): string {
  if (k === "in") return t("mgr.photos.kindIn");
  if (k === "out") return t("mgr.photos.kindOut");
  if (k === "left") return t("mgr.photos.kindLeft");
  return t("mgr.photos.kindBack");
}

const ONLY = "en-US";

// La ventana del mapa entra solo al abrirla (D-209): arrastra el cargador de Google Maps y
// GeofenceMap, y esta pantalla no los necesita hasta que alguien pulsa una ubicación.
const PhotoMapModal = dynamic(() => import("./PhotoMapModal"), {
  loading: () => <div className="overlay"><div className="modal" role="dialog" aria-busy="true"><div className="hint">…</div></div></div>,
});

// Claves literales, una por estado, para la prueba de claves de D-187.
function locText(t: ReturnType<typeof useT>, lang: "en" | "es", p: DayPhoto): string {
  if (p.lat == null || p.lng == null) return t("mgr.photos.locNone");
  if (p.siteName == null || p.distanceM == null) return t("mgr.photos.locNoSite", { lat: p.lat.toFixed(5), lng: p.lng.toFixed(5) });
  const d = fmtDistancia(p.distanceM, lang);
  if (p.offSite) return t("mgr.photos.locOff", { d, site: p.siteName });
  if (p.distanceM === 0) return t("mgr.photos.locOnSite", { site: p.siteName });
  return t("mgr.photos.locAt", { d, site: p.siteName });
}

export function DayPhotos() {
  const t = useT();
  const lang = getLang() === "es" ? "es" : "en"; // useT() ya fuerza el re-render al cambiar el idioma
  const [day, setDay] = useState(() => dateISO(new Date()));
  const [photos, setPhotos] = useState<DayPhoto[]>([]);
  // El día más reciente que sí tiene fotos. Es la diferencia entre "no hay nada" y "no hay
  // nada AQUÍ": lo primero se lee como una app rota, lo segundo como un día sin trabajo.
  const [ultimoConFotos, setUltimoConFotos] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [who, setWho] = useState("");
  const [viewing, setViewing] = useState<number | null>(null);
  // Los sitios con su geocerca viajan una vez con las fotos; `mapa` es la foto cuya ubicación
  // está abierta en la ventana del mapa.
  const [sites, setSites] = useState<PhotoSite[]>([]);
  const [mapa, setMapa] = useState<DayPhoto | null>(null);

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
      setSites(res.sites);
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
    shown.map((p) => [p.url, { name: p.who, role: kindLabel(t, p.kind) }]),
  );

  const byPerson = new Map<string, DayPhoto[]>();
  shown.forEach((p) => byPerson.set(p.who, [...(byPerson.get(p.who) ?? []), p]));

  const today = dateISO(new Date());
  const time = (iso: string) =>
    new Date(iso).toLocaleTimeString(ONLY, { hour: "2-digit", minute: "2-digit", timeZone: APP_SETTINGS.timeZone /* G-25: la zona del ajuste, no America/Chicago a pelo */ });

  return (
    <div className="card">
      <div className="between">
        <h2 style={{ margin: 0 }}>{t("mgr.photos.title")}</h2>
        <div className="row" style={{ alignItems: "center" }}>
          <button className="btn-ghost btn-sm" onClick={() => setDay((d) => addDaysISO(d, -1))} aria-label={t("mgr.photos.prevDay")}>←</button>
          <input
            type="date"
            value={day}
            max={today}
            onChange={(e) => { if (e.target.value) setDay(e.target.value); }}
            style={{ width: "auto" }}
          />
          <button className="btn-ghost btn-sm" disabled={day >= today} onClick={() => setDay((d) => addDaysISO(d, 1))} aria-label={t("mgr.photos.nextDay")}>→</button>
          {day !== today && <button className="btn-ghost btn-sm" onClick={() => setDay(today)}>{t("mgr.photos.today")}</button>}
          {people.length > 1 && (
            <select value={who} onChange={(e) => setWho(e.target.value)} style={{ width: "auto" }}>
              <option value="">{t("mgr.photos.everyone")}</option>
              {people.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          )}
        </div>
      </div>

      <p className="small muted" style={{ marginTop: 4 }}>
        {fmtDayLong(day)} · {loading ? t("mgr.photos.loading") : `${shown.length === 1 ? t("mgr.photos.countOne", { n: shown.length }) : t("mgr.photos.countMany", { n: shown.length })} · ${byPerson.size === 1 ? t("mgr.photos.personOne", { n: byPerson.size }) : t("mgr.photos.personMany", { n: byPerson.size })}`}
      </p>

      {err && <div className="banner err">{err}</div>}

      {!loading && !err && shown.length === 0 && (
        <div className="banner info">
          <div>
            {t("mgr.photos.nobodyOn")}{" "}
            <strong>{day}</strong>.{" "}
            {t("mgr.photos.emptyMeans")}
          </div>
          {/* Y, sobre todo, DÓNDE sí hay. Un navegador por días sin esta pista obliga a hacer
              clic hacia atrás a ciegas, y quien abre un lunes ve vacío el fin de semana y da la
              pantalla por rota — que es exactamente lo que pasó. */}
          {ultimoConFotos && ultimoConFotos !== day && (
            <div style={{ marginTop: 8 }}>
              {t("mgr.photos.latestFrom")} <strong>{ultimoConFotos}</strong>.{" "}
              <button className="btn-ghost btn-sm" onClick={() => setDay(ultimoConFotos)}>
                {t("mgr.photos.goToDay")}
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
              const k = { label: kindLabel(t, p.kind), cls: KIND_CLS[p.kind] };
              return (
                <figure key={p.url} className="rev-item" onClick={() => setViewing(urls.indexOf(p.url))}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={p.url} alt={`${person} · ${k.label}`} loading="lazy" />
                  <figcaption>
                    <span className={`pill ${k.cls}`}>{k.label}</span>
                    <span className="small muted">{time(p.at)}</span>
                    {p.offSite && <span className="pill off">{t("mgr.photos.offSite")}</span>}
                    {p.note && <span className="small muted rev-note">{p.note}</span>}
                    {/* El clic en el pin abre la ventana del mapa y no el visor: stopPropagation.
                        El enlace a Google Maps (D-212) sigue dentro de esa ventana, como respaldo. */}
                    {p.lat != null && p.lng != null ? (
                      <button
                        type="button"
                        className="small muted rev-note"
                        // Fuera de la geocerca: en rojo y seminegrita, a juego con el marcador del mapa (D-213 bis).
                        style={{ background: "none", border: 0, padding: 0, cursor: "pointer", textAlign: "left", font: "inherit", color: p.offSite ? "var(--red)" : "inherit", fontWeight: p.offSite ? 600 : undefined }}
                        title={t("mgr.photos.showMap")}
                        onClick={(e) => { e.stopPropagation(); setMapa(p); }}
                      >
                        {locText(t, lang, p)}
                      </button>
                    ) : (
                      <span className="small muted rev-note">{locText(t, lang, p)}</span>
                    )}
                  </figcaption>
                </figure>
              );
            })}
          </div>
        </div>
      ))}

      <p className="small muted" style={{ marginTop: 14 }}>
        {t("mgr.photos.retention")}
      </p>

      {mapa && <PhotoMapModal photo={mapa} sites={sites} onClose={() => setMapa(null)} />}

      {viewing !== null && urls[viewing] && (
        <PhotoLightbox
          photos={urls}
          index={viewing}
          credits={credits}
          onIndex={setViewing}
          onClose={() => setViewing(null)}
          t={(en, es) => (lang === "es" ? es : en)}
        />
      )}
    </div>
  );
}
