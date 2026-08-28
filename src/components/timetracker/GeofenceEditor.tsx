"use client";

import { useEffect, useRef, useState } from "react";
import { googleMapsEnabled, loadGoogleMaps } from "@/lib/google-maps-loader";
import { addSite, updateSite, geocodeForMap } from "@/app/timetracker/clock-in/actions/sites";
import type { Fence } from "./GeofenceMap";

type LatLng = { lat: number; lng: number };

/**
 * Dibujar y mover geocercas, en Google Maps y dentro de Ajustes.
 *
 * Sustituye al editor de fichaje, que era Leaflet sobre imágenes de Esri y vivía en otra
 * pantalla: pulsar "editar" te sacaba de Ajustes y te metía en la app vieja. Ahora se edita
 * donde se ve.
 *
 * **Lo que gana al cambiar de mapa, y es la razón de fondo:** una geocerca de Leaflet solo
 * se podía trazar clic a clic, y para corregir una esquina había que borrar y volver a
 * empezar. Los polígonos de Google son `editable`, así que se arrastran vértices y se parten
 * lados por su punto medio. Corregir una esquina mal puesta pasa de rehacer la tienda entera
 * a arrastrar un punto.
 *
 * Se sigue guardando con las MISMAS acciones (`addSite` / `updateSite`), que son las que
 * calculan el centro del polígono y comprueban el permiso. Un editor nuevo no es motivo para
 * tener una segunda forma de escribir una geocerca.
 */
