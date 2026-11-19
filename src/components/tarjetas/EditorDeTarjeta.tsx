"use client";

import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { CLAVE_DE_IDIOMA, IDIOMA_POR_DEFECTO, TEXTOS, idiomaDesdeTexto, type Idioma } from "@/lib/tarjetas/textos";
import type { ClaseDeFoto } from "@/lib/tarjetas/fotos";
import { CALIDAD_FOTO, TAMANO_ORIGINAL_MAX } from "@/lib/tarjetas/reduccion";
import { ORIGEN_DE_TARJETAS } from "@/lib/tarjetas/host";
import { type TarjetaPublica } from "@/lib/tarjetas/tarjeta";
import { MARCA } from "@/lib/tarjetas/datos";

// El editor por enlace: la persona recorta su foto (círculo) o su portada (rectángulo de la tarjeta) y la guarda.
// La subida va a `/api/tarjetas/foto`, que valida el token, el tipo y el tamaño. Mismo gesto que el editor del
// contratista: arrastrar, pellizcar, rueda y barra de zoom.

type Forma = "circulo" | "rect";
interface Encuadre { zoom: number; x: number; y: number }

const SALIDA: Record<ClaseDeFoto, { forma: Forma; ancho: number; alto: number; aspecto: number }> = {
  foto: { forma: "circulo", ancho: 800, alto: 800, aspecto: 1 },
  portada: { forma: "rect", ancho: 1200, alto: 644, aspecto: 440 / 236 },
};

const ENCUADRE_INICIAL: Encuadre = { zoom: 1, x: 0, y: 0 };

