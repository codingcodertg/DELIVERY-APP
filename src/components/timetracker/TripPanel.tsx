"use client";

import { useRef, useState } from "react";
import { startTrip, endTrip, finishStop, type getMyTrip } from "@/app/timetracker/clock-in/actions/runner";
import { APP_SETTINGS } from "@/lib/timetracker/helpers";
import { useT } from "@/lib/timetracker/i18n";
import { viajePersonalPorDefecto } from "@/lib/clockin/visitas";

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
 *   · **Se avisa si el de llegada es menor que el de salida.** No se bloquea —un dígito mal
 *     tecleado se corrige, y a veces el vehículo cambia— pero pasar de largo sin decir nada
 *     dejaría una diferencia negativa en la factura.
 *   · **Viaje personal** significa vehículo propio: ni vehículo, ni cuentakilómetros, ni
 *     combustible. Pedirlos sería inventarse datos de un coche que no es de la empresa.
 *
 * Las acciones de servidor son las mismas de siempre (`startTrip`, `logStop`, `finishStop`,
 * `endTrip`), así que la geocodificación de paradas, el permiso y las reglas no cambian.
 *
 * G-9 (D-202): textos por claves emp.trip.*. Los motivos son un enumerado fijo del código (el
 * valor `v` es lo que se guarda y no cambia); los nombres de vehículo y de parada son dato.
 *
 * **D-NEXT — visitas y mandados, con foto.** Al rehacer este panel (D-136) se perdieron dos cosas
 * que el original sí hacía y que las acciones nunca dejaron de aceptar: la FOTO de cada parada y
 * su UBICACIÓN. `logStop` se llamaba solo con el nombre, así que una parada quedaba sin foto, sin
 * GPS, sin dirección y sin millas. Ahora:
 *
 *   · **Llegar a una parada abre la cámara.** La foto sube como la del fichaje y la parada se
 *     guarda con foto, hora y sitio. Sin foto no hay parada: es justo lo que se viene a registrar.
 *   · **Cada paso manda la ubicación si la hay** (empezar, llegar, salir, terminar). Opcional,
 *     como el almuerzo: un GPS que falla no puede dejar a nadie sin registrar su parada.
 *   · **Sin vehículo asignado, el viaje nace «personal»** (`viajePersonalPorDefecto`): antes salía
 *     preseleccionado el primer vehículo de la empresa y pedía un cuentakilómetros de un coche
 *     que la persona no lleva.
 *   · **El estado viene de PunchPanel**, no de una carga propia. El botón de foto de arriba y
 *     este panel hablan del MISMO viaje; con dos cargas, uno de los dos iba siempre un paso
 *     por detrás (y el panel no aparecía tras fichar hasta recargar la página).
 */

export type Viaje = Extract<Awaited<ReturnType<typeof getMyTrip>>, { ok: true }>;
type Punto = { lat: number; lng: number } | undefined;

// Claves literales, una por motivo, para que la prueba de claves de D-187 las vea en el fuente.
function motivos(t: ReturnType<typeof useT>) {
  return [
    { v: "delivery", l: t("emp.trip.reasonDelivery") },
    { v: "customer_visit", l: t("emp.trip.reasonCustomerVisit") },
    { v: "moving_between_stores", l: t("emp.trip.reasonBetweenStores") },
    { v: "pickup", l: t("emp.trip.reasonPickup") },
    { v: "other", l: t("emp.trip.reasonOther") },
  ];
}

