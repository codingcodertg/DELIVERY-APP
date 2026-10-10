"use client";

import { useRef, useState } from "react";
import {
  LADO_MINIMO_DEL_RECUADRO, TIPO_DE_CAPTURA, alFotograma, grosorDelRecuadro, nombreDeCaptura,
  porcentajesDelRecuadro, recuadroDelArrastre, tamanoDeCaptura,
  type FalloDeCaptura, type Punto, type Rect, type Tamano,
} from "@/lib/help-captura";

/**
 * La captura de pantalla de Ayuda: lo que toca el navegador (D-509).
 *
 * Aquí está todo lo que no se puede medir en vitest —`getDisplayMedia`, el `<video>`, el lienzo y el
 * blob— a propósito y en un solo sitio. Las decisiones que sí se miden (el rectángulo, el escalado, el
 * nombre, qué se acepta y el orden en que Ayuda se esconde) están en `src/lib/help-captura.ts`, con sus
 * pruebas.
 *
 * Se captura la pantalla **de verdad**, con el diálogo del navegador por delante, porque el mapa no se
 * puede dibujar desde el DOM. El motivo largo está en `help-captura.ts` y en la entrada de decisiones.
 */

/** El rojo del recuadro: el mismo `--red` de la app no sirve aquí, el lienzo no lee variables de CSS. */
export const COLOR_DEL_RECUADRO = "#dc2626";

/** Un fotograma ya capturado y escalado: la imagen para enseñar, y sus medidas reales para pintar. */
export type FotogramaDeCaptura = { url: string; ancho: number; alto: number };

export class ErrorDeCaptura extends Error {
  constructor(public readonly fallo: FalloDeCaptura) {
    super(fallo);
    this.name = "ErrorDeCaptura";
  }
}

/** `preferCurrentTab` es de Chromium y no está en los tipos del DOM. Es lo que hace que el diálogo
 *  proponga **esta** pestaña, que es la que tiene el problema; proponer, no imponer. */
type OpcionesDeCaptura = DisplayMediaStreamOptions & { preferCurrentTab?: boolean };

/** Cuánto se espera un repintado como mucho. Ver `esperaUnRepintado`. */
export const TOPE_DE_REPINTADO_MS = 400;

/**
 * Dos repintados: el primero deja que React suelte a la pantalla el cambio que esconde Ayuda, el
 * segundo ocurre ya sin ella pintada. Es lo que `conAyudaOculta` espera antes de capturar.
 *
 * **Con tope, y no por prudencia: medido.** Al probarlo en Chrome con la pestaña en segundo plano
 * (`document.visibilityState === "hidden"`), `requestAnimationFrame` **no se dispara nunca** — el
 * navegador lo congela. Sin tope, la espera no termina: no se captura, y como esconder Ayuda ya había
 * ocurrido, **el panel y su botón desaparecen de la app hasta recargar**, con el mensaje a medio
 * escribir dentro. Pasar de largo sin repintar es peor foto; quedarse colgado es perder Ayuda.
 */
export function esperaUnRepintado(): Promise<void> {
  return Promise.race([
    new Promise<void>((listo) => {
      requestAnimationFrame(() => requestAnimationFrame(() => listo()));
    }),
    new Promise<void>((listo) => setTimeout(listo, TOPE_DE_REPINTADO_MS)),
  ]);
}

/** El primer fotograma que mande el flujo, con tope: si no llega ninguno se sigue y lo caza el alto 0. */
async function esperaFotograma(video: HTMLVideoElement): Promise<void> {
  const primero = typeof video.requestVideoFrameCallback === "function"
    ? new Promise<void>((listo) => { video.requestVideoFrameCallback(() => listo()); })
    : esperaUnRepintado();
  await Promise.race([primero, new Promise<void>((listo) => setTimeout(listo, 3000))]);
}

function decodifica(url: string): Promise<HTMLImageElement> {
  return new Promise((listo, falla) => {
    const img = new Image();
    img.onload = () => listo(img);
    img.onerror = () => falla(new ErrorDeCaptura("sin-fotograma"));
    img.src = url;
  });
}

/**
 * Pide la pantalla al navegador y se queda con UN fotograma, ya escalado.
 *
 * El flujo se corta siempre (`finally`): con los carriles vivos, el navegador deja puesta la barra de
 * «estás compartiendo tu pantalla», y una barra que no se va asusta más que el problema que se iba a
 * reportar. Quien llama envuelve esto en `conAyudaOculta`, que es lo que mantiene a Ayuda fuera de la foto.
 */
