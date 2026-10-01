"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { clockIn, clockOut, getMyDay, type ClockInResult } from "@/app/timetracker/clock-in/actions/clock";
import { startLeave, endLeave } from "@/app/timetracker/clock-in/actions/leave";
import { getMyTrip, startTrip, endTrip, logStop, finishStop } from "@/app/timetracker/clock-in/actions/runner";
import { subirFotoDeFichaje } from "@/lib/clockin/sube-foto";
import {
  MOTIVOS_DE_SALIDA, etiquetaDeFoto, filaDeSalida, planDeVisita, seCierraDeUnToque, type MotivoDeSalida,
} from "@/lib/clockin/visitas";
import { APP_SETTINGS, fmtClock } from "@/lib/timetracker/helpers";
import { getLang, useT } from "@/lib/timetracker/i18n";
import { Modal } from "@/components/timetracker/Modal";
import { MySections } from "@/components/timetracker/MySections";
import { TripPanel, type Viaje } from "@/components/timetracker/TripPanel";

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
 * programada, el almuerzo y las salidas del sitio. Los viajes de vehículo entraron después
 * (D-136, TripPanel, más abajo).
 *
 * D-206: pasa del idioma del hub (usePrefs) al de Time Tracker (useT, claves emp.punch.*), como el
 * resto de Registrar tiempo. Los motivos siguen siendo pares en/es (el `value` se guarda), elegidos
 * ahora por el idioma de Time Tracker.
 *
 * **D-NEXT — «Voy a salir» pregunta, y la visita lleva fotos.** El botón grababa una salida con
 * el motivo `customer_visit` SIEMPRE, sin preguntar nada y sin foto. Ahora abre una ventana:
 *
 *   · **¿Vas a visitar a un cliente? → Sí.** Empieza un viaje con ese motivo (personal si no
 *     tiene vehículo de la empresa asignado: nada que rellenar) y bajo el reloj queda, mientras
 *     dure, el botón **📷 Tomar foto**: de un toque, cuantas veces quiera. Cada foto es una
 *     parada (`logStop` con `photoPath`): hora del servidor, GPS, dirección. No hay almacén nuevo.
 *   · **→ No.** Se pregunta por qué sale —los demás motivos del enumerado— y se graba la salida
 *     de siempre (`startLeave`), ya con el motivo verdadero.
 *
 * Por eso el viaje se carga AQUÍ (`getMyTrip`) y se le pasa a TripPanel: el botón de foto y el
 * panel de viajes hablan del mismo viaje.
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

/** Los motivos de «voy a salir» cuando NO es una visita. Qué valores son lo decide visitas.ts. */
const MOTIVO_DE_SALIDA: Record<MotivoDeSalida, { en: string; es: string }> = {
  delivery: { en: "On a delivery", es: "En una entrega" },
  picking_up_supplies: { en: "Picking up supplies", es: "Recogiendo material" },
  moving_between_stores: { en: "Moving between stores", es: "Yendo de una tienda a otra" },
  personal_emergency: { en: "Personal emergency", es: "Emergencia personal" },
  other: { en: "Other", es: "Otro" },
};

type Dia = Extract<Awaited<ReturnType<typeof getMyDay>>, { ok: true }>;

const hhmm = (iso: string) =>
  new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: APP_SETTINGS.timeZone /* G-25: la zona del ajuste, no America/Chicago a pelo */ });
const horas = (min: number) => `${Math.floor(min / 60)}h ${String(min % 60).padStart(2, "0")}m`;