const hhmm = (iso: string) =>
  new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: APP_SETTINGS.timeZone /* G-25: la zona del ajuste, no America/Chicago a pelo */ });

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
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  const [vehiculoElegido, setVehiculo] = useState("");
  // null = no ha tocado la casilla: manda el defecto, que depende de si tiene vehículo asignado.
  const [personalElegido, setPersonal] = useState<boolean | null>(null);
  const camara = useRef<HTMLInputElement>(null);
  const [motivo, setMotivo] = useState("delivery");
  const [nota, setNota] = useState("");
  const [odoIni, setOdoIni] = useState("");
  const [odoFin, setOdoFin] = useState("");
  const [parada, setParada] = useState("");

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
  // Un comercial sin vehículos y sin viaje abierto no tiene nada que hacer aquí.
  if (d.mode === "sales" && d.vehicles.length === 0 && !d.trip) return null;

  const personal = personalElegido ?? viajePersonalPorDefecto(d.currentVehicleId);
  const vehiculo = vehiculoElegido || d.currentVehicleId || d.vehicles[0]?.id || "";

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
    if (r.ok) setParada(""); else setErr(r.message);
  }

  return (
    <div className="card">
      <div className="between">
        <h2 style={{ margin: 0 }}>{t("emp.trip.title")}</h2>
        {d.trip && <span className="pill on">{t("emp.trip.onTrip", { time: hhmm(d.trip.startedAt) })}</span>}
      </div>

      {err && <div className="banner err">{err}</div>}
      {aviso && <div className="banner warn">{aviso}</div>}

      {!d.trip ? (
        <>
          {/* `.motivo` y no `.perm-opt`: la clase del hub, bajo la hoja de Time Tracker, estiraba la
              casilla al 100 % y dejaba el texto debajo (medido en el navegador, D-NEXT). */}
          <label className={"motivo" + (personal ? " on" : "")} style={{ marginTop: 8, textTransform: "none" }}>
            <input type="checkbox" checked={personal} onChange={(e) => setPersonal(e.target.checked)} />
            {t("emp.trip.ownVehicle")}
          </label>

          {!personal && (
            <div className="grid g2">
              <div>
                <label>{t("emp.trip.vehicle")}</label>
                <select value={vehiculo} onChange={(e) => setVehiculo(e.target.value)}>
                  {d.vehicles.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
                </select>
              </div>
              <div>
                <label>{t("emp.trip.odoOut")}</label>
                <input inputMode="numeric" value={odoIni} onChange={(e) => setOdoIni(e.target.value)} placeholder={t("emp.trip.miles")} />
              </div>
            </div>
          )}

          <div className="grid g2">
            <div>
              <label>{t("emp.trip.reason")}</label>
              <select value={motivo} onChange={(e) => setMotivo(e.target.value)}>
                {motivos(t).map((m) => <option key={m.v} value={m.v}>{m.l}</option>)}
              </select>
            </div>
            {motivo === "other" && (
              <div>
                <label>{t("emp.trip.note")}</label>
                <input value={nota} onChange={(e) => setNota(e.target.value)} />
              </div>
            )}
          </div>

          <button
            style={{ marginTop: 12 }}
            disabled={busy || (!personal && !vehiculo)}
            onClick={() => corre(async () => startTrip({
              kind: d.mode,
              personal,
              vehicleId: personal ? null : vehiculo,
              odometer: personal ? null : num(odoIni),
              reason: motivo,
              note: motivo === "other" ? nota || null : null,
              ...(await ubicacion()),
            }))}
          >
            {t("emp.trip.start")}
          </button>
        </>
      ) : (
        <>
          {d.stops.length > 0 && (
            <table style={{ marginTop: 10 }}>
              <tbody>
                {d.stops.map((s) => (
                  <tr key={s.id}>
                    <td>{s.label || t("emp.trip.stop")}</td>
                    <td className="small muted nowrap">
                      {hhmm(s.arrivedAt)}{s.departedAt ? ` – ${hhmm(s.departedAt)}` : ""}
                    </td>
                    <td>{!s.departedAt && <span className="pill wait">{t("emp.trip.hereNow")}</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {/* Llegar y salir de una parada son dos botones distintos a propósito: el tiempo
              EN la parada es el dato que se quiere, y un solo botón lo perdería. */}
          {d.stops.some((s) => !s.departedAt) ? (
            <button className="btn-ghost" style={{ marginTop: 10 }} disabled={busy}
              onClick={() => corre(async () => finishStop({ ...(await ubicacion()) }))}>
              {t("emp.trip.leavingStop")}
            </button>
          ) : (
            <>
              <div className="row" style={{ marginTop: 10 }}>
                <input value={parada} onChange={(e) => setParada(e.target.value)} placeholder={t("emp.trip.stopNamePh")} />
                {/* El nombre va primero y es obligatorio: el servidor rechaza una parada sin nombre
                    (antes el campo decía «opcional» y el botón fallaba). Con nombre, el botón abre
                    la cámara; la parada se guarda al volver con la foto. */}
                <button className="btn-ghost" disabled={busy || !parada.trim()} onClick={() => camara.current?.click()}>
                  📷 {t("emp.trip.arrivedStop")}
                </button>
              </div>
              <div className="hint">{t("emp.trip.stopPhotoHint")}</div>
              {/* capture="environment": la cámara trasera en el móvil; en un ordenador, un fichero. */}
              <input ref={camara} type="file" accept="image/*" capture="environment" hidden onChange={alTomarFoto} />
            </>
          )}

          <div className="hr" />
          <div className="grid g2">
            {d.trip.vehicleId && (
              <div>
                <label>{t("emp.trip.odoIn")}</label>
                <input inputMode="numeric" value={odoFin} onChange={(e) => setOdoFin(e.target.value)} placeholder={t("emp.trip.miles")} />
              </div>
            )}
          </div>
          <button
            className="btn-danger"
            style={{ marginTop: 10 }}
            disabled={busy}
            onClick={() => {
              const a = num(odoIni), b = num(odoFin);
              // Se avisa, no se bloquea: un dígito mal tecleado se corrige, pero pasar de
              // largo dejaría una diferencia negativa en la factura.
              if (a != null && b != null && b < a) {
                setAviso(t("emp.trip.odoWarn", { a, b }));
                return;
              }
              setAviso(null);
              void corre(async () => endTrip({ odometer: num(odoFin), ...(await ubicacion()) }));
            }}
          >
            {t("emp.trip.end")}
          </button>
        </>
      )}
    </div>
  );
}
