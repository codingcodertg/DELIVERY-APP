"use client";

import { useState } from "react";
import { useT } from "@/lib/timetracker/i18n";
import { useData } from "@/lib/timetracker-data-provider";
import { WorkDiary } from "@/components/timetracker/WorkDiary";
import type { Screenshot } from "@/lib/timetracker/types";

// Ported (D-069) from timetracker-clean's employee/EmployeeScreenshots.jsx —
// thin wrapper around the shared WorkDiary: my own screenshots, with the
// ability to delete one (RLS allows an employee to delete their own).
// D-NEXT: pasa del idioma del hub (usePrefs) al de Time Tracker (useT, claves emp.diary.*).
export default function WorkDiaryPage() {
  const t = useT();
  const { myScreenshots, mySessions, deleteScreenshot } = useData();
  const [busy, setBusy] = useState(false);

  async function del(s: Screenshot) {
    if (busy) return;
    if (!confirm(t("emp.diary.deleteConfirm"))) return;
    setBusy(true);
    try { await deleteScreenshot(s.id, s.path); }
    catch (e) { const err = e as { message?: string } | null; alert(t("emp.diary.deleteFail") + (err?.message || t("emp.diary.unknownError"))); }
    finally { setBusy(false); }
  }

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