export function EditorDeTarjeta({ token, tarjeta }: { token: string; tarjeta: TarjetaPublica }) {
  const [idioma, setIdioma] = useState<Idioma>(IDIOMA_POR_DEFECTO);
  const [clase, setClase] = useState<ClaseDeFoto>("foto");
  const [imagenes, setImagenes] = useState<Partial<Record<ClaseDeFoto, HTMLImageElement>>>({});
  const [encuadres, setEncuadres] = useState<Record<ClaseDeFoto, Encuadre>>({ foto: ENCUADRE_INICIAL, portada: ENCUADRE_INICIAL });
  const [cargando, setCargando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [guardadoEn, setGuardadoEn] = useState<number>(0);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const t = TEXTOS[idioma];
  const salida = SALIDA[clase];
  const img = imagenes[clase] ?? null;
  const enc = encuadres[clase];

  useEffect(() => {
    try { setIdioma(idiomaDesdeTexto(localStorage.getItem(CLAVE_DE_IDIOMA))); } catch { /* sin almacenamiento */ }
  }, []);
  useEffect(() => { document.documentElement.lang = idioma; }, [idioma]);

  // La foto y la portada actuales, para empezar el recorte donde están.
  useEffect(() => {
    const cargar = (url: string | null, c: ClaseDeFoto) => {
      if (!url) return;
      const i = new Image();
      i.crossOrigin = "anonymous";
      i.onload = () => setImagenes((prev) => ({ ...prev, [c]: i }));
      i.src = url;
    };
    cargar(tarjeta.fotoUrl, "foto");
    cargar(tarjeta.portadaUrl, "portada");
  }, [tarjeta.fotoUrl, tarjeta.portadaUrl]);

  const avisar = (texto: string) => {
    setToast(texto);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2600);
  };

  const cambiarIdioma = () => {
    const siguiente: Idioma = idioma === "es" ? "en" : "es";
    setIdioma(siguiente);
    try { localStorage.setItem(CLAVE_DE_IDIOMA, siguiente); } catch { /* sin almacenamiento */ }
  };

  const ponerEncuadre = useCallback((c: ClaseDeFoto, f: (e: Encuadre) => Encuadre) => {
    setEncuadres((prev) => ({ ...prev, [c]: f(prev[c]) }));
  }, []);

  // ---- elegir archivo ----
  const elegirArchivo = (f: File | undefined) => {
    if (!f) return;
    if (!["image/jpeg", "image/png", "image/webp"].includes(f.type)) { setAviso(t.editBadFile); return; }
    if (f.size > TAMANO_ORIGINAL_MAX) { setAviso(t.editTooBig); return; }
    setAviso(null);
    const url = URL.createObjectURL(f);
    const i = new Image();
    i.onload = () => {
      setImagenes((prev) => ({ ...prev, [clase]: i }));
      setEncuadres((prev) => ({ ...prev, [clase]: ENCUADRE_INICIAL }));
    };
    i.src = url;
  };

  // ---- guardar ----
  const guardar = async () => {
    if (!img) { setAviso(t.editNeedPhoto); return; }
    setCargando(true);
    setAviso(null);
    try {
      const blob = await exportar(img, enc, salida, CALIDAD_FOTO);
      const form = new FormData();
      form.append("token", token);
      form.append("clase", clase);
      form.append("archivo", new File([blob], `${clase}.jpg`, { type: "image/jpeg" }));
      const r = await fetch("/api/tarjetas/foto", { method: "POST", body: form });
      if (r.status === 429) { setAviso(t.editTooMany); return; }
      if (r.status === 404) { setAviso(t.editBadLink); return; }
      if (!r.ok) { setAviso(t.editError); return; }
      setGuardadoEn(Date.now());
      avisar(t.editSaved);
    } catch {
      setAviso(t.editError);
    } finally {
      setCargando(false);
    }
  };

  const verTarjeta = `${ORIGEN_DE_TARJETAS}/${tarjeta.slug}`;

  return (
    <div className="te">
      <div className="panel">
        <section>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
            <h1>{t.editT}</h1>
            <button className="btn" type="button" onClick={cambiarIdioma} aria-label={t.langLabel}>{idioma === "es" ? "EN" : "ES"}</button>
          </div>
          <p className="sub">{tarjeta.nombre} · {t.editS}</p>

          <div className="row" style={{ marginTop: 18 }} role="tablist">
            {(["foto", "portada"] as const).map((c) => (
              <button key={c} type="button" role="tab" aria-selected={clase === c} className={`btn te-tab${clase === c ? " te-tab-activa" : ""}`}
                onClick={() => { setClase(c); setAviso(null); }}>
                {c === "foto" ? t.editPhoto : t.editCover}
              </button>
            ))}
          </div>

          <Recortador forma={salida.forma} aspecto={salida.aspecto} img={img} enc={enc}
            onCambio={(f) => ponerEncuadre(clase, f)} />
          <p className="hint">{t.editHint}</p>

          <div className="zoom" style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 16 }}>
            <input type="range" min={0.3} max={4} step={0.01} value={enc.zoom} aria-label="Zoom" disabled={!img}
              onChange={(e) => ponerEncuadre(clase, (x) => ({ ...x, zoom: Number(e.target.value) }))} />
          </div>

          <div className="row" style={{ marginTop: 16 }}>
            <label className="btn" style={{ cursor: "pointer" }}>
              {t.editPick}
              <input type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(e) => elegirArchivo(e.target.files?.[0])} />
            </label>
            <button className="btn" type="button" disabled={!img} onClick={() => ponerEncuadre(clase, () => ENCUADRE_INICIAL)}>{t.editReset}</button>
          </div>
          {!img && <p className="note">{t.editPickFirst}</p>}
        </section>

        <aside>
          <div className="mock">
            <div className="cover" style={imagenes.portada ? { backgroundImage: `url(${imagenes.portada.src})` } : undefined} />
            <div className="av">
              <Vista img={imagenes.foto ?? null} enc={encuadres.foto} aspecto={1} />
            </div>
            <div className="name">{tarjeta.nombre}</div>
            <div className="role">{MARCA.nombre}</div>
          </div>

          <div style={{ marginTop: 22 }}>
            <button className="btn primary" type="button" onClick={guardar} disabled={cargando || !img}>
              {cargando ? t.editSaving : t.editSave}
            </button>
            {aviso && <p className="aviso" role="alert">{aviso}</p>}
            {guardadoEn > 0 && (
              <p className="note"><a href={verTarjeta} target="_blank" rel="noopener noreferrer">{t.editView}</a></p>
            )}
          </div>
        </aside>
      </div>
      <div className={`toast${toast ? " show" : ""}`} role="status">{toast ?? ""}</div>
    </div>
  );
}

