"use client";

import { useMemo, useRef, useState } from "react";
import { MapView, type MapLine, type MapPoint } from "@/components/MapView";
import { cargaSnapdom } from "@/components/CapturaDeAyuda";
import { encuadreDeLaFoto, filasDeLaFoto, nombreDelPng, palletsDeLaFoto, puedeCompartirFicheros } from "@/lib/foto-de-la-ruta";
import { fmtDate } from "@/lib/utils";
import type { Delivery } from "@/lib/types";

/**
 * «📸 PNG para el chofer» (D-536): la hoja de la ruta como imagen —cabecera, paradas en orden y el mapa con solo esa
 * ruta— para mandársela al chofer por WhatsApp o correo. Se pinta en un cuadro (para que la persona la vea antes de
 * mandarla) y se fotografía con `snapdom`, el mismo de la captura de Ayuda (D-513): los mosaicos del mapa salen enteros.
 *
 * «📤 Compartir» solo en los navegadores que comparten ficheros (el teléfono); si no, «⬇ Descargar PNG».
 */
export function FotoDeLaRuta({ chofer, fecha, stops, points, lines, color, onClose, t }: {
  chofer: string;
  fecha: string;
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

  /** La hoja a PNG: el cuadro entero menos los botones (`data-fuera-de-la-foto`). */
  const fotografia = async (): Promise<File> => {
    const snapdom = await cargaSnapdom();
    const lienzo = await snapdom.toCanvas(hoja.current!, { backgroundColor: "#ffffff", fast: true, scale: 2, exclude: ["[data-fuera-de-la-foto]"], excludeMode: "remove" });
    const blob = await new Promise<Blob | null>((listo) => lienzo.toBlob(listo, "image/png"));
    if (!blob) throw new Error("sin imagen");
    return new File([blob], nombre, { type: "image/png" });
  };

  const descargar = async () => {
    if (ocupado) return;
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
    if (ocupado) return;
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
      <div className="modal" role="dialog" aria-modal="true" aria-label={t("Route image", "Imagen de la ruta")} style={{ maxWidth: 720, padding: 0, overflow: "hidden" }}>
        <div ref={hoja} data-hoja-de-la-ruta style={{ background: "#fff", color: "#111", padding: 16 }}>
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
            <b style={{ fontSize: 18 }}><span style={{ display: "inline-block", width: 12, height: 12, borderRadius: "50%", background: color, marginRight: 6 }} />🚚 {chofer}</b>
            <span style={{ fontSize: 14 }}>{fmtDate(fecha)} · {stops.length} {t("stops", "paradas")} · {palletsDeLaFoto(stops)} {t("pallets", "pallets")}</span>
          </div>
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
          <div style={{ marginTop: 10 }}>
            <MapView points={points} lines={lines} fitTo={fitTo} height={360} />
          </div>
          <div data-fuera-de-la-foto style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap", justifyContent: "flex-end" }}>
            {aviso && <span className="hint" style={{ flex: "1 1 100%", margin: 0, color: "#b45309" }}>{aviso}</span>}
            <button type="button" className="btn btn-ghost" onClick={onClose}>{t("Close", "Cerrar")}</button>
            <button type="button" className="btn btn-ghost" data-compartir-png disabled={!!ocupado} onClick={() => void compartir()}>
              📤 {ocupado === "compartir" ? t("Preparing…", "Preparando…") : t("Share", "Compartir")}
            </button>
            <button type="button" className="btn btn-primary" data-descargar-png disabled={!!ocupado} onClick={() => void descargar()}>
              ⬇ {ocupado === "png" ? t("Preparing…", "Preparando…") : t("Download PNG", "Descargar PNG")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
