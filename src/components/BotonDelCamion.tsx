"use client";

import { useRef, useState } from "react";
import { useCierraAlSalir } from "@/lib/menu-desplegable";
import { capacidadAGuardar, capacidadEscrita } from "@/lib/gestor/boton-del-camion";

/**
 * «🚚 10» en la cabecera de cada ruta del Gestor (D-655, `lib/gestor/boton-del-camion`): el camión y su capacidad. Pulsado,
 * una ventanita pide la nueva (campo, «Cancelar», «Guardar»; Intro guarda, Escape o un clic fuera cierran sin guardar), y
 * «Guardar» llama a `onGuarda`, que es el `setCapacity` de siempre. Sin `puedeCambiar`, el mismo «🚚 10» sin botón.
 *
 * Una ventanita y no el `prompt` del navegador: el prompt bloquea la pantalla, no se viste como la app y en el iPad sale
 * arriba del todo, lejos de la ruta.
 */
export function BotonDelCamion({ capacidad, puedeCambiar, onGuarda, t }: {
  capacidad: number;
  puedeCambiar: boolean;
  onGuarda: (capacidad: number) => void;
  t: (en: string, es: string) => string;
}) {
  const [abierto, setAbierto] = useState(false);
  const [texto, setTexto] = useState("");
  // Hacia dónde abre: a la izquierda del botón (lo normal, va al final de la fila); a la derecha si el botón está tan a la
  // izquierda que no cabe (en el teléfono la fila baja de línea y el botón puede quedar al principio).
  const [haciaLaDerecha, setHaciaLaDerecha] = useState(false);
  const caja = useRef<HTMLSpanElement>(null);
  useCierraAlSalir(abierto, () => setAbierto(false), () => [caja.current]);
  // «Tarimas» es la «trm» que acompañaba al campo; en inglés, «plt» (pallets).
  const titulo = t(`Truck capacity: ${capacidad} pallets`, `Capacidad del camión: ${capacidad} tarimas`);
  if (!puedeCambiar) {
    return <span className="sema" data-boton-del-camion data-solo-lectura title={titulo} style={{ border: "1px solid var(--line)", color: "var(--gray)" }}>🚚 {capacidad}</span>;
  }
  const valida = capacidadEscrita(texto) != null;
  const guarda = () => {
    if (!valida) return;
    const v = capacidadAGuardar(texto, capacidad);
    if (v != null) onGuarda(v);
    setAbierto(false);
  };
  return (
    // La tarjeta entera, pulsada, suelta la parada enfocada: lo de aquí dentro no es «pulsar fuera».
    <span ref={caja} style={{ position: "relative", display: "inline-block" }} onClick={(e) => e.stopPropagation()}>
      <button type="button" className="btn btn-ghost btn-sm" data-boton-del-camion aria-haspopup="dialog" aria-expanded={abierto}
        title={`${titulo} — ${t("click to change it", "pulse para cambiarla")}`}
        onClick={(e) => {
          setHaciaLaDerecha(e.currentTarget.getBoundingClientRect().right < 230);
          setTexto(String(capacidad));
          setAbierto((v) => !v);
        }}>
        🚚 {capacidad}
      </button>
      {abierto && (
        <div className="col-menu" data-popover-del-camion role="dialog" aria-label={t("Truck capacity", "Capacidad del camión")}
          style={{ width: 210, padding: 10, ...(haciaLaDerecha ? { left: 0, right: "auto" } : {}) }}>
          <form onSubmit={(e) => { e.preventDefault(); guarda(); }}>
            <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12, color: "var(--gray)", fontWeight: 600 }}>
              🚚 {t("Truck capacity (pallets)", "Capacidad del camión (tarimas)")}
              <input type="number" min={1} step="any" inputMode="decimal" data-campo-del-camion autoFocus value={texto}
                onChange={(e) => setTexto(e.target.value)} style={{ width: "100%" }} />
            </label>
            <div style={{ display: "flex", gap: 6, justifyContent: "flex-end", marginTop: 8 }}>
              <button type="button" className="btn btn-ghost btn-sm" data-cancelar-camion onClick={() => setAbierto(false)}>{t("Cancel", "Cancelar")}</button>
              <button type="submit" className="btn btn-primary btn-sm" data-guardar-camion disabled={!valida}>{t("Save", "Guardar")}</button>
            </div>
          </form>
        </div>
      )}
    </span>
  );
}
