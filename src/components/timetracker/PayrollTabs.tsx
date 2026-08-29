"use client";

import { useState } from "react";
import { PayrollTimesheets } from "./PayrollTimesheets";

/**
 * Las dos vistas de la nómina, sobre el MISMO periodo (D-117).
 *
 *   · Period    — las horas de las dos mitades, sin sumarlas (D-102). Se renderiza en el
 *                 servidor y llega aquí como `children`: no había motivo para reescribir una
 *                 tabla que ya funcionaba solo para poder ponerle una pestaña delante.
 *   · Timesheets — los partes de fichaje: aprobar, corregir y cerrar el periodo.
 *
 * Que compartan la navegación de periodo es la mitad del arreglo. Antes eran dos pantallas
 * con dos calendarios propios, y comprobar un dato de la semana pasada obligaba a mover los
 * dos por separado y confiar en que apuntaran a lo mismo. Ahora el periodo está en la URL
 * (`?period=`) y las dos vistas lo leen de ahí.
 */
export function PayrollTabs({ period, children }: { period: string; children: React.ReactNode }) {
  const [view, setView] = useState<"period" | "sheets">("period");

  return (
    <>
      <div className="tabs" style={{ marginBottom: 12 }}>
        <button className={view === "period" ? "active" : ""} onClick={() => setView("period")}>🧾 Period</button>
        <button className={view === "sheets" ? "active" : ""} onClick={() => setView("sheets")}>✅ Timesheets</button>
      </div>
      {view === "period" ? children : <PayrollTimesheets period={period} />}
    </>
  );
}
