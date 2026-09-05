"use client";

import { useEffect, useMemo, useState } from "react";
import { useData } from "@/lib/data-provider";
import { usePrefs } from "@/lib/prefs";
import { createClient } from "@/lib/supabase/client";
import { MapView, type MapLine, type MapPoint } from "@/components/MapView";
import { useStoreMarkers } from "@/lib/useStoreMarkers";
import { orderLabel, todayISO, shiftDateISO, fmtDateShort } from "@/lib/utils";
import { centralWallToUtc } from "@/lib/clockin/tz";
import { nameStop, summarizeTrack, type Fix, type TrackSummary } from "@/lib/track-history";

// ============================================================
// A driver's day, after the fact: where the truck went, how far, how long it
// drove and how long it stood still.
//
// Rebuilt from position fixes, which the phone sends on MOVEMENT rather than
// on a clock. That makes this a reconstruction, not a recording, and the page
// is built to say so — an honest "we don't know" beats a confident number
// nobody should act on.
// ============================================================

/** How many days back the quick-pick strip reaches. */
const DAY_STRIP = 13;

function fmtMin(m: number): string {
  const n = Math.round(m);
  if (n < 60) return `${n} min`;
  const h = Math.floor(n / 60);
  const r = n % 60;
  return r ? `${h} h ${r} min` : `${h} h`;
}

function clock(iso: string | null, lang: string): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString(lang === "es" ? "es-MX" : "en-US", {
    hour: "2-digit", minute: "2-digit", timeZone: "America/Chicago",
  });
}