export async function tomaFotograma(): Promise<FotogramaDeCaptura> {
  const opciones: OpcionesDeCaptura = { video: { frameRate: 1 }, audio: false, preferCurrentTab: true };
  const flujo = await navigator.mediaDevices.getDisplayMedia(opciones);
  try {
    const video = document.createElement("video");
    video.srcObject = flujo;
    video.muted = true;
    // Un `play()` rechazado no hunde la captura: con `srcObject` puesto, el fotograma llega igual.
    await video.play().catch(() => {});
    await esperaFotograma(video);
    const fotograma = tamanoDeCaptura({ ancho: video.videoWidth, alto: video.videoHeight });
    if (!fotograma.ancho || !fotograma.alto) throw new ErrorDeCaptura("sin-fotograma");
    const lienzo = document.createElement("canvas");
    lienzo.width = fotograma.ancho;
    lienzo.height = fotograma.alto;
    const ctx = lienzo.getContext("2d");
    if (!ctx) throw new ErrorDeCaptura("sin-fotograma");
    ctx.drawImage(video, 0, 0, fotograma.ancho, fotograma.alto);
    return { url: lienzo.toDataURL(TIPO_DE_CAPTURA), ancho: fotograma.ancho, alto: fotograma.alto };
  } finally {
    for (const carril of flujo.getTracks()) carril.stop();
  }
}

/** La imagen que se sube: el fotograma con el recuadro ya pintado encima, en PNG. Lo que se manda es
 *  esto, no el fotograma limpio más unas coordenadas que nadie al otro lado va a dibujar. */
export async function ficheroDeCaptura(fotograma: FotogramaDeCaptura, recuadro: Rect | null, cuando: Date): Promise<File> {
  const imagen = await decodifica(fotograma.url);
  const lienzo = document.createElement("canvas");
  lienzo.width = fotograma.ancho;
  lienzo.height = fotograma.alto;
  const ctx = lienzo.getContext("2d");
  if (!ctx) throw new ErrorDeCaptura("sin-fotograma");
  ctx.drawImage(imagen, 0, 0, fotograma.ancho, fotograma.alto);
  if (recuadro && recuadro.w > 0 && recuadro.h > 0) {
    const grosor = grosorDelRecuadro(fotograma);
    ctx.lineWidth = grosor;
    ctx.strokeStyle = COLOR_DEL_RECUADRO;
    // Medio grosor hacia dentro: el borde se pinta centrado en la línea, y pegado a un borde de la
    // imagen se perdería la mitad.
    ctx.strokeRect(
      recuadro.x + grosor / 2,
      recuadro.y + grosor / 2,
      Math.max(1, recuadro.w - grosor),
      Math.max(1, recuadro.h - grosor),
    );
  }
  const blob = await new Promise<Blob | null>((listo) => lienzo.toBlob(listo, TIPO_DE_CAPTURA));
  if (!blob) throw new ErrorDeCaptura("sin-fotograma");
  return new File([blob], nombreDeCaptura(cuando), { type: TIPO_DE_CAPTURA });
}

/** La captura con su recuadro encima. El recuadro va en **porcentajes** del fotograma, así que sigue en
 *  su sitio cuando la imagen se reescala con la ventana. */
export function VistaDeCaptura({ fotograma, recuadro, t }: {
  fotograma: FotogramaDeCaptura;
  recuadro: Rect | null;
  t: (en: string, es: string) => string;
}) {
  return (
    <>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={fotograma.url}
        alt={t("Screenshot of the page", "Captura de la página")}
        draggable={false}
        style={{ display: "block", width: "100%", height: "auto", userSelect: "none", pointerEvents: "none" }}
      />
      {recuadro && (
        <div
          aria-hidden
          style={{
            position: "absolute",
            ...porcentajesDelRecuadro(recuadro, fotograma),
            border: `2px solid ${COLOR_DEL_RECUADRO}`,
            boxShadow: `0 0 0 1px rgba(255,255,255,.7) inset`,
            pointerEvents: "none",
          }}
        />
      )}
    </>
  );
}

