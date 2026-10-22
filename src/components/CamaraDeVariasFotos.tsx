"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  agregarALaRafaga, jpegComprimido, quitarDeLaRafaga, sesionDeCamara, type FinDeRafaga, type NavegadorConCamara,
} from "@/lib/camara-de-varias-fotos";

// ============================================================
// «📸 Varias fotos» (D-637): la cámara dentro de la app, a pantalla completa. Cada toque del disparador saca una foto
// del vídeo (comprimida como las de `PhotoUpload`: 1280 px, JPEG 0,7); abajo, la tira de miniaturas con su ✕ y el
// contador; «✅ Listo (N)» entrega todas de una vez y «Cancelar» cierra sin entregar nada.
//
// La cámara se para (`sesionDeCamara().cerrar()`) al desmontar, que es lo que pasa con «Listo» y con «Cancelar»: quien
// la pinta la quita al recibir `onTerminar`. Si no se puede abrir (sin `getUserMedia`, permiso negado, o la app de
// Android de antes de que declarara la cámara), llama a `onSinCamara` y quien la pinta enseña el aviso de una línea con
// las otras dos opciones a la vista; no se queda una pantalla negra.
// ============================================================

export function CamaraDeVariasFotos({
  max,
  onTerminar,
  onSinCamara,
  t,
}: {
  /** Cuántas fotos caben aún en el sitio donde se usa. */
  max: number;
  onTerminar: (fin: FinDeRafaga) => void;
  onSinCamara: () => void;
  t: (en: string, es: string) => string;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [fotos, setFotos] = useState<string[]>([]);
  const [viendo, setViendo] = useState(false);
  const [destello, setDestello] = useState(false);
  // El aviso se lee de una ref: el efecto que abre la cámara corre una vez y no debe reabrirla si cambia la función.
  const sinCamaraRef = useRef(onSinCamara);
  sinCamaraRef.current = onSinCamara;

  useEffect(() => {
    const sesion = sesionDeCamara(navigator as unknown as NavegadorConCamara);
    void sesion.abrir().then((r) => {
      if (!r.ok) {
        if (r.motivo !== "cerrada") sinCamaraRef.current();
        return;
      }
      const video = videoRef.current;
      if (!video) { sesion.cerrar(); return; }
      video.srcObject = r.flujo as unknown as MediaStream;
      void video.play().catch(() => { /* `autoPlay` + `muted` ya lo arrancan; esto es por si el navegador no */ });
    });
    // Al desmontar (Listo, Cancelar, o la ficha que se cierra): la cámara se apaga.
    return () => sesion.cerrar();
  }, []);

  const llena = fotos.length >= max;

  const disparar = () => {
    const video = videoRef.current;
    if (!video || !video.videoWidth || llena) return;
    let foto: string;
    try { foto = jpegComprimido(video, video.videoWidth, video.videoHeight); } catch { return; }
    setFotos((antes) => agregarALaRafaga(antes, foto, max));
    setDestello(true);
    window.setTimeout(() => setDestello(false), 120);
  };

  return createPortal(
    <div className="rafaga" role="dialog" aria-modal="true" aria-label={t("Several photos", "Varias fotos")} data-camara-rafaga>
      <div className="rafaga-visor">
        <video ref={videoRef} autoPlay muted playsInline onPlaying={() => setViendo(true)} />
        {!viendo && <div className="rafaga-cargando">{t("Opening the camera…", "Abriendo la cámara…")}</div>}
        {destello && <div className="rafaga-destello" />}
        <span className="rafaga-contador" data-contador-rafaga>{fotos.length} / {max}</span>
      </div>
      <div className="rafaga-panel">
        {fotos.length > 0 && (
          <div className="rafaga-tira" data-tira-rafaga>
            {fotos.map((src, i) => (
              <div className="photo-item" key={i}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={src} alt={`${i + 1}`} />
                <button type="button" className="photo-del" onClick={() => setFotos((antes) => quitarDeLaRafaga(antes, i))} title={t("Remove", "Quitar")}>✕</button>
              </div>
            ))}
          </div>
        )}
        {llena && <div className="hint" style={{ marginTop: 0 }}>{t(`Maximum ${max} photos.`, `Máximo ${max} fotos.`)}</div>}
        <div className="rafaga-mandos">
          <button type="button" className="btn btn-ghost" data-rafaga-cancelar onClick={() => onTerminar({ tipo: "cancelar" })}>
            {t("Cancel", "Cancelar")}
          </button>
          <button type="button" className="rafaga-disparador" data-rafaga-disparar aria-label={t("Take photo", "Tomar foto")}
            disabled={!viendo || llena} onClick={disparar} />
          <button type="button" className="btn btn-green" data-rafaga-listo disabled={fotos.length === 0}
            onClick={() => onTerminar({ tipo: "listo", fotos })}>
            ✅ {t(`Done (${fotos.length})`, `Listo (${fotos.length})`)}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
