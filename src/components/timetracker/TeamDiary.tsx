"use client";

import { useEffect, useMemo, useState } from "react";
import { useData } from "@/lib/timetracker-data-provider";
import { useT } from "@/lib/timetracker/i18n";
import { WorkDiary } from "@/components/timetracker/WorkDiary";
import { createClient } from "@/lib/timetracker/supabase/client";
import { rowToCamel } from "@/lib/timetracker/supabase/rowcase";
import { APP_SETTINGS, dateISO, fmtHM } from "@/lib/timetracker/helpers";
import type { Screenshot } from "@/lib/timetracker/types";

// Ported (D-071) from timetracker-clean's manager/Screenshots.jsx — pick an
// employee, browse their day-by-day diary via the shared WorkDiary
// component (already ported once for the employee's own diary, D-069).
// Named /team-diary (the employee route /diary already exists, D-069).
//
// Desde D-194 ya no es una página: es la cuarta vista del selector de Auditoría ("Capturas
// de escritorio"). El cuerpo se MOVIÓ aquí desde `team-diary/page.tsx` sin reescribirlo: el
// borrado de una captura sigue restando su tramo de tiempo pagado a la sesión, y la purga de
// más de 14 días sigue igual. Conserva su propio selector de persona (quien tiene capturas):
// es una lista distinta de la del log y de la de fotos de fichaje, y ninguna gana (D-186).
export function TeamDiary() {
  const { me, allEmployees: users, sessionsSince } = useData();
  const t = useT();
  const supabase = useMemo(() => createClient(), []);
  const [shots, setShots] = useState<Screenshot[]>([]);
  const [sessions, setSessions] = useState<Awaited<ReturnType<typeof sessionsSince>>>([]);
  const [uid, setUid] = useState("");
  const [purgeMsg, setPurgeMsg] = useState("");
  const [purging, setPurging] = useState(false);

  // Company-wide screenshots have no dedicated provider state (see the
  // provider's block comment on why sessions/screenshots at that scale stay
  // on-demand) — loaded once here, most recent first, capped like the
  // original's subscribeRecent(500).
  useEffect(() => {
    let cancelled = false;
    supabase.from("screenshots").select("*").order("taken_at", { ascending: false }).limit(500).then(({ data }) => {
      if (!cancelled) setShots(((data as Record<string, unknown>[] | null) ?? []).map((r) => rowToCamel<Screenshot>(r)!));
    });
    return () => { cancelled = true; };
  }, [supabase]);

  useEffect(() => {
    const start = dateISO(Date.now() - 15 * 86400000);
    sessionsSince(start).then(setSessions);
  }, [sessionsSince]);

  async function purge() {
    if (!confirm(t("mgr.shots.purgeConfirm"))) return;
    setPurging(true); setPurgeMsg("");
    try {
      const cutoff = new Date(Date.now() - 14 * 86400000).toISOString();
      const { data, error } = await supabase.from("screenshots").select("id,path").lt("taken_at", cutoff);
      if (error) throw error;
      const rows = data || [];
      if (rows.length) {
        const paths = rows.map((r) => r.path).filter(Boolean) as string[];
        if (paths.length) await supabase.storage.from("timetracker-screenshots").remove(paths);
        await supabase.from("screenshots").delete().lt("taken_at", cutoff);
      }
      setPurgeMsg(rows.length === 0 ? t("mgr.shots.purgeNone") : t("mgr.shots.purgeDone", { n: rows.length }));
    } catch (e) {
      const err = e as { message?: string } | null;
      setPurgeMsg(t("mgr.shots.purgeFail", { e: err?.message || "unknown error" }));
    } finally { setPurging(false); }
  }

  // Delete a shot AND forfeit its ~segment of paid time (Upwork-style).
  async function deleteShot(s: Screenshot) {
    const segMin = Number(APP_SETTINGS.screenshotIntervalMin) || 10;
    const forfeitSeconds = segMin * 60;
    const msg = s.sessionId ? t("mgr.shots.delConfirm", { d: fmtHM(forfeitSeconds) }) : t("mgr.shots.delConfirmNoSess");
    if (!confirm(msg)) return;
    try {
      if (s.path) { try { await supabase.storage.from("timetracker-screenshots").remove([s.path]); } catch { /* best-effort */ } }
      await supabase.from("screenshots").delete().eq("id", s.id);
      if (s.sessionId && forfeitSeconds > 0) {
        const { data } = await supabase.from("sessions").select("duration_seconds,active_seconds").eq("id", s.sessionId).single();
        if (data) {
          const dur = Math.max(0, ((data.duration_seconds as number) || 0) - forfeitSeconds);
          const act = Math.max(0, Math.min((data.active_seconds as number) || 0, dur));
          await supabase.from("sessions").update({ duration_seconds: dur, active_seconds: act }).eq("id", s.sessionId);
        }
      }
      setShots((prev) => prev.filter((x) => x.id !== s.id));
    } catch (e) {
      const err = e as { message?: string } | null;
      alert(t("mgr.shots.delFail", { e: err?.message || "unknown error" }));
    }
  }

  const empIds = Array.from(new Set(shots.map((s) => s.employeeUid)));
  const employees = users.filter((u) => empIds.includes(u.id));
  const activeUid = uid || employees[0]?.id || "";
  const empShots = shots.filter((s) => s.employeeUid === activeUid);
  const empSessions = sessions.filter((s) => s.employeeUid === activeUid);

  if (me.role !== "admin") return <div className="card"><p className="muted">Admins only.</p></div>;

  return (
    <div className="card">
      <div className="between">
        <h2 style={{ margin: 0 }}>{t("mgr.tab.shots")}</h2>
        <div className="row" style={{ alignItems: "center" }}>
          <select value={activeUid} onChange={(e) => setUid(e.target.value)} style={{ width: "auto" }}>
            {employees.length === 0 && <option value="">{t("mgr.shots.noneOpt")}</option>}
            {employees.map((u) => <option key={u.id} value={u.id}>{u.fullName}</option>)}
          </select>
          <button className="btn-ghost btn-sm" disabled={purging} onClick={purge}>{t("mgr.shots.purgeBtn")}</button>
        </div>
      </div>
      {purgeMsg && <div className="banner info" style={{ marginTop: 10 }}>{purgeMsg}</div>}

      {employees.length === 0 ? (
        <p className="muted" style={{ marginTop: 12 }}>{t("mgr.shots.empty")}</p>
      ) : (
        <WorkDiary key={activeUid} shots={empShots} sessions={empSessions} onDelete={deleteShot} />
      )}
      <p className="small muted" style={{ marginTop: 14 }}>
        {t("mgr.shots.foot", { d: fmtHM((Number(APP_SETTINGS.screenshotIntervalMin) || 10) * 60) })}
      </p>
    </div>
  );
}
