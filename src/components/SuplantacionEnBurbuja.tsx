"use client";

import { useCallback, useEffect, useState } from "react";
import { botonDeVista, estaEnUnMarco } from "@/lib/mobile-preview";
import {
  RUTA_DEL_ESTADO, suplantacionDelEstado, textosDeSuplantacion, tocaVolverSolo, volverAMiCuenta,
  type Suplantacion,
} from "@/lib/suplantacion-en-burbuja";
import type { NamedLocation, Profile } from "@/lib/types";

/**
 * «Entrar como», dentro de la burbuja general (D-NEXT). Hasta ahora lo llevaba la franja `ImpersonationBanner`, pegada
 * arriba en todas las pantallas; el dueño pidió quitarla («ya no quiero esa línea de arriba cuando cambio de usuario; es
 * ineficiente») y que la burbuja se ponga naranja, con un botón rojo encima para volver.
 *
 * Aquí está lo que la franja hacía por debajo, sin cambiar nada: preguntar al servidor UNA vez al montar (la burbuja vive
 * en el layout raíz y no se vuelve a montar al navegar), devolver al admin a su cuenta al cumplirse la hora (el camino
 * amable; el middleware es el respaldo de la pestaña que nadie mira, D-243), pedir la lista para saltar a otra persona
 * solo al pulsar (D-307) y cambiar de vista navegando la pestaña de ARRIBA (D-516). Lo que se pinta, en `BotonGeneral`.
 */

/** La copia de pantalla del idioma de este equipo (`rtg_prefs`), para cuando el admin nunca eligió uno. */
function leeCopiaLocal(): string | null {
  try {
    return localStorage.getItem("rtg_prefs");
  } catch {
    return null;
  }
}

/** La ruta que tiene cargada el marco de la vista móvil, si esta página lo lleva y se deja leer. */
function rutaDelMarcoAbierto(): string | null {
  try {
    const l = document.querySelector<HTMLIFrameElement>("iframe.vista-movil-marco")?.contentWindow?.location;
    return l ? l.pathname + l.search : null;
  } catch {
    return null;
  }
}

/**
 * Se navega la pestaña de ARRIBA: desde dentro del marco es la de fuera, que es la que tiene que dejar de ser la vista
 * móvil; fuera de un marco, `window.top` es esta misma.
 */
function irArriba(destino: string) {
  try {
    (window.top ?? window).location.assign(destino);
  } catch {
    window.location.assign(destino);
  }
}

export type CandidatosDeSalto = { users: Profile[]; stores: NamedLocation[] };

export function useSuplantacion() {
  const [estado, setEstado] = useState<Suplantacion | null>(null);
  const [volviendo, setVolviendo] = useState(false);
  // ¿Esta página está dentro del marco de la vista móvil? (D-516) Se mira al montar: en el servidor no hay ventana.
  const [enMarco, setEnMarco] = useState(false);
  const [candidatos, setCandidatos] = useState<CandidatosDeSalto | null>(null);

  useEffect(() => {
    let vivo = true;
    setEnMarco(estaEnUnMarco(window));
    fetch(RUTA_DEL_ESTADO)
      .then((r) => r.json())
      .then((d: unknown) => { if (vivo) setEstado(suplantacionDelEstado(d, leeCopiaLocal())); })
      .catch(() => { /* sin respuesta no se pinta nada: no hay nada que prometer */ });
    return () => { vivo = false; };
  }, []);

  const volver = useCallback(async (motivo: "manual" | "expired") => {
    setVolviendo(true);
    await volverAMiCuenta(motivo, { fetch: window.fetch.bind(window), ubicacion: window.location });
  }, []);

  // La vuelta sola a la hora (D-243; D-483 dejó de pintar los minutos, no de contarlos).
  useEffect(() => {
    if (!estado) return;
    const tic = () => { if (!volviendo && tocaVolverSolo(estado, Date.now())) void volver("expired"); };
    tic();
    const id = setInterval(tic, 30_000);
    return () => clearInterval(id);
  }, [estado, volviendo, volver]);

  /**
   * La lista para saltar a otra persona (D-307), pedida SOLO al pulsar: una carga normal sigue costando la petición de
   * siempre. Ya viene filtrada por el servidor con la misma regla que la ruta de saltar. `false`: no hay lista (la
   * función apagada o una cookie que no cuadra), y el panel no se abre.
   */
  const pideCandidatos = useCallback(async (): Promise<boolean> => {
    if (candidatos) return true;
    try {
      const r = await fetch("/api/impersonate/switch/candidates");
      if (!r.ok) return false;
      setCandidatos((await r.json()) as CandidatosDeSalto);
      return true;
    } catch {
      return false;
    }
  }, [candidatos]);

  // Lo que hace el botón de vista se decide al pulsar, con la ruta de ese momento (y la del marco, si esta es la página
  // de la vista móvil).
  const cambiarDeVista = useCallback(() => {
    const b = botonDeVista({
      enMarco: estaEnUnMarco(window),
      pathname: window.location.pathname,
      search: window.location.search,
      rutaDelMarco: rutaDelMarcoAbierto(),
    });
    irArriba(b.destino);
  }, []);

  return { estado, volviendo, volver, enMarco, candidatos, pideCandidatos, cambiarDeVista };
}

/**
 * El botón rojo de encima de la burbuja naranja. Sin estado, para pintarlo en una prueba en los dos idiomas. Es el de
 * peligro de la app (`btn-danger`), del alto de un dedo (`.fab-volver`, 44 px).
 */
export function BotonVolverAMiUsuario(p: { suplantacion: Suplantacion; volviendo: boolean; onVolver: () => void }) {
  const { volver } = textosDeSuplantacion({ como: p.suplantacion.como, idioma: p.suplantacion.idioma, volviendo: p.volviendo });
  return (
    <button type="button" className="btn btn-danger fab-volver" data-volver-a-mi-usuario disabled={p.volviendo} onClick={p.onVolver}>
      {volver}
    </button>
  );
}

/**
 * Lo que se lee DENTRO de la burbuja naranja, sin pasar el ratón: «Estás como Ernesto». En un teléfono se corta con
 * «…» antes de empujar la burbuja fuera de la pantalla (`.fab-suplantando-texto`). Con contraseña temporal (D-486),
 * una 🔑 delante; la frase entera va en el menú.
 */
export function EtiquetaDeSuplantacion(p: { suplantacion: Suplantacion }) {
  const { etiqueta } = textosDeSuplantacion(p.suplantacion);
  return (
    <span className="fab-suplantando-texto" data-suplantando-como>
      <span aria-hidden="true">{p.suplantacion.cambiaContrasena ? "🔑 " : "👤 "}</span>
      {etiqueta}
    </span>
  );
}
