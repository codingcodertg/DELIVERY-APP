"use client";

import { useEffect, useState, type ReactNode } from "react";
import { claveDeEleccion, guardarEleccion, leerEleccion, seccionAbierta } from "@/lib/timetracker/seccion-plegable";

/** El almacén del navegador, o null si no se puede abrir (navegador privado, iframe bloqueado...). */
function almacenDelNavegador(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/**
 * Si una sección está abierta, y la función que la abre o la cierra y lo recuerda.
 *
 * La elección guardada se lee DESPUÉS del montaje, no en el primer render: leerla al renderizar
 * daría una pantalla en el servidor y otra en el navegador, y React lo marca como error de
 * hidratación. Mientras tanto la sección se ve con su valor por defecto.
 */
export function useSeccionAbierta(seccion: string, abreConPendientes: boolean, hayPendientes: boolean) {
  const [recordado, setRecordado] = useState<boolean | null>(null);
  useEffect(() => {
    setRecordado(leerEleccion(almacenDelNavegador(), claveDeEleccion(seccion)));
  }, [seccion]);

  const abierta = seccionAbierta({ abreConPendientes, hayPendientes, recordado });
  function alternar() {
    const nueva = !abierta;
    setRecordado(nueva);
    guardarEleccion(almacenDelNavegador(), claveDeEleccion(seccion), nueva);
  }
  return { abierta, alternar };
}

/**
 * Tarjeta plegable con la misma cabecera para las cuatro secciones de la bandeja: título, un
 * contador de filas y una flecha. La cabecera es un `<button>` con `aria-expanded`, así que el
 * teclado y los lectores de pantalla la leen como un control que abre y cierra.
 *
 * El cuerpo no se monta cuando está cerrado: las tablas de abajo no pintan nada hasta que se
 * abren, y el calendario carga sus datos solo cuando alguien lo pide.
 */
export function SeccionPlegable({ seccion, titulo, cuenta, abierta, alternar, children }: {
  seccion: string;
  titulo: string;
  /** Número de filas. null mientras no se sabe (la lista aún está cargando). */
  cuenta: number | null;
  abierta: boolean;
  alternar: () => void;
  children: ReactNode;
}) {
  const cuerpo = "tt-seccion-cuerpo-" + seccion;
  return (
    <div className="card tt-seccion">
      <h2 className="tt-seccion-titulo">
        <button
          type="button"
          className="tt-seccion-cabecera"
          aria-expanded={abierta}
          aria-controls={abierta ? cuerpo : undefined}
          onClick={alternar}
        >
          <span className="tt-seccion-marca" aria-hidden="true">{abierta ? "▾" : "▸"}</span>
          <span className="tt-seccion-texto">{titulo}</span>
          <span className="tt-seccion-cuenta">{cuenta ?? "…"}</span>
        </button>
      </h2>
      {abierta && <div id={cuerpo} className="tt-seccion-cuerpo">{children}</div>}
    </div>
  );
}
