"use client";

import { useEffect, useRef, useState } from "react";
import { PayrollTimesheets } from "./PayrollTimesheets";
import { ManagerReports } from "./ManagerReports";
import { PayrollResumen, type Resumen } from "./PayrollResumen";
import { TrabajandoAhora } from "./TrabajandoAhora";
import { DayPhotos } from "./DayPhotos";
import { ExceptionHistory } from "./ExceptionHistory";
import { TeamDiary } from "./TeamDiary";
import { useT } from "@/lib/timetracker/i18n";
import { useData } from "@/lib/timetracker-data-provider";
import {
  guardarSeccionAbierta,
  leerSeccionAbierta,
  seccionAbierta,
  type SeccionDeNomina,
} from "@/lib/timetracker/trabajando-ahora-en-nomina";

/**
 * La nómina de un periodo, en UNA vista (D-190).
 *
 * Tuvo tres pestañas, luego dos (D-165: "Periodo", la foto de horas, y "Pago", el trabajo), y
 * las dos daban números distintos para lo que parecía la misma pregunta. Parte era a
 * propósito (horas contra dinero, D-102) y parte eran bugs; y la sección Remoto de Pago tenía
 * además su propio calendario, así que ni siquiera miraban la misma semana (D-164). Lo que
 * Periodo hacía bien —las dos vías lado a lado sin sumarlas, la marca `revisar`, el tipo
 * deducido— no se pierde: pasa a ser la **cabecera** de esta vista (`PayrollResumen`), siempre
 * visible, encima de las dos secciones plegables. Y el `?period=` de la URL manda en las tres.
 *
 * Las secciones **se montan al abrirse**, no antes: cada una pide sus propios datos y traer
 * los dos juegos para enseñar uno era pagar dos veces por una pantalla que se abre a diario.
 *
 * Encima de todo va «Trabajando ahora» (2026-11-24), plegada por defecto: antes era su propia
 * pestaña y se consolidó aquí. Solo la ven los admins, igual que antes.
 *
 * Debajo de las dos mitades van tres secciones más, también plegadas y solo para admins (2026-11-24,
 * ayuda de Roberto): las fotos de fichaje, las excepciones y las capturas de escritorio, que
 * estaban en Auditoría. Cada una trae su propio selector de persona (D-186).
 */
export function PayrollTabs({ period, resumen, revisar, vistaPorUrl = null }: {
  period: string;
  resumen: Resumen;
  /** Ids de quien tiene horas por las dos vías este periodo (`period_hours.revisar`). */
  revisar: string[];
  /** La URL trae `?vista=…`: esa sección empieza abierta. `null` si no pide ninguna. */
  vistaPorUrl?: SeccionDeNomina | null;
}) {
  const t = useT();
  const { me } = useData();

  return (
    <>
      {me.role === "admin" && (
        <SeccionDeNomina clave="ahora" titulo={t("tab.live")} porUrl={vistaPorUrl === "ahora"}>
          <TrabajandoAhora />
        </SeccionDeNomina>
      )}

      <PayrollResumen r={resumen} />

      <Seccion titulo={t("mgr.pay.onSiteTitle")} nota={t("mgr.pay.onSiteNote")} abierta>
        <PayrollTimesheets period={period} revisar={revisar} />
      </Seccion>

      <Seccion titulo={t("mgr.pay.remoteTitle")} nota={t("mgr.pay.remoteNote")}>
        <ManagerReports period={period} />
      </Seccion>

      {me.role === "admin" && (
        <>
          <SeccionDeNomina clave="fotos" titulo={t("mgr.audit.viewPhotos")} porUrl={vistaPorUrl === "fotos"}>
            <DayPhotos />
          </SeccionDeNomina>
          <SeccionDeNomina clave="excepciones" titulo={t("mgr.audit.viewExceptions")} porUrl={vistaPorUrl === "excepciones"}>
            <ExceptionHistory />
          </SeccionDeNomina>
          <SeccionDeNomina clave="capturas" titulo={t("mgr.audit.viewDesktop")} porUrl={vistaPorUrl === "capturas"}>
            <TeamDiary />
          </SeccionDeNomina>
        </>
      )}
    </>
  );
}

