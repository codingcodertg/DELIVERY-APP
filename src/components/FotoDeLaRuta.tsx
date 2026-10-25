"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { LeafletMap, type MapLine, type MapPoint } from "@/components/LeafletMap";
import { cargaSnapdom } from "@/components/CapturaDeAyuda";
import { anchoSinAcciones, encuadreDeLaFoto, filasDeLaFoto, FUERA_DE_LA_TABLA, nombreDelPng, palletsDeLaFoto, puedeCompartirFicheros } from "@/lib/foto-de-la-ruta";
import { fmtDate } from "@/lib/utils";
import type { Delivery } from "@/lib/types";

/**
 * «📸 PNG para el chofer» (D-536): la hoja de la ruta como imagen —cabecera, paradas en orden y el mapa con solo esa
 * ruta— para mandársela al chofer por WhatsApp o correo. Se pinta en un cuadro (para que la persona la vea antes de
 * mandarla) y se fotografía con `snapdom`, el mismo de la captura de Ayuda (D-513): los mosaicos del mapa salen enteros.
 *
 * «📤 Compartir» solo en los navegadores que comparten ficheros (el teléfono); si no, «⬇ Descargar PNG».
 *
 * D-636 (el dueño, 2026-10-21, con seis capturas de mapa + tabla: «cuando pido screenshot en png ahí en cada driver a
 * esto me refiero»): arriba el mapa y debajo la tabla de la ruta TAL COMO SE VE en el Gestor (Parada, Factura, Pallets,
 * Tipo, ciudades, Llegada, Ventanas, Etapa, con sus colores de recogida y entrega), fotografiada de la página, sin las
 * casillas ni la columna de flechas. Si la tabla no está en la página (la ruta plegada), sale la lista sencilla de antes.
 *
 * D-678 (el dueño, 2026-10-24, con la foto de Ernesto Castillo al lado del mapa del Gestor): el mapa de la foto es
 * Leaflet, no el de Google. `snapdom` no copia bien el mapa de Google: la foto salía con la región entera y sin una sola
 * marca. Leaflet pinta sus marcas como HTML y sus mosaicos como imágenes, y eso sale entero; los mosaicos son los de
 * Google (`mosaicos="google"`, por /api/map-tiles) para que se parezca al del Gestor. En el demo no hay sesión para ese
 * proxy: ahí, OpenStreetMap.
 */
const MOSAICOS_DE_LA_FOTO = process.env.NEXT_PUBLIC_LOCAL_MODE === "true" ? "osm" : "google";

/** La tabla de la ruta en la página, como imagen: en tema claro (la foto sale igual para todos), sin casillas ni acciones. */
async function fotoDeLaTabla(tabla: HTMLElement): Promise<{ url: string; ancho: number }> {
  const snapdom = await cargaSnapdom();
  const ultima = tabla.querySelector("thead tr")?.lastElementChild as HTMLElement | null | undefined;
  const ancho = anchoSinAcciones(tabla.offsetWidth, ultima?.offsetWidth ?? 0);
  const raiz = document.documentElement;
  const tema = raiz.getAttribute("data-theme");
  if (tema === "dark") raiz.setAttribute("data-theme", "light");
  let lienzo: HTMLCanvasElement;
  try {
    lienzo = await snapdom.toCanvas(tabla, { backgroundColor: "#ffffff", scale: 2, exclude: [...FUERA_DE_LA_TABLA], excludeMode: "hide" });
  } finally {
    if (tema === "dark") raiz.setAttribute("data-theme", tema);
  }
  const escala = lienzo.width / Math.max(1, tabla.offsetWidth);
  const recorte = document.createElement("canvas");
  recorte.width = Math.round(ancho * escala);
  recorte.height = lienzo.height;
  recorte.getContext("2d")?.drawImage(lienzo, 0, 0);
  return { url: recorte.toDataURL("image/png"), ancho };
}

