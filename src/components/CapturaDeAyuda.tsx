"use client";

import { useRef, useState } from "react";
import { Z_PANEL_DE_AYUDA } from "@/lib/ayuda-flotante";
import {
  LADO_MINIMO_DEL_RECUADRO, TIPO_DE_CAPTURA, alFotograma, grosorDelRecuadro, nombreDeCaptura,
  porcentajesDelRecuadro, recuadroDelArrastre, tamanoDeCaptura,
  type FalloDeCaptura, type Punto, type Rect, type Tamano,
} from "@/lib/help-captura";
import { recorteDeLaVista } from "@/lib/recorte-de-la-vista";
import {
  MAX_RECUADROS, agregaRecuadro, escribeProblema, etiquetaDelRecuadro, porcentajesDeLaEtiqueta, quitaRecuadro,
  type RecuadroNumerado,
} from "@/lib/help-recuadros";

/**
 * La captura de pantalla de Ayuda: lo que toca el navegador (D-509, D-513).
 *
 * Aquí está todo lo que no se puede medir en vitest —el clon del DOM, `getDisplayMedia`, el lienzo y
 * el blob— a propósito y en un solo sitio. Las decisiones que sí se miden (el rectángulo, el escalado,
 * el nombre, qué se acepta y el orden en que Ayuda se esconde) están en `src/lib/help-captura.ts`.
 *
 * **Dos maneras de tomar la foto, y la rápida va primero (D-513).** D-509 solo tenía la de
 * `getDisplayMedia`, y el dueño: *«EL SCREENSHOT NO FUNCIONA COMO YO QUIERO, QUIERO ALGO MAS RAPIDO
 * SIN QUE ESTE PIDIENDO TANTO PERMISO Y ASI»*. Ese método obliga al navegador a enseñar su selector de
 * pantalla **cada vez**, y no se puede saltar.
 *
 * D-509 lo justificaba con que «el mapa no se puede dibujar desde el DOM». **Era falso en este app, y
 * no se había medido.** Es cierto con un mapa de Google en WebGL; aquí todos los mapas son Leaflet con
 * mosaicos en `<img>`, y los tres servidores (OpenStreetMap, Esri y Google tiles) mandan
 * `Access-Control-Allow-Origin`. Medido el 2026-10-10 contra el demo: el mapa sale entero.
 *
 * - `tomaFotogramaDeLaPagina` — la de por defecto: clona el DOM con `snapdom`, solo lo visible
 *   (la página entera recortada por el scroll, D-733), sin diálogo. Medido en el demo a 1440×900: mediana 0,25 s en el
 *   Gestor con mapa y 0,60 s en Órdenes, en caliente. Ayuda se deja fuera **al clonar** (`exclude`),
 *   así que no hay que esconderla ni esperar un repintado.
 * - `tomaFotograma` — la de D-509, por `getDisplayMedia`: queda de respaldo, y solo se ofrece si la
 *   rápida falla. Fotografía la pantalla real, así que esa sí necesita esconder Ayuda antes.
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

/** Una imagen cualquiera (el vídeo de `getDisplayMedia` o el lienzo de snapdom) a fotograma: encogida a
 *  `MAX_LADO_DE_CAPTURA` por el lado largo y en PNG. Las dos maneras de capturar terminan aquí, así que
 *  lo que llega al editor tiene siempre la misma forma. */
function aFotograma(fuente: CanvasImageSource, origen: Tamano): FotogramaDeCaptura {
  const fotograma = tamanoDeCaptura(origen);
  if (!fotograma.ancho || !fotograma.alto) throw new ErrorDeCaptura("sin-fotograma");
  const lienzo = document.createElement("canvas");
  lienzo.width = fotograma.ancho;
  lienzo.height = fotograma.alto;
  const ctx = lienzo.getContext("2d");
  if (!ctx) throw new ErrorDeCaptura("sin-fotograma");
  ctx.drawImage(fuente, 0, 0, fotograma.ancho, fotograma.alto);
  return { url: lienzo.toDataURL(TIPO_DE_CAPTURA), ancho: fotograma.ancho, alto: fotograma.alto };
}

/**
 * Lo que se queda fuera de la foto rápida. Un atributo y no una clase de estilo, a propósito: una
 * clase se cambia al retocar el aspecto y nadie piensa que de ella dependía que Ayuda no saliera en
 * la foto. Lo llevan el botón de Ayuda, su panel y el editor del recuadro.
 */
export const FUERA_DE_LA_CAPTURA = "data-fuera-de-la-captura";

/** Para esparcir en el JSX: `<div {...marcaFueraDeLaCaptura}>`. El nombre vive en un solo sitio. */
export const marcaFueraDeLaCaptura = { [FUERA_DE_LA_CAPTURA]: "" };

