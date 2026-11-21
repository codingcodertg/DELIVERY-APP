"use client";

import { useEffect, useRef, useState } from "react";
import type { getMyTrip } from "@/app/timetracker/clock-in/actions/runner";
import { useAccionesDeFichar } from "@/components/timetracker/Capacitacion";
import { APP_SETTINGS } from "@/lib/timetracker/helpers";
import { useT } from "@/lib/timetracker/i18n";
import { odometroDeRegreso } from "@/lib/clockin/visitas";

/**
 * Los viajes de vehículo, dentro de Registrar tiempo (D-136).
 *
 * Última pieza del módulo de fichaje. Se rehace en el idioma de Time Tracker, como las
 * anteriores, pero esta se trató con más cuidado que ninguna por un motivo concreto: **escribe
 * kilometraje**, y ese número acaba en una factura.
 *
 * De ahí las decisiones de abajo:
 *
 *   · El cuentakilómetros **no se manda si está vacío** — se manda `null`. Un campo en blanco
 *     convertido en `0` es un viaje de cero millas que nadie hizo, y es peor que no tener dato:
 *     un hueco se ve, un cero se cree.
 *   · **El de llegada no puede ser menor que el de salida** (D-524; antes solo se avisaba): pasar
 *     de largo dejaría una diferencia negativa en la factura. Se compara con la lectura guardada.
 *   · **Viaje personal** significa vehículo propio: ni vehículo, ni cuentakilómetros, ni
 *     combustible. Pedirlos sería inventarse datos de un coche que no es de la empresa.
 *
 * Las acciones de servidor son las mismas de siempre (`startTrip`, `logStop`, `finishStop`,
 * `endTrip`), así que la geocodificación de paradas, el permiso y las reglas no cambian.
 *
 * G-9 (D-202): textos por claves emp.trip.*. Los motivos son un enumerado fijo del código (el
 * valor `v` es lo que se guarda y no cambia); los nombres de vehículo y de parada son dato.
 *
 * **D-455 — visitas y mandados, con foto.** Al rehacer este panel (D-136) se perdieron dos cosas
 * que el original sí hacía y que las acciones nunca dejaron de aceptar: la FOTO de cada parada y
 * su UBICACIÓN. `logStop` se llamaba solo con el nombre, así que una parada quedaba sin foto, sin
 * GPS, sin dirección y sin millas. Ahora:
 *
 *   · **Llegar a una parada abre la cámara.** La foto sube como la del fichaje y la parada se
 *     guarda con foto, hora y sitio. Sin foto no hay parada: es justo lo que se viene a registrar.
 *   · **Cada paso manda la ubicación si la hay** (empezar, llegar, salir, terminar). Opcional,
 *     como el almuerzo: un GPS que falla no puede dejar a nadie sin registrar su parada.
 *   · **Solo se ve con un viaje abierto** (D-525). Se sale por la ventana de «Voy a salir» (D-489),
 *     que ya pregunta personal o de la empresa; este panel ya no tiene su propio «Empezar viaje».
 *   · **El estado viene de PunchPanel**, no de una carga propia. El botón de foto de arriba y
 *     este panel hablan del MISMO viaje; con dos cargas, uno de los dos iba siempre un paso
 *     por detrás (y el panel no aparecía tras fichar hasta recargar la página).
 */

export type Viaje = Extract<Awaited<ReturnType<typeof getMyTrip>>, { ok: true }>;
type Punto = { lat: number; lng: number } | undefined;

const hhmm = (iso: string) =>
  new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: APP_SETTINGS.timeZone /* G-25: la zona del ajuste, no America/Chicago a pelo */ });

