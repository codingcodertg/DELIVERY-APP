"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { clockIn, clockOut, getMyDay, type ClockInResult } from "@/app/timetracker/clock-in/actions/clock";
import { startLeave, endLeave } from "@/app/timetracker/clock-in/actions/leave";
import { createClient } from "@/lib/clockin/supabase/client";
import { compressImage } from "@/lib/clockin/image";
import { fmtClock } from "@/lib/timetracker/helpers";
import { usePrefs } from "@/lib/prefs";
import { MySections } from "@/components/timetracker/MySections";
import { TripPanel } from "@/components/timetracker/TripPanel";

/**
 * Fichar, dentro de Registrar tiempo (D-125).
 *
 * Es la misma pregunta que el cronómetro —¿estoy trabajando y cuánto llevo?— así que va en la
 * misma plantilla y no en otra pantalla. Un paso antes mandaba al presencial a la app de
 * fichaje; eso funcionaba pero dejaba dos sitios donde trabajar, y el objetivo es retirar esa
 * app entera.
 *
 * **Lo que se conserva del original, porque no es adorno:**
 *
 *   · La ubicación es OBLIGATORIA y la manda el navegador en cada fichaje. El servidor decide
 *     si estás dentro del sitio, no el cliente: por eso se envían coordenadas y no un "sí".
 *   · La foto se sube al mismo bucket y con la misma forma de ruta que antes
 *     (`empresa/persona/hora.jpg`). Cambiarla habría dejado ciega a la vista de Fotos (D-109),
 *     que las busca justo ahí.
 *   · Se comprime antes de subir: una foto de móvil son 8–12 MB y con mala cobertura se queda
 *     colgada. Y la subida lleva su propio límite de 30 s, porque no trae ninguno de serie —
 *     ese fue el "hice la foto y no pasó nada" del original.
 *   · Si el servidor pide un motivo (fuera del sitio, sin turno, en otra tienda) se pregunta y
 *     se reenvía. Sin eso, un fichaje fuera de la geocerca fallaría sin explicar por qué.
 *
 * Trae también lo que la pantalla vieja enseñaba nada más entrar: el turno de hoy, la semana
 * programada, el almuerzo y las salidas del sitio. Lo que NO trae son los viajes de vehículo
 * (con su selección de camión y kilometraje), que siguen en la pantalla de fichaje.
 */

/**
 * Los motivos que se ofrecen cuando el servidor pide uno (D-159 los traduce).
 *
 * El `value` es lo que se guarda y **no se traduce jamás**: es la clave con la que la
 * oficina agrupa y cuenta después. Lo que cambia de idioma es solo lo que se lee.
 *
 * Y esta es la lista que más falta hacía traducir de toda la app: se le pregunta a alguien
 * por qué está fichando fuera de su sitio, de pie, con el teléfono en la mano y con prisa.
 * Si no entiende las opciones, elige "Other" — y entonces el dato que la oficina quería no
 * existe.
 */
const MOTIVOS: Record<string, { value: string; en: string; es: string }[]> = {
  offsite: [
    { value: "customer_visit", en: "Visiting a customer", es: "Visitando a un cliente" },
    { value: "delivery", en: "On a delivery", es: "En una entrega" },
    { value: "moving_between_stores", en: "Moving between stores", es: "Yendo de una tienda a otra" },
    { value: "personal_emergency", en: "Personal emergency", es: "Emergencia personal" },
    { value: "other", en: "Other", es: "Otro" },
  ],
  unscheduled: [
    { value: "covering_shift", en: "Covering a shift", es: "Cubriendo un turno" },
    { value: "asked_to_come_in", en: "Asked to come in", es: "Me pidieron venir" },
    { value: "picking_up_extra", en: "Picking up extra hours", es: "Tomando horas extra" },
    { value: "forgot_on_schedule", en: "I should be on the schedule", es: "Yo debería estar en el horario" },
    { value: "other", en: "Other", es: "Otro" },
  ],
  other_site: [
    { value: "visiting_site", en: "Visiting another site", es: "Visitando otro sitio" },
    { value: "helping_store", en: "Helping another store", es: "Ayudando en otra tienda" },
    { value: "delivery_pickup", en: "Delivery or pickup", es: "Entrega o recolección" },
    { value: "covering_shift", en: "Covering a shift", es: "Cubriendo un turno" },
    { value: "other", en: "Other", es: "Otro" },
  ],
};

type Dia = Extract<Awaited<ReturnType<typeof getMyDay>>, { ok: true }>;

const hhmm = (iso: string) =>
  new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/Chicago" });
