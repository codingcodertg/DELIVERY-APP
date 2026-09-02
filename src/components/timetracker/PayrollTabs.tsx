"use client";

import { useState } from "react";
import { PayrollTimesheets } from "./PayrollTimesheets";
import { ManagerReports } from "./ManagerReports";
import { usePrefs } from "@/lib/prefs";

/**
 * Las dos vistas de la nómina, sobre el MISMO periodo (D-117).
 *
 *   · Periodo    — las horas de las dos mitades, sin sumarlas (D-102). Se renderiza en el
 *                  servidor y llega aquí como `children`: no había motivo para reescribir una
 *                  tabla que ya funcionaba solo para poder ponerle una pestaña delante.
 *   · Partes     — los partes de fichaje: aprobar, corregir y cerrar el periodo.
 *   · Pago       — lo que era "Informes y pago", una pestaña aparte en la barra (D-164).
 *
 * Que compartan la navegación de periodo es la mitad del arreglo. Antes eran dos pantallas
 * con dos calendarios propios, y comprobar un dato de la semana pasada obligaba a mover los
 * dos por separado y confiar en que apuntaran a lo mismo. Ahora el periodo está en la URL
 * (`?period=`) y las dos vistas lo leen de ahí.
 *
 * "Pago" es el tercer paso de la misma pregunta —cuánto se le paga a quién por este
 * periodo— y estaba en su propia pestaña, al lado de esta. Se trae aquí. Conserva su propio
 * selector de periodo, y eso es a propósito: es la pantalla que calcula la nómina de verdad,
 * con años de correcciones dentro, y cambiarle la fuente de la fecha en la misma tanda en
 * que se muda es exactamente como se rompe una nómina.
 */
export function PayrollTabs({ period, children }: { period: string; children: React.ReactNode }) {
  const [view, setView] = useState<"period" | "sheets" | "pay">("period");
  const { t } = usePrefs();

  return (
    <>
      <div className="tabs" style={{ marginBottom: 12 }}>
        <button className={view === "period" ? "active" : ""} onClick={() => setView("period")}>
          🧾 {t("Period", "Periodo")}
        </button>
        <button className={view === "sheets" ? "active" : ""} onClick={() => setView("sheets")}>
          ✅ {t("Timesheets", "Partes")}
        </button>
        <button className={view === "pay" ? "active" : ""} onClick={() => setView("pay")}>
          💵 {t("Pay", "Pago")}
        </button>
      </div>
      {/* `children` es la vista de periodo, que llega ya renderizada del servidor. Se
          mantiene MONTADA y solo se esconde: desmontarla obligaría a volver a pedirla al
          servidor cada vez que alguien va a Pago y vuelve. Las otras dos sí se montan al
          entrar, porque piden sus propios datos y no tiene sentido traerlos antes. */}
      <div hidden={view !== "period"}>{children}</div>
      {view === "sheets" && <PayrollTimesheets period={period} />}
      {view === "pay" && <ManagerReports />}
    </>
  );
}
