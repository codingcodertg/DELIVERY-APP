"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { clockIn, clockOut, getMyDay, type ClockInResult } from "@/app/timetracker/clock-in/actions/clock";
import { createClient } from "@/lib/clockin/supabase/client";
import { compressImage } from "@/lib/clockin/image";
import { fmtClock } from "@/lib/timetracker/helpers";

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
 * Lo que NO trae todavía: los viajes de vehículo y las salidas del sitio, que siguen en la
 * pantalla de fichaje. Están enlazados abajo, y se dice.
 */

const MOTIVOS: Record<string, { value: string; label: string }[]> = {
  offsite: [
    { value: "customer_visit", label: "Visiting a customer" },
    { value: "delivery", label: "On a delivery" },
    { value: "moving_between_stores", label: "Moving between stores" },
    { value: "personal_emergency", label: "Personal emergency" },
    { value: "other", label: "Other" },
  ],
  unscheduled: [
    { value: "covering_shift", label: "Covering a shift" },
    { value: "asked_to_come_in", label: "Asked to come in" },
    { value: "picking_up_extra", label: "Picking up extra hours" },
    { value: "forgot_on_schedule", label: "I should be on the schedule" },
    { value: "other", label: "Other" },
  ],
  other_site: [
    { value: "visiting_site", label: "Visiting another site" },
    { value: "helping_store", label: "Helping another store" },
    { value: "delivery_pickup", label: "Delivery or pickup" },
    { value: "covering_shift", label: "Covering a shift" },
    { value: "other", label: "Other" },
  ],
};

type Dia = Extract<Awaited<ReturnType<typeof getMyDay>>, { ok: true }>;

const hhmm = (iso: string) =>
  new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/Chicago" });
const horas = (min: number) => `${Math.floor(min / 60)}h ${String(min % 60).padStart(2, "0")}m`;

export function PunchPanel() {
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
      if (!navigator.geolocation) return reject(new Error("This device cannot report its location."));
      navigator.geolocation.getCurrentPosition(
        (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy }),
        () => reject(new Error("Location is required to punch. Allow it and try again.")),
        { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 },
      );
    });
  }

  async function subeFoto(file: File): Promise<string | null> {
    if (!d) return null;
    setPaso("Uploading the photo…");
    const supabase = createClient();
    const body = await compressImage(file);
    const path = `${d.companyId}/${d.userId}/${Date.now()}.jpg`;
    const r = await Promise.race([
      supabase.storage.from("exception-photos").upload(path, body, { contentType: "image/jpeg", upsert: false }),
      new Promise<"timeout">((res) => setTimeout(() => res("timeout"), 30000)),
    ]);
    if (r === "timeout") { setErr("The photo is taking too long — weak signal. Try again."); return null; }
    if (r.error) { setErr(r.error.message); return null; }
    return path;
  }

  async function ficha(accion: "in" | "out", photoPath?: string, razon?: string) {
    setErr(null);
    setOcupado(accion);
    try {
      setPaso("Getting your location…");
      const geo = await ubicacion();
      setPaso(accion === "in" ? "Clocking in…" : "Clocking out…");
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

  if (cargando) return <div className="card"><div className="hint">Loading…</div></div>;
  if (!d) return <div className="card"><div className="banner err">{err ?? "Could not read your day."}</div></div>;

  const dentro = !!d.open;
  const llevo = d.open ? Math.max(0, Math.floor((ahora - Date.parse(d.open.clockInAt)) / 1000)) : 0;

  return (
    <>
      <div className="card">
        <div className="between">
          <h2 style={{ margin: 0 }}>{dentro ? "You are on the clock" : "Clock in"}</h2>
          {dentro
            ? <span className="pill on">since {hhmm(d.open!.clockInAt)}</span>
            : <span className="pill wait">not clocked in</span>}
        </div>

        <div style={{ fontSize: 40, fontWeight: 800, letterSpacing: 1, margin: "8px 0" }}>
          {dentro ? fmtClock(llevo) : "0:00:00"}
        </div>

        {err && <div className="banner err">{err}</div>}
        {paso && <div className="hint">{paso}</div>}

        {pideMotivo ? (
          <div className="box" style={{ marginTop: 10 }}>
            <label>
              {pideMotivo === "offsite" ? "You are not at a job site. Why?"
                : pideMotivo === "unscheduled" ? "You are not on the schedule today. Why?"
                : "You are at a different site. Why?"}
            </label>
            <select value={motivo} onChange={(e) => setMotivo(e.target.value)}>
              <option value="">Pick a reason…</option>
              {MOTIVOS[pideMotivo].map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
            <div className="row" style={{ marginTop: 10 }}>
              <button disabled={!motivo || !!ocupado} onClick={() => ficha("in", undefined, motivo)}>Clock in</button>
              <button className="btn-ghost" onClick={() => { setPideMotivo(null); setMotivo(""); }}>Cancel</button>
            </div>
          </div>
        ) : (
          <div className="row" style={{ marginTop: 6 }}>
            {dentro
              ? <button className="btn-danger" disabled={!!ocupado} onClick={() => pide("out")}>
                  {ocupado === "out" ? "…" : "Clock out"}
                </button>
              : <button disabled={!!ocupado} onClick={() => pide("in")}>
                  {ocupado === "in" ? "…" : "Clock in"}
                </button>}
          </div>
        )}

        {/* capture="environment" abre la cámara trasera directamente en el móvil; en un
            ordenador es un selector de fichero normal. */}
        <input ref={fotoRef} type="file" accept="image/*" capture="environment" hidden onChange={alElegirFoto} />
      </div>

      <div className="card">
        <div className="grid g2">
          <div className="stat">
            <div className="small muted">Today</div>
            <div style={{ fontSize: 24, fontWeight: 800 }}>{horas(d.todayMinutes)}</div>
          </div>
          <div className="stat">
            <div className="small muted">This pay week</div>
            <div style={{ fontSize: 24, fontWeight: 800 }}>{horas(d.weekMinutes)}</div>
          </div>
        </div>

        <h2 style={{ marginTop: 16 }}>Today&apos;s punches</h2>
        {d.today.length === 0 ? (
          <p className="muted">Nothing yet today.</p>
        ) : (
          <table>
            <thead><tr><th>In</th><th>Out</th><th style={{ textAlign: "right" }}>Worked</th></tr></thead>
            <tbody>
              {d.today.map((e) => (
                <tr key={e.id}>
                  <td className="nowrap">{hhmm(e.clockInAt)}</td>
                  <td className="nowrap">{e.clockOutAt ? hhmm(e.clockOutAt) : <span className="pill wait">open</span>}</td>
                  <td className="nowrap" style={{ textAlign: "right" }}>{horas(e.minutes)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
