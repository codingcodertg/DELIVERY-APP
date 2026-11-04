"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { soloActivos } from "@/lib/baja";
import { useData } from "@/lib/data-provider";
import { usePrefs } from "@/lib/prefs";
import { createClient } from "@/lib/supabase/client";
import { MapView, type LiveDriver, type MapLine, type MapPoint } from "@/components/MapView";
import { NOTA_TURNO_AUTOMATICO } from "@/lib/turno-automatico";
import { useStoreMarkers } from "@/lib/useStoreMarkers";
import { orderLabel, retentionFloorISO, seesAllHistory, todayISO, shiftDateISO, fmtDateShort } from "@/lib/utils";
import { centralWallToUtc } from "@/lib/clockin/tz";
import { nameStop, summarizeTrack, type Fix, type TrackSummary } from "@/lib/track-history";
import { PausasDelDia } from "@/components/PausasDelDia";
import { tramos } from "@/lib/tramos-del-recorrido";
import { colorDeChofer } from "@/lib/map-legend";
import { choferesEnVivo, etiquetaEnVivo, MINUTOS_EN_VIVO } from "@/lib/choferes-en-vivo";

// ============================================================
// A driver's day, after the fact: where the truck went, how far, how long it
// drove and how long it stood still.
//
// Rebuilt from position fixes. Since D-831 the phone sends one every 10 m or
// 5 s while moving and once a minute parked, so the line is close to the road;
// the page still says so when a day is sparse — an honest "we don't know" beats
// a confident number nobody should act on.
//
// D-833: como el Route Manager. Arriba, una tarjeta por chofer (color, en vivo o sin señal, turno de hoy, millas,
// cargas y entregas); el mapa con TODOS los recorridos del día y los camiones en vivo; se pulsa una tarjeta para ver
// a uno solo con su detalle y su reproducción. El dueño: «el mismo view de route manager: están los 3 conductores y
// yo le doy click para verlos y ver la ruta que hizo, y poder verlos live».
// ============================================================

/** How many days back the quick-pick strip reaches. */
const DAY_STRIP = 13;
/** D-832: a 10 m / 5 s (D-831) un día largo son ~6 000 posiciones por chofer; el tope de 5 000 cortaba la tarde. */
const FIXES_POR_DIA = 20_000;
/** D-833: «todos los choferes» en el selector. */
const TODOS = "todos";