export default function TrackPage() {
  const { users, deliveries, settings, me } = useData();
  const { lang, t } = usePrefs();
  const drivers = useMemo(() => users.filter((u) => u.role === "driver"), [users]);

  const [driverId, setDriverId] = useState<string>("");
  const [date, setDate] = useState(todayISO());
  const [fixes, setFixes] = useState<Fix[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!driverId && drivers.length) setDriverId(drivers[0].id);
  }, [drivers, driverId]);

  useEffect(() => {
    if (!driverId) return;
    let cancelled = false;
    setLoading(true);
    setErr(null);
    (async () => {
      // The provider only keeps the last few hours for the live map, so the
      // history is fetched here for the day being looked at.
      const supabase = createClient();
      // Límites del día en hora de la empresa, con horario de verano (G-24, D-NEXT). Antes iba
      // `-05:00` fijo, que solo es Central en verano: de noviembre a marzo (CST, -06:00) las
      // fijaciones entre las 23:00 y la medianoche caían en el día equivocado, mientras la
      // tira de días de abajo clasifica con America/Chicago. Mismo helper DST-aware que el
      // fichaje (src/lib/clockin/tz.ts).
      const from = centralWallToUtc(`${date}T00:00`);
      const to = centralWallToUtc(`${shiftDateISO(date, 1)}T00:00`);
      const { data, error } = await supabase
        .from("driver_locations")
        .select("lat, lng, accuracy_m, recorded_at")
        .eq("driver_id", driverId)
        .gte("recorded_at", from)
        .lt("recorded_at", to)
        .order("recorded_at", { ascending: true })
        .limit(5000);
      if (cancelled) return;
      if (error) { setErr(error.message); setFixes([]); }
      else setFixes((data ?? []).map((r) => ({ lat: r.lat, lng: r.lng, accuracy_m: r.accuracy_m, at: r.recorded_at })));
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [driverId, date]);

  // Which of the recent days this driver actually reported on. A date picker
  // that lets you land on an empty day is a date picker that wastes clicks —
  // the strip below marks the days worth opening.
  const [daysWithData, setDaysWithData] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (!driverId) { setDaysWithData(new Set()); return; }
    let cancelled = false;
    (async () => {
      const supabase = createClient();
      const { data } = await supabase
        .from("driver_locations")
        .select("recorded_at")
        .eq("driver_id", driverId)
        .gte("recorded_at", centralWallToUtc(`${shiftDateISO(todayISO(), -DAY_STRIP)}T00:00`))
        .limit(20000);
      if (cancelled) return;
      const set = new Set<string>();
      for (const r of data ?? []) {
        // Business time, not the browser's: a fix at 7pm Chicago is still that
        // day even when the office reviewing it sits in another zone.
        set.add(new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago" }).format(new Date(r.recorded_at as string)));
      }
      setDaysWithData(set);
    })();
    return () => { cancelled = true; };
  }, [driverId]);

  const strip = useMemo(
    () => Array.from({ length: DAY_STRIP + 1 }, (_, i) => shiftDateISO(todayISO(), -i)),
    [],
  );

  const summary: TrackSummary = useMemo(() => summarizeTrack(fixes), [fixes]);

  const driverName = drivers.find((d) => d.id === driverId)?.full_name ?? "";

  // Somewhere to match a stop against: the day's delivery addresses, plus
  // every store.
  const places = useMemo(() => {
    const out: Array<{ label: string; lat: number; lng: number }> = [];
    for (const s of settings.stores) {
      if (s.lat != null && s.lng != null) out.push({ label: s.name, lat: s.lat, lng: s.lng });
    }
    for (const d of deliveries) {
      if (d.delivery_lat != null && d.delivery_lng != null) {
        out.push({ label: `#${orderLabel(d)}${d.account ? ` · ${d.account}` : ""}`, lat: d.delivery_lat, lng: d.delivery_lng });
      }
    }
    return out;
  }, [settings.stores, deliveries]);

  const storeMarkers = useStoreMarkers(settings.stores);

  // The traced path, broken at every stretch we couldn't read — a straight
  // line drawn across an unexplained hour would be a road the truck never took.
  const lines: MapLine[] = useMemo(() => {
    const segs: [number, number][][] = [];
    let cur: [number, number][] = [];
    for (let i = 0; i < fixes.length; i++) {
      const f = fixes[i];
      if (i > 0) {
        const mins = (new Date(f.at).getTime() - new Date(fixes[i - 1].at).getTime()) / 60_000;
        if (mins > 20) { if (cur.length > 1) segs.push(cur); cur = []; }
      }
      cur.push([f.lat, f.lng]);
    }
    if (cur.length > 1) segs.push(cur);
    return segs.map((positions, i) => ({ id: `seg${i}`, color: "#2456c9", positions }));
  }, [fixes]);

  const points: MapPoint[] = useMemo(
    () => summary.stops.map((s, i) => ({
      id: `stop${i}`,
      lat: s.at.lat,
      lng: s.at.lng,
      color: "#b06a12",
      label: `${nameStop(s, places) ?? t("Unnamed stop", "Parada sin nombre")} · ${fmtMin(s.minutes)}`,
      badge: String(i + 1),
    })),
    [summary.stops, places, t],
  );

  const done = useMemo(
    () => deliveries.filter((d) => d.assigned_driver === driverName && d.stage === "delivered" && (d.delivery_date ?? "").slice(0, 10) === date),
    [deliveries, driverName, date],
  );

  if (me && !["admin", "manager", "logistics"].includes(me.role)) {
    return <div className="card"><b>{t("Not available for your role.", "No disponible para su rol.")}</b></div>;
  }

  return (
    <>
      <div className="page-head">
        <h2>🛣 {t("Driver track", "Recorrido del chofer")}</h2>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <select value={driverId} onChange={(e) => setDriverId(e.target.value)} style={{ width: "auto" }}>
            {drivers.map((d) => <option key={d.id} value={d.id}>{d.full_name}</option>)}
          </select>
          <button className="btn btn-ghost btn-sm" title={t("Previous day", "Día anterior")}
            onClick={() => setDate((d) => shiftDateISO(d, -1))}>◀</button>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={{ width: "auto" }} />
          {/* Never past today: there is no track for a day that hasn't happened. */}
          <button className="btn btn-ghost btn-sm" disabled={date >= todayISO()} title={t("Next day", "Día siguiente")}
            onClick={() => setDate((d) => shiftDateISO(d, 1))}>▶</button>
          <button className="btn btn-ghost btn-sm" disabled={date === todayISO()}
            onClick={() => setDate(todayISO())}>{t("Today", "Hoy")}</button>
        </div>
      </div>

      {/* Two weeks at a glance. A day with no fixes is dimmed rather than
          hidden — knowing the driver reported nothing on Tuesday is itself
          the answer to a question, and hiding it would look like the day
          never existed. */}
      <div className="filters filters-oneline" style={{ marginBottom: 14 }}>
        {strip.map((d) => {
          const has = daysWithData.has(d);
          return (
            <button
              key={d}
              className={"chip" + (d === date ? " on" : "")}
              style={!has && d !== date ? { opacity: 0.45 } : undefined}
              title={has ? d : t(`${d} — nothing reported`, `${d} — sin reportes`)}
              onClick={() => setDate(d)}
            >
              {d === todayISO() ? t("Today", "Hoy") : fmtDateShort(d, lang)}
              {has && <span className="cnt">•</span>}
            </button>
          );
        })}
      </div>

      {err && <div className="card" style={{ borderColor: "var(--red)" }}><b style={{ color: "var(--red)" }}>{err}</b></div>}

      {/* What the numbers are worth, said before the numbers. A reader who
          scrolls past this would take a reconstruction for a measurement. */}
      {(summary.sparse || summary.teleports > 0) && summary.fixes > 0 && (
        <div className="card" style={{ background: "#fff7ec", borderColor: "var(--amber)" }}>
          <b style={{ color: "#b9791a" }}>⚠ {t("Read these as an outline, not a measurement", "Léalo como un bosquejo, no como una medición")}</b>
          <div className="hint" style={{ marginTop: 4 }}>
            {t(
              "The phone reports when the truck MOVES, not on a clock, so distance is measured in straight lines between scattered points and comes out lower than the road.",
              "El teléfono reporta cuando el camión SE MUEVE, no por reloj, así que la distancia se mide en línea recta entre puntos sueltos y sale menor que la carretera.",
            )}
            {summary.gaps > 0 && ` ${t(
              `${summary.gaps} stretch(es) had no fixes at all — the truck may have been parked, or the app asleep while it drove. Those minutes are counted as unknown rather than guessed.`,
              `${summary.gaps} tramo(s) no tuvieron ninguna posición — el camión pudo estar parado, o la app dormida mientras manejaba. Esos minutos se cuentan como sin determinar, no se adivinan.`,
            )}`}
          </div>
          {summary.teleports > 0 && (
            <div className="hint" style={{ marginTop: 6, color: "var(--red)", fontWeight: 700 }}>
              🚩 {t(
                `${summary.teleports} jump(s) too far to be driven were left out. That means positions from more than one device on this account, or a faked location — worth looking into.`,
                `Se excluyeron ${summary.teleports} salto(s) imposibles de recorrer. Eso significa posiciones de más de un dispositivo en esta cuenta, o una ubicación falseada — vale la pena revisarlo.`,
              )}
            </div>
          )}
        </div>
      )}

      <div className="grid g4" style={{ marginBottom: 14 }}>
        <div className="card" style={{ margin: 0 }}>
          <div className="hint" style={{ marginTop: 0 }}>{t("Distance", "Distancia")}</div>
          <div className="display" style={{ fontSize: 26, fontWeight: 800 }}>{summary.miles} mi</div>
        </div>
        <div className="card" style={{ margin: 0 }}>
          <div className="hint" style={{ marginTop: 0 }}>{t("Driving", "Manejando")}</div>
          <div className="display" style={{ fontSize: 26, fontWeight: 800 }}>{fmtMin(summary.movingMinutes)}</div>
        </div>
        <div className="card" style={{ margin: 0 }}>
          <div className="hint" style={{ marginTop: 0 }}>{t("Stopped", "Detenido")}</div>
          <div className="display" style={{ fontSize: 26, fontWeight: 800 }}>{fmtMin(summary.stoppedMinutes)}</div>
        </div>
        <div className="card" style={{ margin: 0, borderColor: summary.unknownMinutes > 0 ? "var(--amber)" : undefined }}>
          <div className="hint" style={{ marginTop: 0 }}>{t("Unaccounted for", "Sin determinar")}</div>
          <div className="display" style={{ fontSize: 26, fontWeight: 800, color: summary.unknownMinutes > 0 ? "#b9791a" : undefined }}>
            {fmtMin(summary.unknownMinutes)}
          </div>
        </div>
      </div>

      <div className="card">
        <h2>
          🗺 {t("Where the truck went", "Por dónde anduvo el camión")}
          <span className="count-tag">{summary.fixes} {t("fixes", "posiciones")}</span>
          {summary.firstAt && (
            <span className="hint" style={{ marginTop: 0 }}>
              {clock(summary.firstAt, lang)} – {clock(summary.lastAt, lang)}
            </span>
          )}
        </h2>
        {loading ? (
          <div className="empty">{t("Loading…", "Cargando…")}</div>
        ) : summary.fixes === 0 ? (
          <div className="empty">
            {t("No positions recorded that day.", "No se registraron posiciones ese día.")}
          </div>
        ) : (
          <MapView
            points={points}
            lines={lines}
            stores={storeMarkers}
            // Frame the whole day, not just the stops: a track with two long
            // stops and a lot of road between them would otherwise open zoomed
            // into one parking lot.
            fitTo={fixes.map((f) => [f.lat, f.lng] as [number, number])}
            height={420}
          />
        )}
      </div>

      <div className="card">
        <h2>⏸ {t("Stops", "Paradas")}<span className="count-tag">{summary.stops.length}</span></h2>
        {summary.stops.length === 0 ? (
          <div className="empty">{t("No stop long enough to record.", "Ninguna parada lo bastante larga para registrarse.")}</div>
        ) : (
          <div className="tbl-scroll">
            <table className="orders">
              <thead>
                <tr>
                  <th>#</th>
                  <th>{t("Where", "Dónde")}</th>
                  <th>{t("Arrived", "Llegó")}</th>
                  <th>{t("Left", "Salió")}</th>
                  <th>{t("Time there", "Tiempo ahí")}</th>
                </tr>
              </thead>
              <tbody>
                {summary.stops.map((s, i) => (
                  <tr key={i}>
                    <td>{i + 1}</td>
                    {/* Only named when a known address is genuinely close. A
                        stop labelled with a customer half a mile away would be
                        worse than no label. */}
                    <td>{nameStop(s, places) ?? <span className="hint">{t("Unnamed", "Sin nombre")}</span>}</td>
                    <td>{clock(s.from, lang)}</td>
                    <td>{clock(s.to, lang)}</td>
                    <td><b>{fmtMin(s.minutes)}</b></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card">
        <h2>✅ {t("Delivered that day", "Entregadas ese día")}<span className="count-tag">{done.length}</span></h2>
        {done.length === 0 ? (
          <div className="empty">{t("Nothing delivered.", "Nada entregado.")}</div>
        ) : (
          <div className="tbl-scroll">
            <table className="orders">
              <thead>
                <tr><th>#</th><th>{t("Account", "Cuenta")}</th><th>{t("Address", "Dirección")}</th><th>{t("Delivered", "Entregada")}</th></tr>
              </thead>
              <tbody>
                {done.map((d) => (
                  <tr key={d.id}>
                    <td className="ordno">#{orderLabel(d)}</td>
                    <td>{d.account || "—"}</td>
                    <td>{d.delivery_address || "—"}</td>
                    <td>{clock(d.pod_delivered_at, lang)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
