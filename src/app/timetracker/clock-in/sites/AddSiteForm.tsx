"use client";

import { useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { addSite, updateSite } from "@/app/timetracker/clock-in/actions/sites";
import { t, type Lang } from "@/lib/clockin/i18n";
import { btn, field } from "@/lib/clockin/ui";

const BoundaryMap = dynamic(() => import("./BoundaryMap"), { ssr: false });

type LatLng = { lat: number; lng: number };
type Mode = "polygon" | "circle";
export type EditSite = {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  radius_meters: number;
  boundary: LatLng[] | null;
  padding_meters: number | null;
};

export default function AddSiteForm({
  lang,
  editSite = null,
  onDone,
}: {
  lang: Lang;
  editSite?: EditSite | null;
  onDone?: () => void;
}) {
  const tr = t(lang).mgr;
  const es = lang === "es";
  const router = useRouter();
  const hasPoly = !!editSite?.boundary && editSite.boundary.length >= 3;
  const [mode, setMode] = useState<Mode>(hasPoly ? "polygon" : editSite ? "circle" : "polygon");
  const [name, setName] = useState(editSite?.name ?? "");
  const [padding, setPadding] = useState(String(editSite?.padding_meters ?? 25));
  const [points, setPoints] = useState<LatLng[]>(hasPoly ? editSite!.boundary! : []);
  // circle fields
  const [radius, setRadius] = useState(String(editSite?.radius_meters ?? 100));
  const [lat, setLat] = useState(editSite && !hasPoly ? String(editSite.latitude) : "");
  const [lng, setLng] = useState(editSite && !hasPoly ? String(editSite.longitude) : "");
  const [busy, setBusy] = useState(false);
  const [geoBusy, setGeoBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  // In add mode the form is collapsed behind a button (so the map mounts fresh —
  // and sizes correctly — only when opened). Edit mode is always open.
  const [open, setOpen] = useState(!!editSite);
  // Address autocomplete → suggestions appear as you type; picking one recenters
  // the map. Uses Photon (a free OSM geocoder built for search-as-you-type),
  // biased toward the Rio Grande Valley so local addresses rank first.
  type Suggestion = { label: string; lat: number; lng: number };
  const [search, setSearch] = useState("");
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [focus, setFocus] = useState<LatLng | null>(null);
  const debRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function onSearchChange(val: string) {
    setSearch(val);
    if (debRef.current) clearTimeout(debRef.current);
    if (val.trim().length < 3) {
      setSuggestions([]);
      return;
    }
    debRef.current = setTimeout(() => fetchSuggestions(val.trim()), 280);
  }

  async function fetchSuggestions(q: string) {
    try {
      const r = await fetch(`https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&limit=6&lat=26.2&lon=-98.23`);
      const j = (await r.json()) as { features?: { geometry: { coordinates: [number, number] }; properties: Record<string, string> }[] };
      const feats = j.features ?? [];
      setSuggestions(
        feats.map((f) => {
          const p = f.properties ?? {};
          const [lon, lat] = f.geometry.coordinates;
          const line = [p.housenumber, p.street || p.name].filter(Boolean).join(" ");
          const place = [p.city || p.town || p.village || p.county, p.state].filter(Boolean).join(", ");
          const label = [line || p.name, place].filter(Boolean).join(", ") || p.name || `${lat.toFixed(4)}, ${lon.toFixed(4)}`;
          return { label, lat, lng: lon };
        }),
      );
    } catch {
      setSuggestions([]);
    }
  }

  function pickSuggestion(s: Suggestion) {
    setFocus({ lat: s.lat, lng: s.lng });
    setSearch(s.label);
    setSuggestions([]);
    if (mode === "circle") {
      setLat(s.lat.toFixed(6));
      setLng(s.lng.toFixed(6));
    }
  }

  function useMyLocation() {
    setGeoBusy(true);
    setError(null);
    if (!("geolocation" in navigator)) {
      setError(es ? "Este dispositivo no puede compartir ubicación." : "This device can't share location.");
      setGeoBusy(false);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLat(pos.coords.latitude.toFixed(6));
        setLng(pos.coords.longitude.toFixed(6));
        setGeoBusy(false);
      },
      () => {
        setError(es ? "No se pudo obtener tu ubicación — permite el acceso." : "Couldn't get your location — allow location access.");
        setGeoBusy(false);
      },
      { enableHighAccuracy: true, timeout: 10000 },
    );
  }

  async function save() {
    setError(null);
    setOk(false);
    if (!name.trim()) {
      setError(es ? "Ponle un nombre al sitio." : "Give the site a name.");
      return;
    }
    if (mode === "polygon" && points.length < 3) {
      setError(es ? "Toca al menos 3 esquinas en el mapa para trazar la propiedad." : "Tap at least 3 corners on the map to outline the property.");
      return;
    }
    setBusy(true);
    const payload =
      mode === "polygon"
        ? { name, boundary: points, padding: parseInt(padding || "25", 10), lat: 0, lng: 0, radius: 0 }
        : { name, lat: parseFloat(lat), lng: parseFloat(lng), radius: parseInt(radius || "100", 10) };
    const res = editSite ? await updateSite(editSite.id, payload) : await addSite(payload);
    setBusy(false);
    if (!res.ok) {
      setError(res.message);
      return;
    }
    setOk(true);
    if (editSite) {
      router.refresh();
      onDone?.();
      return;
    }
    setName("");
    setPoints([]);
    setLat("");
    setLng("");
    router.refresh();
  }

  // Center the map on the site being edited (so it shows the right place).
  const mapCenter: LatLng | null = editSite ? { lat: editSite.latitude, lng: editSite.longitude } : null;
  const laF = parseFloat(lat);
  const lnF = parseFloat(lng);
  const circlePoint: LatLng[] = Number.isFinite(laF) && Number.isFinite(lnF) ? [{ lat: laF, lng: lnF }] : [];

  // Collapsed add-site: just a button that reveals the full form on click.
  if (!editSite && !open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="w-full rounded-2xl border border-zinc-200 dark:border-zinc-800 px-5 py-4 flex items-center justify-between gap-2 bg-zinc-50 dark:bg-zinc-900/50 hover:bg-zinc-100 dark:hover:bg-zinc-900 transition-colors"
      >
        <span className="text-sm font-semibold uppercase tracking-wide text-zinc-500">➕ {tr.addJobSite}</span>
        <span className="text-zinc-400">▾</span>
      </button>
    );
  }

  return (
    <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 p-5 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">{editSite ? tr.editSite : tr.addJobSite}</h2>
        <div className="flex items-center gap-2">
        <div className="flex rounded-lg border border-zinc-300 dark:border-zinc-700 overflow-hidden text-sm font-medium">
          <button
            onClick={() => setMode("polygon")}
            className={`px-4 py-2 transition-colors ${mode === "polygon" ? "bg-emerald-600 text-white" : "hover:bg-zinc-100 dark:hover:bg-zinc-800"}`}
          >
            {tr.propertyOutline}
          </button>
          <button
            onClick={() => setMode("circle")}
            className={`px-4 py-2 transition-colors ${mode === "circle" ? "bg-emerald-600 text-white" : "hover:bg-zinc-100 dark:hover:bg-zinc-800"}`}
          >
            {tr.singlePoint}
          </button>
        </div>
        {!editSite && (
          <button onClick={() => setOpen(false)} aria-label="Collapse" className="text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 px-1 text-lg leading-none">
            ▴
          </button>
        )}
        </div>
      </div>

      <label className="flex flex-col gap-1">
        <span className="text-xs text-zinc-500">{tr.siteName}</span>
        <input value={name} onChange={(e) => setName(e.target.value)} className={field} placeholder={tr.siteNamePlaceholder} />
      </label>

      {/* Address autocomplete — type and pick from live suggestions. */}
      <div className="relative">
        <input
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && suggestions[0]) {
              e.preventDefault();
              pickSuggestion(suggestions[0]);
            }
          }}
          placeholder={`🔍 ${tr.searchAddress}`}
          className={field}
          autoComplete="off"
        />
        {suggestions.length > 0 && (
          <ul className="absolute z-[500] left-0 right-0 mt-1 max-h-64 overflow-auto rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 shadow-xl">
            {suggestions.map((s, i) => (
              <li key={i} className="border-t border-zinc-100 dark:border-zinc-800 first:border-0">
                <button
                  type="button"
                  onClick={() => pickSuggestion(s)}
                  className="w-full text-left px-4 py-2.5 text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800"
                >
                  📍 {s.label}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {mode === "polygon" ? (
        <>
          <p className="text-xs text-zinc-500">{tr.outlineHelp}</p>
          <BoundaryMap points={points} onAdd={(p) => setPoints((prev) => [...prev, p])} center={mapCenter} focus={focus} />
          <div className="flex items-center justify-between text-xs text-zinc-500">
            <span>{points.length} {es ? "esquina" : "corner"}{points.length === 1 ? "" : "s"}</span>
            <span className="flex gap-3">
              <button onClick={() => setPoints((p) => p.slice(0, -1))} className="hover:underline" disabled={!points.length}>
                {tr.undoPoint}
              </button>
              <button onClick={() => setPoints([])} className="text-red-600 hover:underline" disabled={!points.length}>
                {tr.clear}
              </button>
            </span>
          </div>
          <label className="flex flex-col gap-1 w-40">
            <span className="text-xs text-zinc-500">{tr.paddingM}</span>
            <input type="number" value={padding} onChange={(e) => setPadding(e.target.value)} className={field} />
          </label>
        </>
      ) : (
        <>
          <p className="text-xs text-zinc-500">{tr.singlePointHelp}</p>
          <BoundaryMap
            single
            points={circlePoint}
            center={mapCenter ?? circlePoint[0] ?? null}
            focus={focus}
            onAdd={(p) => {
              setLat(p.lat.toFixed(6));
              setLng(p.lng.toFixed(6));
            }}
          />
          <div className="flex items-center gap-3 flex-wrap">
            <button onClick={useMyLocation} disabled={geoBusy} className={`${btn("neutral", "sm")}`}>
              📍 {geoBusy ? tr.locatingLoc : tr.useMyLocation}
            </button>
            <label className="flex items-center gap-2">
              <span className="text-xs text-zinc-500">{tr.radiusM}</span>
              <input
                type="number"
                value={radius}
                onChange={(e) => setRadius(e.target.value)}
                className={`${field} w-24`}
              />
            </label>
          </div>
          <details className="text-xs text-zinc-500">
            <summary className="cursor-pointer select-none">{tr.advancedCoords}</summary>
            <div className="grid grid-cols-2 gap-3 mt-2">
              <label className="flex flex-col gap-1">
                <span>{tr.latitude}</span>
                <input value={lat} onChange={(e) => setLat(e.target.value)} className={field} />
              </label>
              <label className="flex flex-col gap-1">
                <span>{tr.longitude}</span>
                <input value={lng} onChange={(e) => setLng(e.target.value)} className={field} />
              </label>
            </div>
          </details>
        </>
      )}

      <div className="flex items-center gap-2">
        <button onClick={save} disabled={busy} className={btn("primary", "md")}>
          {busy ? tr.saving : editSite ? tr.saveChanges : tr.saveSite}
        </button>
        {editSite && onDone && (
          <button onClick={onDone} className="text-sm text-zinc-400 hover:text-zinc-600">
            {tr.cancel}
          </button>
        )}
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      {ok && <p className="text-sm text-emerald-600">{tr.siteSaved}</p>}
    </div>
  );
}