const horas = (min: number) => `${Math.floor(min / 60)}h ${String(min % 60).padStart(2, "0")}m`;

export function PunchPanel() {
  const { t, lang } = usePrefs();
  const [d, setD] = useState<Dia | null>(null);
  const [cargando, setCargando] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState<null | "in" | "out">(null);
  const [paso, setPaso] = useState<string>("");
  const [pideMotivo, setPideMotivo] = useState<null | "offsite" | "unscheduled" | "other_site">(null);
  const [motivo, setMotivo] = useState("");
  const [ahora, setAhora] = useState(Date.now());
  const fotoRef = useRef<HTMLInputElement>(null);
  const pendiente = useRef<"in" | "out" | null>(null);

  const load = useCallback(async () => {
    const res = await getMyDay();
    if (!res.ok) setErr(res.message); else { setErr(null); setD(res); }
    setCargando(false);
  }, []);

  useEffect(() => { void load(); }, [load]);
  // El contador de "llevo trabajando" tiene que moverse solo; si no, parece parado.
  useEffect(() => { const i = setInterval(() => setAhora(Date.now()), 1000); return () => clearInterval(i); }, []);

  /** Coordenadas del navegador. Sin ellas no se ficha: el servidor las exige. */
  function ubicacion(): Promise<{ lat: number; lng: number; accuracy?: number }> {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) return reject(new Error(t("This device cannot report its location.", "Este dispositivo no puede informar su ubicación.")));
      navigator.geolocation.getCurrentPosition(
        (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy }),
        () => reject(new Error(t("Location is required to punch. Allow it and try again.", "Se necesita la ubicación para fichar. Permítala y vuelva a intentarlo."))),
        { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 },
      );
    });
  }

  async function subeFoto(file: File): Promise<string | null> {
    if (!d) return null;
    setPaso(t("Uploading the photo…", "Subiendo la foto…"));
    const supabase = createClient();
    const body = await compressImage(file);
    const path = `${d.companyId}/${d.userId}/${Date.now()}.jpg`;
    const r = await Promise.race([
      supabase.storage.from("exception-photos").upload(path, body, { contentType: "image/jpeg", upsert: false }),
      new Promise<"timeout">((res) => setTimeout(() => res("timeout"), 30000)),
    ]);
    if (r === "timeout") { setErr(t("The photo is taking too long — weak signal. Try again.", "La foto está tardando demasiado — señal débil. Inténtelo otra vez.")); return null; }
    if (r.error) { setErr(r.error.message); return null; }
    return path;
  }

  async function ficha(accion: "in" | "out", photoPath?: string, razon?: string) {
    setErr(null);
    setOcupado(accion);
    try {
      setPaso(t("Getting your location…", "Obteniendo su ubicación…"));
      const geo = await ubicacion();
      setPaso(accion === "in" ? t("Clocking in…", "Registrando entrada…") : t("Clocking out…", "Registrando salida…"));
      if (accion === "in") {
        const res: ClockInResult = await clockIn({ ...geo, photoPath, reason: razon });
        if (!res.ok) {
          if (res.code === "needs_reason") { setPideMotivo(res.context); setOcupado(null); setPaso(""); return; }
          if (res.code === "already_open") { await load(); setOcupado(null); setPaso(""); return; }
          setErr(res.message);
        }
      } else {
        if (!d?.open) return;
        const res = await clockOut(d.open.id, { ...geo, photoPath });
        if (!res.ok) setErr(res.message);
      }
      setPideMotivo(null);
      setMotivo("");
      await load();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setOcupado(null);
      setPaso("");
    }
  }

  /** Acciones que no fichan (almuerzo, salidas): sin foto ni ubicación obligatoria. */
  async function corre(fn: () => Promise<{ ok: boolean; message?: string }>) {
    setErr(null);
    setOcupado("in");
    const res = await fn();
    setOcupado(null);
    if (!res.ok) { setErr(res.message ?? t("Could not save.", "No se pudo guardar.")); return; }
    await load();
  }

  /** La cámara se abre primero; el fichaje va después, con la foto ya subida. */
  function pide(accion: "in" | "out") {
    pendiente.current = accion;
    fotoRef.current?.click();
  }

  async function alElegirFoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    const accion = pendiente.current;
    pendiente.current = null;
    if (!accion) return;
    setOcupado(accion);
    // Sin foto se sigue fichando: la hora y el sitio son lo que se paga, y perder el fichaje
    // por una cámara que no abrió sería peor que quedarse sin la foto.
    const path = file ? await subeFoto(file) : undefined;
    await ficha(accion, path ?? undefined);
  }

  if (cargando) return <div className="card"><div className="hint">{t("Loading…", "Cargando…")}</div></div>;
  if (!d) return <div className="card"><div className="banner err">{err ?? t("Could not read your day.", "No se pudo leer su día.")}</div></div>;

  const dentro = !!d.open;
  const llevo = d.open ? Math.max(0, Math.floor((ahora - Date.parse(d.open.clockInAt)) / 1000)) : 0;

  return (
    <>
      <div className="card">
        <div className="between">
          <h2 style={{ margin: 0 }}>{dentro ? t("You are on the clock", "Está trabajando") : t("Clock in", "Registrar entrada")}</h2>
          {dentro
            ? <span className="pill on">{t("since", "desde")} {hhmm(d.open!.clockInAt)}</span>
            : <span className="pill wait">{t("not clocked in", "sin fichar")}</span>}
        </div>

        <div style={{ fontSize: 40, fontWeight: 800, letterSpacing: 1, margin: "8px 0" }}>
          {dentro ? fmtClock(llevo) : "0:00:00"}
        </div>

        {err && <div className="banner err">{err}</div>}
        {paso && <div className="hint">{paso}</div>}

        {pideMotivo ? (
          <div className="box" style={{ marginTop: 10 }}>
            <label>
              {pideMotivo === "offsite" ? t("You are not at a job site. Why?", "No está en un sitio de trabajo. ¿Por qué?")
                : pideMotivo === "unscheduled" ? t("You are not on the schedule today. Why?", "Hoy no está en el horario. ¿Por qué?")
                : t("You are at a different site. Why?", "Está en un sitio distinto. ¿Por qué?")}
            </label>
            <select value={motivo} onChange={(e) => setMotivo(e.target.value)}>
              <option value="">{t("Pick a reason…", "Elija un motivo…")}</option>
              {MOTIVOS[pideMotivo].map((m) => <option key={m.value} value={m.value}>{lang === "es" ? m.es : m.en}</option>)}
            </select>
            <div className="row" style={{ marginTop: 10 }}>
              <button disabled={!motivo || !!ocupado} onClick={() => ficha("in", undefined, motivo)}>{t("Clock in", "Registrar entrada")}</button>
              <button className="btn-ghost" onClick={() => { setPideMotivo(null); setMotivo(""); }}>{t("Cancel", "Cancelar")}</button>
            </div>
          </div>
        ) : (
          <div className="row" style={{ marginTop: 6 }}>
            {dentro
              ? <button className="btn-danger" disabled={!!ocupado} onClick={() => pide("out")}>
                  {ocupado === "out" ? "…" : t("Clock out", "Registrar salida")}
                </button>
              : <button disabled={!!ocupado} onClick={() => pide("in")}>
                  {ocupado === "in" ? "…" : t("Clock in", "Registrar entrada")}
                </button>}
          </div>
        )}

        {/* Almuerzo y salidas del sitio: solo tienen sentido estando dentro, así que no se
            dibujan a quien no ha fichado — un botón que va a fallar es peor que no estar. */}
        {dentro && (
          <div className="row" style={{ marginTop: 10 }}>
            {d.leave ? (
              <button className="btn-warn" disabled={!!ocupado}
                onClick={() => corre(() => endLeave(d.leave!.id))}>
                {d.leave.reason === "lunch" ? t("End lunch", "Terminar almuerzo") : t("I'm back", "Ya volví")} · {hhmm(d.leave.leftAt)}
              </button>
            ) : (
              <>
                <button className="btn-warn" disabled={!!ocupado}
                  onClick={() => corre(() => startLeave({ reason: "lunch" }))}>
                  🍽 {t("Start lunch", "Empezar almuerzo")}
                </button>
                <button className="btn-ghost" disabled={!!ocupado}
                  onClick={() => corre(() => startLeave({ reason: "customer_visit" }))}>
                  🚚 {t("Going out", "Voy a salir")}
                </button>
              </>
            )}
          </div>
        )}

        {/* capture="environment" abre la cámara trasera directamente en el móvil; en un
            ordenador es un selector de fichero normal. */}
        <input ref={fotoRef} type="file" accept="image/*" capture="environment" hidden onChange={alElegirFoto} />
      </div>

      {/* El turno de hoy y la semana programada. Es la pregunta que se hace cualquiera nada
          más entrar —¿a qué hora salgo y cuánto llevo de lo mío?— y estaba solo en la app de
          fichaje. */}
      {(d.shift || d.scheduledMinutes > 0) && (
        <div className="card">
          <div className="between">
            <span className="muted">{t("Today's shift", "Turno de hoy")}</span>
            <strong>{d.shift ? `${d.shift.start.slice(0, 5)} – ${d.shift.end.slice(0, 5)}` : "—"}</strong>
          </div>
          {d.shift && (d.shift.lunch > 0 || d.shift.site) && (
            <div className="small muted" style={{ textAlign: "right" }}>
              {d.shift.lunch > 0 ? t(`${d.shift.lunch}m lunch`, `${d.shift.lunch}m de almuerzo`) : ""}
              {d.shift.lunch > 0 && d.shift.site ? " · " : ""}
              {d.shift.site ?? ""}
            </div>
          )}
          <div className="between" style={{ marginTop: 6 }}>
            <span className="muted">
              {t("This pay week", "Esta semana de pago")}
              <span className="small muted" style={{ display: "block", fontWeight: 400 }}>
                {d.periodStart} → {d.periodEnd} {t("(Fri–Thu)", "(vie–jue)")}
              </span>
            </span>
            <strong>
              {horas(d.weekMinutes)} / {horas(d.scheduledMinutes)}
            </strong>
          </div>
          <div className="small muted" style={{ textAlign: "right" }}>
            {d.scheduledDays === 1 ? t(`${d.scheduledDays} day scheduled`, `${d.scheduledDays} día programado`) : t(`${d.scheduledDays} days scheduled`, `${d.scheduledDays} días programados`)}
          </div>
        </div>
      )}

      <TripPanel />

      <MySections />

      <div className="card">
        <div className="grid g2">
          <div className="stat">
            <div className="small muted">{t("Today", "Hoy")}</div>
            <div style={{ fontSize: 24, fontWeight: 800 }}>{horas(d.todayMinutes)}</div>
          </div>
          <div className="stat">
            <div className="small muted">{t("This pay week", "Esta semana de pago")}</div>
            <div style={{ fontSize: 24, fontWeight: 800 }}>{horas(d.weekMinutes)}</div>
          </div>
        </div>

        <h2 style={{ marginTop: 16 }}>{t("Today's punches", "Fichajes de hoy")}</h2>
        {d.today.length === 0 && d.breaks.length === 0 ? (
          <p className="muted">{t("Nothing yet today.", "Todavía nada hoy.")}</p>
        ) : (
          <table>
            <thead><tr><th>{t("What", "Qué")}</th><th>{t("In", "Entrada")}</th><th>{t("Out", "Salida")}</th><th style={{ textAlign: "right" }}>{t("Time", "Tiempo")}</th></tr></thead>
            <tbody>
              {/* Fichajes y descansos EN UNA SOLA tabla, ordenados por hora. Antes solo salían
                  los fichajes, así que un almuerzo de 40 minutos no aparecía por ninguna parte.
                  En dos tablas habría que reconstruir el día mentalmente; así se lee de arriba
                  abajo tal como pasó: entré, comí, volví, salí a repartir. */}
              {[
                ...d.today.map((e) => ({
                  k: e.id, orden: e.clockInAt, que: t("⏰ Shift", "⏰ Turno"), cls: "on",
                  desde: e.clockInAt, hasta: e.clockOutAt, min: e.minutes,
                })),
                ...d.breaks.map((b) => ({
                  k: b.id, orden: b.leftAt,
                  que: b.reason === "lunch" ? t("🍽 Lunch", "🍽 Almuerzo") : t("🚚 Out", "🚚 Fuera"),
                  cls: b.reason === "lunch" ? "wait" : "",
                  desde: b.leftAt, hasta: b.returnedAt, min: b.minutes,
                })),
              ]
                .sort((a, b) => a.orden.localeCompare(b.orden))
                .map((r) => (
                  <tr key={r.k}>
                    <td className="nowrap"><span className={`pill ${r.cls}`}>{r.que}</span></td>
                    <td className="nowrap">{hhmm(r.desde)}</td>
                    <td className="nowrap">{r.hasta ? hhmm(r.hasta) : <span className="pill wait">{t("open", "abierto")}</span>}</td>
                    <td className="nowrap" style={{ textAlign: "right" }}>{horas(r.min)}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        )}
        {(d.lunchMinutes > 0 || d.outMinutes > 0) && (
          // El total del día, por separado: comer y salir a repartir no son lo mismo ni para
          // la nómina ni para quien revisa.
          <p className="small muted" style={{ marginTop: 8 }}>
            {d.lunchMinutes > 0 && <>🍽 {t("Lunch", "Almuerzo")} {d.lunchMinutes} min</>}
            {d.lunchMinutes > 0 && d.outMinutes > 0 && " · "}
            {d.outMinutes > 0 && <>🚚 {t("Out", "Fuera")} {d.outMinutes} min</>}
          </p>
        )}
      </div>
    </>
  );
}
