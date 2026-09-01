"use client";

import { useState } from "react";
import { usePrefs } from "@/lib/prefs";
import { useData } from "@/lib/timetracker-data-provider";
import { WorkDiary } from "@/components/timetracker/WorkDiary";
import type { Screenshot } from "@/lib/timetracker/types";

// Ported (D-069) from timetracker-clean's employee/EmployeeScreenshots.jsx —
// thin wrapper around the shared WorkDiary: my own screenshots, with the
// ability to delete one (RLS allows an employee to delete their own).
export default function WorkDiaryPage() {
  const { t } = usePrefs();
  const { myScreenshots, mySessions, deleteScreenshot } = useData();
  const [busy, setBusy] = useState(false);

  async function del(s: Screenshot) {
    if (busy) return;
    if (!confirm(t("Delete this screenshot? This removes it permanently, for your manager too.", "¿Borrar esta captura? Se elimina para siempre, también para su encargado."))) return;
    setBusy(true);
    try { await deleteScreenshot(s.id, s.path); }
    catch (e) { const err = e as { message?: string } | null; alert(t("Could not delete: ", "No se pudo borrar: ") + (err?.message || t("unknown error", "error desconocido"))); }
    finally { setBusy(false); }
  }

  return (
    <div className="card">
      <h2>{t("Work diary", "Diario de trabajo")}</h2>
      <WorkDiary shots={myScreenshots} sessions={mySessions} onDelete={del} />
      <p className="small muted" style={{ marginTop: 12 }}>
        {t("One screenshot per ~10-minute segment (up to 6/hour), taken at a random time. The bar shows that segment’s activity. Deleting a shot removes it for your manager too.",
           "Una captura por cada segmento de ~10 minutos (hasta 6 por hora), tomada a una hora al azar. La barra muestra la actividad de ese segmento. Borrar una captura la elimina también para su encargado.")}
      </p>
    </div>
  );
}
