"use client";

import { useState } from "react";
import { useT } from "@/lib/timetracker/i18n";
import { AssignmentsPanel } from "./AssignmentsPanel";
import { ScheduleWeek } from "./ScheduleWeek";

/**
 * Asignaciones, en DOS secciones (D-186): las tarifas por proyecto y el horario semanal.
 *
 * Son dos pantallas que no comparten nada —tabla, proveedor de datos, lado de la línea
 * cliente/servidor— y se juntan aquí porque el dueño las quiere bajo una sola pestaña, con la
 * objeción por escrito en la decisión. Por eso son SECCIONES y no una vista soldada: cada una
 * conserva su propio código y, sobre todo, **su propia lista de personas**:
 *
 *   · Tarifas lista a todo el que tiene `timetracker_role` (sin tienda, sin filtrar inactivos).
 *   · Horario lista solo las tiendas visibles del gerente y solo gente activa (D-127).
 *
 * Unificarlas en cualquier dirección hace desaparecer a alguien de un desplegable sin que
 * salte ningún error. Si algún día se te ocurre pasar una lista a la otra sección, lee D-186
 * primero.
 *
 * Las secciones se montan al abrirse: el horario pide su semana al servidor y las tarifas
 * vienen del proveedor en tiempo real; traer las dos para enseñar una era pagar de más.
 *
 * Precisión (auditoría, al fusionar): lo que se difiere es el MONTAJE, y con él la llamada a
 * `getScheduleWeek`. En bytes no se ahorra nada — los dos paneles se importan estáticos aquí
 * arriba, así que su JS viaja en el mismo chunk. Medido: /timetracker/assignments pasó de
 * 283 kB a 285 kB. El ahorro es de trabajo, no de descarga.
 */
export function AssignmentsTabs() {
  const [view, setView] = useState<"rates" | "schedule">("rates");
  const t = useT();

  return (
    <>
      <div className="tabs" style={{ marginBottom: 12 }}>
        <button className={view === "rates" ? "active" : ""} onClick={() => setView("rates")}>
          {t("mgr.asn.secRates")}
        </button>
        <button className={view === "schedule" ? "active" : ""} onClick={() => setView("schedule")}>
          {t("mgr.asn.secSchedule")}
        </button>
      </div>

      {view === "rates" ? <AssignmentsPanel /> : <ScheduleWeek />}
    </>
  );
}
