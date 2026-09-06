"use client";

import { useState } from "react";
import { useData } from "@/lib/recruiting-data-provider";
import { useUI } from "@/components/recruiting/ModalHost";
import { usePrefs } from "@/lib/prefs";
import type { Candidate } from "@/lib/recruiting/types";
import { fmtDateTime } from "@/lib/recruiting/utils";

export default function CalendarPage() {
  const { candidates } = useData();
  const ui = useUI();
  const { t, lang } = usePrefs();
  const loc = lang === "es" ? "es-US" : "en-US";
  const [ym, setYm] = useState(() => { const d = new Date(); return { y: d.getFullYear(), m: d.getMonth() }; });

  const first = new Date(ym.y, ym.m, 1);
  const startDow = first.getDay();
  const daysIn = new Date(ym.y, ym.m + 1, 0).getDate();
  const cells: (number | null)[] = [];
  for (let i = 0; i < startDow; i++) cells.push(null);
  for (let d = 1; d <= daysIn; d++) cells.push(d);

  type Ev = { c: Candidate; kind: "phone" | "inperson"; at: string };
  const evs: Record<number, Ev[]> = {};
  const pushEv = (c: Candidate, kind: Ev["kind"], at: string) => {
    const d = new Date(at);
    if (d.getFullYear() === ym.y && d.getMonth() === ym.m) {
      const day = d.getDate();
      (evs[day] = evs[day] || []).push({ c, kind, at });
    }
  };
  candidates.forEach((c) => {
    if (c.phone_date) pushEv(c, "phone", c.phone_date);
    if (c.inperson_date) pushEv(c, "inperson", c.inperson_date);
  });
  Object.values(evs).forEach((arr) => arr.sort((a, b) => a.at.localeCompare(b.at)));

  const today = new Date();
  const monthName = first.toLocaleDateString(loc, { month: "long", year: "numeric" });
  const dows = lang === "es"
    ? ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"]
    : ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  const cutoff = new Date(Date.now() - 864e5);
  const upcoming: Ev[] = candidates
    .flatMap((c) => [
      ...(c.phone_date ? [{ c, kind: "phone" as const, at: c.phone_date }] : []),
      ...(c.inperson_date ? [{ c, kind: "inperson" as const, at: c.inperson_date }] : []),
    ])
    .filter((ev) => new Date(ev.at) >= cutoff)
    .sort((a, b) => a.at.localeCompare(b.at))
    .slice(0, 8);

  return (
    <div>
      <div className="card">
        <div className="cal-head">
          <button className="btn btn-ghost btn-sm" onClick={() => setYm((p) => (p.m === 0 ? { y: p.y - 1, m: 11 } : { y: p.y, m: p.m - 1 }))}>← {t("Previous", "Anterior")}</button>
          <h2 style={{ margin: 0, textTransform: "capitalize" }}>{monthName}</h2>
          <button className="btn btn-ghost btn-sm" onClick={() => setYm((p) => (p.m === 11 ? { y: p.y + 1, m: 0 } : { y: p.y, m: p.m + 1 }))}>{t("Next", "Siguiente")} →</button>
        </div>
        <div className="cal-grid">
          {dows.map((d) => <div key={d} className="cal-dow">{d}</div>)}
          {cells.map((d, i) => {
            if (d === null) return <div key={i} className="cal-day other" />;
            const isToday = today.getFullYear() === ym.y && today.getMonth() === ym.m && today.getDate() === d;
            return (
              <div key={i} className={"cal-day" + (isToday ? " today" : "")}>
                <div className="cal-num">{d}</div>
                {(evs[d] || []).map((ev) => {
                  const tm = new Date(ev.at).toLocaleTimeString(loc, { hour: "2-digit", minute: "2-digit" });
                  const inperson = ev.kind === "inperson";
                  return (
                    <div
                      key={ev.c.id + ev.kind}
                      className="cal-ev"
                      title={ev.c.name + " · " + ev.c.role + (inperson ? t(" · In-person", " · Presencial") : t(" · Phone", " · Llamada"))}
                      style={inperson ? { background: "#dcfce7", color: "#15803d" } : undefined}
                      onClick={() => ui.openProfile(ev.c.id)}
                    >
                      {inperson ? "🤝 " : "☎ "}{tm} {ev.c.name.split(" ")[0]}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
        <div className="hint">{t("Tap an event to open that candidate's interview.", "Toca un evento para abrir la entrevista de ese candidato.")}</div>
      </div>

      <div className="card">
        <h2>📅 {t("Upcoming interviews", "Próximas entrevistas")}</h2>
        {upcoming.length === 0 && <div className="empty">{t("No interviews scheduled. Schedule from the Candidates tab.", "No hay entrevistas programadas. Programa desde la pestaña Candidatos.")}</div>}
        {upcoming.map((ev) => (
          <div key={ev.c.id + ev.kind} className="cand-row" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
            <div>
              <button onClick={() => ui.openProfile(ev.c.id)} title={t("Open profile", "Abrir perfil")} style={{ background: "none", border: "none", padding: 0, font: "inherit", fontWeight: 700, color: "inherit", cursor: "pointer", textDecoration: "underline dotted", textUnderlineOffset: 3 }}>{ev.c.name}</button> <span style={{ color: "var(--gray)" }}>· {ev.c.role} · {ev.c.phone}</span>
              <div style={{ color: ev.kind === "inperson" ? "var(--green-deep)" : "var(--accent)", fontWeight: 600, fontSize: 12.5, marginTop: 2 }}>
                {ev.kind === "inperson" ? "🤝 " + t("In-person", "Presencial") : "☎ " + t("Phone call", "Llamada")} · {fmtDateTime(ev.at)}
              </div>
            </div>
            {ev.kind === "phone" && <button className="btn btn-primary btn-sm" onClick={() => ui.openInterview(ev.c.id)}>🎤 {t("Interview", "Entrevista")}</button>}
          </div>
        ))}
      </div>
    </div>
  );
}
