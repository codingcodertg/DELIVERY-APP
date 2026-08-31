"use client";

import { useCallback, useEffect, useState } from "react";
import { getMyTrip, startTrip, endTrip, logStop, finishStop } from "@/app/timetracker/clock-in/actions/runner";

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
 */

type Data = Extract<Awaited<ReturnType<typeof getMyTrip>>, { ok: true }>;

const MOTIVOS = [
  { v: "delivery", l: "Delivery" },
  { v: "customer_visit", l: "Customer visit" },
  { v: "moving_between_stores", l: "Between stores" },
  { v: "pickup", l: "Pickup" },
  { v: "other", l: "Other" },
];

const hhmm = (iso: string) =>
  new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/Chicago" });

export function TripPanel() {
  const [d, setD] = useState<Data | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  const [vehiculo, setVehiculo] = useState("");
  const [personal, setPersonal] = useState(false);
  const [motivo, setMotivo] = useState("delivery");
  const [nota, setNota] = useState("");
  const [odoIni, setOdoIni] = useState("");
  const [odoFin, setOdoFin] = useState("");
  const [parada, setParada] = useState("");

  const load = useCallback(async () => {
    const r = await getMyTrip();
    if (!r.ok) { setErr(r.message); return; }
    setErr(null);
    setD(r);
    setVehiculo((v) => v || r.currentVehicleId || r.vehicles[0]?.id || "");
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function corre(fn: () => Promise<{ ok: boolean; message?: string }>) {
    setBusy(true);
    setErr(null);
    const r = await fn();
    setBusy(false);
    if (!r.ok) { setErr(r.message ?? "Could not save."); return false; }
    await load();
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

  return (
    <div className="card">
      <div className="between">
        <h2 style={{ margin: 0 }}>🚚 Vehicle trip</h2>
        {d.trip && <span className="pill on">on a trip · {hhmm(d.trip.startedAt)}</span>}
      </div>

      {err && <div className="banner err">{err}</div>}
      {aviso && <div className="banner warn">{aviso}</div>}

      {!d.trip ? (
        <>
          <label className="perm-opt" style={{ marginTop: 8 }}>
            <input type="checkbox" checked={personal} onChange={(e) => setPersonal(e.target.checked)} />
            My own vehicle (no odometer)
          </label>

          {!personal && (
            <div className="grid g2">
              <div>
                <label>Vehicle</label>
                <select value={vehiculo} onChange={(e) => setVehiculo(e.target.value)}>
                  {d.vehicles.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
                </select>
              </div>
              <div>
                <label>Odometer out</label>
                <input inputMode="numeric" value={odoIni} onChange={(e) => setOdoIni(e.target.value)} placeholder="miles" />
              </div>
            </div>
          )}

          <div className="grid g2">
            <div>
              <label>Reason</label>
              <select value={motivo} onChange={(e) => setMotivo(e.target.value)}>
                {MOTIVOS.map((m) => <option key={m.v} value={m.v}>{m.l}</option>)}
              </select>
            </div>
            {motivo === "other" && (
              <div>
                <label>Note</label>
                <input value={nota} onChange={(e) => setNota(e.target.value)} />
              </div>
            )}
          </div>

          <button
            style={{ marginTop: 12 }}
            disabled={busy || (!personal && !vehiculo)}
            onClick={() => corre(() => startTrip({
              kind: d.mode,
              personal,
              vehicleId: personal ? null : vehiculo,
              odometer: personal ? null : num(odoIni),
              reason: motivo,
              note: motivo === "other" ? nota || null : null,
            }))}
          >
            Start trip
          </button>
        </>
      ) : (
        <>
          {d.stops.length > 0 && (
            <table style={{ marginTop: 10 }}>
              <tbody>
                {d.stops.map((s) => (
                  <tr key={s.id}>
                    <td>{s.label || "Stop"}</td>
                    <td className="small muted nowrap">
                      {hhmm(s.arrivedAt)}{s.departedAt ? ` – ${hhmm(s.departedAt)}` : ""}
                    </td>
                    <td>{!s.departedAt && <span className="pill wait">here now</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {/* Llegar y salir de una parada son dos botones distintos a propósito: el tiempo
              EN la parada es el dato que se quiere, y un solo botón lo perdería. */}
          {d.stops.some((s) => !s.departedAt) ? (
            <button className="btn-ghost" style={{ marginTop: 10 }} disabled={busy}
              onClick={() => corre(() => finishStop({}))}>
              Leaving this stop
            </button>
          ) : (
            <div className="row" style={{ marginTop: 10 }}>
              <input value={parada} onChange={(e) => setParada(e.target.value)} placeholder="Stop name (optional)" />
              <button className="btn-ghost" disabled={busy}
                onClick={async () => { if (await corre(() => logStop({ label: parada || undefined }))) setParada(""); }}>
                Arrived at a stop
              </button>
            </div>
          )}

          <div className="hr" />
          <div className="grid g2">
            {d.trip.vehicleId && (
              <div>
                <label>Odometer in</label>
                <input inputMode="numeric" value={odoFin} onChange={(e) => setOdoFin(e.target.value)} placeholder="miles" />
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
                setAviso(`Odometer in (${b}) is lower than out (${a}). Check it before ending.`);
                return;
              }
              setAviso(null);
              void corre(() => endTrip({ odometer: num(odoFin) }));
            }}
          >
            End trip
          </button>
        </>
      )}
    </div>
  );
}
