"use client";

import { useState } from "react";
import { PayrollTimesheets } from "./PayrollTimesheets";
import { ManagerReports } from "./ManagerReports";
import { usePrefs } from "@/lib/prefs";

/**
 * La nómina de un periodo, en DOS vistas (D-165).
 *
 *   · **Periodo** — cuántas horas hizo cada quien, las dos mitades, sin sumarlas (D-102).
 *     Es la foto: se mira, no se toca. Llega ya renderizada del servidor como `children`.
 *   · **Pago** — el trabajo: aprobar, corregir, calcular y cerrar.
 *
 * Llegó a tener tres. La tercera, "Partes", se separaba de "Pago" por una línea que resultó
 * no ser una línea: las dos son *pagar este periodo*. Lo que de verdad las distinguía era **a
 * quién** se paga —quien ficha cobra la asistencia, quien cronometra cobra las sesiones—, y
 * eso no es una pestaña, es un titular dentro de la misma pantalla. Con tres, quien entraba a
 * cerrar la nómina tenía que acordarse de pasar por dos sitios y de que en el segundo faltaba
 * gente; olvidarse de uno significa que alguien no cobra.
 *
 * Es la misma división que ya usa la vista de Periodo (En sitio / Remoto), así que las dos
 * vistas se leen igual y se corresponden fila a fila.
 *
 * Las secciones **se montan al abrirse**, no antes: cada una pide sus propios datos y traer
 * los dos juegos para enseñar uno era pagar dos veces por una pantalla que se abre a diario.
 */
export function PayrollTabs({ period, children }: { period: string; children: React.ReactNode }) {
  const [view, setView] = useState<"period" | "pay">("period");
  const { t } = usePrefs();

  return (
    <>
      <div className="tabs" style={{ marginBottom: 12 }}>
        <button className={view === "period" ? "active" : ""} onClick={() => setView("period")}>
          🧾 {t("Period", "Periodo")}
        </button>
        <button className={view === "pay" ? "active" : ""} onClick={() => setView("pay")}>
          💵 {t("Pay", "Pago")}
        </button>
      </div>

      {/* `children` es la vista de periodo, que llega ya renderizada del servidor. Se
          mantiene MONTADA y solo se esconde: desmontarla obligaría a volver a pedirla al
          servidor cada vez que alguien va a Pago y vuelve. */}
      <div hidden={view !== "period"}>{children}</div>

      {view === "pay" && (
        <>
          <Seccion
            titulo={`🕐 ${t("On site · timesheets", "En sitio · partes de fichaje")}`}
            nota={t("Paid from punches. Approve, correct and close the period.",
                    "Se paga por lo fichado. Aprobar, corregir y cerrar el periodo.")}
            abierta
          >
            <PayrollTimesheets period={period} />
          </Seccion>

          <Seccion
            titulo={`💻 ${t("Remote · pay from sessions", "Remoto · pago por sesiones")}`}
            nota={t("Paid from tracked sessions. Compute, adjust and record the payment.",
                    "Se paga por lo cronometrado. Calcular, ajustar y registrar el pago.")}
          >
            <ManagerReports period={period} />
          </Seccion>
        </>
      )}
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