/**
 * Señalar dónde está el problema: se arrastra un recuadro sobre la captura y se adjunta.
 *
 * Un recuadro y nada más, que es lo que se pidió: no hay flechas, ni texto, ni borrador. Arrastrar otra
 * vez reemplaza el que haya; «Quitar recuadro» lo deja limpio.
 */
export function EditorDeCaptura({ fotograma, t, ocupado, onUsar, onDescartar, onDeNuevo }: {
  fotograma: FotogramaDeCaptura;
  t: (en: string, es: string) => string;
  ocupado?: boolean;
  onUsar: (recuadro: Rect | null) => void;
  onDescartar: () => void;
  onDeNuevo: () => void;
}) {
  const inicio = useRef<Punto | null>(null);
  const [recuadro, setRecuadro] = useState<Rect | null>(null);

  /** El punto y el tamaño de la imagen **tal como se ve ahora**, los dos de la misma medición: un rect
   *  medido antes y un punto medido después se desalinean si algo se movió entre medias. */
  const medidas = (e: React.PointerEvent<HTMLDivElement>): { punto: Punto; vista: Tamano } => {
    const caja = e.currentTarget.getBoundingClientRect();
    return {
      punto: { x: e.clientX - caja.left, y: e.clientY - caja.top },
      vista: { ancho: caja.width, alto: caja.height },
    };
  };

  const alBajar = (e: React.PointerEvent<HTMLDivElement>) => {
    if (ocupado) return;
    e.preventDefault();
    inicio.current = medidas(e).punto;
    setRecuadro(null);
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const alMover = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!inicio.current) return;
    const { punto, vista } = medidas(e);
    const enVista = recuadroDelArrastre(inicio.current, punto, vista);
    setRecuadro(enVista ? alFotograma(enVista, vista, fotograma) : null);
  };

  const alSoltar = () => { inicio.current = null; };

  return (
    <div className="overlay" style={{ zIndex: 60 }}>
      <div className="modal" style={{ maxWidth: 900 }}>
        <h3 style={{ margin: "0 0 4px" }}>{t("Mark the problem", "Señale el problema")}</h3>
        <p className="hint" style={{ marginTop: 0 }}>
          {t(
            "Drag a box over what's wrong, then attach it. Dragging again replaces the box.",
            "Arrastre un recuadro sobre lo que está mal y adjúntelo. Si arrastra otra vez, se reemplaza.",
          )}
        </p>
        <div
          onPointerDown={alBajar}
          onPointerMove={alMover}
          onPointerUp={alSoltar}
          onPointerCancel={alSoltar}
          style={{
            position: "relative",
            touchAction: "none",
            cursor: ocupado ? "default" : "crosshair",
            border: "1px solid var(--line)",
            borderRadius: 8,
            overflow: "hidden",
            lineHeight: 0,
          }}
        >
          <VistaDeCaptura fotograma={fotograma} recuadro={recuadro} t={t} />
        </div>
        <div className="hint" style={{ marginTop: 6 }}>
          {recuadro
            ? t(
                `Box: ${recuadro.w}×${recuadro.h} px of ${fotograma.ancho}×${fotograma.alto}.`,
                `Recuadro: ${recuadro.w}×${recuadro.h} px de ${fotograma.ancho}×${fotograma.alto}.`,
              )
            : t(
                `No box yet — optional. A drag under ${LADO_MINIMO_DEL_RECUADRO} px doesn't count as one.`,
                `Sin recuadro todavía — es opcional. Un arrastre de menos de ${LADO_MINIMO_DEL_RECUADRO} px no cuenta.`,
              )}
        </div>
        <div className="modal-actions">
          <button className="btn btn-ghost" onClick={onDescartar} disabled={ocupado}>
            {t("Discard", "Descartar")}
          </button>
          <button className="btn btn-ghost" onClick={() => setRecuadro(null)} disabled={ocupado || !recuadro}>
            {t("Remove box", "Quitar recuadro")}
          </button>
          <button className="btn btn-ghost" onClick={onDeNuevo} disabled={ocupado}>
            📸 {t("Capture again", "Capturar de nuevo")}
          </button>
          <button className="btn btn-primary" onClick={() => onUsar(recuadro)} disabled={ocupado}>
            {ocupado ? t("Attaching…", "Adjuntando…") : t("Attach to request", "Adjuntar a la solicitud")}
          </button>
        </div>
      </div>
    </div>
  );
}
