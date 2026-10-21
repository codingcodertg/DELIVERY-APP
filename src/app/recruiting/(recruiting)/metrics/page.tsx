"use client";

import { useState } from "react";
import { useData } from "@/lib/recruiting-data-provider";
import { usePrefs } from "@/lib/prefs";
import { fmtPct, scoreOf } from "@/lib/recruiting/utils";
import { formatoEnBrownsville } from "@/lib/recruiting/hora-de-brownsville";

export default function MetricsPage() {
  const { candidates, recruiters, stages, settings } = useData();
  const { t, lang } = usePrefs();
  const loc = lang === "es" ? "es-US" : "en-US";
  const wonStage = stages.find((s) => s.type === "won");
  const lostStage = stages.find((s) => s.type === "lost");
  const [range, setRange] = useState<"all" | "week" | "month" | "year">("all");
  const now = new Date();

  const inRange = (iso: string | null) => {
    if (range === "all" || !iso) return range === "all";
    const d = new Date(iso.length === 10 ? iso + "T12:00:00" : iso);
    const diff = (now.getTime() - d.getTime()) / 864e5;
    if (range === "week") return diff <= 7;
    if (range === "month") return diff <= 31;
    if (range === "year") return diff <= 365;
    return true;
  };

  const cs = range === "all" ? candidates : candidates.filter((c) => inRange(c.reg_date));
  const total = cs.length;

  const counts: Record<string, number> = {};
  stages.forEach((s) => (counts[s.key] = cs.filter((c) => c.status === s.key).length));
  const hired = wonStage ? counts[wonStage.key] : 0;
  const discarded = lostStage ? counts[lostStage.key] : 0;
  const interviewed = cs.filter((c) => c.interview).length;
  const pct = (n: number) => (total ? Math.round((n / total) * 100) : 0);

  const scores = cs.map(scoreOf).filter((n): n is number => n != null);
  const avgScore = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null;

  const days = cs
    .filter((c) => c.interview?.date && c.reg_date)
    .map((c) => Math.max(0, Math.round((new Date(c.interview!.date).getTime() - new Date(c.reg_date + "T12:00:00").getTime()) / 864e5)));
  const avgDays = days.length ? Math.round(days.reduce((a, b) => a + b, 0) / days.length) : null;

  const bySource: Record<string, number> = {};
  cs.forEach((c) => { const s = (c.source || "—").trim() || "—"; bySource[s] = (bySource[s] || 0) + 1; });
  const sources = Object.entries(bySource).sort((a, b) => b[1] - a[1]);
  const maxSource = sources.length ? sources[0][1] : 1;

  // #33 source effectiveness: total, hired, hire-rate, avg score per source
  const srcStats = sources.map(([name]) => {
    const list = cs.filter((c) => (c.source || "—").trim() === name || (!c.source && name === "—"));
    const h = list.filter((c) => wonStage && c.status === wonStage.key).length;
    const scored = list.map(scoreOf).filter((n): n is number => n != null);
    const avg = scored.length ? scored.reduce((a, b) => a + b, 0) / scored.length : null;
    return { name, total: list.length, hired: h, rate: list.length ? Math.round((h / list.length) * 100) : 0, avg };
  }).sort((a, b) => b.rate - a.rate || b.hired - a.hired);

  const recName = (id: string | null) => recruiters.find((r) => r.id === id)?.full_name ?? t("Unassigned", "Sin asignar");
  const byRec: Record<string, { total: number; hired: number }> = {};
  cs.forEach((c) => {
    const r = recName(c.assigned_recruiter);
    if (!byRec[r]) byRec[r] = { total: 0, hired: 0 };
    byRec[r].total++;
    if (wonStage && c.status === wonStage.key) byRec[r].hired++;
  });
  const recRanking = Object.entries(byRec).sort((a, b) => b[1].total - a[1].total);
  const maxRec = recRanking.length ? recRanking[0][1].total : 1;

  // ---- per-position breakdown -------------------------------------------------
  // Grouped by `role`, not by `job_id`: requisitions are optional and in practice
  // unused, so grouping by job would produce an empty table.
  const byRole: Record<string, typeof cs> = {};
  cs.forEach((c) => {
    const r = (c.role || "").trim() || t("No position", "Sin puesto");
    (byRole[r] = byRole[r] || []).push(c);
  });
  const roleStats = Object.entries(byRole)
    .map(([name, list]) => {
      const h = wonStage ? list.filter((c) => c.status === wonStage.key).length : 0;
      const d = lostStage ? list.filter((c) => c.status === lostStage.key).length : 0;
      const scored = list.map(scoreOf).filter((n): n is number => n != null);
      const avg = scored.length ? scored.reduce((a, b) => a + b, 0) / scored.length : null;
      const active = list.filter((c) => stages.find((s) => s.key === c.status)?.type === "active").length;
      return {
        name,
        total: list.length,
        interviewed: list.filter((c) => c.interview).length,
        hired: h,
        rate: list.length ? Math.round((h / list.length) * 100) : 0,
        discarded: d,
        discardRate: list.length ? Math.round((d / list.length) * 100) : 0,
        avg,
        active,
      };
    })
    .sort((a, b) => b.total - a.total);
  const maxRole = roleStats.length ? roleStats[0].total : 1;

  // funnel = active stages in order, then the terminal "won" and "lost" stages
  const funnelStages = [...stages.filter((s) => s.type === "active"), ...(wonStage ? [wonStage] : []), ...(lostStage ? [lostStage] : [])];
  const maxFunnel = Math.max(1, ...funnelStages.map((s) => counts[s.key]));

  // #9 avg days candidates have spent in their CURRENT stage, per stage
  const daysSince = (iso: string | null) =>
    iso ? Math.max(0, (now.getTime() - new Date(iso).getTime()) / 864e5) : null;
  const stageTime = stages.filter((s) => s.type === "active").map((s) => {
    const list = cs.filter((c) => c.status === s.key);
    const ds = list.map((c) => daysSince(c.stage_changed_at)).filter((x): x is number => x != null);
    const avg = ds.length ? ds.reduce((a, b) => a + b, 0) / ds.length : null;
    return { stage: s, n: list.length, avg };
  });
  const maxStageTime = Math.max(1, ...stageTime.map((s) => s.avg ?? 0));

  // #8 weekly report — last 7 days summary, ready to copy or email the manager
  const within7 = (iso: string | null) => {
    if (!iso) return false;
    const d = new Date(iso.length === 10 ? iso + "T12:00:00" : iso);
    return (now.getTime() - d.getTime()) / 864e5 <= 7;
  };
  const buildWeekly = () => {
    const newRegs = candidates.filter((c) => within7(c.reg_date));
    const interviews = candidates.filter((c) => within7(c.interview?.date ?? null));
    const hires = candidates.filter((c) => wonStage && c.status === wonStage.key && within7(c.stage_changed_at));
    const discards = candidates.filter((c) => lostStage && c.status === lostStage.key && within7(c.stage_changed_at));
    const active = candidates.filter((c) => !c.archived && stages.find((s) => s.key === c.status)?.type === "active").length;

    const unassigned = t("Unassigned", "Sin asignar");
    const perRec: Record<string, { neu: number; hired: number }> = {};
    newRegs.forEach((c) => {
      const r = recruiters.find((x) => x.id === c.assigned_recruiter)?.full_name ?? unassigned;
      perRec[r] = perRec[r] || { neu: 0, hired: 0 };
      perRec[r].neu++;
    });
    hires.forEach((c) => {
      const r = recruiters.find((x) => x.id === c.assigned_recruiter)?.full_name ?? unassigned;
      perRec[r] = perRec[r] || { neu: 0, hired: 0 };
      perRec[r].hired++;
    });

    const L: string[] = [];
    L.push(`${settings.app_name || "Recruiting"} — ${t("Weekly report", "Reporte semanal")}`);
    L.push(`${t("Week ending", "Semana que termina")} ${formatoEnBrownsville(now, loc, { year: "numeric", month: "long", day: "numeric" })}`);
    L.push("");
    L.push(`• ${t("New candidates", "Nuevos candidatos")}: ${newRegs.length}`);
    L.push(`• ${t("Interviews done", "Entrevistas realizadas")}: ${interviews.length}`);
    L.push(`• ${t("Hires", "Contrataciones")}: ${hires.length}`);
    L.push(`• ${t("Discards", "Descartes")}: ${discards.length}`);
    L.push(`• ${t("Still active in pipeline", "Aún activos en el proceso")}: ${active}`);
    L.push("");
    L.push(t("By recruiter (new / hired):", "Por reclutador (nuevos / contratados):"));
    Object.entries(perRec).sort((a, b) => b[1].neu - a[1].neu).forEach(([r, v]) => L.push(`  - ${r}: ${v.neu} ${t("new", "nuevos")}, ${v.hired} ${t("hired", "contratados")}`));
    if (hires.length) {
      L.push("");
      L.push(t("Hired this week:", "Contratados esta semana:"));
      hires.forEach((c) => L.push(`  - ${c.name}${c.role ? " (" + c.role + ")" : ""}`));
    }
    return L.join("\n");
  };
  const copyWeekly = async () => {
    try { await navigator.clipboard.writeText(buildWeekly()); alert(t("Weekly report copied ✓ — paste it anywhere.", "Reporte semanal copiado ✓ — pégalo donde quieras.")); }
    catch { alert(buildWeekly()); }
  };
  const emailWeekly = () => {
    const subject = encodeURIComponent(`${settings.app_name || "Recruiting"} — Weekly report`);
    const body = encodeURIComponent(buildWeekly());
    window.open(`mailto:?subject=${subject}&body=${body}`, "_blank");
  };

  return (
    <div>
      {/* #12 print-only header with company name + generated date */}
      <div className="print-only" style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 22, fontWeight: 800 }}>{settings.app_name || "Recruiting"} — {t("Metrics report", "Reporte de métricas")}</div>
        <div style={{ color: "#555" }}>
          {t("Range", "Rango")}: {({ all: t("All time", "Todo"), week: t("Last 7 days", "Últimos 7 días"), month: t("Last 30 days", "Últimos 30 días"), year: t("Last year", "Último año") } as const)[range]}
          {" · "}{t("Generated", "Generado")} {formatoEnBrownsville(now, loc, { year: "numeric", month: "long", day: "numeric" })}
        </div>
      </div>
      <div className="card no-print" style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", padding: "12px 16px" }}>
        <b style={{ fontSize: 13 }}>📊 {t("Metrics", "Métricas")}</b>
        <div className="filters" style={{ margin: 0 }}>
          {([["all", t("All time", "Todo")], ["week", t("Last 7 days", "Últimos 7 días")], ["month", t("Last 30 days", "Últimos 30 días")], ["year", t("Last year", "Último año")]] as const).map(([id, l]) => (
            <button key={id} className={"chip " + (range === id ? "on" : "")} onClick={() => setRange(id)}>{l}</button>
          ))}
        </div>
        <button className="btn btn-ghost btn-sm" style={{ marginLeft: "auto" }} onClick={copyWeekly}>📄 {t("Weekly report", "Reporte semanal")}</button>
        <button className="btn btn-ghost btn-sm" onClick={emailWeekly}>✉️ {t("Email report", "Enviar reporte")}</button>
        <button className="btn btn-ghost btn-sm" onClick={() => window.print()}>🖨 {t("Export / Print", "Exportar / Imprimir")}</button>
      </div>

      {total === 0 ? (
        <div className="card"><div className="empty">{t("No data in this period. Register candidates or widen the range.", "Sin datos en este periodo. Registra candidatos o amplía el rango.")}</div></div>
      ) : (
        <div>
          <div className="sec-head">
            <span className="sec-title">📊 {t("General", "General")}</span>
            <span className="sec-sub">{t("Everything in the selected range", "Todo el rango seleccionado")}</span>
          </div>

          <div className="kpi-grid">
            <div className="kpi"><div className="k-val">{total}</div><div className="k-lbl">{t("Total candidates", "Total candidatos")}</div></div>
            <div className="kpi"><div className="k-val" style={{ color: "var(--green)" }}>{pct(hired)}%</div><div className="k-lbl">{t("Hire rate", "Tasa contratación")}</div><div className="k-sub">{hired} {t("hired", "contratados")}</div></div>
            <div className="kpi"><div className="k-val" style={{ color: "var(--red)" }}>{pct(discarded)}%</div><div className="k-lbl">{t("Discard rate", "Tasa descarte")}</div><div className="k-sub">{discarded} {t("discarded", "descartados")}</div></div>
            <div className="kpi"><div className="k-val" style={{ color: "var(--amber)" }}>{fmtPct(avgScore)}</div><div className="k-lbl">{t("Avg interview score", "Promedio entrevista")}</div><div className="k-sub">{interviewed} {t("interviewed", "entrevistados")}</div></div>
            <div className="kpi"><div className="k-val">{avgDays == null ? "—" : avgDays}</div><div className="k-lbl">{t("Avg days to interview", "Días prom. a entrevista")}</div><div className="k-sub">{t("register → interview", "registro → entrevista")}</div></div>
          </div>

          <div className="card">
            <h2>🔻 {t("Conversion funnel", "Embudo de conversión")}</h2>
            {funnelStages.map((s) => {
              const n = counts[s.key];
              return (
                <div key={s.key} className="funnel-row">
                  <div className="funnel-label"><span className="dot" style={{ background: s.color }} />{s.label}</div>
                  <div className="funnel-track">
                    <div className="funnel-fill" style={{ width: Math.max(6, (n / maxFunnel) * 100) + "%", background: s.color }}>{n}</div>
                  </div>
                  <div className="bar-val">{pct(n)}%</div>
                </div>
              );
            })}
            <div className="hint">{t("Counts reflect each candidate's current stage (not cumulative history).", "Los conteos reflejan la etapa actual de cada candidato (no el historial acumulado).")}</div>
          </div>

          <div className="card">
            <h2>⏱ {t("Avg time in stage", "Tiempo prom. por etapa")}</h2>
            {stageTime.map(({ stage, n, avg }) => (
              <div key={stage.key} className="bar-row">
                <div className="bar-label"><span className="dot" style={{ background: stage.color }} /> {stage.label}</div>
                <div className="bar-track">
                  <div className="bar-fill" style={{ width: Math.max(4, ((avg ?? 0) / maxStageTime) * 100) + "%", background: stage.color }} />
                </div>
                <div className="bar-val" style={{ flex: "0 0 120px" }}>
                  {avg == null ? "—" : avg.toFixed(1) + t("d avg", "d prom")} <span style={{ color: "var(--gray)" }}>({n})</span>
                </div>
              </div>
            ))}
            <div className="hint">{t("Average days candidates currently sitting in each stage have been there. High numbers = bottlenecks.", "Días promedio que los candidatos actuales llevan en cada etapa. Números altos = cuellos de botella.")}</div>
          </div>

          <div className="card">
            <h2>📥 {t("Candidates by source", "Candidatos por fuente")}</h2>
            {sources.map(([name, n]) => (
              <div key={name} className="bar-row">
                <div className="bar-label">{name}</div>
                <div className="bar-track"><div className="bar-fill" style={{ width: Math.max(4, (n / maxSource) * 100) + "%" }} /></div>
                <div className="bar-val">{n}</div>
              </div>
            ))}
          </div>

          <div className="card">
            <h2>🎯 {t("Source effectiveness", "Efectividad por fuente")}</h2>
            <div style={{ overflowX: "auto" }}>
              <table className="cmp-tbl">
                <thead>
                  <tr><th>{t("Source", "Fuente")}</th><th>{t("Candidates", "Candidatos")}</th><th>{t("Hired", "Contratados")}</th><th>{t("Hire rate", "Tasa contratación")}</th><th>{t("Avg score", "Puntaje prom.")}</th></tr>
                </thead>
                <tbody>
                  {srcStats.map((s) => (
                    <tr key={s.name}>
                      <td className="rowh">{s.name}</td>
                      <td>{s.total}</td>
                      <td style={{ color: "var(--green)" }}>{s.hired}</td>
                      <td style={{ fontWeight: 700 }}>{s.rate}%</td>
                      <td style={{ color: "var(--amber)" }}>{fmtPct(s.avg)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="hint">{t("Which channels actually convert to hires — not just volume.", "Qué canales realmente convierten en contrataciones — no solo volumen.")}</div>
          </div>

          <div className="card">
            <h2>🧑‍💼 {t("Recruiter ranking", "Ranking de reclutadores")}</h2>
            {recRanking.map(([name, r]) => (
              <div key={name} className="bar-row">
                <div className="bar-label">{name}</div>
                <div className="bar-track"><div className="bar-fill" style={{ width: Math.max(4, (r.total / maxRec) * 100) + "%", background: "var(--purple)" }} /></div>
                <div className="bar-val" style={{ flex: "0 0 90px" }}>
                  {r.total} · <span style={{ color: "var(--green)" }}>{r.hired} {t("hired", "contratados")}</span>
                </div>
              </div>
            ))}
          </div>

          <div className="sec-head">
            <span className="sec-title">💼 {t("By position", "Por puesto")}</span>
            <span className="sec-sub">{t("Same range, split by the role each candidate applied for", "Mismo rango, separado por el puesto al que aplicó cada candidato")}</span>
          </div>

          <div className="card">
            <h2>💼 {t("Candidates by position", "Candidatos por puesto")}</h2>
            {roleStats.map((r) => (
              <div key={r.name} className="bar-row">
                <div className="bar-label">{r.name}</div>
                <div className="bar-track">
                  <div className="bar-fill" style={{ width: Math.max(4, (r.total / maxRole) * 100) + "%", background: "var(--teal)" }} />
                </div>
                <div className="bar-val">{r.total}</div>
              </div>
            ))}
          </div>

          <div className="card">
            <h2>📈 {t("Performance by position", "Rendimiento por puesto")}</h2>
            <div style={{ overflowX: "auto" }}>
              <table className="cmp-tbl">
                <thead>
                  <tr>
                    <th>{t("Position", "Puesto")}</th>
                    <th>{t("Candidates", "Candidatos")}</th>
                    <th>{t("In pipeline", "En proceso")}</th>
                    <th>{t("Interviewed", "Entrevistados")}</th>
                    <th>{t("Avg score", "Puntaje prom.")}</th>
                    <th>{t("Hired", "Contratados")}</th>
                    <th>{t("Hire rate", "Tasa contratación")}</th>
                    <th>{t("Discarded", "Descartados")}</th>
                  </tr>
                </thead>
                <tbody>
                  {roleStats.map((r) => (
                    <tr key={r.name}>
                      <td className="rowh">{r.name}</td>
                      <td>{r.total}</td>
                      <td>{r.active}</td>
                      <td>{r.interviewed}</td>
                      <td style={{ color: "var(--amber)" }}>{fmtPct(r.avg)}</td>
                      <td style={{ color: "var(--green)" }}>{r.hired}</td>
                      <td style={{ fontWeight: 700 }}>{r.rate}%</td>
                      <td style={{ color: "var(--red)" }}>{r.discarded} <span style={{ color: "var(--gray)", fontWeight: 400 }}>({r.discardRate}%)</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="hint">{t("Which positions are hard to fill — low hire rate or high discard rate means the pipeline for that role needs attention.", "Qué puestos cuesta llenar — una tasa baja de contratación o alta de descarte indica que ese puesto necesita atención.")}</div>
          </div>

          <div className="card">
            <h2>🔻 {t("Pipeline by position", "Proceso por puesto")}</h2>
            <div style={{ overflowX: "auto" }}>
              <table className="cmp-tbl">
                <thead>
                  <tr>
                    <th>{t("Position", "Puesto")}</th>
                    {funnelStages.map((s) => (
                      <th key={s.key}><span className="dot" style={{ background: s.color }} /> {s.label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {roleStats.map((r) => (
                    <tr key={r.name}>
                      <td className="rowh">{r.name}</td>
                      {funnelStages.map((s) => {
                        const n = (byRole[r.name] || []).filter((c) => c.status === s.key).length;
                        return <td key={s.key} style={{ color: n ? "var(--ink)" : "var(--gray)", fontWeight: n ? 700 : 400 }}>{n}</td>;
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="hint">{t("Where each position's candidates are sitting right now.", "Dónde están parados ahora mismo los candidatos de cada puesto.")}</div>
          </div>
        </div>
      )}
    </div>
  );
}