type Snapdom = (typeof import("@zumer/snapdom"))["snapdom"];
let cargando: Promise<Snapdom> | null = null;

/** snapdom pesa 89 KB comprimida y Ayuda está en todas las páginas: se descarga la primera vez que
 *  alguien abre Ayuda, no con cada página. */
export function cargaSnapdom(): Promise<Snapdom> {
  if (!cargando) {
    cargando = import("@zumer/snapdom").then((m) => m.snapdom);
    // Si la descarga falla (red), el siguiente intento la vuelve a pedir en vez de heredar el fallo.
    cargando.catch(() => { cargando = null; });
  }
  return cargando;
}

/**
 * - Sin `clip`: la página ENTERA, y `tomaFotogramaDeLaPagina` recorta lo que se ve (D-733). Antes era
 *   el recorte «viewport» de snapdom, que en Órdenes con scroll salía bien, pero en Rutas con la ventana bajada hasta la tabla
 *   pintaba la cabecera arriba, un hueco y las tarjetas (medido el 2026-10-28, `recorte-de-la-vista.ts` cuenta
 *   el detalle). La página entera es asequible: las tablas largas viven en cajas con su propio scroll
 *   (`.tbl-caja`), así que el body no mide mucho más que la ventana.
 * - `excludeMode: "hide"`: Ayuda se quita dejando su hueco, así que nada de alrededor se mueve.
 * - `fast`: `true` clona de un tirón, que es lo más rápido; `false` cede el hilo cada fotograma, que
 *   es lo que se quiere al calentar mientras la persona escribe.
 */
function opcionesDeLaPagina(deUnTiron: boolean) {
  return {
    exclude: [`[${FUERA_DE_LA_CAPTURA}]`],
    excludeMode: "hide" as const,
    backgroundColor: getComputedStyle(document.body).backgroundColor,
    fast: deUnTiron,
  };
}

/**
 * Calentar la foto rápida. La primera captura de cada carga de página tarda 1,6–2,2 s —descubre e
 * incrusta las fuentes—, y las siguientes 0,25–0,6 s (medido en el demo). Se llama al abrir Ayuda,
 * así que lo lento ocurre mientras la persona escribe y no cuando pulsa el botón. Un fallo aquí se
 * calla: es un adelanto, y la captura de verdad lo volverá a intentar y dirá qué pasó.
 */
export function calientaCaptura(): void {
  void cargaSnapdom()
    .then((snapdom) => snapdom.toCanvas(document.body, opcionesDeLaPagina(false)))
    .catch(() => {});
}

/** La foto rápida: sin diálogo del navegador, solo lo que se ve, y con Ayuda fuera. La página entera se pinta y
 *  de ahí se recorta la ventana por el scroll (D-733); si el recorte no sale (medidas a cero), va la foto entera. */
export async function tomaFotogramaDeLaPagina(): Promise<FotogramaDeCaptura> {
  const snapdom = await cargaSnapdom();
  const lienzo = await snapdom.toCanvas(document.body, opcionesDeLaPagina(true));
  const r = recorteDeLaVista(lienzo, document.body.getBoundingClientRect(), window);
  if (!r) return aFotograma(lienzo, { ancho: lienzo.width, alto: lienzo.height });
  const vista = document.createElement("canvas");
  vista.width = r.ancho;
  vista.height = r.alto;
  const ctx = vista.getContext("2d");
  if (!ctx) throw new ErrorDeCaptura("sin-fotograma");
  ctx.drawImage(lienzo, r.sx, r.sy, r.sw, r.sh, 0, 0, r.ancho, r.alto);
  return aFotograma(vista, { ancho: r.ancho, alto: r.alto });
}

/**
 * El respaldo de D-509: pide la pantalla al navegador y se queda con UN fotograma, ya escalado. Solo
 * se ofrece si la foto rápida falla, porque obliga al diálogo del navegador cada vez.
 *
 * El flujo se corta siempre (`finally`): con los carriles vivos, el navegador deja puesta la barra de
 * «estás compartiendo tu pantalla», y una barra que no se va asusta más que el problema que se iba a
 * reportar. Quien llama envuelve esto en `conAyudaOculta`, que es lo que mantiene a Ayuda fuera de la
 * foto: aquí sí hace falta, porque lo que se fotografía es la pantalla real.
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
    return aFotograma(video, { ancho: video.videoWidth, alto: video.videoHeight });
  } finally {
    for (const carril of flujo.getTracks()) carril.stop();
  }
}

/** La imagen que se sube: el fotograma con el recuadro ya pintado encima, en PNG. Lo que se manda es
 *  esto, no el fotograma limpio más unas coordenadas que nadie al otro lado va a dibujar. */
