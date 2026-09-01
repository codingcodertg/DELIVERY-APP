"use client";

import { useEffect, useMemo, useState } from "react";
import { useData } from "@/lib/data-provider";
import { usePrefs } from "@/lib/prefs";
import { MapView, type MapPoint } from "@/components/MapView";
import { downloadCSV, toCSV } from "@/lib/utils";

// ============================================================
// Market Map — a live view of the flooring market across Hidalgo + Cameron
// counties, pulled in real time from OpenStreetMap (via /api/places), not a
// static list. Rodriguez Tile Group locations stand out in blue; competitors
// red; big-box secondary sellers (Home Depot / Lowe's) orange; hardware /
// building-supply partnership prospects green.
// ============================================================

type Klass = "rtg" | "competitor" | "bigbox" | "hardware";

interface Place {
  id: string;
  name: string;
  lat: number;
  lng: number;
  shop: string | null;
  brand: string | null;
  city: string | null;
  phone: string | null;
  rating: number | null;
  address: string | null;
  website?: string | null;
  ratingCount?: number | null;
  mapsUri?: string | null;
  status?: string | null;
  hours?: string[] | null;
  /** Which query layer this came from (flooring / bigbox / hardware). */
  cat?: string;
}

type SortKey = "name" | "type" | "city" | "rating" | "distance";

