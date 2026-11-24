"use client";

import { Suspense, useEffect, useRef, useState, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import { useData } from "@/lib/timetracker-data-provider";
import { useT } from "@/lib/timetracker/i18n";
import { guardarEleccion, leerEleccion } from "@/lib/timetracker/seccion-plegable";
import { ScheduleWeek } from "./ScheduleWeek";
import { MiSemana } from "./MiSemana";

/**
 * Lo que va debajo del reloj de «Registrar tiempo» (owner, 2026-11-24: «The Schedule tab is retired; from now on it
 * lives in Track Time» y «My week is removed»): dos secciones plegadas.
 *
 *   · «Schedule» (`tab.assignments`), solo para admins: el horario semanal (`ScheduleWeek`).
 *   · «My week» (`tab.week`), para todos: lo que era la pantalla /timetracker/week (`MiSemana`).
 *
 * Las dos vienen cerradas, y su cuerpo no se monta hasta abrirlas (`ScheduleWeek` llama al servidor al montarse).
 * Se abren desde la URL: `?vista=horario` y `?vista=semana`; la URL manda sobre la elección recordada, y al llegar
 * por ella la sección se lleva a la vista una vez. La elección de cada persona se recuerda en el navegador.
 *
 * No usa `SeccionPlegable` porque ese muestra «…» como cuenta mientras no hay número, y aquí no hay cuenta que
 * enseñar. Usa las mismas clases (`tt-seccion…`) y el mismo patrón de guardar la elección.
 *
 * Este componente no toca el cronómetro: lo monta el layout, y no se importa aquí.
 */

const CLAVES_DE_ELECCION = {
  horario: "tt_registrar_horario_abierta",
  semana: "tt_registrar_semana_abierta",
} as const;

type Seccion = keyof typeof CLAVES_DE_ELECCION;

/** El almacén del navegador, o null si no se puede abrir (navegador privado, iframe bloqueado...). */
function almacenDelNavegador(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/**
 * `useSearchParams` exige un límite de Suspense al prerenderizar; el contenido es el mismo, solo cambia la URL.
 */
export function SeccionesDeRegistrarTiempo() {
  return (
    <Suspense fallback={null}>
      <Secciones />
    </Suspense>
  );
}

function Secciones() {
  const { me } = useData();
  const t = useT();
  const vista = useSearchParams().get("vista");
  return (
    <>
      {me.role === "admin" && (
        <SeccionDeRegistrar seccion="horario" titulo={t("tab.assignments")} porUrl={vista === "horario"}>
          <ScheduleWeek />
        </SeccionDeRegistrar>
      )}
      <SeccionDeRegistrar seccion="semana" titulo={t("tab.week")} porUrl={vista === "semana"}>
        <MiSemana />
      </SeccionDeRegistrar>
    </>
  );
}

/**
 * Una sección plegable con cabecera de botón (`aria-expanded`), igual que las de Nómina.
 *
 * Quién decide si está abierta: la elección de esta visita, si la hay; si no, la URL; si no, la elección
 * recordada; si no, cerrada. La elección guardada se lee después del montaje, para no dar un HTML distinto
 * en el servidor y en el navegador.
 */
function SeccionDeRegistrar({ seccion, titulo, porUrl, children }: {
  seccion: Seccion;
  titulo: string;
  /** La URL pide esta sección (`?vista=…`). */
  porUrl: boolean;
  children: ReactNode;
}) {
  const [recordada, setRecordada] = useState<boolean | null>(null);
  const [elegida, setElegida] = useState<boolean | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setRecordada(leerEleccion(almacenDelNavegador(), CLAVES_DE_ELECCION[seccion]));
  }, [seccion]);

  // Si la URL la pide (al montarse o al llegar otra vez por un enlace con ?vista=), se lleva a la vista y
  // la elección de esta visita deja de mandar.
  useEffect(() => {
    if (!porUrl) return;
    setElegida(null);
    ref.current?.scrollIntoView({ block: "start" });
  }, [porUrl]);

  const abierta = elegida ?? (porUrl || recordada === true);
  function alternar() {
    const nueva = !abierta;
    setElegida(nueva);
    guardarEleccion(almacenDelNavegador(), CLAVES_DE_ELECCION[seccion], nueva);
  }

  const cuerpo = `tt-registrar-${seccion}-cuerpo`;
  return (
    <div ref={ref} className="card tt-seccion" style={{ marginBottom: 16 }} data-seccion-de-registrar={seccion}>
      <h2 className="tt-seccion-titulo">
        <button
          type="button"
          className="tt-seccion-cabecera"
          data-seccion-de-registrar={seccion}
          aria-expanded={abierta}
          aria-controls={abierta ? cuerpo : undefined}
          onClick={alternar}
        >
          <span className="tt-seccion-marca" aria-hidden="true">{abierta ? "▾" : "▸"}</span>
          <span className="tt-seccion-texto">{titulo}</span>
        </button>
      </h2>
      {abierta && <div id={cuerpo} className="tt-seccion-cuerpo">{children}</div>}
    </div>
  );
}
