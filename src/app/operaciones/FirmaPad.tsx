"use client";

import { useEffect, useRef, useState } from "react";
import { usePrefs } from "@/lib/prefs";

/**
 * Pad de firma dibujada (migración 280): se firma con el dedo o el mouse en un canvas y se exporta como `data:` PNG.
 * Sin librerías. Los colores viven en operaciones.css (`.ops-firma-pad`), no en línea (inline-colors.test).
 */
export function FirmaPad({ etiqueta, onFirmar, onCancelar, guardando = false }: {
  etiqueta: string;
  onFirmar: (png: string) => void;
  onCancelar: () => void;
  guardando?: boolean;
}) {
  const { t } = usePrefs();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dibujando = useRef(false);
  const ultimo = useRef<{ x: number; y: number } | null>(null);
  const [tieneTrazo, setTieneTrazo] = useState(false);

  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    // Resolución física para que el trazo no salga pixelado en móvil.
    const escala = window.devicePixelRatio || 1;
    const rect = c.getBoundingClientRect();
    c.width = Math.round(rect.width * escala);
    c.height = Math.round(rect.height * escala);
    const ctx = c.getContext("2d");
    if (!ctx) return;
    ctx.scale(escala, escala);
    ctx.lineWidth = 2.2;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    // El color del trazo se lee del CSS (currentColor del canvas), para respetar el tema.
    ctx.strokeStyle = getComputedStyle(c).color || "#111";
  }, []);

  const puntoDe = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const c = canvasRef.current!;
    const rect = c.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };
  const empieza = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    canvasRef.current?.setPointerCapture(e.pointerId);
    dibujando.current = true;
    ultimo.current = puntoDe(e);
  };
  const mueve = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!dibujando.current) return;
    e.preventDefault();
    const ctx = canvasRef.current?.getContext("2d");
    const p = puntoDe(e);
    if (ctx && ultimo.current) {
      ctx.beginPath();
      ctx.moveTo(ultimo.current.x, ultimo.current.y);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
      setTieneTrazo(true);
    }
    ultimo.current = p;
  };
  const termina = () => { dibujando.current = false; ultimo.current = null; };

  const borra = () => {
    const c = canvasRef.current;
    const ctx = c?.getContext("2d");
    if (c && ctx) ctx.clearRect(0, 0, c.width, c.height);
    setTieneTrazo(false);
  };
  const guarda = () => {
    const c = canvasRef.current;
    if (!c || !tieneTrazo) return;
    onFirmar(c.toDataURL("image/png"));
  };

  return (
    <div className="ops-corregir ops-firma-pad" data-firma-pad>
      <p className="hint">{etiqueta}</p>
      <canvas
        ref={canvasRef}
        className="ops-firma-canvas"
        data-firma-canvas
        onPointerDown={empieza}
        onPointerMove={mueve}
        onPointerUp={termina}
        onPointerLeave={termina}
        onPointerCancel={termina}
      />
      <div className="modal-actions">
        <button type="button" className="btn" onClick={onCancelar} disabled={guardando}>{t("Cancel", "Cancelar")}</button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={borra} disabled={guardando || !tieneTrazo} data-accion="borrar-firma">{t("Clear", "Borrar")}</button>
        <button type="button" className="btn btn-primary" onClick={guarda} disabled={guardando || !tieneTrazo} data-accion="guardar-firma">
          {guardando ? t("Saving…", "Guardando…") : t("Sign", "Firmar")}
        </button>
      </div>
    </div>
  );
}