function haversineMiles(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 3958.8;
  const toRad = (x: number) => (x * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

const COLORS: Record<Klass, string> = {
  rtg: "#2456c9",        // blue — us
  competitor: "#d64545", // red — dedicated flooring competitors
  bigbox: "#d1782e",     // orange — big-box secondary sellers
  hardware: "#1f9d61",   // green — hardware / prospects
};

const KLASS_LABEL: Record<Klass, { en: string; es: string }> = {
  rtg: { en: "Rodriguez Tile Group", es: "Rodriguez Tile Group" },
  competitor: { en: "Flooring competitor", es: "Competidor de pisos" },
  bigbox: { en: "Big-box (also sells flooring)", es: "Grande tienda (también vende pisos)" },
  hardware: { en: "Hardware / prospect", es: "Ferretería / prospecto" },
};
const KLASS_ORDER: Klass[] = ["rtg", "competitor", "bigbox", "hardware"];

type Status = "contacted" | "interested" | "partner" | "not_interested";
const STATUS_META: Record<Status, { en: string; es: string; color: string }> = {
  contacted: { en: "Contacted", es: "Contactado", color: "#6b7686" },
  interested: { en: "Interested", es: "Interesado", color: "#e9a13b" },
  partner: { en: "Partner", es: "Socio", color: "#1f9d61" },
  not_interested: { en: "Not interested", es: "No interesado", color: "#d64545" },
};
const STATUS_ORDER: Status[] = ["contacted", "interested", "partner", "not_interested"];

function classify(p: Place): Klass {
  const n = p.name.toLowerCase();
  const b = (p.brand ?? "").toLowerCase();
  if (n.includes("rodriguez tile") || b.includes("rodriguez tile")) return "rtg";
  // Big-box by name or by source (shop=doityourself / the "bigbox" query layer).
  if (n.includes("home depot") || n.includes("lowe") || p.shop === "doityourself" || p.cat === "bigbox") return "bigbox";
  // Hardware by tag or by source layer.
  if (["hardware", "trade", "building_materials", "paint"].includes(p.shop ?? "") || p.cat === "hardware") return "hardware";
  return "competitor"; // dedicated flooring
}

export default function MarketPage() {
  const { me, settings, saveSettings } = useData();
  const { t } = usePrefs();
  const [places, setPlaces] = useState<Place[]>([]);
  // The company's own stores are Rodriguez Tile Group — always shown in blue,
  // geocoded from Settings, independent of the live places source.
  const [storePlaces, setStorePlaces] = useState<Place[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [show, setShow] = useState<Record<Klass, boolean>>({ rtg: true, competitor: true, bigbox: true, hardware: true });
  const [q, setQ] = useState("");
  const [view, setView] = useState<"list" | "city" | "type">("list");
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "name", dir: 1 });
  const [selId, setSelId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<"all" | "tagged" | Status>("all");

  const load = async () => {
    setLoading(true);
    setErr(null);
    try {
      // Sequential (not parallel) so the free Overpass service doesn't rate-limit us.
      const cats = ["flooring", "bigbox", "hardware"];
      const byId = new Map<string, Place>();
      let anyOk = false;
      for (const c of cats) {
        const r = await fetch(`/api/places?category=${c}`).then((res) => res.json()).catch(() => ({ error: "fetch" }));
        if (!r.error) anyOk = true;
        for (const p of (r.places ?? []) as Place[]) {
          if (!byId.has(p.id)) byId.set(p.id, { ...p, cat: c }); // first layer wins the tag
        }
        setPlaces([...byId.values()]); // progressive: show each layer as it lands
      }
      if (!anyOk) setErr(t("Couldn't reach the live places service. Try Refresh.", "No se pudo consultar el servicio en vivo. Use Actualizar."));
    } catch {
      setErr(t("Network error — try again.", "Error de red — intente de nuevo."));
    } finally {
      setLoading(false);
    }
  };

  // El silenciador estaba DENTRO del cuerpo del efecto, así que apuntaba a la línea
  // siguiente y no a la lista de dependencias: nunca silenció nada. Se veía en cuanto
  // hubo un linter (D-154). Aquí la intención es correcta —cargar una vez al montar— y
  // añadir `load` a las dependencias lo volvería a lanzar en cada render.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, []);

  // Geocode the company's own stores → blue RTG markers.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const out: Place[] = [];
      for (const s of settings.stores) {
        const addr = (s.address || s.name || "").trim();
        if (!addr) continue;
        try {
          const res = await fetch("/api/geocode-point", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ address: `${addr}, TX` }) });
          if (!res.ok) continue;
          const p = await res.json();
          if (!cancelled && typeof p?.lat === "number" && typeof p?.lng === "number") {
            out.push({ id: `store:${s.name}`, name: `Rodriguez Tile Group — ${s.name}`, lat: p.lat, lng: p.lng, shop: null, brand: "Rodriguez Tile", city: s.name, phone: null, rating: null, address: s.address || null });
          }
        } catch { /* skip */ }
      }
      if (!cancelled) setStorePlaces(out);
    })();
    return () => { cancelled = true; };
  }, [settings.stores]);

  const classed = useMemo(() => {
    // If the live source already returned an RTG location near one of our own
    // stores, drop the store overlay there to avoid a duplicate blue pin.
    const liveRtg = places.filter((p) => p.name.toLowerCase().includes("rodriguez tile"));
    const merged = [...storePlaces, ...places].filter((p) =>
      !p.id.startsWith("store:") ||
      !liveRtg.some((r) => Math.abs(r.lat - p.lat) < 0.008 && Math.abs(r.lng - p.lng) < 0.008),
    );
    return merged.map((p) => ({ ...p, klass: classify(p) }));
  }, [storePlaces, places]);
  const counts = useMemo(() => {
    const c: Record<Klass, number> = { rtg: 0, competitor: 0, bigbox: 0, hardware: 0 };
    for (const p of classed) c[p.klass]++;
    return c;
  }, [classed]);

  const shown = useMemo(() => classed.filter((p) => show[p.klass]), [classed, show]);
  const selected = useMemo(() => classed.find((p) => p.id === selId) ?? null, [classed, selId]);

  // Distance (mi) from each place to the nearest RTG store.
  const distById = useMemo(() => {
    const m = new Map<string, { miles: number; store: string }>();
    if (!storePlaces.length) return m;
    for (const p of classed) {
      let best = Infinity;
      let name = "";
      for (const s of storePlaces) {
        const d = haversineMiles(p.lat, p.lng, s.lat, s.lng);
        if (d < best) { best = d; name = s.city ?? s.name; }
      }
      m.set(p.id, { miles: Math.round(best * 10) / 10, store: name });
    }
    return m;
  }, [classed, storePlaces]);

  // Table: search across name/city/address/phone, then sort.
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const ps = settings.prospect_status ?? {};
    return shown.filter((p) => {
      if (statusFilter !== "all") {
        const st = ps[p.id]?.status;
        if (statusFilter === "tagged" ? !st : st !== statusFilter) return false;
      }
      if (!needle) return true;
      return (
        p.name.toLowerCase().includes(needle) ||
        (p.city || "").toLowerCase().includes(needle) ||
        (p.address || "").toLowerCase().includes(needle) ||
        (p.phone || "").toLowerCase().includes(needle)
      );
    });
  }, [shown, q, statusFilter, settings.prospect_status]);

  const sorted = useMemo(() => {
    const { key, dir } = sort;
    return [...filtered].sort((a, b) => {
      const av = key === "name" ? a.name.toLowerCase()
        : key === "city" ? (a.city || "~").toLowerCase()
        : key === "type" ? a.klass
        : key === "distance" ? (distById.get(a.id)?.miles ?? Infinity)
        : (a.rating ?? -1);
      const bv = key === "name" ? b.name.toLowerCase()
        : key === "city" ? (b.city || "~").toLowerCase()
        : key === "type" ? b.klass
        : key === "distance" ? (distById.get(b.id)?.miles ?? Infinity)
        : (b.rating ?? -1);
      return av < bv ? -dir : av > bv ? dir : a.name.localeCompare(b.name);
    });
  }, [filtered, sort, distById]);

  const toggleSort = (key: SortKey) =>
    setSort((s) => (s.key === key ? { key, dir: (s.dir === 1 ? -1 : 1) as 1 | -1 } : { key, dir: 1 }));

  const prospects = settings.prospect_status ?? {};
  const setStatus = (id: string, s: Status | "") => {
    const next = { ...prospects };
    if (!s) delete next[id];
    else next[id] = { status: s, note: next[id]?.note ?? null, updated_at: new Date().toISOString(), updated_by: me?.id ?? null };
    saveSettings({ prospect_status: next });
  };
  const setNote = (id: string, note: string) => {
    const trimmed = note.trim() || null;
    const cur = prospects[id];
    if (!cur && !trimmed) return;
    saveSettings({ prospect_status: { ...prospects, [id]: { status: cur?.status ?? "contacted", note: trimmed, updated_at: new Date().toISOString(), updated_by: me?.id ?? null } } });
  };

  const exportCsv = () => {
    const headers = ["Name", "Type", "Status", "Note", "City", "Rating", "Reviews", "Distance (mi)", "Phone", "Website", "Address"];
    const ps = settings.prospect_status ?? {};
    const rows = sorted.map((p) => [
      p.name,
      t(KLASS_LABEL[p.klass].en, KLASS_LABEL[p.klass].es),
      ps[p.id] ? t(STATUS_META[ps[p.id]!.status].en, STATUS_META[ps[p.id]!.status].es) : "",
      ps[p.id]?.note ?? "",
      p.city ?? "",
      p.rating != null ? p.rating.toFixed(1) : "",
      p.ratingCount != null ? p.ratingCount : "",
      p.klass !== "rtg" && distById.get(p.id) ? distById.get(p.id)!.miles : "",
      p.phone ?? "",
      p.website ?? "",
      p.address ?? "",
    ]);
    downloadCSV(`market_map_${new Date().toISOString().slice(0, 10)}.csv`, toCSV(headers, rows));
  };

  const points: MapPoint[] = useMemo(
    () => shown.map((p) => ({
      id: p.id,
      lat: p.lat,
      lng: p.lng,
      color: COLORS[p.klass],
      label: `${p.name}${p.city ? ` — ${p.city}` : ""}${p.phone ? ` — ${p.phone}` : ""}`,
    })),
    [shown],
  );
  const fitTo = useMemo<[number, number][]>(() => points.map((p) => [p.lat, p.lng] as [number, number]), [points]);

  const legend = KLASS_ORDER.map((k) => ({ k, en: KLASS_LABEL[k].en, es: KLASS_LABEL[k].es }));

  // A reusable row for the tables (list + grouped views).
  const Row = ({ p }: { p: Place & { klass: Klass } }) => (
    <tr className={"clickable" + (selId === p.id ? " row-selected" : "")} style={{ cursor: "pointer" }} onClick={() => setSelId(p.id)}>
      <td style={{ fontWeight: 700 }}>
        <span style={{ display: "inline-block", width: 9, height: 9, borderRadius: "50%", background: COLORS[p.klass], marginRight: 7, verticalAlign: "middle" }} />
        {p.name}
        {prospects[p.id] && <span className="sema" style={{ background: STATUS_META[prospects[p.id]!.status].color, color: "#fff", marginLeft: 6 }}>{t(STATUS_META[prospects[p.id]!.status].en, STATUS_META[prospects[p.id]!.status].es)}</span>}
      </td>
      <td>{t(KLASS_LABEL[p.klass].en, KLASS_LABEL[p.klass].es)}</td>
      <td>{p.city || "—"}</td>
      <td style={{ fontVariantNumeric: "tabular-nums" }}>{p.rating != null ? `★ ${p.rating.toFixed(1)}` : "—"}</td>
      <td style={{ fontVariantNumeric: "tabular-nums" }}>{p.klass !== "rtg" && distById.get(p.id) ? `${distById.get(p.id)!.miles} mi` : "—"}</td>
      <td>{p.phone ? <a className="link-tel" href={`tel:${p.phone}`}>{p.phone}</a> : "—"}</td>
      <td><a href={`https://www.google.com/maps/search/?api=1&query=${p.lat},${p.lng}`} target="_blank" rel="noopener noreferrer" title={t("Open in Maps", "Abrir en Mapas")}>🧭</a></td>
    </tr>
  );

  if (!me) return null;
  if (me.role !== "admin") {
    return <div className="empty">{t("Not available for your role.", "No disponible para su rol.")}</div>;
  }

  return (
    <>
      <div className="page-head">
        <h2>{t("Market Map", "Mapa de Mercado")} <span className="count-tag">{classed.length}</span></h2>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          {legend.map((l) => (
            <button
              key={l.k}
              className={"btn btn-sm " + (show[l.k] ? "btn-primary" : "btn-ghost")}
              onClick={() => setShow((s) => ({ ...s, [l.k]: !s[l.k] }))}
              title={t("Toggle on the map", "Mostrar/ocultar en el mapa")}
            >
              <span style={{ display: "inline-block", width: 10, height: 10, borderRadius: "50%", background: COLORS[l.k], marginRight: 6, verticalAlign: "middle", boxShadow: "0 0 0 1px var(--line)" }} />
              {t(l.en, l.es)} ({counts[l.k]})
            </button>
          ))}
          <button className="btn btn-ghost btn-sm" onClick={load} disabled={loading}>
            {loading ? `… ${t("Loading", "Cargando")}` : `↻ ${t("Refresh (live)", "Actualizar (en vivo)")}`}
          </button>
        </div>
      </div>

      <p className="hint" style={{ marginTop: -6 }}>
        {t(
          "Live from OpenStreetMap across Hidalgo & Cameron counties — reflects what's mapped there today, and grows as more is added.",
          "En vivo desde OpenStreetMap en los condados de Hidalgo y Cameron — refleja lo que está mapeado hoy y crece a medida que se agrega más.",
        )}
      </p>

      {err && <div className="card" style={{ borderColor: "var(--red)" }}>{err}</div>}

      <div className="card" style={{ padding: 0, overflow: "hidden" }}>
        <MapView points={points} fitTo={fitTo.length ? fitTo : undefined} height={520} onPointClick={(id) => setSelId(id)} />
      </div>

      {selected && (
        <div className="card">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8, flexWrap: "wrap" }}>
            <h2 style={{ margin: 0 }}>
              <span style={{ display: "inline-block", width: 12, height: 12, borderRadius: "50%", background: COLORS[selected.klass], marginRight: 8, verticalAlign: "middle", boxShadow: "0 0 0 1px var(--line)" }} />
              {selected.name}
            </h2>
            <button className="btn btn-ghost btn-sm" onClick={() => setSelId(null)}>✕ {t("Close", "Cerrar")}</button>
          </div>
          <div style={{ marginTop: 4 }}>
            <span className="sema" style={{ background: COLORS[selected.klass], color: "#fff" }}>{t(KLASS_LABEL[selected.klass].en, KLASS_LABEL[selected.klass].es)}</span>
            {selected.status && selected.status !== "OPERATIONAL" && (
              <span className="sema" style={{ background: "var(--red)", color: "#fff", marginLeft: 6 }}>
                {selected.status === "CLOSED_TEMPORARILY" ? t("Temporarily closed", "Cerrado temporalmente") : t("Closed", "Cerrado")}
              </span>
            )}
          </div>

          <div style={{ marginTop: 12 }}>
            {selected.rating != null && (
              <div className="detail-row"><span className="dk">{t("Rating", "Calificación")}</span>
                <span className="dv"><b>★ {selected.rating.toFixed(1)}</b>{selected.ratingCount != null ? ` (${selected.ratingCount} ${t("reviews", "reseñas")})` : ""}</span></div>
            )}
            {selected.klass !== "rtg" && distById.get(selected.id) && (
              <div className="detail-row"><span className="dk">{t("Nearest store", "Tienda más cercana")}</span>
                <span className="dv"><b>{distById.get(selected.id)!.miles} mi</b> — {distById.get(selected.id)!.store}</span></div>
            )}
            <div className="detail-row"><span className="dk">{t("Address", "Dirección")}</span><span className="dv">{selected.address || selected.city || "—"}</span></div>
            {selected.city && <div className="detail-row"><span className="dk">{t("City", "Ciudad")}</span><span className="dv">{selected.city}</span></div>}
            {selected.phone && <div className="detail-row"><span className="dk">{t("Phone", "Teléfono")}</span><span className="dv"><a className="link-tel" href={`tel:${selected.phone}`}>{selected.phone}</a></span></div>}
            {selected.website && <div className="detail-row"><span className="dk">{t("Website", "Sitio web")}</span><span className="dv" style={{ overflow: "hidden", textOverflow: "ellipsis" }}><a href={selected.website} target="_blank" rel="noopener noreferrer">{selected.website.replace(/^https?:\/\//, "").replace(/\/$/, "")}</a></span></div>}
            {selected.hours && selected.hours.length > 0 && (
              <div className="detail-row"><span className="dk">{t("Hours", "Horario")}</span>
                <span className="dv" style={{ display: "grid", gap: 1 }}>{selected.hours.map((h, i) => <span key={i} style={{ fontSize: 12.5 }}>{h}</span>)}</span></div>
            )}
          </div>

          {selected.klass !== "rtg" && (
            <div style={{ marginTop: 14, paddingTop: 12, borderTop: "1px solid var(--line)" }}>
              <label style={{ fontSize: 12, color: "var(--gray)", textTransform: "uppercase", letterSpacing: ".04em" }}>{t("Prospect status", "Estado de prospecto")}</label>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6 }}>
                <button className={"btn btn-sm " + (!prospects[selected.id] ? "btn-primary" : "btn-ghost")} onClick={() => setStatus(selected.id, "")}>{t("None", "Ninguno")}</button>
                {STATUS_ORDER.map((s) => {
                  const on = prospects[selected.id]?.status === s;
                  return (
                    <button key={s} className="btn btn-sm" onClick={() => setStatus(selected.id, s)}
                      style={on ? { background: STATUS_META[s].color, color: "#fff", borderColor: STATUS_META[s].color } : { background: "var(--accent-soft)", color: "var(--text)" }}>
                      {t(STATUS_META[s].en, STATUS_META[s].es)}
                    </button>
                  );
                })}
              </div>
              <input
                defaultValue={prospects[selected.id]?.note ?? ""}
                key={selected.id}
                placeholder={t("Note (contact name, next step…)", "Nota (nombre de contacto, siguiente paso…)")}
                onBlur={(e) => { if ((e.target.value.trim() || null) !== (prospects[selected.id]?.note ?? null)) setNote(selected.id, e.target.value); }}
                style={{ marginTop: 8, maxWidth: 460 }}
              />
            </div>
          )}

          <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
            {selected.phone && <a className="btn btn-primary btn-sm" href={`tel:${selected.phone}`}>📞 {t("Call", "Llamar")}</a>}
            <a className="btn btn-ghost btn-sm" href={selected.mapsUri || `https://www.google.com/maps/search/?api=1&query=${selected.lat},${selected.lng}`} target="_blank" rel="noopener noreferrer">🧭 {t("Directions", "Cómo llegar")}</a>
            {selected.website && <a className="btn btn-ghost btn-sm" href={selected.website} target="_blank" rel="noopener noreferrer">🌐 {t("Website", "Sitio")}</a>}
          </div>
        </div>
      )}

      <div className="card">
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
          <h2 style={{ margin: 0 }}>📋 {t("Companies", "Empresas")} <span className="count-tag">{filtered.length}</span></h2>
          <span style={{ flex: 1 }} />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t("Search name / city / address / phone…", "Buscar nombre / ciudad / dirección / teléfono…")}
            style={{ maxWidth: 280 }}
          />
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)} style={{ width: "auto" }} title={t("Filter by prospect status", "Filtrar por estado de prospecto")}>
            <option value="all">{t("All statuses", "Todos los estados")}</option>
            <option value="tagged">{t("Any status", "Con estado")}</option>
            {STATUS_ORDER.map((s) => <option key={s} value={s}>{t(STATUS_META[s].en, STATUS_META[s].es)}</option>)}
          </select>
          <div className="toggle-group">
            <button className={"toggle-btn " + (view === "list" ? "on" : "")} onClick={() => setView("list")}>{t("List", "Lista")}</button>
            <button className={"toggle-btn " + (view === "city" ? "on" : "")} onClick={() => setView("city")}>{t("By city", "Por ciudad")}</button>
            <button className={"toggle-btn " + (view === "type" ? "on" : "")} onClick={() => setView("type")}>{t("By type", "Por tipo")}</button>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={exportCsv} disabled={!sorted.length} title={t("Export the filtered list to CSV", "Exportar la lista filtrada a CSV")}>
            ⬇ {t("Export CSV", "Exportar CSV")}
          </button>
        </div>

        {loading && filtered.length === 0 ? (
          <div className="empty">{t("Loading live data…", "Cargando datos en vivo…")}</div>
        ) : filtered.length === 0 ? (
          <div className="empty">{t("No companies match. Adjust filters or search.", "Nada coincide. Ajuste filtros o búsqueda.")}</div>
        ) : view === "list" ? (
          <div className="tbl-scroll" style={{ border: "none" }}>
            <table className="orders" style={{ minWidth: 620 }}>
              <thead>
                <tr>
                  {([["name", t("Company", "Empresa")], ["type", t("Type", "Tipo")], ["city", t("City", "Ciudad")], ["rating", t("Rating", "Calif.")], ["distance", t("Dist.", "Dist.")]] as [SortKey, string][]).map(([k, lbl]) => (
                    <th key={k} className="clickable" onClick={() => toggleSort(k)} style={{ cursor: "pointer", whiteSpace: "nowrap" }}>
                      {lbl}{sort.key === k ? (sort.dir === 1 ? " ▲" : " ▼") : ""}
                    </th>
                  ))}
                  <th>{t("Phone", "Teléfono")}</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((p) => <Row key={p.id} p={p} />)}
              </tbody>
            </table>
          </div>
        ) : (
          // Grouped by city or by type.
          (() => {
            const groups = new Map<string, (Place & { klass: Klass })[]>();
            for (const p of sorted) {
              const key = view === "city" ? (p.city || t("(unknown city)", "(ciudad desconocida)")) : t(KLASS_LABEL[p.klass].en, KLASS_LABEL[p.klass].es);
              (groups.get(key) ?? groups.set(key, []).get(key)!).push(p);
            }
            const keys = [...groups.keys()].sort((a, b) => groups.get(b)!.length - groups.get(a)!.length || a.localeCompare(b));
            return (
              <div style={{ display: "grid", gap: 16 }}>
                {keys.map((k) => (
                  <div key={k}>
                    <h3 style={{ margin: "0 0 6px", fontSize: 15 }}>
                      {view === "type" && groups.get(k)![0] && <span style={{ display: "inline-block", width: 10, height: 10, borderRadius: "50%", background: COLORS[groups.get(k)![0].klass], marginRight: 7, verticalAlign: "middle" }} />}
                      {k} <span className="count-tag">{groups.get(k)!.length}</span>
                    </h3>
                    <div className="tbl-scroll" style={{ border: "none" }}>
                      <table className="orders" style={{ minWidth: 620 }}>
                        <thead>
                          <tr>
                            <th>{t("Company", "Empresa")}</th><th>{t("Type", "Tipo")}</th><th>{t("City", "Ciudad")}</th>
                            <th>{t("Rating", "Calif.")}</th><th>{t("Dist.", "Dist.")}</th><th>{t("Phone", "Teléfono")}</th><th></th>
                          </tr>
                        </thead>
                        <tbody>{groups.get(k)!.map((p) => <Row key={p.id} p={p} />)}</tbody>
                      </table>
                    </div>
                  </div>
                ))}
              </div>
            );
          })()
        )}
      </div>
    </>
  );
}
