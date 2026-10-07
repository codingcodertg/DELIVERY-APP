"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useT } from "@/lib/timetracker/i18n";
import { puedeVerMiDiario } from "@/lib/timetracker/vista-empleado";
import { useData } from "@/lib/timetracker-data-provider";
import { WorkDiary } from "@/components/timetracker/WorkDiary";
import type { Screenshot } from "@/lib/timetracker/types";

// Ported (D-069) from timetracker-clean's employee/EmployeeScreenshots.jsx —
// thin wrapper around the shared WorkDiary: my own screenshots, with the
// ability to delete one (RLS allows an employee to delete their own).
// D-206: pasa del idioma del hub (usePrefs) al de Time Tracker (useT, claves emp.diary.*).
export default function WorkDiaryPage() {
  const t = useT();
  const { me, myScreenshots, mySessions, deleteScreenshot } = useData();
  const [busy, setBusy] = useState(false);
  // «Mi diario» ya no es del empleado (D-NEXT): sin pestaña, y quien llegue aquí por un enlace
  // viejo vuelve a «Registrar tiempo». El admin la sigue teniendo.
  const router = useRouter();
  const permitido = puedeVerMiDiario(me.role);
  useEffect(() => { if (!permitido) router.replace("/timetracker"); }, [permitido, router]);

  async function del(s: Screenshot) {
    if (busy) return;
    if (!confirm(t("emp.diary.deleteConfirm"))) return;
    setBusy(true);
    try { await deleteScreenshot(s.id, s.path); }
    catch (e) { const err = e as { message?: string } | null; alert(t("emp.diary.deleteFail") + (err?.message || t("emp.diary.unknownError"))); }
    finally { setBusy(false); }
  }

  if (!permitido) return null;

  return (
    <div className="card">
      <h2>{t("emp.diary.title")}</h2>
      <WorkDiary shots={myScreenshots} sessions={mySessions} onDelete={del} />
      <p className="small muted" style={{ marginTop: 12 }}>
        {t("emp.diary.note")}
      </p>
    </div>
  );
}