export function GeofenceEditor({
  site,
  onDone,
  onCancel,
}: {
  site?: Fence | null;
  onDone: () => void;
  onCancel: () => void;
}) {
  const editing = !!site;
  const hasPoly = !!site?.boundary && site.boundary.length >= 3;

  const [mode, setMode] = useState<"polygon" | "circle">(hasPoly || !editing ? "polygon" : "circle");
  const [name, setName] = useState(site?.name ?? "");
  const [padding, setPadding] = useState(String(site?.padding_meters ?? 25));
  const [radius, setRadius] = useState(String(site?.radius_meters ?? 100));
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [count, setCount] = useState(hasPoly ? site!.boundary!.length : 0);

  const box = useRef<HTMLDivElement>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const polyRef = useRef<google.maps.Polygon | null>(null);
  const circleRef = useRef<google.maps.Circle | null>(null);
  const mapsRef = useRef<typeof google.maps | null>(null);
  // El modo se lee dentro del listener de clics, que se registra una vez.
  const modeRef = useRef(mode);
  modeRef.current = mode;

  /** Los vértices actuales, leídos del polígono en vez de duplicados en estado: si se
   *  guardaran aparte, arrastrar un vértice cambiaría el mapa y no lo guardado. */
  function currentPoints(): LatLng[] {
    const p = polyRef.current;
    if (!p) return [];
    return p.getPath().getArray().map((ll) => ({ lat: ll.lat(), lng: ll.lng() }));
  }

  useEffect(() => {
    if (!googleMapsEnabled()) { setErr("Google Maps is not configured."); return; }
    let cancelled = false;

    (async () => {
      let maps: typeof google.maps;
      try { maps = await loadGoogleMaps(); }
      catch (e) { if (!cancelled) setErr(e instanceof Error ? e.message : "Google Maps failed to load."); return; }
      if (cancelled || !box.current) return;
      mapsRef.current = maps;

      const start: LatLng = hasPoly
        ? site!.boundary![0]
        : site?.latitude != null && site?.longitude != null
          ? { lat: site.latitude, lng: site.longitude }
          : { lat: 26.2, lng: -98.23 };

      const map = new maps.Map(box.current, {
        center: start,
        zoom: editing ? 19 : 15,
        mapTypeId: "hybrid",
        disableDefaultUI: true,
        zoomControl: true,
        gestureHandling: "greedy", // aquí SÍ se quiere zoom con rueda: se está dibujando
      });
      mapRef.current = map;

      const shapeStyle = { strokeColor: "#22c55e", strokeWeight: 2, fillColor: "#22c55e", fillOpacity: 0.18 };

      const poly = new maps.Polygon({
        ...shapeStyle,
        paths: hasPoly ? site!.boundary! : [],
        editable: true,
        map,
      });
      polyRef.current = poly;
      const sync = () => setCount(poly.getPath().getLength());
      maps.event.addListener(poly.getPath(), "insert_at", sync);
      maps.event.addListener(poly.getPath(), "remove_at", sync);
      maps.event.addListener(poly.getPath(), "set_at", sync);

      const circle = new maps.Circle({
        ...shapeStyle,
        center: start,
        radius: Number(site?.radius_meters ?? 100),
        editable: true,
        draggable: true,
        map: null,
      });
      circleRef.current = circle;
      maps.event.addListener(circle, "radius_changed", () => setRadius(String(Math.round(circle.getRadius()))));

      // Un clic añade una esquina. Solo en modo polígono: en círculo el clic movería el
      // centro sin querer, y para eso ya se arrastra la figura.
      map.addListener("click", (e: google.maps.MapMouseEvent) => {
        if (modeRef.current !== "polygon" || !e.latLng) return;
        poly.getPath().push(e.latLng);
      });

      if (hasPoly) {
        const b = new maps.LatLngBounds();
        site!.boundary!.forEach((p) => b.extend(p));
        map.fitBounds(b, 40);
      }
      setTimeout(() => maps.event.trigger(map, "resize"), 200);
    })();

    return () => {
      cancelled = true;
      polyRef.current?.setMap(null);
      circleRef.current?.setMap(null);
    };
    // Se monta una vez por sitio editado; el resto se maneja por refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [site?.id]);

  // Enseñar la figura del modo elegido y esconder la otra.
  useEffect(() => {
    polyRef.current?.setMap(mode === "polygon" ? mapRef.current : null);
    circleRef.current?.setMap(mode === "circle" ? mapRef.current : null);
  }, [mode]);

  function undo() {
    const path = polyRef.current?.getPath();
    if (path && path.getLength() > 0) path.removeAt(path.getLength() - 1);
  }
  function clear() {
    polyRef.current?.getPath().clear();
    setCount(0);
  }

  async function findAddress() {
    if (search.trim().length < 3) return;
    setBusy(true); setErr(null);
    const hit = await geocodeForMap(search);
    setBusy(false);
    if (!hit) { setErr("Address not found."); return; }
    mapRef.current?.setCenter({ lat: hit.lat, lng: hit.lng });
    mapRef.current?.setZoom(19);
    if (mode === "circle") circleRef.current?.setCenter({ lat: hit.lat, lng: hit.lng });
    setMsg(hit.label);
  }

  function useMyLocation() {
    if (!navigator.geolocation) { setErr("This device can't share its location."); return; }
    setBusy(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setBusy(false);
        const p = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        mapRef.current?.setCenter(p);
        mapRef.current?.setZoom(19);
        if (mode === "circle") circleRef.current?.setCenter(p);
      },
      () => { setBusy(false); setErr("Couldn't get your location — allow location access."); },
      { enableHighAccuracy: true, timeout: 10000 },
    );
  }

  async function save() {
    setErr(null); setMsg(null);
    if (!name.trim()) { setErr("Give the site a name."); return; }

    let payload: { name: string; lat: number; lng: number; radius: number; boundary?: LatLng[] | null; padding?: number };
    if (mode === "polygon") {
      const pts = currentPoints();
      if (pts.length < 3) { setErr("Click at least 3 corners on the map to outline the property."); return; }
      payload = { name: name.trim(), boundary: pts, padding: parseInt(padding || "25", 10), lat: 0, lng: 0, radius: 0 };
    } else {
      const c = circleRef.current?.getCenter();
      if (!c) { setErr("Place the circle on the map first."); return; }
      payload = { name: name.trim(), lat: c.lat(), lng: c.lng(), radius: parseInt(radius || "100", 10), boundary: null };
    }

    setBusy(true);
    const res = site ? await updateSite(site.id, payload) : await addSite(payload);
    setBusy(false);
    if (!res.ok) { setErr(res.message); return; }
    onDone();
  }

  return (
    <div className="card" style={{ marginTop: 10 }}>
      <div className="between">
        <h3 style={{ margin: 0 }}>{editing ? `Edit ${site!.name}` : "New job site"}</h3>
        <button className="btn-ghost btn-sm" onClick={onCancel}>Cancel</button>
      </div>

      {err && <div className="banner err">{err}</div>}
      {msg && <div className="banner ok">{msg}</div>}

      <div className="grid g2" style={{ marginTop: 10 }}>
        <div className="field">
          <label>Name</label>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Brownsville" />
        </div>
        <div className="field">
          <label>Shape</label>
          <select value={mode} onChange={(e) => setMode(e.target.value as "polygon" | "circle")}>
            <option value="polygon">Outline the property</option>
            <option value="circle">Circle around a point</option>
          </select>
        </div>
      </div>

      <div className="field">
        <label>Find the place</label>
        <div className="row" style={{ gap: 6 }}>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && findAddress()}
            placeholder="🔍 Address, city"
          />
          <button className="btn-ghost btn-sm" disabled={busy} onClick={findAddress}>Search</button>
          <button className="btn-ghost btn-sm" disabled={busy} onClick={useMyLocation}>Use my location</button>
        </div>
      </div>

      <div ref={box} style={{ height: 380, width: "100%", borderRadius: 10, overflow: "hidden", border: "1px solid var(--line)" }} />

      {mode === "polygon" ? (
        <div className="row" style={{ gap: 8, marginTop: 8, flexWrap: "wrap", alignItems: "center" }}>
          <span className="chip">{count} corner{count === 1 ? "" : "s"}</span>
          <button className="btn-ghost btn-sm" onClick={undo} disabled={count === 0}>Undo last</button>
          <button className="btn-ghost btn-sm" onClick={clear} disabled={count === 0}>Clear</button>
          <span className="small muted">Click to add a corner · drag a corner to move it · drag the midpoint of a side to split it.</span>
        </div>
      ) : (
        <p className="small muted" style={{ marginTop: 8 }}>Drag the circle to move it, drag its edge to resize.</p>
      )}

      <div className="grid g2" style={{ marginTop: 10 }}>
        {mode === "polygon" ? (
          <div className="field">
            <label>Padding (m)</label>
            <input value={padding} onChange={(e) => setPadding(e.target.value)} inputMode="numeric" />
            <div className="hint">How far outside the outline still counts as on-site — for GPS drift.</div>
          </div>
        ) : (
          <div className="field">
            <label>Radius (m)</label>
            <input value={radius} onChange={(e) => setRadius(e.target.value)} inputMode="numeric" />
          </div>
        )}
      </div>

      <button className="btn-primary" style={{ marginTop: 12 }} disabled={busy} onClick={save}>
        {busy ? "Saving…" : editing ? "Save changes" : "Create job site"}
      </button>
    </div>
  );
}