export function PunchPanel() {
  const t = useT();
  const lang = getLang(); // useT() ya fuerza el re-render al cambiar el idioma
  const [d, setD] = useState<Dia | null>(null);
  // El viaje abierto (o no) de quien mira. Lo comparten el botón de foto y TripPanel.
  const [viaje, setViaje] = useState<Viaje | null>(null);
  // La ventana de «voy a salir»: primero la pregunta, y si dice que no, el motivo.
  const [salida, setSalida] = useState<null | "pregunta" | "motivo">(null);
  const [enPropio, setEnPropio] = useState(false);
  const [odoVisita, setOdoVisita] = useState("");
  const [motivoSalida, setMotivoSalida] = useState<MotivoDeSalida>(MOTIVOS_DE_SALIDA[0]);
  const [notaSalida, setNotaSalida] = useState("");
  const [notaFoto, setNotaFoto] = useState("");
  const fotoVisitaRef = useRef<HTMLInputElement>(null);
  const [cargando, setCargando] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState<null | "in" | "out">(null);
  const [paso, setPaso] = useState<string>("");
  const [pideMotivo, setPideMotivo] = useState<null | "offsite" | "unscheduled" | "other_site">(null);
  // Varios motivos, no uno (D-163). Un Set no: el ORDEN importa —el primero es el que se
  // guarda en `reason` y el que sale en los informes viejos— y un Set no promete ninguno.
  const [motivos, setMotivos] = useState<string[]>([]);
  // La nota, solo cuando se marca "otro": es justo el caso en que la etiqueta no dice nada.
  const [notaMotivo, setNotaMotivo] = useState("");
  const [ahora, setAhora] = useState(Date.now());
  const fotoRef = useRef<HTMLInputElement>(null);
  const pendiente = useRef<"in" | "out" | null>(null);

  const load = useCallback(async () => {
    const [res, v] = await Promise.all([getMyDay(), getMyTrip()]);
    if (!res.ok) setErr(res.message); else { setErr(null); setD(res); }
    // El viaje es accesorio: si no se pudo leer, se ficha igual y el panel de viajes no sale.
    setViaje(v.ok ? v : null);
    setCargando(false);
  }, []);

  useEffect(() => { void load(); }, [load]);
  // El contador de "llevo trabajando" tiene que moverse solo; si no, parece parado.
  useEffect(() => { const i = setInterval(() => setAhora(Date.now()), 1000); return () => clearInterval(i); }, []);

  /** Coordenadas del navegador. Sin ellas no se ficha: el servidor las exige. */
  function ubicacion(): Promise<{ lat: number; lng: number; accuracy?: number }> {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) return reject(new Error(t("emp.punch.noGeo")));
      navigator.geolocation.getCurrentPosition(
        (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy }),
        () => reject(new Error(t("emp.punch.geoRequired"))),
        { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 },
      );
    });
  }

  /**
   * La misma posición, pero sin exigirla: salir a comer y volver no fichan, así que un GPS que
   * falla o tarda no puede bloquearlos. Se apunta lo que haya (o nada) y la excepción se graba
   * igual; Auditoría → Fotos enseña "sin ubicación" cuando no hubo. Ocho segundos y no
   * quince: quien pulsa "salgo a comer" no espera como quien ficha.
   */
  async function ubicacionOpcional(): Promise<{ lat: number; lng: number } | undefined> {
    if (!navigator.geolocation) return undefined;
    return new Promise((resolve) => {
      navigator.geolocation.getCurrentPosition(
        (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
        () => resolve(undefined),
        { enableHighAccuracy: true, timeout: 8000, maximumAge: 30000 },
      );
    });
  }

  async function subeFoto(file: File): Promise<string | null> {
    if (!d) return null;
    setPaso(t("emp.punch.uploading"));
    const r = await subirFotoDeFichaje(file, { companyId: d.companyId, userId: d.userId });
    if (r.ok) return r.path;
    setErr(r.motivo === "timeout" ? t("emp.punch.photoTimeout") : r.message);
    return null;
  }

  async function ficha(accion: "in" | "out", photoPath?: string, razones?: string[], nota?: string) {
    setErr(null);
    setOcupado(accion);
    try {
      setPaso(t("emp.punch.gettingLocation"));
      const geo = await ubicacion();
      setPaso(accion === "in" ? t("emp.punch.clockingIn") : t("emp.punch.clockingOut"));
      if (accion === "in") {
        const res: ClockInResult = await clockIn({ ...geo, photoPath, reasons: razones, note: nota || undefined });
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
      setMotivos([]);
      setNotaMotivo("");
      await load();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setOcupado(null);
      setPaso("");
    }
  }

  /** Acciones que no fichan (almuerzo, salidas): sin foto, y la ubicación si la hay (ubicacionOpcional). */
  async function corre(fn: () => Promise<{ ok: boolean; message?: string }>) {
    setErr(null);
    setOcupado("in");
    const res = await fn();
    setOcupado(null);
    if (!res.ok) { setErr(res.message ?? t("emp.punch.saveFail")); return; }
    await load();
  }

  /**
   * Una foto con su hora y su sitio. Es una PARADA del viaje abierto: `logStop` ya guarda foto,
   * hora del servidor, GPS, dirección y millas — no hay almacén nuevo. `cerrar` la deja cerrada
   * al momento: una foto suelta es un instante, no una estancia, y una parada abierta bloquearía
   * el almuerzo y el cierre del viaje. (`finishStop` cierra la ÚLTIMA abierta, que es esta.)
   *
   * Sin foto subida no se guarda nada: aquí la foto ES el registro, no un adjunto del fichaje.
   */
  async function guardaFoto(file: File, etiqueta: string, cerrar: boolean): Promise<{ ok: true } | { ok: false; message: string }> {
    if (!d) return { ok: false, message: t("emp.punch.saveFail") };
    setOcupado("in");
    try {
      setPaso(t("emp.punch.uploading"));
      const subida = await subirFotoDeFichaje(file, { companyId: d.companyId, userId: d.userId });
      if (!subida.ok) return { ok: false, message: subida.motivo === "timeout" ? t("emp.punch.photoTimeout") : subida.message };
      setPaso(t("emp.punch.gettingLocation"));
      const geo = await ubicacionOpcional();
      setPaso(t("emp.visit.saving"));
      const r = await logStop({ label: etiqueta, photoPath: subida.path, ...geo });
      if (!r.ok) return { ok: false, message: r.message };
      // La foto ya está guardada: si cerrar la parada falla, se dice, pero no se da por perdida.
      const cierre = cerrar ? await finishStop({ ...geo }) : null;
      await load();
      if (cierre && !cierre.ok) setErr(cierre.message);
      return { ok: true };
    } catch (e) {
      return { ok: false, message: (e as Error).message };
    } finally {
      setOcupado(null);
      setPaso("");
    }
  }

  /** El botón 📷 de la visita: la cámara ya se cerró. Sin fichero (canceló) no pasa nada. */
  async function alTomarFotoDeVisita(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setErr(null);
    const r = await guardaFoto(file, etiquetaDeFoto(notaFoto, t("emp.visit.photoLabel")), true);
    if (r.ok) setNotaFoto(""); else setErr(r.message);
  }

  const planVisita = planDeVisita({ vehiculoAsignado: viaje?.currentVehicleId ?? null, enPropio, odometro: odoVisita });

  /** «¿Vas a visitar a un cliente?» → Sí. */
  async function empiezaVisita() {
    if (!planVisita.ok) return;
    const plan = planVisita.viaje;
    setSalida(null);
    await corre(async () => startTrip({ kind: viaje?.mode ?? "sales", ...plan, ...(await ubicacionOpcional()) }));
    setOdoVisita("");
    setEnPropio(false);
  }

  /** → No: la salida de siempre (`startLeave`), con el motivo que diga. */
  async function saleSinVisita() {
    const reason = motivoSalida;
    const note = reason === "other" ? notaSalida.trim() || undefined : undefined;
    setSalida(null);
    await corre(async () => startLeave({ reason, note, geo: await ubicacionOpcional() }));
    setNotaSalida("");
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

  if (cargando) return <div className="card"><div className="hint">{t("emp.punch.loading")}</div></div>;
  if (!d) return <div className="card"><div className="banner err">{err ?? t("emp.punch.dayFail")}</div></div>;

  const dentro = !!d.open;
  const fila = filaDeSalida({ descansoAbierto: !!d.leave, viajeAbierto: !!viaje?.trip });
  const vehiculoDeVisita = viaje?.vehicles.find((v) => v.id === viaje.currentVehicleId) ?? null;
  const llevo = d.open ? Math.max(0, Math.floor((ahora - Date.parse(d.open.clockInAt)) / 1000)) : 0;

  return (
    <>
      <div className="card">
        <div className="between">
          <h2 style={{ margin: 0 }}>{dentro ? t("emp.punch.onClock") : t("emp.punch.clockIn")}</h2>
          {dentro
            ? <span className="pill on">{t("emp.punch.since")} {hhmm(d.open!.clockInAt)}</span>
            : <span className="pill wait">{t("emp.punch.notClockedIn")}</span>}
        </div>

        <div style={{ fontSize: 40, fontWeight: 800, letterSpacing: 1, margin: "8px 0" }}>
          {dentro ? fmtClock(llevo) : "0:00:00"}
        </div>

        {err && <div className="banner err">{err}</div>}
        {paso && <div className="hint">{paso}</div>}

        {pideMotivo ? (
          <div className="box" style={{ marginTop: 10 }}>
            <label>
              {pideMotivo === "offsite" ? t("emp.punch.whyOffsite")
                : pideMotivo === "unscheduled" ? t("emp.punch.whyUnscheduled")
                : t("emp.punch.whyOtherSite")}
            </label>
            {/* Casillas y no un desplegable (D-163).
                ---------------------------------------------------------------
                Un <select> obliga a elegir UNO, y el 72 % de los fichajes fuera
                de radio acababan en "otro" — que es lo que se marca cuando sales
                por dos cosas a la vez y solo te dejan decir una. Marcando varias
                se puede decir lo que de verdad pasó: iba a una entrega Y de paso
                pasé por la otra tienda.

                Además una casilla se toca de pie y con guantes; una lista
                desplegable, en un móvil, es un menú del sistema encima de todo.

                Se puede marcar una sola: nada obliga a marcar más. */}
            <div className="motivos">
              {MOTIVOS[pideMotivo].map((m) => {
                const puesto = motivos.includes(m.value);
                return (
                  <label key={m.value} className={"motivo" + (puesto ? " on" : "")}>
                    <input
                      type="checkbox"
                      checked={puesto}
                      onChange={() => setMotivos((ms) =>
                        // Se quita donde estaba, o se añade AL FINAL: así el primero que se
                        // marcó sigue siendo el primero, y es el que va a `reason`.
                        puesto ? ms.filter((x) => x !== m.value) : [...ms, m.value])}
                    />
                    {lang === "es" ? m.es : m.en}
                  </label>
                );
              })}
            </div>

            {/* "Otro" sin explicación no es un dato, es un hueco con nombre. Si se marca,
                se pregunta — sin obligar: es mejor un fichaje con "otro" pelado que un
                fichaje que no ocurre porque alguien no sabía qué escribir. */}
            {motivos.includes("other") && (
              <input
                style={{ marginTop: 8 }}
                value={notaMotivo}
                onChange={(e) => setNotaMotivo(e.target.value)}
                placeholder={t("emp.punch.whatHappened")}
              />
            )}

            <div className="row" style={{ marginTop: 10 }}>
              <button disabled={!motivos.length || !!ocupado}
                onClick={() => ficha("in", undefined, motivos, notaMotivo)}>
                {t("emp.punch.clockIn")}
              </button>
              <button className="btn-ghost" onClick={() => { setPideMotivo(null); setMotivos([]); setNotaMotivo(""); }}>
                {t("common.cancel")}
              </button>
            </div>
          </div>
        ) : (
          <div className="row" style={{ marginTop: 6 }}>
            {dentro
              ? <button className="btn-danger" disabled={!!ocupado} onClick={() => pide("out")}>
                  {ocupado === "out" ? "…" : t("emp.punch.clockOut")}
                </button>
              : <button disabled={!!ocupado} onClick={() => pide("in")}>
                  {ocupado === "in" ? "…" : t("emp.punch.clockIn")}
                </button>}
          </div>
        )}

        {/* Almuerzo y salidas del sitio: solo tienen sentido estando dentro, así que no se
            dibujan a quien no ha fichado — un botón que va a fallar es peor que no estar. */}
        {dentro && (
          <div className="row" style={{ marginTop: 10 }}>
            {fila === "descanso" && d.leave ? (
              <button className="btn-warn" disabled={!!ocupado}
                onClick={() => corre(async () => endLeave(d.leave!.id, await ubicacionOpcional()))}>
                {d.leave.reason === "lunch" ? t("emp.punch.endLunch") : t("emp.punch.imBack")} · {hhmm(d.leave.leftAt)}
              </button>
            ) : fila === "visita" && viaje?.trip ? (
              <>
                {/* El botón de foto, visible TODO el rato que dure la salida (D-NEXT): se toca
                    cuando quiera y cuantas veces quiera; cada toque abre la cámara. */}
                <button disabled={!!ocupado} onClick={() => fotoVisitaRef.current?.click()}>
                  📷 {t("emp.visit.takePhoto")}
                </button>
                {seCierraDeUnToque(viaje.trip) && (
                  <button className="btn-warn" disabled={!!ocupado}
                    onClick={() => corre(async () => endTrip({ ...(await ubicacionOpcional()) }))}>
                    {t("emp.punch.imBack")} · {hhmm(viaje.trip.startedAt)}
                  </button>
                )}
                <button className="btn-ghost" disabled={!!ocupado}
                  onClick={() => corre(async () => startLeave({ reason: "lunch", geo: await ubicacionOpcional() }))}>
                  🍽 {t("emp.punch.startLunch")}
                </button>
              </>
            ) : (
              <>
                <button className="btn-warn" disabled={!!ocupado}
                  onClick={() => corre(async () => startLeave({ reason: "lunch", geo: await ubicacionOpcional() }))}>
                  🍽 {t("emp.punch.startLunch")}
                </button>
                {/* Ya no graba nada al pulsarlo: abre la ventana que pregunta (D-NEXT). */}
                <button className="btn-ghost" disabled={!!ocupado} onClick={() => setSalida("pregunta")}>
                  🚚 {t("emp.punch.goingOut")}
                </button>
              </>
            )}
          </div>
        )}

        {dentro && fila === "visita" && viaje?.trip && (
          <div style={{ marginTop: 8 }}>
            <input value={notaFoto} onChange={(e) => setNotaFoto(e.target.value)} placeholder={t("emp.visit.notePh")} />
            <div className="hint">
              {t("emp.visit.hint", { n: viaje.stops.length })}
              {!seCierraDeUnToque(viaje.trip) && <> {t("emp.visit.endBelow")}</>}
            </div>
          </div>
        )}

        {/* La cámara de las fotos de visita. Aparte de la del fichaje: aquella ficha al volver. */}
        <input ref={fotoVisitaRef} type="file" accept="image/*" capture="environment" hidden onChange={alTomarFotoDeVisita} />

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
            <span className="muted">{t("emp.punch.todayShift")}</span>
            <strong>{d.shift ? `${d.shift.start.slice(0, 5)} – ${d.shift.end.slice(0, 5)}` : "—"}</strong>
          </div>
          {d.shift && (d.shift.lunch > 0 || d.shift.site) && (
            <div className="small muted" style={{ textAlign: "right" }}>
              {d.shift.lunch > 0 ? t("emp.punch.lunchMin", { m: d.shift.lunch }) : ""}
              {d.shift.lunch > 0 && d.shift.site ? " · " : ""}
              {d.shift.site ?? ""}
            </div>
          )}
          <div className="between" style={{ marginTop: 6 }}>
            <span className="muted">
              {t("emp.punch.payWeek")}
              <span className="small muted" style={{ display: "block", fontWeight: 400 }}>
                {d.periodStart} → {d.periodEnd} {t("emp.punch.friThu")}
              </span>
            </span>
            <strong>
              {horas(d.weekMinutes)} / {horas(d.scheduledMinutes)}
            </strong>
          </div>
          <div className="small muted" style={{ textAlign: "right" }}>
            {d.scheduledDays === 1 ? t("emp.punch.dayScheduled", { n: d.scheduledDays }) : t("emp.punch.daysScheduled", { n: d.scheduledDays })}
          </div>
        </div>
      )}

      <TripPanel
        d={viaje}
        recargar={load}
        ubicacion={ubicacionOpcional}
        fotoDeParada={(file, etiqueta) => guardaFoto(file, etiqueta, false)}
      />

      {salida && (
        <Modal title={`🚚 ${t("emp.punch.goingOut")}`} onClose={() => setSalida(null)} maxWidth={440}>
          {salida === "pregunta" ? (
            <>
              <p style={{ fontSize: 18, fontWeight: 700, margin: "6px 0" }}>{t("emp.visit.ask")}</p>
              <p className="hint">{t("emp.visit.askHint")}</p>
              {/* Solo quien tiene vehículo de la empresa asignado ve esto. Los demás van en el
                  suyo: viaje personal, nada que rellenar (planDeVisita). */}
              {vehiculoDeVisita && (
                <div className="box" style={{ marginTop: 8 }}>
                  <label className={"motivo" + (enPropio ? " on" : "")} style={{ textTransform: "none" }}>
                    <input type="checkbox" checked={enPropio} onChange={(e) => setEnPropio(e.target.checked)} />
                    {t("emp.trip.ownVehicle")}
                  </label>
                  {!enPropio && (
                    <>
                      <label>{t("emp.visit.odoOf", { v: vehiculoDeVisita.name })}</label>
                      <input inputMode="numeric" value={odoVisita} onChange={(e) => setOdoVisita(e.target.value)} placeholder={t("emp.trip.miles")} />
                    </>
                  )}
                </div>
              )}
              <div className="modal-actions">
                <button className="btn-ghost" onClick={() => setSalida("motivo")}>{t("emp.visit.no")}</button>
                <button disabled={!planVisita.ok || !!ocupado} onClick={empiezaVisita}>{t("emp.visit.yes")}</button>
              </div>
            </>
          ) : (
            <>
              <label>{t("emp.visit.whyOut")}</label>
              <div className="motivos">
                {MOTIVOS_DE_SALIDA.map((m) => (
                  <label key={m} className={"motivo" + (motivoSalida === m ? " on" : "")}>
                    <input type="radio" name="motivo-salida" checked={motivoSalida === m} onChange={() => setMotivoSalida(m)} />
                    {lang === "es" ? MOTIVO_DE_SALIDA[m].es : MOTIVO_DE_SALIDA[m].en}
                  </label>
                ))}
              </div>
              {motivoSalida === "other" && (
                <input style={{ marginTop: 8 }} value={notaSalida} onChange={(e) => setNotaSalida(e.target.value)} placeholder={t("emp.punch.whatHappened")} />
              )}
              <div className="modal-actions">
                <button className="btn-ghost" onClick={() => setSalida("pregunta")}>{t("emp.visit.backToAsk")}</button>
                <button disabled={!!ocupado} onClick={saleSinVisita}>{t("emp.punch.goingOut")}</button>
              </div>
            </>
          )}
        </Modal>
      )}

      <MySections />

      <div className="card">
        <div className="grid g2">
          <div className="stat">
            <div className="small muted">{t("emp.punch.today")}</div>
            <div style={{ fontSize: 24, fontWeight: 800 }}>{horas(d.todayMinutes)}</div>
          </div>
          <div className="stat">
            <div className="small muted">{t("emp.punch.payWeek")}</div>
            <div style={{ fontSize: 24, fontWeight: 800 }}>{horas(d.weekMinutes)}</div>
          </div>
        </div>

        <h2 style={{ marginTop: 16 }}>{t("emp.punch.todayPunches")}</h2>
        {d.today.length === 0 && d.breaks.length === 0 ? (
          <p className="muted">{t("emp.punch.nothingToday")}</p>
        ) : (
          <table>
            <thead><tr><th>{t("emp.punch.colWhat")}</th><th>{t("emp.punch.colIn")}</th><th>{t("emp.punch.colOut")}</th><th style={{ textAlign: "right" }}>{t("emp.punch.colTime")}</th></tr></thead>
            <tbody>
              {/* Fichajes y descansos EN UNA SOLA tabla, ordenados por hora. Antes solo salían
                  los fichajes, así que un almuerzo de 40 minutos no aparecía por ninguna parte.
                  En dos tablas habría que reconstruir el día mentalmente; así se lee de arriba
                  abajo tal como pasó: entré, comí, volví, salí a repartir. */}
              {[
                ...d.today.map((e) => ({
                  k: e.id, orden: e.clockInAt, que: t("emp.punch.shift"), cls: "on",
                  desde: e.clockInAt, hasta: e.clockOutAt, min: e.minutes,
                })),
                ...d.breaks.map((b) => ({
                  k: b.id, orden: b.leftAt,
                  que: b.reason === "lunch" ? t("emp.punch.lunchRow") : t("emp.punch.outRow"),
                  cls: b.reason === "lunch" ? "wait" : "",
                  desde: b.leftAt, hasta: b.returnedAt, min: b.minutes,
                })),
              ]
                .sort((a, b) => a.orden.localeCompare(b.orden))
                .map((r) => (
                  <tr key={r.k}>
                    <td className="nowrap"><span className={`pill ${r.cls}`}>{r.que}</span></td>
                    <td className="nowrap">{hhmm(r.desde)}</td>
                    <td className="nowrap">{r.hasta ? hhmm(r.hasta) : <span className="pill wait">{t("emp.punch.open")}</span>}</td>
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
            {d.lunchMinutes > 0 && <>🍽 {t("emp.punch.lunch")} {d.lunchMinutes} min</>}
            {d.lunchMinutes > 0 && d.outMinutes > 0 && " · "}
            {d.outMinutes > 0 && <>🚚 {t("emp.punch.out")} {d.outMinutes} min</>}
          </p>
        )}
      </div>
    </>
  );
}