export function FotoDeLaRuta({ chofer, fecha, laneKey, stops, points, lines, color, onClose, t }: {
  chofer: string;
  fecha: string;
  /** La ruta en el Gestor: su tabla lleva `data-tabla-de-la-ruta={laneKey}`. */
  laneKey: string;
  /** Las paradas de la ruta, en su orden. */
  stops: readonly Delivery[];
  /** Las marcas y las líneas de SOLO esta ruta (`puntosDeLaRuta`, `lineasDeLaRuta`). */
  points: MapPoint[];
  lines: MapLine[];
  /** El color del chofer, para la cabecera. */
  color: string;
  onClose: () => void;
  t: (en: string, es: string) => string;
}) {
  const hoja = useRef<HTMLDivElement>(null);
  const [ocupado, setOcupado] = useState<"png" | "compartir" | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const filas = useMemo(() => filasDeLaFoto(stops), [stops]);
  const fitTo = useMemo(() => encuadreDeLaFoto(points, lines), [points, lines]);
  const nombre = nombreDelPng(chofer, fecha);
  // La tabla del Gestor como imagen: «cargando» mientras se fotografía; null si no está en la página o falla.
  const [tabla, setTabla] = useState<{ url: string; ancho: number } | "cargando" | null>("cargando");
  useEffect(() => {
    let vivo = true;
    // La ruta se acaba de abrir para la foto (`abreParaLaFoto`): su tabla puede tardar un momento en estar.
    let intentos = 0;
    const busca = () => {
      if (!vivo) return;
      const el = document.querySelector<HTMLElement>(`[data-tabla-de-la-ruta="${CSS.escape(laneKey)}"]`);
      if (el) { fotoDeLaTabla(el).then((r) => { if (vivo) setTabla(r); }, () => { if (vivo) setTabla(null); }); return; }
      if (++intentos >= 15) { setTabla(null); return; }
      setTimeout(busca, 200);
    };
    busca();
    return () => { vivo = false; };
  }, [laneKey]);

  /** La hoja a PNG: el cuadro entero menos los botones (`data-fuera-de-la-foto`). */
  const fotografia = async (): Promise<File> => {
    const snapdom = await cargaSnapdom();
    const lienzo = await snapdom.toCanvas(hoja.current!, { backgroundColor: "#ffffff", fast: true, scale: 2, exclude: ["[data-fuera-de-la-foto]", ".leaflet-control-zoom", ".gm-bundled-control"], excludeMode: "remove" });
    const blob = await new Promise<Blob | null>((listo) => lienzo.toBlob(listo, "image/png"));
    if (!blob) throw new Error("sin imagen");
    return new File([blob], nombre, { type: "image/png" });
  };

  const descargar = async () => {
    if (ocupado || tabla === "cargando") return;
    setOcupado("png"); setAviso(null);
    try {
      const fichero = await fotografia();
      const url = URL.createObjectURL(fichero);
      const a = document.createElement("a");
      a.href = url; a.download = nombre; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch {
      setAviso(t("Couldn't build the image. Try again.", "No se pudo armar la imagen. Inténtelo otra vez."));
    } finally { setOcupado(null); }
  };

  const compartir = async () => {
    if (ocupado || tabla === "cargando") return;
    setOcupado("compartir"); setAviso(null);
    try {
      const fichero = await fotografia();
      if (!puedeCompartirFicheros(navigator, fichero)) { setAviso(t("This browser can't share files — download the PNG and send it.", "Este navegador no comparte ficheros: descargue el PNG y mándelo.")); return; }
      await navigator.share({ files: [fichero], title: `${chofer} · ${fmtDate(fecha)}` });
    } catch (e) {
      // Cancelar la hoja de compartir no es un error.
      if ((e as { name?: string })?.name !== "AbortError") setAviso(t("Couldn't share the image.", "No se pudo compartir la imagen."));
    } finally { setOcupado(null); }
  };

  return (
    <div className="overlay" data-foto-de-la-ruta onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={t("Route image", "Imagen de la ruta")} style={{ maxWidth: tabla && tabla !== "cargando" ? `min(${tabla.ancho + 32}px, 96vw)` : 720, width: "100%", padding: 0, overflow: "hidden" }}>
        <div ref={hoja} data-hoja-de-la-ruta style={{ background: "#fff", color: "#111", padding: 16 }}>
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
            <b style={{ fontSize: 18 }}><span style={{ display: "inline-block", width: 12, height: 12, borderRadius: "50%", background: color, marginRight: 6 }} />🚚 {chofer}</b>
            <span style={{ fontSize: 14 }}>{fmtDate(fecha)} · {stops.length} {t("stops", "paradas")} · {palletsDeLaFoto(stops)} {t("pallets", "pallets")}</span>
          </div>
          {/* El mapa, cuando el cuadro ya tiene su ancho (el de la tabla): pintado antes, Leaflet se queda con el ancho viejo
              y deja una franja gris (medido en el demo, D-636). */}
          {tabla === "cargando" ? (
            <p className="hint" style={{ marginTop: 10 }}>{t("Preparing the stops table…", "Preparando la tabla de paradas…")}</p>
          ) : (
            <div style={{ marginTop: 10 }}>
              <LeafletMap points={points} lines={lines} fitTo={fitTo} height={420} mosaicos={MOSAICOS_DE_LA_FOTO} />
            </div>
          )}
          {tabla && tabla !== "cargando" && (
            <img src={tabla.url} alt={t("Stops of the route", "Paradas de la ruta")} data-tabla-en-la-foto style={{ display: "block", width: "100%", maxWidth: tabla.ancho, marginTop: 10 }} />
          )}
          {tabla === null && (
            <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 10, fontSize: 13 }}>
              <thead>
                <tr style={{ textAlign: "left", borderBottom: "2px solid #ddd" }}>
                  <th style={{ padding: "4px 6px", width: 28 }}>#</th>
                  <th style={{ padding: "4px 6px" }}>{t("Order", "Orden")}</th>
                  <th style={{ padding: "4px 6px" }}>{t("Account", "Cuenta")}</th>
                  <th style={{ padding: "4px 6px" }}>{t("Address", "Dirección")}</th>
                  <th style={{ padding: "4px 6px" }}>{t("Window", "Ventana")}</th>
                  <th style={{ padding: "4px 6px", textAlign: "right" }}>{t("Pallets", "Pallets")}</th>
                </tr>
              </thead>
              <tbody>
                {filas.map((f) => (
                  <tr key={f.n} data-fila-de-la-foto={f.n} style={{ borderBottom: "1px solid #eee", verticalAlign: "top" }}>
                    <td style={{ padding: "4px 6px", fontWeight: 800 }}>{f.n}</td>
                    <td style={{ padding: "4px 6px", fontWeight: 700 }}>{f.orden}</td>
                    <td style={{ padding: "4px 6px" }}>{f.cuenta}</td>
                    <td style={{ padding: "4px 6px" }}>{f.direccion}</td>
                    <td style={{ padding: "4px 6px", whiteSpace: "nowrap" }}>{f.ventana}</td>
                    <td style={{ padding: "4px 6px", textAlign: "right" }}>{f.pallets}</td>
                  </tr>
                ))}
                {filas.length === 0 && <tr><td colSpan={6} style={{ padding: 8 }}>{t("No stops on this route.", "Esta ruta no tiene paradas.")}</td></tr>}
              </tbody>
            </table>
          )}
          <div data-fuera-de-la-foto style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap", justifyContent: "flex-end" }}>
            {aviso && <span className="hint" style={{ flex: "1 1 100%", margin: 0, color: "#b45309" }}>{aviso}</span>}
            <button type="button" className="btn btn-ghost" onClick={onClose}>{t("Close", "Cerrar")}</button>
            <button type="button" className="btn btn-ghost" data-compartir-png disabled={!!ocupado || tabla === "cargando"} onClick={() => void compartir()}>
              📤 {ocupado === "compartir" ? t("Preparing…", "Preparando…") : t("Share", "Compartir")}
            </button>
            <button type="button" className="btn btn-primary" data-descargar-png disabled={!!ocupado || tabla === "cargando"} onClick={() => void descargar()}>
              ⬇ {ocupado === "png" ? t("Preparing…", "Preparando…") : t("Download PNG", "Descargar PNG")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