/**
 * **D-1123 — un solo botón que cambia** (Everto, 21 nov: «the customer visit steps are confusing»). Antes: una tabla de
 * paradas, un campo para escribir el sitio, el botón de foto aparte y «Terminar viaje» en rojo como si fuera lo principal.
 * Ahora, como las apps de reparto: arriba una tarjeta dice en qué paso vas («Manejando · desde 12:10 · 8 min» o
 * «En Garza Builders · 25 min»), debajo el historial del día, y UN botón grande que cambia: «📍 Llegué» → elegir el
 * sitio (recientes o escribir otro) y la foto → «Me voy de aquí». «Terminar viaje» queda pequeño abajo y pide el
 * cuentakilómetros solo al pulsarlo. Las acciones y las reglas del cuentakilómetros (D-524) no cambian.
 */
const CLAVE_RECIENTES = "tt_paradas_recientes";
const leeRecientes = (): string[] => {
  try { const v = JSON.parse(window.localStorage.getItem(CLAVE_RECIENTES) ?? "[]"); return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").slice(0, 6) : []; } catch { return []; }
};
const guardaReciente = (nombre: string) => {
  try { window.localStorage.setItem(CLAVE_RECIENTES, JSON.stringify([nombre, ...leeRecientes().filter((x) => x.toLowerCase() !== nombre.toLowerCase())].slice(0, 6))); } catch { /* sin almacenamiento: sin recientes */ }
};
const minutosDesde = (iso: string, ahora: number) => Math.max(0, Math.round((ahora - new Date(iso).getTime()) / 60000));

export function TripPanel({
  d, recargar, fotoDeParada, ubicacion,
}: {
  /** El viaje de quien mira, cargado por PunchPanel. null = aún no se sabe o no se pudo leer. */
  d: Viaje | null;
  recargar: () => Promise<void>;
  /** Sube la foto y guarda la parada (logStop con photoPath). Si no quedó guardada, dice por qué. */
  fotoDeParada: (file: File, etiqueta: string) => Promise<{ ok: true } | { ok: false; message: string }>;
  /** La posición del navegador, sin exigirla. */
  ubicacion: () => Promise<Punto>;
}) {
  const t = useT();
  // Reales o de práctica (modo capacitación, D-490).
  const { endTrip, finishStop } = useAccionesDeFichar();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  const camara = useRef<HTMLInputElement>(null);
  const [odoFin, setOdoFin] = useState("");
  const [parada, setParada] = useState("");
  // D-1123: «📍 Llegué» abre la elección del sitio; «Terminar viaje» abre el cuentakilómetros.
  const [eligiendo, setEligiendo] = useState(false);
  const [otro, setOtro] = useState(false);
  const [terminando, setTerminando] = useState(false);
  const [recientes, setRecientes] = useState<string[]>([]);
  const [ahora, setAhora] = useState(() => Date.now());
  useEffect(() => {
    setRecientes(leeRecientes());
    const id = setInterval(() => setAhora(Date.now()), 30000);
    return () => clearInterval(id);
  }, []);

  async function corre(fn: () => Promise<{ ok: boolean; message?: string }>) {
    setBusy(true);
    setErr(null);
    const r = await fn();
    setBusy(false);
    if (!r.ok) { setErr(r.message ?? t("emp.trip.saveFail")); return false; }
    await recargar();
    return true;
  }

  /** Vacío es `null`, nunca 0: un cero se cree, un hueco se ve. */
  const num = (s: string) => (s.trim() === "" ? null : Number(s));

  if (!d) return null;
  // Sin fichaje abierto no hay viaje: se conduce estando de alta, y ofrecerlo antes solo daría
  // un error del servidor con otras palabras.
  if (!d.clockedIn) return null;
  // Solo mientras hay un viaje abierto (D-525): se sale SOLO por la ventana de «Voy a salir» (D-489).
  if (!d.trip) return null;

  // La lectura de salida del viaje abierto (D-524): la GUARDADA, aunque el viaje se empezara en «Voy a salir» o la página se
  // recargara.
  const salida = d.trip.vehicleId ? d.trip.startOdometer : null;
  const regreso = odometroDeRegreso(salida, num(odoFin));

  const abierta = d.stops.find((s) => !s.departedAt) ?? null;
  // Manejando desde la última salida de una parada, o desde que empezó el viaje.
  const ultimaSalida = d.stops.map((s) => s.departedAt).filter((x): x is string => !!x).sort().pop() ?? d.trip.startedAt;
  const desde = abierta ? abierta.arrivedAt : ultimaSalida;
  const sugerencias = Array.from(new Set([...d.stops.map((s) => (s.label ?? "").trim()).filter(Boolean).reverse(), ...recientes])).slice(0, 5);
  const nombreDe = (s: { label: string | null }) => s.label || t("emp.trip.stop");

  /** La cámara ya se cerró: con foto se guarda la parada; sin foto no hay nada que guardar. */
  async function alTomarFoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setBusy(true);
    setErr(null);
    const r = await fotoDeParada(file, parada.trim());
    setBusy(false);
    // El motivo se dice AQUÍ, junto al botón que se pulsó, no en la tarjeta del reloj de arriba.
    if (r.ok) { guardaReciente(parada.trim()); setRecientes(leeRecientes()); setParada(""); setEligiendo(false); setOtro(false); }
    else setErr(r.message);
  }
  /** Elegir un sitio de la lista abre la cámara enseguida: la parada se guarda al volver con la foto. */
  const eligeYFoto = (nombre: string) => { setParada(nombre); setTimeout(() => camara.current?.click(), 0); };

  const botonGrande: React.CSSProperties = { width: "100%", padding: "16px 12px", fontSize: 18, fontWeight: 800, borderRadius: 14, marginTop: 12 };

  return (
    <div className="card" data-viaje-un-boton>
      <div className="between">
        <h2 style={{ margin: 0 }}>{t("emp.trip.title")}</h2>
        <span className="pill on">{t("emp.trip.onTrip", { time: hhmm(d.trip.startedAt) })}</span>
      </div>

      {err && <div className="banner err">{err}</div>}
      {aviso && <div className="banner warn">{aviso}</div>}

      {/* La tarjeta de estado: en qué paso vas, de un vistazo. */}
      <div data-estado-del-viaje={abierta ? "en-parada" : "manejando"}
        style={{ marginTop: 12, padding: "14px 16px", borderRadius: 14, color: "#fff", background: abierta ? "#1E6B3A" : "#1B2540", display: "flex", flexDirection: "column", gap: 4 }}>
        <span style={{ fontSize: 22, fontWeight: 800 }}>{abierta ? `📍 ${t("emp.trip.atPlace", { place: nombreDe(abierta) })}` : `🚗 ${t("emp.trip.driving")}`}</span>
        <span style={{ fontSize: 14, opacity: 0.85 }}>{t("emp.trip.since", { time: hhmm(desde), min: minutosDesde(desde, ahora) })}</span>
      </div>

      {/* El historial del día, en lugar de la tabla (que cortaba las horas en el teléfono). */}
      <div data-historial-del-viaje style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 6 }}>
        <div className="small muted" style={{ fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase" }}>{t("emp.trip.today")}</div>
        <div className="small"><b>{hhmm(d.trip.startedAt)}</b> · {t("emp.trip.tlLeft")}</div>
        {d.stops.map((s) => (
          <div key={s.id} style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <div className="small"><b>{hhmm(s.arrivedAt)}</b> · {t("emp.trip.tlArrived", { place: nombreDe(s) })}</div>
            {s.departedAt
              ? <div className="small"><b>{hhmm(s.departedAt)}</b> · {t("emp.trip.tlDeparted", { place: nombreDe(s) })}</div>
              : <div><span className="pill wait">{t("emp.trip.hereNow")}</span></div>}
          </div>
        ))}
      </div>

      {/* capture="environment": la cámara trasera en el móvil; en un ordenador, un fichero. */}
      <input ref={camara} type="file" accept="image/*" capture="environment" hidden onChange={alTomarFoto} />

      {/* Llegar y salir de una parada siguen siendo dos pasos: el tiempo EN la parada es el dato que se quiere. */}
      {abierta ? (
        <button className="btn-primary" data-me-voy style={botonGrande} disabled={busy}
          onClick={() => corre(async () => finishStop({ ...(await ubicacion()) }))}>
          🚗 {t("emp.trip.leaveHere")}
        </button>
      ) : !eligiendo ? (
        <button className="btn-primary" data-llegue style={botonGrande} disabled={busy}
          onClick={() => { setEligiendo(true); setOtro(sugerencias.length === 0); }}>
          📍 {t("emp.trip.arrived")}
        </button>
      ) : (
        <div data-donde-estas style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 8 }}>
          <b style={{ fontSize: 18 }}>{t("emp.trip.whereAreYou")}</b>
          {sugerencias.length > 0 && <div className="small muted">{t("emp.trip.recent")}</div>}
          {sugerencias.map((n) => (
            <button key={n} className="btn-ghost" data-sitio-reciente={n} disabled={busy} style={{ textAlign: "left", padding: "12px 14px" }} onClick={() => eligeYFoto(n)}>📷 {n}</button>
          ))}
          {otro ? (
            <>
              {/* El nombre es obligatorio: el servidor rechaza una parada sin nombre. Con nombre, el botón abre la cámara. */}
              <input value={parada} onChange={(e) => setParada(e.target.value)} placeholder={t("emp.trip.stopNamePh")} autoFocus />
              <button className="btn-primary" disabled={busy || !parada.trim()} onClick={() => camara.current?.click()}>
                📷 {t("emp.trip.photoAndArrive")}
              </button>
            </>
          ) : (
            <button className="btn-ghost" data-otro-lugar disabled={busy} onClick={() => setOtro(true)}>✏️ {t("emp.trip.otherPlace")}</button>
          )}
          <div className="hint">{t("emp.trip.stopPhotoHint")}</div>
          <button className="btn-ghost" disabled={busy} onClick={() => { setEligiendo(false); setOtro(false); setParada(""); }}>{t("emp.trip.cancel")}</button>
        </div>
      )}

      <div className="hr" />
      {!terminando ? (
        <button className="btn-ghost" data-abre-terminar disabled={busy} onClick={() => setTerminando(true)} style={{ fontSize: 13 }}>
          🏁 {t("emp.trip.end")}
        </button>
      ) : (
        <>
          <div className="grid g2">
            {d.trip.vehicleId && (
              <div>
                <label>{t("emp.trip.odoIn")}</label>
                <input inputMode="numeric" value={odoFin} onChange={(e) => setOdoFin(e.target.value)} placeholder={t("emp.trip.miles")}
                  min={salida ?? undefined} aria-invalid={regreso === "menor" || undefined} />
                {/* D-524: la lectura de salida a la vista, y el aviso en cuanto el regreso es menor. */}
                {salida != null && <div className="hint" data-odometro-salida>{t("emp.trip.odoOutWas", { a: salida })}</div>}
                {regreso === "menor" && salida != null && (
                  <div className="hint" data-odometro-menor style={{ color: "var(--red, #c0392b)" }}>{t("emp.trip.odoWarn", { a: salida, b: num(odoFin) ?? "" })}</div>
                )}
              </div>
            )}
          </div>
          <div className="row" style={{ marginTop: 10, gap: 8 }}>
            <button
              className="btn-danger"
              disabled={busy || regreso === "menor"}
              onClick={() => {
                // Menor que la salida no se manda (D-524; el servidor tampoco lo acepta): pasar de largo dejaría una
                // diferencia negativa en la factura. Vacío sí se manda, y el servidor contesta qué falta, como antes.
                if (regreso === "menor" && salida != null) {
                  setAviso(t("emp.trip.odoWarn", { a: salida, b: num(odoFin) ?? "" }));
                  return;
                }
                setAviso(null);
                void corre(async () => endTrip({ odometer: num(odoFin), ...(await ubicacion()) }));
              }}
            >
              {t("emp.trip.end")}
            </button>
            <button className="btn-ghost" disabled={busy} onClick={() => setTerminando(false)}>{t("emp.trip.cancel")}</button>
          </div>
        </>
      )}
    </div>
  );
}