type Turno = { driver_id: string; started_at: string; ended_at: string | null; note: string | null };
type Hito = { id: string; driver_id: string; kind: "picked_up" | "delivered"; at: string; delivery_id: string };
type DiaDeChofer = { fixes: Fix[]; turnos: Turno[]; hitos: Hito[] };
const DIA_VACIO: DiaDeChofer = { fixes: [], turnos: [], hitos: [] };

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
  const { users, deliveries, settings, me, realRole, driverLocations } = useData();
  const { lang, t } = usePrefs();
  const drivers = useMemo(() => soloActivos(users.filter((u) => u.role === "driver")), [users]); // D-707
  const nameById = useMemo(() => new Map(drivers.map((d) => [d.id, d.full_name])), [drivers]);
  const coloresDeChofer = settings.driver_colors;
  const color = useMemo(() => (nombre: string) => colorDeChofer(coloresDeChofer, nombre), [coloresDeChofer]);

  // D-833: nace con todos; una tarjeta lleva a uno solo, y volver a pulsarla (o «Todos») vuelve.
  const [driverId, setDriverId] = useState<string>(TODOS);
  const [date, setDate] = useState(todayISO());
  // La ventana también aquí (D-239). Es la decisión más discutible de la rama y va
  // dicha en la entrada: Recorrido es una herramienta de REVISIÓN, y acotarla a ayer
  // le quita a un gerente el «a ver qué pasó el martes pasado». Se acota igual porque
  // la regla del dueño no distingue pantallas, y quien planifica rutas —admin y
  // logística— la conserva entera.
  const veTodoElHistorial = seesAllHistory(realRole, me?.permissions);
  const pisoFecha = retentionFloorISO();
  const fecha = veTodoElHistorial || date >= pisoFecha ? date : pisoFecha;
  const esHoy = fecha === todayISO();
  const idsDelDia = useMemo(() => drivers.map((d) => d.id), [drivers]);
  const idsVisibles = useMemo(() => driverId === TODOS ? idsDelDia : [driverId], [driverId, idsDelDia]);

  // D-833: el día de CADA chofer (posiciones, turnos, cargas/entregas), se vea uno o todos. Se carga el día entero de
  // todos de una vez: así pasar de «todos» a uno no vuelve a leer nada.
  const [porChofer, setPorChofer] = useState<Record<string, DiaDeChofer>>({});
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!idsDelDia.length) return;
    let cancelled = false;
    setLoading(true);
    setErr(null);
    (async () => {
      // The provider only keeps the last few hours for the live map, so the
      // history is fetched here for the day being looked at.
      const supabase = createClient();
      // Límites del día en hora de la empresa, con horario de verano (G-24, D-198). Antes iba
      // `-05:00` fijo, que solo es Central en verano: de noviembre a marzo (CST, -06:00) las
      // fijaciones entre las 23:00 y la medianoche caían en el día equivocado, mientras la
      // tira de días de abajo clasifica con America/Chicago. Mismo helper DST-aware que el
      // fichaje (src/lib/clockin/tz.ts).
      const from = centralWallToUtc(`${fecha}T00:00`);
      const to = centralWallToUtc(`${shiftDateISO(fecha, 1)}T00:00`);
      const [{ data, error }, t1, h1] = await Promise.all([
        supabase.from("driver_locations").select("driver_id, lat, lng, accuracy_m, recorded_at").in("driver_id", idsDelDia)
          .gte("recorded_at", from).lt("recorded_at", to).order("recorded_at", { ascending: true }).limit(FIXES_POR_DIA * Math.max(1, idsDelDia.length)),
        supabase.from("driver_shifts").select("driver_id, started_at, ended_at, note").in("driver_id", idsDelDia)
          .gte("started_at", from).lt("started_at", to).order("started_at", { ascending: true }),
        supabase.from("order_events").select("id, kind, created_at, delivery_id, created_by").in("created_by", idsDelDia)
          .in("kind", ["picked_up", "delivered"]).gte("created_at", from).lt("created_at", to).order("created_at", { ascending: true }),
      ]);
      if (cancelled) return;
      const out: Record<string, DiaDeChofer> = {};
      for (const id of idsDelDia) out[id] = { fixes: [], turnos: [], hitos: [] };
      if (error) setErr(error.message);
      for (const r of (data ?? []) as { driver_id: string; lat: number; lng: number; accuracy_m: number | null; recorded_at: string }[]) {
        out[r.driver_id]?.fixes.push({ lat: r.lat, lng: r.lng, accuracy_m: r.accuracy_m, at: r.recorded_at });
      }
      for (const s of (t1.data ?? []) as Turno[]) out[s.driver_id]?.turnos.push(s);
      for (const e of (h1.data ?? []) as { id: string; kind: string; created_at: string; delivery_id: string; created_by: string }[]) {
        out[e.created_by]?.hitos.push({ id: e.id, driver_id: e.created_by, kind: e.kind as Hito["kind"], at: e.created_at, delivery_id: e.delivery_id });
      }
      setPorChofer(out);
      setCursor(null);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [idsDelDia, fecha]);

  // D-833: EN VIVO. El proveedor recibe cada posición nueva por realtime (`driverLocations`, la última por chofer);
  // si es de hoy y más nueva que la última de su recorrido, se cuelga al final: la línea crece sola.
  useEffect(() => {
    if (!esHoy || loading) return;
    setPorChofer((prev) => {
      let cambio = false;
      const next = { ...prev };
      for (const loc of driverLocations) {
        const dia = next[loc.driver_id];
        if (!dia) continue;
        const ultima = dia.fixes[dia.fixes.length - 1];
        if (ultima && new Date(loc.recorded_at).getTime() <= new Date(ultima.at).getTime()) continue;
        next[loc.driver_id] = { ...dia, fixes: [...dia.fixes, { lat: loc.lat, lng: loc.lng, accuracy_m: loc.accuracy_m, at: loc.recorded_at }] };
        cambio = true;
      }
      return cambio ? next : prev;
    });
  }, [driverLocations, esHoy, loading]);

  // Which of the recent days the drivers actually reported on. A date picker
  // that lets you land on an empty day is a date picker that wastes clicks —
  // the strip below marks the days worth opening.
  const [daysWithData, setDaysWithData] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (!idsVisibles.length) { setDaysWithData(new Set()); return; }
    let cancelled = false;
    (async () => {
      const supabase = createClient();
      // D-832: «qué días tienen recorrido» se lee de los TURNOS (una fila por día, D-831), no de las posiciones:
      // a 10 m / 5 s la tira de dos semanas serían ~80 000 filas (G-18 ya lo dejó como pendiente).
      const { data } = await supabase
        .from("driver_shifts")
        .select("started_at")
        .in("driver_id", idsVisibles)
        .gte("started_at", centralWallToUtc(`${shiftDateISO(todayISO(), -DAY_STRIP)}T00:00`))
        .order("started_at", { ascending: false })
        .limit(500);
      if (cancelled) return;
      const set = new Set<string>();
      for (const r of data ?? []) {
        // Business time, not the browser's: a fix at 7pm Chicago is still that
        // day even when the office reviewing it sits in another zone.
        set.add(new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago" }).format(new Date(r.started_at as string)));
      }
      setDaysWithData(set);
    })();
    return () => { cancelled = true; };
  }, [idsVisibles]);

  const strip = useMemo(
    () => Array.from({ length: DAY_STRIP + 1 }, (_, i) => shiftDateISO(todayISO(), -i)),
    [],
  );

  // Lo del chofer que se mira (uno solo); con «todos», lo de todos donde tenga sentido.
  const unSolo = driverId !== TODOS;
  const dia: DiaDeChofer = porChofer[driverId] ?? DIA_VACIO;
  const fixes = dia.fixes;
  const turnos = dia.turnos;
  const hitos = useMemo(
    () => unSolo ? dia.hitos : idsVisibles.flatMap((id) => porChofer[id]?.hitos ?? []).sort((a, b) => a.at.localeCompare(b.at)),
    [unSolo, dia.hitos, idsVisibles, porChofer],
  );
  const summary: TrackSummary = useMemo(() => summarizeTrack(fixes), [fixes]);
  const driverName = nameById.get(driverId) ?? "";

  // D-833: la tarjeta de cada chofer: lo de hoy de un vistazo.
  const tarjetas = useMemo(() => {
    const ahora = Date.now();
    return drivers.map((d) => {
      const x = porChofer[d.id] ?? DIA_VACIO;
      const loc = driverLocations.find((l) => l.driver_id === d.id);
      const minutos = loc ? (ahora - new Date(loc.recorded_at).getTime()) / 60_000 : null;
      const turnoAbierto = x.turnos.find((s) => !s.ended_at) ?? null;
      const resumen = summarizeTrack(x.fixes);
      return {
        id: d.id, nombre: d.full_name, color: color(d.full_name),
        enVivo: esHoy && minutos != null && minutos <= MINUTOS_EN_VIVO, minutos,
        turnoAbierto, turnos: x.turnos, millas: resumen.miles,
        cargas: x.hitos.filter((h) => h.kind === "picked_up").length, entregas: x.hitos.filter((h) => h.kind === "delivered").length,
      };
    });
  }, [drivers, porChofer, driverLocations, esHoy, color]);

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

  // Las líneas: una por chofer visible, con su color (el mismo del Route Manager, D-274). Pulsar una lleva a ese chofer.
  const lines: MapLine[] = useMemo(() => idsVisibles.flatMap((id) => {
    const nombre = nameById.get(id) ?? "";
    // D-835: lo que no se sabe va punteado y gris, no como una calle recta.
    return tramos(porChofer[id]?.fixes ?? []).map((t, i) => ({ id: `${id}:seg${i}`, color: t.hueco ? "#8a94a0" : unSolo ? "#2456c9" : color(nombre), positions: t.positions, dashed: t.hueco }));
  }), [idsVisibles, porChofer, nameById, unSolo, color]);

  const points: MapPoint[] = useMemo(
    () => unSolo ? summary.stops.map((s, i) => ({
      id: `stop${i}`,
      lat: s.at.lat,
      lng: s.at.lng,
      color: "#b06a12",
      label: `${nameStop(s, places) ?? t("Unnamed stop", "Parada sin nombre")} · ${fmtMin(s.minutes)}`,
      badge: String(i + 1),
    })) : [],
    [unSolo, summary.stops, places, t],
  );

  const done = useMemo(
    () => deliveries.filter((d) => d.assigned_driver === driverName && d.stage === "delivered" && (d.delivery_date ?? "").slice(0, 10) === fecha),
    [deliveries, driverName, fecha],
  );

  // D-832: cargas y entregas que el chofer marcó, con la orden a la que pertenecen (si sigue cargada en pantalla).
  const hitosConOrden = useMemo(() => hitos.map((h) => {
    const d = deliveries.find((x) => x.id === h.delivery_id);
    const etiqueta = d ? `#${orderLabel(d)}${d.account ? ` · ${d.account}` : ""}` : t("order", "orden");
    const suyas = porChofer[h.driver_id]?.fixes ?? [];
    const fix = suyas.length ? suyas.reduce((mejor, f) => Math.abs(new Date(f.at).getTime() - new Date(h.at).getTime()) < Math.abs(new Date(mejor.at).getTime() - new Date(h.at).getTime()) ? f : mejor) : null;
    return { ...h, chofer: nameById.get(h.driver_id) ?? "", etiqueta, direccion: d?.delivery_address ?? null, lat: d?.delivery_lat ?? fix?.lat ?? null, lng: d?.delivery_lng ?? fix?.lng ?? null };
  }), [hitos, deliveries, porChofer, nameById, t]);
  const puntosDeHitos: MapPoint[] = useMemo(() => hitosConOrden.filter((h) => h.lat != null && h.lng != null).map((h) => ({
    id: `hito${h.id}`, lat: h.lat as number, lng: h.lng as number,
    color: h.kind === "delivered" ? "#15803d" : "#2456c9",
    label: `${h.kind === "delivered" ? t("Delivered", "Entregada") : t("Picked up", "Cargada")} ${h.etiqueta} · ${clock(h.at, lang)}${unSolo ? "" : ` · ${h.chofer}`}`,
    badge: h.kind === "delivered" ? "✓" : "▲",
  })), [hitosConOrden, t, lang, unSolo]);

  // D-832: reproducir el recorrido (solo con un chofer). `cursor` = hasta qué posición se pinta; null = el día entero.
  const [cursor, setCursor] = useState<number | null>(null);
  const [reproduciendo, setReproduciendo] = useState(false);
  const reproRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => { setCursor(null); setReproduciendo(false); }, [driverId]);
  useEffect(() => {
    if (!reproduciendo) { if (reproRef.current) clearInterval(reproRef.current); reproRef.current = null; return; }
    const paso = Math.max(1, Math.round(fixes.length / 400));
    reproRef.current = setInterval(() => {
      setCursor((c) => {
        const n = (c ?? 0) + paso;
        if (n >= fixes.length - 1) { setReproduciendo(false); return fixes.length - 1; }
        return n;
      });
    }, 50);
    return () => { if (reproRef.current) clearInterval(reproRef.current); };
  }, [reproduciendo, fixes.length]);
  const lineasVisibles: MapLine[] = useMemo(() => {
    if (!unSolo || cursor == null) return lines;
    return tramos(fixes.slice(0, cursor + 1)).map((t, i) => ({ id: `rep${i}`, color: t.hueco ? "#8a94a0" : "#2456c9", positions: t.positions, dashed: t.hueco }));
  }, [unSolo, cursor, fixes, lines]);

  // D-833: los camiones EN VIVO (la última posición de cada chofer visible, si es de hace menos de una hora). En la
  // reproducción, el camión naranja del momento elegido en su lugar.
  const camiones: LiveDriver[] = useMemo(() => {
    if (unSolo && cursor != null && fixes[cursor]) {
      const f = fixes[cursor];
      return [{ driver: driverName, lat: f.lat, lng: f.lng, color: "#d97706", accuracy_m: f.accuracy_m, label: clock(f.at, lang) }];
    }
    if (!esHoy) return [];
    const nombresVisibles = new Set(idsVisibles.map((id) => nameById.get(id)));
    return choferesEnVivo(driverLocations, nameById, color).filter((c) => nombresVisibles.has(c.driver)).map((c) => ({ ...c, label: etiquetaEnVivo(c, t) }));
  }, [unSolo, cursor, fixes, driverName, lang, esHoy, driverLocations, nameById, idsVisibles, t, color]);

  const todasLasPosiciones = useMemo(() => idsVisibles.flatMap((id) => (porChofer[id]?.fixes ?? []).map((f) => [f.lat, f.lng] as [number, number])), [idsVisibles, porChofer]);
  const totalPosiciones = todasLasPosiciones.length;

  return (
    <>
      <div className="page-head">
        <h2>🛣 {t("Driver track", "Recorrido del chofer")}</h2>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <select value={driverId} onChange={(e) => setDriverId(e.target.value)} style={{ width: "auto" }} data-selector-chofer>
            <option value={TODOS}>{t("All drivers", "Todos los choferes")}</option>
            {drivers.map((d) => <option key={d.id} value={d.id}>{d.full_name}</option>)}
          </select>
          <button className="btn btn-ghost btn-sm" title={t("Previous day", "Día anterior")}
            disabled={!veTodoElHistorial && fecha <= pisoFecha}
            onClick={() => setDate((d) => { const p = shiftDateISO(d, -1); return veTodoElHistorial || p >= pisoFecha ? p : d; })}>◀</button>
          <input type="date" value={fecha} min={veTodoElHistorial ? undefined : pisoFecha} onChange={(e) => setDate(e.target.value)} style={{ width: "auto" }} />
          {/* Never past today: there is no track for a day that hasn't happened. */}
          <button className="btn btn-ghost btn-sm" disabled={fecha >= todayISO()} title={t("Next day", "Día siguiente")}
            onClick={() => setDate((d) => shiftDateISO(d, 1))}>▶</button>
          <button className="btn btn-ghost btn-sm" disabled={esHoy}
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
              className={"chip" + (d === fecha ? " on" : "") + (!has && d !== fecha ? " chip-vacio" : "")}
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

      {/* D-833: una tarjeta por chofer, como las del Route Manager. Pulsar = ver solo a ese; otra vez = todos. */}
      <div data-bloque="choferes" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 10, marginBottom: 14 }}>
        {tarjetas.map((c) => {
          const elegido = driverId === c.id;
          return (
            <button key={c.id} type="button" className="card" data-chofer={c.id} data-elegido={elegido ? "si" : "no"}
              onClick={() => setDriverId(elegido ? TODOS : c.id)}
              style={{ margin: 0, textAlign: "left", cursor: "pointer", borderColor: elegido ? c.color : "var(--line)", boxShadow: elegido ? `0 0 0 2px ${c.color}` : undefined, opacity: driverId !== TODOS && !elegido ? .55 : 1 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ width: 12, height: 12, borderRadius: "50%", background: c.color, flex: "0 0 auto", boxShadow: "0 0 0 1px var(--line)" }} />
                <b style={{ flex: 1 }}>{c.nombre}</b>
                {c.enVivo
                  ? <span className="sema" data-en-vivo="si" style={{ background: "var(--tint-green)", color: "var(--green)", fontSize: 11 }}>🟢 {c.minutos != null && c.minutos < 1 ? t("live", "en vivo") : t(`${Math.round(c.minutos ?? 0)} min ago`, `hace ${Math.round(c.minutos ?? 0)} min`)}</span>
                  : esHoy ? <span className="sema" data-en-vivo="no" style={{ background: "var(--card)", color: "var(--gray)", fontSize: 11, border: "1px solid var(--line)" }}>⚪ {t("no signal", "sin señal")}</span> : null}
              </div>
              <div className="hint" style={{ marginTop: 6 }}>
                {c.turnoAbierto
                  ? <>⏱ {t("On shift since", "En turno desde")} {clock(c.turnoAbierto.started_at, lang)}</>
                  : c.turnos.length
                    ? <>⏱ {clock(c.turnos[0].started_at, lang)} – {clock(c.turnos[c.turnos.length - 1].ended_at, lang)}</>
                    : <>⏱ {t("No shift", "Sin turno")}</>}
              </div>
              <div className="hint" style={{ marginTop: 2 }}>
                🛣 {c.millas} mi · ▲ {c.cargas} · ✓ {c.entregas}
              </div>
            </button>
          );
        })}
        {tarjetas.length === 0 && <div className="hint">{t("No active drivers.", "No hay choferes activos.")}</div>}
      </div>

      {/* What the numbers are worth, said before the numbers. A reader who
          scrolls past this would take a reconstruction for a measurement. */}
      {unSolo && (summary.sparse || summary.teleports > 0) && summary.fixes > 0 && (
        <div className="card" style={{ background: "var(--amber-soft)", borderColor: "var(--amber)" }}>
          <b style={{ color: "var(--amber-text)" }}>⚠ {t("Read these as an outline, not a measurement", "Léalo como un bosquejo, no como una medición")}</b>
          <div className="hint" style={{ marginTop: 4 }}>
            {t(
              "Few positions came in that day, so distance is measured in straight lines between scattered points and comes out lower than the road.",
              "Ese día llegaron pocas posiciones, así que la distancia se mide en línea recta entre puntos sueltos y sale menor que la carretera.",
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

      {unSolo && (
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
            <div className="display" style={{ fontSize: 26, fontWeight: 800, color: summary.unknownMinutes > 0 ? "var(--amber-text)" : undefined }}>
              {fmtMin(summary.unknownMinutes)}
            </div>
          </div>
        </div>
      )}

      {/* D-832: el turno del día (D-831): de la primera carga a la última entrega. */}
      {unSolo && (
        <div className="card" data-bloque="turnos">
          <b>⏱ {t("Shift", "Turno")}</b>{" "}
          {turnos.length === 0 ? (
            <span className="hint">{t("No shift that day: the driver did not pick up anything from the app.", "Sin turno ese día: el chofer no cargó nada desde la app.")}</span>
          ) : turnos.map((s, i) => (
            <span key={i} style={{ marginLeft: 8 }}>
              {clock(s.started_at, lang)} – {s.ended_at ? clock(s.ended_at, lang) : <b style={{ color: "var(--green)" }}>{t("open", "abierto")}</b>}
              <span className="hint" style={{ marginLeft: 4 }}>
                {s.note === NOTA_TURNO_AUTOMATICO ? t("(automatic: first pickup → last delivery)", "(automático: primera carga → última entrega)") : t("(clocked in by hand)", "(marcado a mano)")}
              </span>
            </span>
          ))}
        </div>
      )}

      <div className="card">
        <h2>
          🗺 {unSolo ? t("Where the truck went", "Por dónde anduvo el camión") : t("Where the trucks went", "Por dónde anduvieron los camiones")}
          <span className="count-tag">{totalPosiciones} {t("fixes", "posiciones")}</span>
          {unSolo && summary.firstAt && (
            <span className="hint" style={{ marginTop: 0 }}>
              {clock(summary.firstAt, lang)} – {clock(summary.lastAt, lang)}
            </span>
          )}
          {esHoy && camiones.length > 0 && cursor == null && <span className="hint" style={{ marginTop: 0, color: "var(--green)" }}>● {t("live", "en vivo")}</span>}
        </h2>
        {loading ? (
          <div className="empty">{t("Loading…", "Cargando…")}</div>
        ) : totalPosiciones === 0 && camiones.length === 0 ? (
          <div className="empty">
            {t("No positions recorded that day.", "No se registraron posiciones ese día.")}
          </div>
        ) : (
          <>
          <MapView
            points={[...points, ...puntosDeHitos]}
            lines={lineasVisibles}
            liveDrivers={camiones}
            stores={storeMarkers}
            onLineClick={(id) => { const chofer = id.split(":")[0]; if (porChofer[chofer]) setDriverId(chofer); }}
            // Frame the whole day, not just the stops: a track with two long
            // stops and a lot of road between them would otherwise open zoomed
            // into one parking lot.
            fitTo={todasLasPosiciones.length ? todasLasPosiciones : camiones.map((c) => [c.lat, c.lng] as [number, number])}
            height={unSolo ? 420 : 520}
          />
          {/* D-832: reproducir el día. El camión naranja va por la línea; la barra deja ir a cualquier momento. */}
          {unSolo && fixes.length > 1 && (
            <div data-bloque="reproduccion" style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 8, flexWrap: "wrap" }}>
              <button className={"btn btn-sm " + (reproduciendo ? "btn-ghost" : "btn-primary")} data-accion="reproducir"
                onClick={() => { if (reproduciendo) setReproduciendo(false); else { if (cursor == null || cursor >= fixes.length - 1) setCursor(0); setReproduciendo(true); } }}>
                {reproduciendo ? "⏸ " + t("Pause", "Pausa") : "▶ " + t("Replay the day", "Reproducir el día")}
              </button>
              <input type="range" min={0} max={Math.max(0, fixes.length - 1)} value={cursor ?? fixes.length - 1} style={{ flex: 1, minWidth: 160 }}
                onChange={(e) => { setReproduciendo(false); setCursor(Number(e.target.value)); }} />
              <span className="hint" style={{ marginTop: 0, fontVariantNumeric: "tabular-nums", minWidth: 60 }}>{cursor != null && fixes[cursor] ? clock(fixes[cursor].at, lang) : clock(summary.lastAt, lang)}</span>
              {cursor != null && <button className="btn btn-ghost btn-sm" onClick={() => { setReproduciendo(false); setCursor(null); }}>{t("Whole day", "Día entero")}</button>}
            </div>
          )}
          {!unSolo && <div className="hint" style={{ marginTop: 6 }}>{t("Tap a driver card or a line to see just that driver, with the replay.", "Pulsa la tarjeta de un chofer o su línea para ver solo a ese, con la reproducción.")}</div>}
          </>
        )}
      </div>

      {/* D-832: lo que el chofer marcó, en orden: cada carga y cada entrega con su hora. Con «todos», las de todos con su chofer. */}
      <div className="card" data-bloque="hitos">
        <h2>🚚 {t("Pickups and deliveries", "Cargas y entregas")}<span className="count-tag">{hitosConOrden.length}</span></h2>
        {hitosConOrden.length === 0 ? (
          <div className="empty">{t("Nothing marked from the app that day.", "Nada marcado desde la app ese día.")}</div>
        ) : (
          <div className="tbl-scroll">
            <table className="orders">
              <thead><tr><th>{t("Time", "Hora")}</th>{!unSolo && <th>{t("Driver", "Chofer")}</th>}<th>{t("What", "Qué")}</th><th>{t("Order", "Orden")}</th><th>{t("Address", "Dirección")}</th></tr></thead>
              <tbody>
                {hitosConOrden.map((h) => (
                  <tr key={h.id}>
                    <td style={{ fontVariantNumeric: "tabular-nums" }}>{clock(h.at, lang)}</td>
                    {!unSolo && <td><span style={{ display: "inline-block", width: 9, height: 9, borderRadius: "50%", background: color(h.chofer), marginRight: 6 }} />{h.chofer}</td>}
                    <td>{h.kind === "delivered" ? <b style={{ color: "var(--green)" }}>✓ {t("Delivered", "Entregada")}</b> : <b style={{ color: "#2456c9" }}>▲ {t("Picked up", "Cargada")}</b>}</td>
                    <td className="ordno">{h.etiqueta}</td>
                    <td>{h.direccion ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Lo que el chofer DIJO (D-520, «⏸ Registrar parada» en «Mi ruta»): baño, gasolina con su recibo… Va antes de las
          paradas que se deducen del GPS, que son una reconstrucción. */}
      {unSolo && <PausasDelDia driverId={driverId} fecha={fecha} clock={(iso) => clock(iso, lang)} />}

      {unSolo && (
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
      )}

      {unSolo && (
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
      )}
    </>
  );
}