/** El recorte interactivo: arrastrar, pellizcar y rueda. Dibuja la imagen en un lienzo con el marco. */
function Recortador({ forma, aspecto, img, enc, onCambio }: {
  forma: Forma; aspecto: number; img: HTMLImageElement | null; enc: Encuadre; onCambio: (f: (e: Encuadre) => Encuadre) => void;
}) {
  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const punteros = useRef(new Map<number, { x: number; y: number }>());
  const ultimo = useRef<{ x: number; y: number } | null>(null);
  const pinza = useRef<{ d: number; zoom: number } | null>(null);
  const [arrastrando, setArrastrando] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    const stage = stageRef.current;
    if (!canvas || !stage) return;
    const r = stage.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.round(r.width * dpr));
    canvas.height = Math.max(1, Math.round(r.height * dpr));
    dibujaMarco(canvas, img, enc, r.width / Math.max(1, r.height));
  });

  const tamano = () => stageRef.current?.getBoundingClientRect().width ?? 1;

  const bajar = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    punteros.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    setArrastrando(true);
    if (punteros.current.size === 2) {
      const [a, b] = [...punteros.current.values()];
      pinza.current = { d: Math.hypot(a.x - b.x, a.y - b.y), zoom: enc.zoom };
    }
    ultimo.current = { x: e.clientX, y: e.clientY };
  };
  const mover = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!punteros.current.has(e.pointerId)) return;
    punteros.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const size = tamano();
    if (punteros.current.size === 2 && pinza.current) {
      const [a, b] = [...punteros.current.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      const z = Math.min(4, Math.max(0.3, (pinza.current.zoom * d) / pinza.current.d));
      onCambio((x) => ({ ...x, zoom: z }));
    } else if (punteros.current.size === 1 && ultimo.current) {
      const dx = (e.clientX - ultimo.current.x) / size;
      const dy = (e.clientY - ultimo.current.y) / size;
      onCambio((x) => ({ ...x, x: x.x + dx, y: x.y + dy }));
    }
    ultimo.current = { x: e.clientX, y: e.clientY };
  };
  const soltar = (e: ReactPointerEvent<HTMLDivElement>) => {
    punteros.current.delete(e.pointerId);
    if (punteros.current.size < 2) pinza.current = null;
    const resto = [...punteros.current.values()][0];
    if (resto) ultimo.current = resto;
    if (punteros.current.size === 0) setArrastrando(false);
  };

  return (
    <div ref={stageRef}
      className={`stage ${forma === "circulo" ? "cuadrado circulo" : "rect"}${arrastrando ? " drag" : ""}`}
      style={{ aspectRatio: String(aspecto), touchAction: "none" }}
      onPointerDown={bajar} onPointerMove={mover} onPointerUp={soltar} onPointerCancel={soltar}
      onWheel={(e) => {
        const z = Math.min(4, Math.max(0.3, enc.zoom * Math.exp(-e.deltaY * 0.0015)));
        onCambio((x) => ({ ...x, zoom: z }));
      }}>
      <canvas ref={canvasRef} style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }} />
      <div className={`mask ${forma === "circulo" ? "circulo" : "rect"}`} />
      <div className={`ring ${forma === "circulo" ? "circulo" : "rect"}`} />
    </div>
  );
}

/** Vista pequeña de la misma recorte (para la vista previa). */
function Vista({ img, enc, aspecto }: { img: HTMLImageElement | null; enc: Encuadre; aspecto: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (c) dibujaMarco(c, img, enc, aspecto);
  }, [img, enc, aspecto]);
  return <canvas ref={ref} width={224} height={224} style={{ width: "100%", height: "100%", display: "block" }} />;
}

/**
 * Dibuja el encuadre en el lienzo: fondo neutro y la imagen cubriendo el marco, con el zoom y el desplazamiento del
 * usuario (fracciones del marco). El marco tiene la proporción `aspecto` (ancho / alto) y ocupa todo el lienzo.
 */
function dibujaMarco(c: HTMLCanvasElement, img: HTMLImageElement | null, enc: Encuadre, aspecto: number) {
  const g = c.getContext("2d");
  if (!g) return;
  const W = c.width;
  const H = c.height;
  g.fillStyle = "#0e0e0e";
  g.fillRect(0, 0, W, H);
  if (!img) return;
  const mW = W;
  const mH = W / aspecto;
  const base = Math.max(mW / img.naturalWidth, mH / img.naturalHeight);
  const s = base * enc.zoom;
  const w = img.naturalWidth * s;
  const h = img.naturalHeight * s;
  g.imageSmoothingQuality = "high";
  g.drawImage(img, W / 2 + enc.x * mW - w / 2, H / 2 + enc.y * mH - h / 2, w, h);
}

/** La imagen recortada como JPEG de la salida (800×800 para la foto, 1200×644 para la portada). */
function exportar(img: HTMLImageElement, enc: Encuadre, salida: { ancho: number; alto: number }, calidad: number): Promise<Blob> {
  const c = document.createElement("canvas");
  c.width = salida.ancho;
  c.height = salida.alto;
  const g = c.getContext("2d");
  if (!g) return Promise.reject(new Error("sin lienzo"));
  g.fillStyle = "#0e0e0e";
  g.fillRect(0, 0, c.width, c.height);
  const base = Math.max(c.width / img.naturalWidth, c.height / img.naturalHeight);
  const s = base * enc.zoom;
  const w = img.naturalWidth * s;
  const h = img.naturalHeight * s;
  g.imageSmoothingQuality = "high";
  g.drawImage(img, c.width / 2 + enc.x * c.width - w / 2, c.height / 2 + enc.y * c.height - h / 2, w, h);
  return new Promise((resolver, rechazar) =>
    c.toBlob((b) => (b ? resolver(b) : rechazar(new Error("sin imagen"))), "image/jpeg", calidad));
}
