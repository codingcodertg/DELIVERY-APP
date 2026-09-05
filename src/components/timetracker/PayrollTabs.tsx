"use client";

import { useState } from "react";
import { PayrollTimesheets } from "./PayrollTimesheets";
import { ManagerReports } from "./ManagerReports";
import { PayrollResumen, type Resumen } from "./PayrollResumen";
import { useT } from "@/lib/timetracker/i18n";

/**
 * La nómina de un periodo, en UNA vista (D-NEXT).
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
 */
export function PayrollTabs({ period, resumen, revisar }: {
  period: string;
  resumen: Resumen;
  /** Ids de quien tiene horas por las dos vías este periodo (`period_hours.revisar`). */
  revisar: string[];
}) {
  const t = useT();

  return (
    <>
      <PayrollResumen r={resumen} />

      <Seccion titulo={t("mgr.pay.onSiteTitle")} nota={t("mgr.pay.onSiteNote")} abierta>
        <PayrollTimesheets period={period} revisar={revisar} />
      </Seccion>

      <Seccion titulo={t("mgr.pay.remoteTitle")} nota={t("mgr.pay.remoteNote")}>
        <ManagerReports period={period} />
      </Seccion>
    </>
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