export async function ficheroDeCaptura(fotograma: FotogramaDeCaptura, recuadros: readonly RecuadroNumerado[], cuando: Date): Promise<File> {
  const imagen = await decodifica(fotograma.url);
  const lienzo = document.createElement("canvas");
  lienzo.width = fotograma.ancho;
  lienzo.height = fotograma.alto;
  const ctx = lienzo.getContext("2d");
  if (!ctx) throw new ErrorDeCaptura("sin-fotograma");
  ctx.drawImage(imagen, 0, 0, fotograma.ancho, fotograma.alto);
  const grosor = grosorDelRecuadro(fotograma);
  for (const { n, rect: recuadro } of recuadros) {
    if (!(recuadro.w > 0 && recuadro.h > 0)) continue;
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
    // El número (D-583): el mismo que lleva su línea en el mensaje «1) …».
    const etiqueta = etiquetaDelRecuadro(recuadro, fotograma);
    ctx.fillStyle = COLOR_DEL_RECUADRO;
    ctx.fillRect(etiqueta.x, etiqueta.y, etiqueta.lado, etiqueta.lado);
    ctx.fillStyle = "#ffffff";
    ctx.font = `bold ${etiqueta.fuente}px sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String(n), etiqueta.x + etiqueta.lado / 2, etiqueta.y + etiqueta.lado / 2);
  }
  const blob = await new Promise<Blob | null>((listo) => lienzo.toBlob(listo, TIPO_DE_CAPTURA));
  if (!blob) throw new ErrorDeCaptura("sin-fotograma");
  return new File([blob], nombreDeCaptura(cuando), { type: TIPO_DE_CAPTURA });
}

/** La captura con sus recuadros encima, cada uno con su número, y el que se está arrastrando (`borrador`)
 *  sin número todavía. Todo va en **porcentajes** del fotograma, así que sigue en su sitio cuando la
 *  imagen se reescala con la ventana. */
export function VistaDeCaptura({ fotograma, recuadros, borrador = null, t }: {
  fotograma: FotogramaDeCaptura;
  recuadros: readonly RecuadroNumerado[];
  borrador?: Rect | null;
  t: (en: string, es: string) => string;
}) {
  const marco = (r: Rect): React.CSSProperties => ({
    position: "absolute",
    ...porcentajesDelRecuadro(r, fotograma),
    border: `2px solid ${COLOR_DEL_RECUADRO}`,
    pointerEvents: "none",
  });
  return (
    <>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={fotograma.url}
        alt={t("Screenshot of the page", "Captura de la página")}
        draggable={false}
        style={{ display: "block", width: "100%", height: "auto", userSelect: "none", pointerEvents: "none" }}
      />
      {/* El resplandor blanco de dentro y los colores de la etiqueta viven en `globals.css`
          (`.recuadro-de-captura`, `.numero-de-recuadro`): son colores a pelo, y los colores a pelo no
          van en línea (lo fija la prueba `inline-colors`). */}
      {recuadros.map(({ n, rect }) => (
        <div key={n} aria-hidden className="recuadro-de-captura" style={marco(rect)} />
      ))}
      {recuadros.map(({ n, rect }) => (
        // La etiqueta va aparte del recuadro, hermana y no hija: en porcentajes del fotograma, los
        // mismos que el recuadro, así que las dos se reescalan juntas.
        <span
          key={`n${n}`}
          aria-hidden
          className="numero-de-recuadro"
          style={{
            position: "absolute",
            ...porcentajesDeLaEtiqueta(rect, fotograma),
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontWeight: 700,
            lineHeight: 1,
            fontSize: "clamp(10px, 1.4vw, 16px)",
            pointerEvents: "none",
          }}
        >
          {n}
        </span>
      ))}
      {borrador && <div aria-hidden className="recuadro-de-captura" style={marco(borrador)} />}
    </>
  );
}

/**
 * Señalar dónde están los problemas: se arrastran recuadros sobre la captura, cada uno con su número y
 * su texto, y se adjunta la imagen con todo pintado encima (D-583).
 *
 * Hasta D-513 era un recuadro y nada más, y arrastrar otra vez lo reemplazaba. El dueño pidió «multiple
 * boxes showing an error y ahí él pueda por cada box describir un problema»: cada arrastre añade uno
 * (hasta `MAX_RECUADROS`), debajo sale su línea para escribir, y el «×» quita ese. Sigue sin flechas,
 * sin texto libre sobre la imagen y sin borrador.
 */
export function EditorDeCaptura({ fotograma, t, ocupado, onUsar, onDescartar, onDeNuevo }: {
  fotograma: FotogramaDeCaptura;
  t: (en: string, es: string) => string;
  ocupado?: boolean;
  onUsar: (recuadros: RecuadroNumerado[]) => void;
  onDescartar: () => void;
  onDeNuevo: () => void;
}) {
  const inicio = useRef<Punto | null>(null);
  const [recuadros, setRecuadros] = useState<RecuadroNumerado[]>([]);
  const [borrador, setBorrador] = useState<Rect | null>(null);
  const lleno = recuadros.length >= MAX_RECUADROS;

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
    if (ocupado || lleno) return;
    e.preventDefault();
    inicio.current = medidas(e).punto;
    setBorrador(null);
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const alMover = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!inicio.current) return;
    const { punto, vista } = medidas(e);
    const enVista = recuadroDelArrastre(inicio.current, punto, vista);
    setBorrador(enVista ? alFotograma(enVista, vista, fotograma) : null);
  };

  /** Al soltar, el borrador pasa a la lista con su número. Un clic suelto (sin borrador) no añade nada. */
  const alSoltar = () => {
    inicio.current = null;
    if (borrador) setRecuadros((lista) => agregaRecuadro(lista, borrador));
    setBorrador(null);
  };

  return (
    // Fuera de la foto: con «Capturar de nuevo», el editor sigue montado en el instante en que empieza.
    <div className="overlay" style={{ zIndex: Z_PANEL_DE_AYUDA + 10 }} {...marcaFueraDeLaCaptura}>
      <div className="modal" style={{ maxWidth: 900 }}>
        <h3 style={{ margin: "0 0 4px" }}>{t("Mark the problems", "Señale los problemas")}</h3>
        <p className="hint" style={{ marginTop: 0 }}>
          {t(
            `Drag a box over each thing that's wrong — up to ${MAX_RECUADROS}. Each box gets a number; describe it below.`,
            `Arrastre un recuadro sobre cada cosa que esté mal — hasta ${MAX_RECUADROS}. Cada recuadro lleva un número; descríbalo abajo.`,
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
            cursor: ocupado || lleno ? "default" : "crosshair",
            border: "1px solid var(--line)",
            borderRadius: 8,
            overflow: "hidden",
            lineHeight: 0,
          }}
        >
          <VistaDeCaptura fotograma={fotograma} recuadros={recuadros} borrador={borrador} t={t} />
        </div>
        {recuadros.length === 0 ? (
          <div className="hint" style={{ marginTop: 6 }}>
            {t(
              `No boxes yet — optional. A drag under ${LADO_MINIMO_DEL_RECUADRO} px doesn't count as one.`,
              `Sin recuadros todavía — es opcional. Un arrastre de menos de ${LADO_MINIMO_DEL_RECUADRO} px no cuenta.`,
            )}
          </div>
        ) : (
          <ol style={{ margin: "8px 0 0", padding: 0, listStyle: "none", display: "grid", gap: 6 }}>
            {recuadros.map(({ n, texto }) => (
              <li key={n} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span
                  className="numero-de-recuadro"
                  style={{ minWidth: 24, height: 24, borderRadius: 6, display: "inline-flex", alignItems: "center", justifyContent: "center", fontWeight: 700 }}
                >
                  {n}
                </span>
                <input
                  style={{ flex: 1 }}
                  value={texto}
                  disabled={ocupado}
                  placeholder={t(`What's wrong in box ${n}?`, `¿Qué está mal en el recuadro ${n}?`)}
                  onChange={(e) => setRecuadros((lista) => escribeProblema(lista, n, e.target.value))}
                />
                <button
                  type="button"
                  className="btn btn-ghost"
                  aria-label={t(`Remove box ${n}`, `Quitar recuadro ${n}`)}
                  title={t(`Remove box ${n}`, `Quitar recuadro ${n}`)}
                  disabled={ocupado}
                  onClick={() => setRecuadros((lista) => quitaRecuadro(lista, n))}
                >
                  ×
                </button>
              </li>
            ))}
            {lleno && <li className="hint">{t(`That's the maximum (${MAX_RECUADROS}).`, `Es el máximo (${MAX_RECUADROS}).`)}</li>}
          </ol>
        )}
        <div className="modal-actions">
          <button className="btn btn-ghost" onClick={onDescartar} disabled={ocupado}>
            {t("Discard", "Descartar")}
          </button>
          <button className="btn btn-ghost" onClick={() => setRecuadros([])} disabled={ocupado || recuadros.length === 0}>
            {t("Remove all boxes", "Quitar todos los recuadros")}
          </button>
          <button className="btn btn-ghost" onClick={onDeNuevo} disabled={ocupado}>
            📸 {t("Capture again", "Capturar de nuevo")}
          </button>
          <button className="btn btn-primary" onClick={() => onUsar(recuadros)} disabled={ocupado}>
            {ocupado ? t("Attaching…", "Adjuntando…") : t("Attach to request", "Adjuntar a la solicitud")}
          </button>
        </div>
      </div>
    </div>
  );
}
