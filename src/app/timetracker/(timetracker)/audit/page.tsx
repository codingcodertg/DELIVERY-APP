"use client";

import { useMemo, useState } from "react";
import { useData } from "@/lib/timetracker-data-provider";
import { useT } from "@/lib/timetracker/i18n";
import { dateISO, fmtDT, fmtDayLong } from "@/lib/timetracker/helpers";
import { DayPhotos } from "@/components/timetracker/DayPhotos";

// Ported (D-071) from timetracker-clean's manager/AuditLog.jsx — grouped by
// day, with person + action filters. `auditLog` is kept live by the
// provider (latest 300, bounded — see its block comment).
//
// Desde D-109 esta pantalla tiene DOS vistas, y es el sitio donde entran las que vengan. El
// tab de fichaje se retira, y sus pantallas de gerente no merecen cada una un tab propio en
// la barra de Time Tracker: lo que se hace aquí es siempre la misma pregunta —qué pasó, quién
// y cuándo— así que el registro y las fotos que lo prueban van juntos, no separados por la
// barra de navegación.
export default function AuditLogPage() {
  const [view, setView] = useState<"log" | "photos">("log");
  const { me, auditLog: items, allEmployees: users } = useData();
  const t = useT();
  const [who, setWho] = useState("");
  const [action, setAction] = useState("");

  const uMap = useMemo(() => new Map(users.map((u) => [u.id, u])), [users]);
  const actionTypes = useMemo(() => Array.from(new Set(items.map((i) => i.action).filter((a): a is string => !!a))).sort(), [items]);

  const filtered = items.filter((i) => (!who || i.who === who) && (!action || i.action === action));

  const byDay = new Map<string, typeof items>();
  filtered.forEach((i) => {
    const d = i.at ? dateISO(new Date(i.at)) : "unknown";
    if (!byDay.has(d)) byDay.set(d, []);
    byDay.get(d)!.push(i);
  });
  const days = Array.from(byDay.keys()).sort().reverse();

  if (me.role !== "admin") return <div className="card"><p className="muted">Admins only.</p></div>;

  const switcher = (
    <div className="tabs" style={{ marginBottom: 12 }}>
      <button className={view === "log" ? "active" : ""} onClick={() => setView("log")}>📜 Log</button>
      <button className={view === "photos" ? "active" : ""} onClick={() => setView("photos")}>📷 Photos</button>
    </div>
  );

  if (view === "photos") return <>{switcher}<DayPhotos /></>;

  return (
    <>
    {switcher}
    <div className="card">
      <div className="between">
        <h2 style={{ margin: 0 }}>{t("mgr.audit.title")}</h2>
        <div className="row">
          <select value={who} onChange={(e) => setWho(e.target.value)} style={{ width: "auto" }}>
            <option value="">{t("mgr.audit.allPeople")}</option>
            {users.map((u) => <option key={u.id} value={u.id}>{u.fullName}</option>)}
          </select>
          <select value={action} onChange={(e) => setAction(e.target.value)} style={{ width: "auto" }}>
            <option value="">{t("mgr.audit.allActions")}</option>
            {actionTypes.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        </div>
      </div>

      {filtered.length === 0 ? (
        <p className="muted" style={{ marginTop: 12 }}>{t("mgr.audit.empty")}</p>
      ) : days.map((d) => (
        <details key={d} style={{ marginTop: 12 }}>
          <summary style={{ cursor: "pointer", fontWeight: 700 }}>
            {d === "unknown" ? t("mgr.audit.unknownDate") : fmtDayLong(d)} <span className="chip" style={{ marginLeft: 6 }}>{byDay.get(d)!.length}</span>
          </summary>
          <table style={{ marginTop: 6 }}>
            <thead><tr><th>{t("mgr.audit.time")}</th><th>{t("mgr.audit.who")}</th><th>{t("mgr.audit.action")}</th><th>{t("mgr.audit.detail")}</th></tr></thead>
            <tbody>
              {byDay.get(d)!.map((it) => (
                <tr key={it.id}>
                  <td className="small nowrap">{it.at ? fmtDT(new Date(it.at).getTime(), { hour: "2-digit", minute: "2-digit" }) : "…"}</td>
                  <td className="small">{(it.who && uMap.get(it.who)?.fullName) || "—"}</td>
                  <td className="small"><span className="chip">{it.action}</span></td>
                  <td className="small muted">{it.detail}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      ))}
    </div>
    </>
  );
}