/** El almacén del navegador, o null si no se puede abrir (navegador privado, iframe bloqueado...). */
function almacenDelNavegador(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/**
 * Una sección plegable de Nómina, con cabecera de botón. La usan «Trabajando ahora» y las tres
 * vistas que llegaron de Auditoría. Su cuerpo (`children`) no se monta hasta que se abre, así que
 * lo que haga (sondeos, consultas de fotos o capturas) solo corre mientras la sección está abierta.
 *
 * Quién decide si está abierta: `seccionEstaAbierta` (URL > elección recordada > cerrada). La elección
 * de esta visita pesa más que la URL, para que plegarla de verdad la pliegue. La elección guardada se
 * lee después del montaje, para no dar un HTML distinto en el servidor y en el navegador.
 *
 * Si la URL la pide, la sección se lleva a la vista al montarse, una sola vez.
 */
function SeccionDeNomina({ clave, titulo, porUrl, children }: {
  clave: SeccionDeNomina;
  titulo: string;
  porUrl: boolean;
  children: React.ReactNode;
}) {
  const [recordado, setRecordado] = useState<boolean | null>(null);
  const [elegida, setElegida] = useState<boolean | null>(null);
  const seccionRef = useRef<HTMLDivElement>(null);
  const yaLlevada = useRef(false);

  useEffect(() => {
    setRecordado(leerSeccionAbierta(almacenDelNavegador(), clave));
  }, [clave]);

  useEffect(() => {
    if (!porUrl || yaLlevada.current) return;
    yaLlevada.current = true;
    seccionRef.current?.scrollIntoView({ block: "start" });
  }, [porUrl]);

  const abierta = seccionAbierta({ elegida, porUrl, recordado });
  function alternar() {
    const nueva = !abierta;
    setElegida(nueva);
    guardarSeccionAbierta(almacenDelNavegador(), clave, nueva);
  }

  const cuerpo = `tt-nomina-${clave}-cuerpo`;
  return (
    <div ref={seccionRef} className="card tt-seccion" style={{ marginBottom: 16 }} data-seccion-de-nomina={clave}>
      <h2 className="tt-seccion-titulo">
        <button
          type="button"
          className="tt-seccion-cabecera"
          data-seccion-de-nomina={clave}
          data-trabajando-ahora={clave === "ahora" ? true : undefined}
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

/**
 * Una mitad de la nómina, plegable.
 *
 * Dos pantallas grandes seguidas son ochocientas líneas de alto; sin plegar, la segunda
 * mitad no existe para quien no baja hasta abajo. Se usa `<details>` del navegador y no un
 * acordeón propio por lo de siempre: recuerda el foco, se busca dentro con Ctrl+F, y no hay
 * nada escrito que pueda fallar.
 *
 * `onToggle` monta el contenido la primera vez que se abre. Lo que ya se abrió se queda
 * montado: volver a cerrarlo y abrirlo no debería costar otra carga.
 */
function Seccion({
  titulo, nota, abierta = false, children,
}: {
  titulo: string;
  nota: string;
  abierta?: boolean;
  children: React.ReactNode;
}) {
  const [montada, setMontada] = useState(abierta);

  return (
    <details
      open={abierta}
      style={{ marginBottom: 16 }}
      onToggle={(e) => { if ((e.currentTarget as HTMLDetailsElement).open) setMontada(true); }}
    >
      <summary style={{ cursor: "pointer", fontWeight: 800, fontSize: 15, padding: "6px 0" }}>
        {titulo}
        <span className="muted small" style={{ marginLeft: 10, fontWeight: 400 }}>{nota}</span>
      </summary>
      {montada && children}
    </details>
  );
}
